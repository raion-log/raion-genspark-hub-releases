// ==================== RAION Genspark Hub v1.0.1 ====================
// 통합 백그라운드 서비스 워커 (이미지 + 채팅)
importScripts('auth.js');

console.log('[Controller] v1.0.1 로드됨');

// 사이드패널 활성 탭 추적
let sidePanelTabId = null;

const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/raion-log/raion-genspark-hub-releases/main/latest.json';
const UPDATE_ALARM_NAME = 'updateCheck';
const UPDATE_CHECK_INTERVAL_MINUTES = 60;

// ==================== 이미지 자동화 상태 ====================
let state = {
  isRunning: false,
  prompts: [],
  batches: [],
  settings: {},
  currentBatchIndex: 0,
  activeTabId: null,
  lastFailedIndex: -1,
  canRetry: false,
  processingBatch: false,
  currentStep: '',
  failedPrompts: [],
  downloadFolder: '',
  batchDownloaded: false
};

// ==================== 채팅 상태 ====================
let chatState = {
  activeProject: null,
  status: 'idle', // idle | injecting | waiting_ack | ready | sending | waiting_response
  activeTabId: null
};

// ==================== 상태 영속화 ====================
async function saveState() {
  const toSave = {
    isRunning: state.isRunning, prompts: state.prompts, batches: state.batches,
    settings: state.settings, currentBatchIndex: state.currentBatchIndex,
    activeTabId: state.activeTabId, lastFailedIndex: state.lastFailedIndex,
    canRetry: state.canRetry, currentStep: state.currentStep, savedAt: Date.now()
  };
  await chrome.storage.local.set({ automationState: toSave });
}

async function loadState() {
  const { automationState } = await chrome.storage.local.get('automationState');
  return automationState || null;
}

async function clearPersistedState() {
  await chrome.storage.local.remove('automationState');
}

async function saveChatState() {
  await chrome.storage.local.set({
    chatAutomationState: {
      activeProject: chatState.activeProject,
      status: chatState.status,
      activeTabId: chatState.activeTabId,
      savedAt: Date.now()
    }
  });
}

async function loadChatState() {
  const { chatAutomationState } = await chrome.storage.local.get('chatAutomationState');
  return chatAutomationState || null;
}

// 모델 목록
const IMAGE_MODELS = [
  'Nano Banana Pro', 'Nano Banana 2', 'Bytedance Seedream v5 Lite',
  'Flux 2', 'Flux 2 Pro', 'Z-Image Turbo', 'GPT Image 1.5',
  'Recraft V3', 'Ideogram V3', 'Qwen Image 2',
  'Recraft Clarity Upscale', 'Bria Background Remover', 'Text Removal'
];

const CHAT_MODELS = [
  'GPT-5 Pro', 'GPT-5.1 Instant', 'GPT-5.4', 'GPT-5.2', 'GPT-5.2 Pro', 'GPT-5.4 Pro', 'o3-pro',
  'Claude Sonnet 4.6', 'Claude Sonnet 4.5', 'Claude Opus 4.6', 'Claude Opus 4.5', 'Claude Haiku 4.5',
  'Gemini 2.5 Pro', 'Gemini 3 Flash Preview', 'Gemini 3.1 Pro Preview', 'Gemini 3 Pro Preview',
  'Grok4 0709'
];

// keepalive 알람
function startKeepalive() { chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }); }
function stopKeepalive() { chrome.alarms.clear('keepalive'); }

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'keepalive') {
    console.log('[Controller] keepalive');
    if (!state.isRunning && !state.processingBatch) {
      const saved = await loadState();
      if (saved?.isRunning && (Date.now() - saved.savedAt < 2 * 60 * 60 * 1000)) {
        Object.assign(state, saved);
        state.processingBatch = false;
        const tabId = await findGensparkTab('image');
        if (tabId) { state.activeTabId = tabId; await wait(1000); processBatch(); }
      }
    }
  }
  if (alarm.name === UPDATE_ALARM_NAME) {
    checkForUpdate();
  }
  if (alarm.name === 'raion-auto-backup') {
    autoBackupProjects();
  }
});

// ==================== 프로젝트 자동 백업 (2시간 주기) ====================
chrome.alarms.create('raion-auto-backup', { periodInMinutes: 120 });

async function autoBackupProjects() {
  try {
    const result = await chrome.storage.local.get(['raion_chat_projects', 'raion_chat_groups', 'raion_chat_order', 'raion_last_backup_hash']);
    const projects = result.raion_chat_projects || [];
    if (projects.length === 0) return; // 빈 데이터는 백업 안 함

    const data = {
      version: 2,
      projects,
      groups: result.raion_chat_groups || [],
      order: result.raion_chat_order || []
    };
    const json = JSON.stringify(data);
    const hash = json.length + '_' + projects.length; // 간단한 변경 감지
    if (hash === result.raion_last_backup_hash) {
      console.log('[Controller] 자동 백업: 변경 없음, 스킵');
      return;
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: 'raion-genspark-backup.json',
      saveAs: false,
      conflictAction: 'overwrite'
    });
    await chrome.storage.local.set({ raion_last_backup_hash: hash });
    console.log('[Controller] 자동 백업 완료');
  } catch (e) {
    console.warn('[Controller] 자동 백업 실패:', e.message);
  }
}

