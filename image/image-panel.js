// ==================== RAION Genspark Hub - 이미지 생성 패널 ====================
// 기존 sidepanel.js를 네임스페이스로 래핑

window.ImagePanel = (function() {
  'use strict';

  console.log('[ImagePanel] 로드됨');

  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  let state = {
    prompts: [],
    batchSize: 5,
    model: 'Nano Banana Pro',
    imageSize: '자동',
    aspectRatio: '16:9',
    autoPrompt: 'off',
    generationWaitSec: 600,
    startNumber: 1,
    downloadMethod: 'local',
    isRunning: false,
    currentBatchIndex: -1,
    totalBatches: 0,
    currentStep: '',
    stepProgress: 0,
    canRetry: false,
    lastFailedIndex: -1,
    statusMessage: ''
  };

  // ========== 초기화 ==========
  function init() {
    console.log('[ImagePanel] 초기화');
    loadSettings();
    setupEvents();
    setupMessageListener();
    restoreAutomationState();
    startBackgroundHeartbeat();
  }

  // ========== 자동화 상태 복원 ==========
  function restoreAutomationState() {
    chrome.storage.local.get('automationState', ({ automationState }) => {
      if (!automationState) return;
      if (automationState.isRunning) {
        state.isRunning = true;
        state.currentBatchIndex = automationState.currentBatchIndex;
        state.totalBatches = automationState.batches?.length || 0;
        state.prompts = automationState.prompts || [];
        state.batchSize = automationState.settings?.batchSize || state.batchSize;
        state.canRetry = false;
        state.lastFailedIndex = -1;
        updateUI();
        updateStatus(`[${automationState.currentBatchIndex + 1}/${state.totalBatches}] 자동화 진행 중...`, (automationState.currentBatchIndex / state.totalBatches) * 100);
        updateQueueDisplay();
      } else {
        chrome.storage.local.remove('automationState');
        state.canRetry = false;
        state.lastFailedIndex = -1;
        updateUI();
      }
    });
  }

  // ========== 설정 로드/저장 ==========
  function loadSettings() {
    chrome.storage.local.get([
      'batchSize', 'startNumber', 'model', 'imageSize', 'aspectRatio',
      'autoPrompt', 'generationWaitSec', 'downloadMethod'
    ], result => {
      if (result.batchSize) { state.batchSize = result.batchSize; $('#batch-size').value = result.batchSize; }
      if (result.startNumber) { state.startNumber = result.startNumber; $('#start-number').value = result.startNumber; }
      if (result.model) { state.model = result.model; $('#model-select').value = result.model; }
      if (result.imageSize) { state.imageSize = result.imageSize; $('#image-size-select').value = result.imageSize; }
      if (result.aspectRatio) { state.aspectRatio = result.aspectRatio; $('#aspect-ratio-select').value = result.aspectRatio; }
      if (result.autoPrompt) { state.autoPrompt = result.autoPrompt; $('#auto-prompt-select').value = result.autoPrompt; }
      if (result.generationWaitSec) { state.generationWaitSec = result.generationWaitSec; $('#generation-wait').value = result.generationWaitSec; }
      if (result.downloadMethod) { state.downloadMethod = result.downloadMethod; $('#download-method-select').value = result.downloadMethod; }
    });
  }

  function saveSettings() {
    chrome.storage.local.set({
      batchSize: state.batchSize, startNumber: state.startNumber, model: state.model,
      imageSize: state.imageSize, aspectRatio: state.aspectRatio,
      autoPrompt: state.autoPrompt, generationWaitSec: state.generationWaitSec,
      downloadMethod: state.downloadMethod
    });
  }

  // ========== 이벤트 설정 ==========
  function setupEvents() {
    // 뒤로가기
    $('#image-back-btn').addEventListener('click', () => window.navigateToHome());

    // 프롬프트 입력
    $('#prompt-list').addEventListener('input', () => { updatePromptCount(); updateBatchPreview(); });

    // 설정 변경
    $('#batch-size').addEventListener('change', (e) => {
      let val = Math.max(1, Math.min(6, parseInt(e.target.value) || 5));
      e.target.value = val;
      state.batchSize = val;
      saveSettings();
      updateBatchPreview();
    });
    $('#start-number').addEventListener('change', (e) => {
      let val = Math.max(1, Math.min(9999, parseInt(e.target.value) || 1));
      e.target.value = val;
      state.startNumber = val;
      saveSettings();
      updateBatchPreview();
    });
    $('#model-select').addEventListener('change', (e) => { state.model = e.target.value; saveSettings(); });
    $('#image-size-select').addEventListener('change', (e) => { state.imageSize = e.target.value; saveSettings(); });
    $('#aspect-ratio-select').addEventListener('change', (e) => { state.aspectRatio = e.target.value; saveSettings(); });
    $('#auto-prompt-select').addEventListener('change', (e) => { state.autoPrompt = e.target.value; saveSettings(); });
    $('#download-method-select').addEventListener('change', (e) => { state.downloadMethod = e.target.value; saveSettings(); });
    $('#generation-wait').addEventListener('change', (e) => {
      let val = Math.max(30, Math.min(1000, parseInt(e.target.value) || 600));
      e.target.value = val;
      state.generationWaitSec = val;
      saveSettings();
    });

    // 숫자 컨트롤
    $$('.btn-minus').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $(`#${btn.dataset.target}`);
        const min = parseInt(input.min) || 1;
        let val = parseInt(input.value) || 0;
        if (val > min) { input.value = val - 1; input.dispatchEvent(new Event('change')); }
      });
    });
    $$('.btn-plus').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $(`#${btn.dataset.target}`);
        const max = parseInt(input.max) || 999;
        let val = parseInt(input.value) || 0;
        if (val < max) { input.value = val + 1; input.dispatchEvent(new Event('change')); }
      });
    });

    // 설정 토글
    $('#settings-toggle').addEventListener('click', () => {
      $('#settings-toggle').classList.toggle('active');
      const content = $('#settings-content');
      content.style.display = content.style.display === 'none' ? 'block' : 'none';
    });

    // 액션 버튼
    $('#start-btn').addEventListener('click', startAutomation);
    $('#stop-btn').addEventListener('click', stopAutomation);
    $('#retry-btn').addEventListener('click', retryAutomation);
    $('#skip-btn').addEventListener('click', skipBatch);
    $('#download-btn').addEventListener('click', downloadNow);

    // Rate Limit
    $('#rate-limit-close')?.addEventListener('click', () => { $('#rate-limit-modal').classList.remove('visible'); });
    $('#failure-close')?.addEventListener('click', () => { $('#failure-modal').classList.remove('visible'); });
  }

  // ========== 프롬프트 및 배치 ==========
  function updatePromptCount() {
    const text = $('#prompt-list').value.trim();
    const lines = text ? text.split('\n').filter(line => line.trim()) : [];
    state.prompts = lines;
    const count = lines.length;
    $('#prompt-count').textContent = `프롬프트 ${count}줄 = 이미지 ${count}개 생성`;
  }

  function updateBatchPreview() {
    const batches = splitIntoBatches(state.prompts, state.batchSize);
    state.totalBatches = batches.length;
    $('#batch-info').textContent = `${batches.length}개 배치`;

    if (batches.length === 0) {
      $('#batch-list').innerHTML = '<div class="batch-empty">프롬프트를 입력하세요</div>';
      return;
    }

    const html = batches.map((batch, idx) => {
      const promptsHtml = batch.map(item =>
        `<div class="batch-prompt-item">${item.originalIndex}. ${escapeHtml(item.prompt.substring(0, 40))}${item.prompt.length > 40 ? '...' : ''}</div>`
      ).join('');
      return `<div class="batch-card"><div class="batch-header">배치 ${idx + 1} (${batch.length}개)</div><div class="batch-prompts">${promptsHtml}</div></div>`;
    }).join('');
    $('#batch-list').innerHTML = html;
  }

  function splitIntoBatches(prompts, batchSize) {
    const batches = [];
    const startNum = state.startNumber || 1;
    const indexed = prompts.map((p, i) => ({ originalIndex: i + startNum, prompt: p }));
    for (let i = 0; i < indexed.length; i += batchSize) batches.push(indexed.slice(i, i + batchSize));
    return batches;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ========== 자동화 제어 ==========
  function startAutomation() {
    if (state.prompts.length === 0) { alert('프롬프트를 입력해주세요.'); return; }
    state.isRunning = true;
    state.currentBatchIndex = 0;
    state.canRetry = false;
    state.lastFailedIndex = -1;
    updateUI();

    chrome.runtime.sendMessage({
      type: 'START_AUTOMATION',
      prompts: state.prompts,
      settings: {
        batchSize: state.batchSize, startNumber: state.startNumber,
        model: state.model, imageSize: state.imageSize,
        aspectRatio: state.aspectRatio, autoPrompt: state.autoPrompt,
        generationWaitSec: state.generationWaitSec,
        downloadMethod: state.downloadMethod
      }
    });
  }

  function stopAutomation() {
    chrome.runtime.sendMessage({ type: 'STOP_AUTOMATION' });
    state.isRunning = false;
    state.canRetry = true;
    state.lastFailedIndex = state.currentBatchIndex;
    state.currentStep = '';
    state.stepProgress = 0;
    updateUI();
    updateStatus('중지됨 — 재시도/건너뛰기/다운로드 가능', 0);
  }

  function retryAutomation() {
    chrome.runtime.sendMessage({
      type: 'RETRY_AUTOMATION', prompts: state.prompts,
      failedIndex: state.lastFailedIndex,
      settings: {
        batchSize: state.batchSize, startNumber: state.startNumber,
        model: state.model, imageSize: state.imageSize,
        aspectRatio: state.aspectRatio, autoPrompt: state.autoPrompt,
        generationWaitSec: state.generationWaitSec,
        downloadMethod: state.downloadMethod
      }
    });
    state.canRetry = false;
    state.isRunning = true;
    $('#error-actions').style.display = 'none';
    updateUI();
  }

  function skipBatch() {
    chrome.runtime.sendMessage({
      type: 'SKIP_BATCH', prompts: state.prompts,
      failedIndex: state.lastFailedIndex,
      settings: {
        batchSize: state.batchSize, startNumber: state.startNumber,
        model: state.model, imageSize: state.imageSize,
        aspectRatio: state.aspectRatio, autoPrompt: state.autoPrompt,
        generationWaitSec: state.generationWaitSec,
        downloadMethod: state.downloadMethod
      }
    });
    state.canRetry = false;
    state.isRunning = true;
    $('#error-actions').style.display = 'none';
    updateUI();
  }

  function downloadNow() {
    const btn = $('#download-btn');
    btn.disabled = true;
    btn.textContent = '다운로드 중...';
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_NOW' }, (response) => {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 다운로드`;
      if (response?.success) {
        updateStatus(`${response.count}개 이미지 다운로드 완료`, 100);
      } else {
        updateStatus(response?.error || '다운로드 실패', 0);
      }
    });
  }

  // ========== UI ==========
  function updateUI() {
    const startBtn = $('#start-btn');
    const stopBtn = $('#stop-btn');
    const errorActions = $('#error-actions');
    if (state.isRunning) {
      startBtn.disabled = true;
      stopBtn.disabled = false;
      errorActions.style.display = 'none';
    } else {
      startBtn.disabled = false;
      stopBtn.disabled = true;
      errorActions.style.display = state.canRetry ? 'flex' : 'none';
    }
  }

  function updateStatus(message, progress) {
    $('#status-text').textContent = message;
    $('#progress-fill').style.width = `${progress}%`;
  }

  function updateQueueDisplay() {
    const queueList = $('#queue-list');
    const batches = splitIntoBatches(state.prompts, state.batchSize);
    if (batches.length === 0) {
      queueList.innerHTML = '<div class="queue-empty">대기 중인 작업이 없습니다</div>';
      return;
    }
    let html = '';
    batches.forEach((batch, index) => {
      let statusClass = 'waiting', statusText = '대기 중', progressWidth = 0;
      if (state.isRunning) {
        if (index < state.currentBatchIndex) { statusClass = 'completed'; statusText = '완료'; progressWidth = 100; }
        else if (index === state.currentBatchIndex) { statusClass = 'active'; statusText = getStepDisplayName(state.currentStep); progressWidth = state.stepProgress; }
      }
      html += `<div class="queue-item ${statusClass}"><div class="queue-item-number">${index + 1}</div><div class="queue-item-info"><div class="queue-item-name">배치 ${index + 1} (${batch.length}개 프롬프트)</div><div class="queue-item-status">${statusText}</div>${statusClass === 'active' ? `<div class="queue-item-progress"><div class="queue-item-progress-fill" style="width: ${progressWidth}%"></div></div>` : ''}</div></div>`;
    });
    queueList.innerHTML = html;
  }

  function getStepDisplayName(step) {
    const names = {
      'DO_SELECT_MODEL': '모델 선택 중...', 'DO_INPUT_PROMPT': '프롬프트 입력 중...',
      'DO_SEND': '전송 중...', 'DO_WAIT_GENERATION': '이미지 생성 중...',
      'DO_SAVE_TO_DRIVE': 'ZIP 저장 중...', 'DO_NEW_CHAT': '다음 배치 준비...'
    };
    return names[step] || step || '처리 중...';
  }

  // ========== 메시지 수신 ==========
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'UPDATE_STATUS':
          state.currentBatchIndex = msg.currentBatchIndex ?? state.currentBatchIndex;
          state.currentStep = msg.currentStep || state.currentStep;
          state.stepProgress = msg.stepProgress ?? state.stepProgress;
          state.canRetry = msg.canRetry ?? state.canRetry;
          state.lastFailedIndex = msg.lastFailedIndex ?? state.lastFailedIndex;
          updateStatus(msg.status, msg.progress);
          updateQueueDisplay();
          updateUI();
          break;
        case 'AUTOMATION_COMPLETE':
          state.isRunning = false;
          state.currentBatchIndex = -1;
          state.currentStep = '';
          state.stepProgress = 0;
          updateStatus('모든 작업 완료!', 100);
          updateQueueDisplay();
          updateUI();
          showCompletePopup([]);
          break;
        case 'AUTOMATION_COMPLETE_WITH_FAILURES':
          state.isRunning = false;
          state.currentBatchIndex = -1;
          state.currentStep = '';
          state.stepProgress = 0;
          updateStatus('완료 (일부 실패)', 100);
          updateQueueDisplay();
          updateUI();
          showCompletePopup(msg.failedPrompts || []);
          break;
        case 'AUTOMATION_ERROR':
          state.isRunning = false;
          state.canRetry = true;
          state.lastFailedIndex = msg.failedIndex ?? state.lastFailedIndex;
          updateStatus(`오류: ${msg.error}`, 0);
          updateUI();
          break;
        case 'RATE_LIMIT':
          state.isRunning = false;
          state.canRetry = true;
          $('#rate-limit-progress').textContent = msg.progress || '';
          $('#rate-limit-progress').style.display = msg.progress ? 'block' : 'none';
          $('#rate-limit-modal').classList.add('visible');
          updateStatus('Rate Limit', 0);
          updateUI();
          break;
      }
    });
  }

  // ========== 백그라운드 heartbeat ==========
  let heartbeatTimer = null;
  function startBackgroundHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      if (!state.isRunning) return;
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }).then(() => {}).catch(() => {
        console.log('[ImagePanel] SW 깨우기 시도');
      });
    }, 10000);
  }

  // ========== 실패 목록 팝업 ==========
  function showCompletePopup(failedPrompts) {
    const titleEl = document.querySelector('#failure-modal .rate-limit-title');
    const iconEl = document.querySelector('#failure-modal .rate-limit-icon');
    const listEl = document.getElementById('failure-list');
    const tipsEl = document.getElementById('failure-tips');
    if (!listEl || !tipsEl) return;

    if (failedPrompts.length === 0) {
      iconEl.textContent = '✅';
      titleEl.textContent = '모든 이미지가 다운로드되었어요!';
      listEl.innerHTML = '';
      tipsEl.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">다운로드 폴더에서 이미지를 확인해보세요.</p>';
    } else {
      iconEl.textContent = '⚠️';
      titleEl.textContent = '일부 이미지 생성에 문제가 있었어요';
      listEl.innerHTML = failedPrompts.map(f =>
        `<div style="margin-bottom: 4px;"><strong>#${f.index}</strong> ${f.prompt.substring(0, 40)}${f.prompt.length > 40 ? '...' : ''} — <span style="color: ${f.reason === 'NSFW' ? '#e94560' : '#ff9800'};">${f.reason}</span></div>`
      ).join('');

      const hasNSFW = failedPrompts.some(f => f.reason === 'NSFW');
      const hasFail = failedPrompts.some(f => f.reason !== 'NSFW');
      let tips = '';
      if (hasNSFW) tips += '<p><strong>NSFW란?</strong> 부적절한 콘텐츠(폭력, 선정적 등)가 감지된 경우입니다. 프롬프트를 좀 더 순한 표현으로 수정 후 다시 시도해보세요.</p>';
      if (hasFail) tips += '<p><strong>생성 실패:</strong> 해당 번호의 이미지가 정상적으로 생성되었는지 확인해보세요. 생성되지 않았다면 해당 프롬프트만 다시 실행해보세요.</p>';
      tipsEl.innerHTML = tips;
    }

    document.getElementById('failure-modal').classList.add('visible');
  }

  // 초기화 실행
  init();

  return { state };
})();