// 사이드패널 설정
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setOptions?.({ enabled: false }).catch(() => {});
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
  chrome.alarms.create(UPDATE_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES
  });
});

chrome.action.onClicked.addListener((tab) => {
  sidePanelTabId = tab.id;
  chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
  chrome.sidePanel.open({ tabId: tab.id });
});

// 탭 전환 시 사이드패널 비활성화 (열었던 탭에서만 유지)
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (sidePanelTabId && tabId !== sidePanelTabId) {
    chrome.sidePanel.setOptions({ tabId, enabled: false });
  }
});

// ==================== 메시지 수신 ====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CHECK_UPDATE_NOW') {
    checkForUpdate();
    return;
  }

  switch (msg.type) {
    // 이미지 자동화
    case 'START_AUTOMATION': startAutomation(msg); break;
    case 'STOP_AUTOMATION': stopAutomation(); break;
    case 'RETRY_AUTOMATION': retryAutomation(msg); break;
    case 'SKIP_BATCH': skipBatch(msg); break;
    case 'DOWNLOAD_NOW':
      downloadNow().then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    case 'GET_RETRY_STATUS':
      sendResponse({ canRetry: state.canRetry, lastFailedIndex: state.lastFailedIndex });
      return true;
    case 'GET_STATUS':
      sendResponse({
        isRunning: state.isRunning, currentBatchIndex: state.currentBatchIndex,
        totalBatches: state.batches.length, canRetry: state.canRetry,
        lastFailedIndex: state.lastFailedIndex, processingBatch: state.processingBatch,
        currentStep: state.currentStep
      });
      return true;

    // 채팅 자동화
    case 'CHAT_ACTIVATE_PROJECT': handleChatActivateProject(msg); break;
    case 'CHAT_SEND_USER_MESSAGE': handleChatSendMessage(msg); break;
    case 'CHAT_DEACTIVATE': handleChatDeactivate(); break;
    case 'CHAT_GET_STATUS':
      sendResponse({ ...chatState });
      return true;
  }
});

// ==================== 이미지 자동화 (기존 로직) ====================

async function startAutomation(msg) {
  const authResult = await Auth.verify();
  if (!authResult.valid) {
    broadcast('인증이 필요합니다. 로그인 후 다시 시도해주세요.', 0);
    chrome.runtime.sendMessage({ type: 'AUTH_REQUIRED' });
    return;
  }

  startKeepalive();
  state.isRunning = true;
  state.prompts = msg.prompts;
  state.settings = msg.settings;
  state.currentBatchIndex = 0;
  state.lastFailedIndex = -1;
  state.canRetry = false;
  state.processingBatch = false;
  state.failedPrompts = [];
  state.downloadFolder = createKSTFolder();
  state.batchDownloaded = false;
  state.batches = splitIntoBatches(state.prompts, state.settings.batchSize || 5, state.settings.startNumber || 1);

  broadcast('자동화 시작...', 0);
  await saveState();
  await navigateToGensparkPage();
}

function splitIntoBatches(prompts, batchSize, startNumber = 1) {
  const batches = [];
  const indexed = prompts.map((p, i) => ({ originalIndex: i + startNumber, prompt: p }));
  for (let i = 0; i < indexed.length; i += batchSize) batches.push(indexed.slice(i, i + batchSize));
  return batches;
}

function isValidGensparkPage(url) {
  return url.includes('genspark.ai/ai_image') ||
         url.includes('genspark.ai/agents?id=') ||
         url.includes('genspark.ai/agents?type=');
}

async function navigateToGensparkPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { broadcast('탭 없음', 0); state.isRunning = false; return; }
    const url = tab.url || '';
    if (isValidGensparkPage(url)) {
      state.activeTabId = tab.id;
      await wait(1500);
      processBatch();
    } else {
      await chrome.tabs.update(tab.id, { url: 'https://www.genspark.ai/ai_image' });
      state.activeTabId = tab.id;
    }
  } catch (error) {
    broadcast('페이지 이동 실패', 0);
    state.isRunning = false;
  }
}

// 탭 닫힘 감지
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === sidePanelTabId) sidePanelTabId = null;
  if (!state.isRunning || tabId !== state.activeTabId) return;
  stopKeepalive();
  state.isRunning = false;
  state.processingBatch = false;
  state.currentStep = '';
  state.canRetry = true;
  state.lastFailedIndex = state.currentBatchIndex;
  state.activeTabId = null;
  await saveState();
  broadcast('Genspark 탭이 닫혔습니다. 탭을 다시 열고 재시도 버튼을 눌러주세요.', 0, 'TAB_CLOSED', 0, true);
});

// 페이지 로드 감지
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!state.isRunning) return;
  if (info.status !== 'complete') return;
  if (state.activeTabId && tabId !== state.activeTabId) return;
  if (state.processingBatch) return;
  const url = tab.url || '';
  if (isValidGensparkPage(url)) {
    state.activeTabId = tabId;
    await wait(2000);
    if (state.isRunning && !state.processingBatch) processBatch();
  }
});

async function processBatch() {
  if (!state.isRunning) return;

  const authCheck = await Auth.verify();
  if (!authCheck.valid) {
    broadcast((authCheck.message || '인증이 만료되었습니다.'), 0);
    chrome.runtime.sendMessage({ type: 'AUTH_REQUIRED' });
    stopAutomation();
    return;
  }

  if (state.currentBatchIndex >= state.batches.length) { complete(); return; }
  if (state.processingBatch) return;

  state.processingBatch = true;
  const batch = state.batches[state.currentBatchIndex];
  const batchNum = state.currentBatchIndex + 1;
  const totalBatches = state.batches.length;
  const baseProgress = (state.currentBatchIndex / totalBatches) * 100;

  broadcast(`[${batchNum}/${totalBatches}] 배치 처리 중...`, baseProgress, 'BATCH_START', 0);

  try {
    const resumeFromWait = (state.currentStep === 'sent' || state.currentStep === 'waiting');

    if (!resumeFromWait) {
      if (state.currentBatchIndex === 0 && state.currentStep !== 'input') {
        state.currentStep = 'settings';
        broadcast(`[${batchNum}/${totalBatches}] 모델 선택 중...`, baseProgress, 'DO_SELECT_MODEL', 5);
        const modelResult = await sendCmd(state.activeTabId, 'DO_SELECT_MODEL', { model: state.settings.model || 'Nano Banana Pro' });
        if (!modelResult.success && !modelResult.alreadySelected) throw new Error(modelResult.error || '모델 선택 실패');
        await wait(300);

        if (state.settings.imageSize && state.settings.imageSize !== '자동') {
          await sendCmd(state.activeTabId, 'DO_SELECT_IMAGE_SIZE', { size: state.settings.imageSize });
          await wait(300);
        }
        if (state.settings.aspectRatio) {
          await sendCmd(state.activeTabId, 'DO_SELECT_ASPECT_RATIO', { ratio: state.settings.aspectRatio });
          await wait(300);
        }
        if (state.settings.autoPrompt === 'off') {
          await sendCmd(state.activeTabId, 'DO_DISABLE_AUTO_PROMPT');
          await wait(300);
        }
      }

      state.currentStep = 'input';
      const message = generateBatchMessage(batch);
      broadcast(`[${batchNum}/${totalBatches}] 프롬프트 입력 중...`, baseProgress + 5, 'DO_INPUT_PROMPT', 20);
      const inputResult = await sendCmd(state.activeTabId, 'DO_INPUT_PROMPT', { message });
      if (!inputResult.success) throw new Error(inputResult.error || '프롬프트 입력 실패');
      await wait(500);

      broadcast(`[${batchNum}/${totalBatches}] 전송 중...`, baseProgress + 10, 'DO_SEND', 30);
      const sendResult = await sendCmd(state.activeTabId, 'DO_SEND');
      if (!sendResult.success) throw new Error(sendResult.error || '전송 실패');

      state.currentStep = 'sent';
      await saveState();
    }

    state.currentStep = 'waiting';
    const fileNumbers = batch.map(item => item.originalIndex);
    broadcast(`[${batchNum}/${totalBatches}] 이미지 생성 중...`, baseProgress + 15, 'DO_WAIT_GENERATION', 50);
    const waitResult = await sendCmd(state.activeTabId, 'DO_WAIT_GENERATION', {
      expectedCount: batch.length, maxWaitSec: state.settings.generationWaitSec || 120, fileNumbers: fileNumbers
    });

    // NSFW 감지 시 기록하고 계속 진행
    if (waitResult.nsfwDetected) {
      console.log('[Controller] NSFW 감지 - 기록 후 계속 진행');
      for (const item of batch) {
        state.failedPrompts.push({ index: item.originalIndex, prompt: item.prompt, reason: 'NSFW' });
      }
      broadcast(`[${batchNum}/${totalBatches}] NSFW 감지 - 다음 배치 진행`, baseProgress + 100 / totalBatches, 'NSFW_SKIP', 100);
    }

    if (waitResult.error === 'RATE_LIMIT') {
      state.isRunning = false;
      state.processingBatch = false;
      state.canRetry = true;
      state.lastFailedIndex = state.currentBatchIndex;
      await saveState();
      broadcast('5시간 제한 도달 - 다운로드 버튼으로 생성된 이미지를 저장하세요.', 0, 'RATE_LIMIT', 0, true);
      chrome.runtime.sendMessage({ type: 'AUTOMATION_ERROR', error: '5시간 제한 도달', failedIndex: state.currentBatchIndex }).catch(() => {});
      return;
    }

    // 생성 실패 시 기록하고 계속 진행
    if (!waitResult.success || waitResult.generatedCount === 0) {
      console.log('[Controller] 이미지 생성 실패 - 기록 후 계속 진행');
      for (const item of batch) {
        state.failedPrompts.push({ index: item.originalIndex, prompt: item.prompt, reason: '생성 실패' });
      }
      broadcast(`[${batchNum}/${totalBatches}] 생성 실패 - 다음 배치 진행`, baseProgress + 100 / totalBatches, 'GEN_FAIL_SKIP', 100);
    }

    if (waitResult.missingCount > 0 && waitResult.missingIndices?.length > 0) {
      await sendCmd(state.activeTabId, 'DO_REQUEST_REGENERATE', { missingIndices: waitResult.missingIndices, model: state.settings.model });
      await wait(1000);
      await sendCmd(state.activeTabId, 'DO_WAIT_GENERATION', { expectedCount: waitResult.missingCount, maxWaitSec: 60 });
    }

    // 배치별 다운로드 (local 방식)
    if (state.settings.downloadMethod === 'local' && waitResult.generatedCount > 0) {
      broadcast(`[${batchNum}/${totalBatches}] 이미지 다운로드 중...`, baseProgress + 80, 'DOWNLOADING', 80);
      const collectResult = await sendCmd(state.activeTabId, 'DO_COLLECT_IMAGE_URLS');
      if (collectResult?.success && collectResult.urls?.length > 0) {
        const successNums = waitResult.successFileNumbers || fileNumbers;
        const mappedNumbers = collectResult.urls.map((_, i) => successNums[i] || (fileNumbers[0] + i));
        await convertAndDownloadImages(state.activeTabId, collectResult.urls, state.downloadFolder, mappedNumbers);
        state.batchDownloaded = true;
      }
    }

    broadcast(`[${batchNum}/${totalBatches}] 배치 완료`, baseProgress + 100 / totalBatches, 'BATCH_COMPLETE', 100);
    state.currentBatchIndex++;
    state.currentStep = '';
    state.processingBatch = false;
    await saveState();

    if (state.currentBatchIndex < state.batches.length && state.isRunning) {
      broadcast('다음 배치 준비 중...', (state.currentBatchIndex / totalBatches) * 100, 'NEXT_BATCH', 0);
      // Genspark 응답 완료 대기 (AbortError 방지)
      await sendCmd(state.activeTabId, 'WAIT_IDLE', { maxWaitMs: 30000 });
      await wait(1000);
      processBatch();
    } else if (state.isRunning) {
      complete();
    }
  } catch (error) {
    state.isRunning = false;
    state.processingBatch = false;
    state.currentStep = '';
    state.canRetry = true;
    state.lastFailedIndex = state.currentBatchIndex;
    await saveState();
    broadcast(`오류: ${error.message}`, 0, 'ERROR', 0, true);
    chrome.runtime.sendMessage({ type: 'AUTOMATION_ERROR', error: error.message, failedIndex: state.currentBatchIndex }).catch(() => {});
  }
}

function generateBatchMessage(batch) {
  const lines = batch.map(item => `${item.originalIndex}. ${item.prompt}`).join('\n');
  const fileNumbers = batch.map(item => item.originalIndex).join(', ');
  return `아래 프롬프트로 이미지를 생성하고, 파일명은 각각 ${fileNumbers}로 지정해줘.\n\n${lines}`;
}

async function stopAutomation() {
  stopKeepalive();
  const stoppedAt = state.currentBatchIndex;
  state.isRunning = false;
  state.processingBatch = false;
  state.currentStep = '';
  state.canRetry = true;
  state.lastFailedIndex = stoppedAt;
  await clearPersistedState();
  broadcast('중지됨', 0, '', 0, true);
}

async function retryAutomation(msg) {
  const failedIndex = msg.failedIndex ?? state.lastFailedIndex;
  if (failedIndex < 0) return;
  if (msg.prompts && msg.settings) {
    state.prompts = msg.prompts;
    state.settings = msg.settings;
    state.batches = splitIntoBatches(state.prompts, state.settings.batchSize || 5, state.settings.startNumber || 1);
  }
  if (!state.batches || state.batches.length === 0) {
    broadcast('재시도 실패 - 시작 버튼으로 다시 실행해주세요.', 0);
    return;
  }
  startKeepalive();
  state.isRunning = true;
  state.currentBatchIndex = failedIndex;
  state.lastFailedIndex = -1;
  state.canRetry = false;
  state.processingBatch = false;
  state.currentStep = '';
  await saveState();
  broadcast(`재시도 (배치 ${failedIndex + 1}부터)...`, (failedIndex / state.batches.length) * 100);
  processBatch();
}

async function skipBatch(msg) {
  const failedIndex = msg.failedIndex ?? state.lastFailedIndex;
  if (failedIndex < 0) return;
  if (msg.prompts && msg.settings) {
    state.prompts = msg.prompts;
    state.settings = msg.settings;
    state.batches = splitIntoBatches(state.prompts, state.settings.batchSize || 5, state.settings.startNumber || 1);
  }
  const nextIndex = failedIndex + 1;
  if (nextIndex >= (state.batches?.length || 0)) {
    broadcast('마지막 배치를 건너뛰었습니다.', 100);
    state.canRetry = false;
    state.lastFailedIndex = -1;
    await clearPersistedState();
    chrome.runtime.sendMessage({ type: 'AUTOMATION_COMPLETE' }).catch(() => {});
    return;
  }
  startKeepalive();
  state.isRunning = true;
  state.currentBatchIndex = nextIndex;
  state.lastFailedIndex = -1;
  state.canRetry = false;
  state.processingBatch = false;
  state.currentStep = '';
  await saveState();
  broadcast(`배치 ${failedIndex + 1} 건너뛰기 → ${nextIndex + 1}부터 계속...`, (nextIndex / state.batches.length) * 100);
  processBatch();
}

// ==================== PNG 변환 후 다운로드 (onDeterminingFilename 방식) ====================
async function convertAndDownloadImages(tabId, urls, folder, fileNumbers) {
  let downloadCount = 0;
  for (let i = 0; i < urls.length; i++) {
    const num = Array.isArray(fileNumbers) ? fileNumbers[i] : (fileNumbers + i);
    const filename = `${folder}/${num}.png`;
    try {
      const convertResult = await sendCmd(tabId, 'DO_CONVERT_SINGLE_IMAGE', { srcUrl: urls[i] });
      const downloadUrl = convertResult?.success ? convertResult.dataUrl : urls[i];

      // onDeterminingFilename으로 파일명 강제 지정
      await new Promise((resolve, reject) => {
        const listener = (item, suggest) => {
          suggest({ filename: filename, conflictAction: 'uniquify' });
          chrome.downloads.onDeterminingFilename.removeListener(listener);
        };
        chrome.downloads.onDeterminingFilename.addListener(listener);

        chrome.downloads.download({ url: downloadUrl }, (downloadId) => {
          if (chrome.runtime.lastError) {
            chrome.downloads.onDeterminingFilename.removeListener(listener);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            setTimeout(() => {
              try { chrome.downloads.onDeterminingFilename.removeListener(listener); } catch(e) {}
            }, 10000);
            resolve(downloadId);
          }
        });
      });

      downloadCount++;
      console.log(`[Controller] 다운로드 완료: ${filename}`);
    } catch (e) {
      console.error(`[Controller] 다운로드 실패 (${filename}):`, e);
    }
  }
  return downloadCount;
}

async function downloadNow() {
  if (!state.activeTabId) return { success: false, error: '활성 탭 없음' };
  try {
    const collectResult = await sendCmd(state.activeTabId, 'DO_COLLECT_IMAGE_URLS');
    if (!collectResult?.success || !collectResult.urls?.length) return { success: false, error: '다운로드할 이미지가 없습니다.' };
    const folder = state.downloadFolder || createKSTFolder();
    const startNum = state.settings?.startNumber || 1;
    const count = await convertAndDownloadImages(state.activeTabId, collectResult.urls, folder, startNum);
    return { success: true, count };
  } catch (e) { return { success: false, error: e.message }; }
}

async function complete() {
  if (!state.isRunning) return;
  state.isRunning = false;

  const downloadMethod = state.settings.downloadMethod || 'ai-drive';
  try {
    if (downloadMethod === 'local') {
      if (state.batchDownloaded) {
        await wait(1000);
        const collectResult = await sendCmd(state.activeTabId, 'DO_COLLECT_IMAGE_URLS');
        if (collectResult?.success && collectResult.urls?.length > 0) {
          broadcast('남은 이미지 다운로드 중...', 90, 'DOWNLOADING', 90);
          const folder = state.downloadFolder || createKSTFolder();
          const startNum = state.settings?.startNumber || 1;
          await convertAndDownloadImages(state.activeTabId, collectResult.urls, folder, startNum);
        }
      } else {
        broadcast('이미지 URL 수집 중...', 85, 'COLLECTING_URLS', 85);
        await wait(3000);
        const collectResult = await sendCmd(state.activeTabId, 'DO_COLLECT_IMAGE_URLS');
        if (collectResult?.success && collectResult.urls?.length > 0) {
          broadcast('PC에 이미지 다운로드 중...', 90, 'DOWNLOADING', 90);
          const folder = state.downloadFolder || createKSTFolder();
          const startNum = state.settings?.startNumber || 1;
          await convertAndDownloadImages(state.activeTabId, collectResult.urls, folder, startNum);
        }
      }
    } else {
      broadcast('Genspark 처리 완료 대기 중...', 85, 'WAITING_IDLE', 85);
      await wait(5000);
      broadcast('AI 드라이브 저장 요청 중...', 90, 'DO_REQUEST_SAVE_TO_DRIVE', 90);
      await sendCmd(state.activeTabId, 'DO_REQUEST_SAVE_TO_DRIVE');
      broadcast('저장 완료 대기 중...', 95, 'DO_WAIT_SAVE_COMPLETE', 95);
      await sendCmd(state.activeTabId, 'DO_WAIT_SAVE_COMPLETE', { maxWaitSec: 120 });
    }
  } catch (error) {
    console.error('[Controller] 저장 실패:', error);
  }

  stopKeepalive();
  state.processingBatch = false;
  state.currentStep = '';
  state.currentBatchIndex = 0;
  await clearPersistedState();

  const failed = state.failedPrompts || [];
  if (failed.length > 0) {
    const failedMsg = failed.map(f => `#${f.index} (${f.reason})`).join(', ');
    broadcast(`완료 (일부 실패: ${failedMsg})`, 100);
    chrome.runtime.sendMessage({ type: 'AUTOMATION_COMPLETE_WITH_FAILURES', failedPrompts: failed }).catch(() => {});
  } else {
    broadcast('모든 작업 완료!', 100);
    chrome.runtime.sendMessage({ type: 'AUTOMATION_COMPLETE' }).catch(() => {});
  }
  state.failedPrompts = [];
}

// ==================== 채팅 자동화 ====================

async function handleChatActivateProject(msg) {
  const authResult = await Auth.verify();
  if (!authResult.valid) {
    chrome.runtime.sendMessage({ type: 'AUTH_REQUIRED' });
    return;
  }

  chatState.activeProject = msg.project;
  chatState.status = 'injecting';
  await saveChatState();

  chrome.runtime.sendMessage({ type: 'CHAT_STATUS_UPDATE', status: 'injecting', message: '시스템 프롬프트 전송 중...' }).catch(() => {});

  try {
    // 1. 채팅 페이지 확인/이동
    chrome.runtime.sendMessage({ type: 'CHAT_STATUS_UPDATE', status: 'injecting', message: '채팅 페이지 준비 중...' }).catch(() => {});
    const tabId = await findOrNavigateToChatPage();
    if (!tabId) {
      chatState.status = 'idle';
      chrome.runtime.sendMessage({ type: 'CHAT_STATUS_UPDATE', status: 'error', message: '채팅 페이지를 열 수 없습니다.' }).catch(() => {});
      return;
    }
    chatState.activeTabId = tabId;

    // 페이지 로드 대기
    const statusUpdate = (status, message) => {
      chrome.runtime.sendMessage({ type: 'CHAT_STATUS_UPDATE', status, message }).catch(() => {});
    };

    const mode = msg.mode || 'new';
    statusUpdate('injecting', '준비 중...');

    if (mode === 'new') {
      // 현재 탭이 이미 새 채팅 페이지인지 확인
      const tab = await chrome.tabs.get(tabId);
      const isAlreadyFresh = tab.url && tab.url.includes('genspark.ai/agents?type=');

      if (!isAlreadyFresh) {
        // 기존 채팅 중이면 새 페이지로 이동
        statusUpdate('injecting', '새 채팅 준비 중...');
        await chrome.tabs.update(tabId, { url: 'https://www.genspark.ai/agents?type=ai_chat' });

        await new Promise((resolve) => {
          const listener = (tid, info) => {
            if (tid === tabId && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
        });
        await wait(1500);
      }
    }

    // content script 연결 확인
    let pingOk = false;
    for (let i = 0; i < 5; i++) {
      try {
        const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
        if (ping?.success) { pingOk = true; break; }
      } catch (e) {
        try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content-chat.js'] }); } catch (injectErr) {}
        await wait(1500);
      }
    }

    if (!pingOk) {
      chatState.status = 'idle';
      statusUpdate('error', '페이지 연결 실패. 새로고침 후 다시 시도해주세요.');
      return;
    }

    // 새 채팅 모드: 모델 선택
    if (mode === 'new' && msg.project.model) {
      statusUpdate('injecting', '모델 설정 중...');
      await sendChatCmd(tabId, 'CHAT_SELECT_MODEL', { model: msg.project.model });
      await wait(500);
    }

    // 참고 파일 첨부 (네이티브 첨부 시도 → 실패 시 텍스트 합성 fallback)
    const refFiles = msg.project.referenceFiles;
    let refFilesAttached = false;
    if (refFiles && refFiles.length > 0) {
      statusUpdate('injecting', '참고 파일 첨부 중...');
      try {
        const attachResult = await sendChatCmd(tabId, 'CHAT_ATTACH_FILES', {
          files: refFiles.map(f => ({ name: f.name, content: f.content }))
        });
        if (attachResult.success) {
          refFilesAttached = true;
          console.log('[ChatMgr] 네이티브 첨부 성공:', attachResult.attached);
        } else {
          console.log('[ChatMgr] 네이티브 첨부 실패, 텍스트 fallback:', attachResult.error);
        }
      } catch (e) {
        console.log('[ChatMgr] 네이티브 첨부 오류, 텍스트 fallback:', e.message);
      }
    }

    // 지침서 전송 (네이티브 첨부 실패 시 참고 파일 텍스트 합성)
    statusUpdate('injecting', '지침서 전송 중...');
    let fullPrompt = msg.project.systemPrompt;
    if (refFiles && refFiles.length > 0 && !refFilesAttached) {
      fullPrompt += '\n\n========================================\n';
      fullPrompt += '참고 파일 (Reference Files)\n';
      fullPrompt += '========================================\n';
      for (const file of refFiles) {
        fullPrompt += `\n--- [${file.name}] ---\n`;
        fullPrompt += file.content;
        fullPrompt += `\n--- [/${file.name}] ---\n`;
      }
    }
    const injectResult = await sendChatCmd(tabId, 'CHAT_INJECT_PROMPT', { systemPrompt: fullPrompt });
    if (!injectResult.success) {
      chatState.status = 'idle';
      statusUpdate('error', '지침서 전송 실패');
      return;
    }

    // AI 응답 대기
    chatState.status = 'waiting_ack';
    statusUpdate('waiting_ack', 'AI 응답 대기 중...');
    const ackResult = await sendChatCmd(tabId, 'CHAT_WAIT_ACKNOWLEDGMENT', { maxWaitSec: 120 });

    if (ackResult.success) {
      chatState.status = 'ready';
      await saveChatState();
      statusUpdate('ready', '준비 완료');
    } else {
      chatState.status = 'idle';
      statusUpdate('error', 'AI 응답 대기 실패');
    }
  } catch (error) {
    chatState.status = 'idle';
    chrome.runtime.sendMessage({ type: 'CHAT_STATUS_UPDATE', status: 'error', message: '오류: ' + error.message }).catch(() => {});
  }
}

async function handleChatSendMessage(msg) {
  if (chatState.status !== 'ready') {
    chrome.runtime.sendMessage({ type: 'CHAT_STATUS_UPDATE', status: chatState.status, message: '프로젝트가 아직 준비되지 않았습니다.' }).catch(() => {});
    return;
  }

  chatState.status = 'sending';
  chrome.runtime.sendMessage({ type: 'CHAT_STATUS_UPDATE', status: 'sending', message: '메시지 전송 중...' }).catch(() => {});

  try {
    // 메시지 전송
    const sendResult = await sendChatCmd(chatState.activeTabId, 'CHAT_SEND_MESSAGE', { message: msg.message });
    if (!sendResult.success) {
      chatState.status = 'ready';
      chrome.runtime.sendMessage({ type: 'CHAT_STATUS_UPDATE', status: 'error', message: '전송 실패: ' + sendResult.error }).catch(() => {});
      return;
    }

    // 응답 대기
    chatState.status = 'waiting_response';
    chrome.runtime.sendMessage({ type: 'CHAT_STATUS_UPDATE', status: 'waiting_response', message: 'AI 응답 대기 중...' }).catch(() => {});
    const waitResult = await sendChatCmd(chatState.activeTabId, 'CHAT_WAIT_RESPONSE', { maxWaitSec: 120 });

    // 응답 텍스트 추출
    const responseResult = await sendChatCmd(chatState.activeTabId, 'CHAT_GET_LAST_RESPONSE');

    chatState.status = 'ready';
    chrome.runtime.sendMessage({
      type: 'CHAT_RESPONSE',
      text: responseResult?.text || '[응답을 가져올 수 없습니다]',
      success: waitResult.success
    }).catch(() => {});
  } catch (error) {
    chatState.status = 'ready';
    chrome.runtime.sendMessage({ type: 'CHAT_STATUS_UPDATE', status: 'error', message: '오류: ' + error.message }).catch(() => {});
  }
}

async function handleChatDeactivate() {
  chatState.activeProject = null;
  chatState.status = 'idle';
  chatState.activeTabId = null;
  await chrome.storage.local.remove('chatAutomationState');
  chrome.runtime.sendMessage({ type: 'CHAT_STATUS_UPDATE', status: 'idle', message: '' }).catch(() => {});
}

async function findOrNavigateToChatPage() {
  // 항상 현재 활성 탭 사용
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return null;

    const url = tab.url || '';
    if (url.includes('genspark.ai/agents')) {
      console.log('[Controller] 활성 탭이 이미 채팅 페이지:', tab.id);
      return tab.id;
    }

    // 채팅 페이지가 아니면 이동
    console.log('[Controller] 활성 탭을 채팅 페이지로 이동:', tab.id);
    await chrome.tabs.update(tab.id, { url: 'https://www.genspark.ai/agents?type=ai_chat' });

    // 페이지 로드 완료 대기
    await new Promise((resolve) => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
    });
    await wait(2000);
    return tab.id;
  } catch (e) {
    console.error('[Controller] 탭 탐색 실패:', e);
    return null;
  }
}

// ==================== 유틸리티 ====================

function broadcast(status, progress, step = '', stepProgress = 0, showRetry = false) {
  chrome.runtime.sendMessage({
    type: 'UPDATE_STATUS', status, progress,
    currentBatchIndex: state.currentBatchIndex, currentStep: step,
    stepProgress, canRetry: showRetry || state.canRetry,
    lastFailedIndex: state.lastFailedIndex
  }).catch(() => {});
}

// content-image.js에 명령 전송
async function sendCmd(tabId, type, data = {}, maxRetries = 3) {
  if (!tabId) {
    const found = await findGensparkTab('image');
    if (found) { tabId = found; state.activeTabId = found; }
    else return { success: false, error: 'Genspark 탭을 찾을 수 없음' };
  }

  const timeoutMap = {
    'DO_WAIT_GENERATION': (data.maxWaitSec || 600) * 1000 + 300000,
    'DO_COLLECT_IMAGE_URLS': 30000,
    'DO_CONVERT_SINGLE_IMAGE': 30000,
    'WAIT_INPUT_READY': 30000,
  };
  const timeoutMs = timeoutMap[type] || 30000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tabId, { type, ...data }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${type} 응답 타임아웃 (${Math.round(timeoutMs/1000)}초)`)), timeoutMs))
      ]);
      return response || { success: false, error: '응답 없음' };
    } catch (error) {
      if (attempt < maxRetries) {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content-image.js'] });
          await wait(1000);
        } catch (e) {}
      } else {
        return { success: false, error: error.message };
      }
    }
  }
  return { success: false, error: '최대 재시도 초과' };
}

// content-chat.js에 명령 전송
async function sendChatCmd(tabId, type, data = {}, maxRetries = 3) {
  if (!tabId) return { success: false, error: '채팅 탭 없음' };
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type, ...data });
      // content-image.js가 응답하지 않으면 undefined 반환 → 재시도
      if (response === undefined) {
        if (attempt < maxRetries) {
          console.log(`[Controller] sendChatCmd ${type}: 응답 없음, 재시도 ${attempt + 1}/${maxRetries}`);
          await wait(1000);
          continue;
        }
        return { success: false, error: '응답 없음' };
      }
      return response;
    } catch (error) {
      if (attempt < maxRetries) {
        console.log(`[Controller] sendChatCmd ${type}: 오류 → 스크립트 재주입 (${attempt}/${maxRetries})`);
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['content-chat.js'] });
          await wait(2000);
        } catch (e) {}
      } else {
        return { success: false, error: error.message };
      }
    }
  }
  return { success: false, error: '최대 재시도 초과' };
}

async function findGensparkTab(mode = 'image') {
  try {
    const tabs = await chrome.tabs.query({ url: '*://www.genspark.ai/*' });
    for (const tab of tabs) {
      const url = tab.url || '';
      if (mode === 'image' && isValidGensparkPage(url)) return tab.id;
      if (mode === 'chat' && url.includes('agents')) return tab.id;
    }
  } catch (e) {}
  return null;
}

// KST 기준 폴더명 생성
function createKSTFolder() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = String(kst.getUTCFullYear()).slice(2);
  const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${y}${mo}${d}_${h}${mi}`;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// SW 자동 재개
(async function tryResume() {
  const saved = await loadState();
  if (!saved || !saved.isRunning) return;
  if (Date.now() - saved.savedAt > 2 * 60 * 60 * 1000) { await clearPersistedState(); return; }
  Object.assign(state, saved);
  state.processingBatch = false;
  startKeepalive();
  const tabId = await findGensparkTab('image');
  if (tabId) {
    state.activeTabId = tabId;
    await wait(2000);
    processBatch();
  } else {
    state.canRetry = true;
    state.lastFailedIndex = state.currentBatchIndex;
    state.isRunning = false;
    await saveState();
    broadcast('서비스 워커 재시작 - Genspark 탭을 찾을 수 없습니다.', 0, 'SW_RESTART_NO_TAB', 0, true);
  }
})();

console.log('[Controller] 준비 완료');

// ==================== 업데이트 체크 ====================
function isNewerVersion(remote, local) {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

async function checkForUpdate() {
  try {
    const currentVersion = chrome.runtime.getManifest().version;
    console.log(`[Update] 업데이트 확인 중... (현재: v${currentVersion})`);
    chrome.runtime.sendMessage({ type: 'UPDATE_CHECK_STATUS', status: 'checking' }).catch(() => {});

    const response = await fetch(UPDATE_CHECK_URL, { cache: 'no-store' });
    if (!response.ok) {
      chrome.runtime.sendMessage({ type: 'UPDATE_CHECK_STATUS', status: 'latest' }).catch(() => {});
      return;
    }

    const latest = await response.json();
    if (!latest.version || !latest.download_url) return;

    if (isNewerVersion(latest.version, currentVersion)) {
      console.log(`[Update] 새 버전 발견: v${latest.version}`);
      await chrome.storage.local.set({
        availableUpdate: {
          version: latest.version,
          changelog: latest.changelog || '',
          download_url: latest.download_url,
          released_at: latest.released_at || ''
        }
      });
      chrome.runtime.sendMessage({
        type: 'UPDATE_AVAILABLE',
        version: latest.version,
        changelog: latest.changelog || '',
        download_url: latest.download_url
      }).catch(() => {});
    } else {
      console.log(`[Update] 최신 버전 사용 중 (v${currentVersion})`);
      await chrome.storage.local.remove('availableUpdate');
      chrome.runtime.sendMessage({ type: 'UPDATE_CHECK_STATUS', status: 'latest' }).catch(() => {});
    }
  } catch (error) {
    console.error('[Update] 체크 실패:', error.message);
  }
}

setTimeout(() => checkForUpdate(), 7000);
