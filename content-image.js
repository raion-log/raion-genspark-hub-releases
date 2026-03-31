// ==================== RAION Genspark Pro v1.0.5 ====================
// Genspark AI 이미지 생성 자동화 - 콘텐츠 스크립트

// 중복 실행 방지
if (window.__RAION_GENSPARK_LOADED__) {
  console.log('[Worker] 이미 로드됨 - 스킵');
} else {
  window.__RAION_GENSPARK_LOADED__ = true;
  console.log('[Worker] v1.0.5 로드됨');
(function() {

// 유틸리티 함수
const wait = ms => new Promise(r => setTimeout(r, ms));
const downloadedSrcs = new Set();

// Genspark UI 셀렉터
const SELECTORS = {
  promptInput: 'textarea.search-input.j-search-input[name="query"]',
  sendButton: 'div.enter-icon-wrapper',
  // 메뉴 A: 모델 선택 버튼 (첫 번째 model-button)
  modelButton: 'div.model-button',  // 인덱스 0번 사용
  modelItem: 'div.model-name',
  modelSelected: 'div.model-selected .text',
  // 메뉴 B: 설정 버튼 (aspect-ratio-selector setting-button)
  settingsButton: 'div.model-button.aspect-ratio-selector.setting-button',
  sizeOption: 'div.size-option',
  ratioOption: 'div.ratio-option',
  // 자동 프롬프트 토글
  autoPromptToggle: 'div.reflection-toggle'
};

// 버튼 찾기 헬퍼 (인덱스 또는 텍스트로)
function findModelButton() {
  // 첫 번째 model-button (모델 선택)
  return document.querySelectorAll('div.model-button')[0];
}

function findSettingsButton() {
  // "설정" 텍스트가 있는 버튼 또는 aspect-ratio-selector
  const btn = document.querySelector('div.model-button.aspect-ratio-selector.setting-button');
  if (btn) return btn;

  // 백업: 텍스트로 찾기
  const allBtns = document.querySelectorAll('div.model-button');
  for (const b of allBtns) {
    if (b.innerText.includes('설정')) return b;
  }
  return allBtns[1]; // 두 번째 버튼
}

// ==================== 모델 선택 ====================
async function doSelectModel(model) {
  console.log(`[Worker] 모델 선택: ${model}`);

  try {
    await wait(500);

    // 현재 선택된 모델 확인
    const currentModel = document.querySelector(SELECTORS.modelSelected);
    if (currentModel) {
      const currentText = (currentModel.textContent || '').trim();
      if (currentText === model) {
        console.log(`[Worker] 이미 ${model} 선택됨`);
        return { success: true, model, alreadySelected: true };
      }
    }

    // 모델 버튼 hover하여 드롭다운 열기
    const modelBtn = findModelButton();
    if (!modelBtn) {
      console.log('[Worker] 모델 버튼 없음');
      return { success: false, error: '모델 버튼 없음' };
    }

    console.log('[Worker] 모델 버튼 hover');
    modelBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await wait(500);

    // 모델 목록에서 해당 모델 찾기 (div.model-name)
    const modelItems = document.querySelectorAll('div.model-name');
    console.log(`[Worker] 모델 목록 ${modelItems.length}개 발견`);

    for (const item of modelItems) {
      const text = (item.textContent || '').trim();
      if (text === model) {
        item.click();
        await wait(300);
        console.log(`[Worker] ${model} 선택 완료`);
        // 메뉴 닫기
        modelBtn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        return { success: true, model };
      }
    }

    // 모델을 찾지 못한 경우 드롭다운 닫기
    modelBtn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await wait(200);

    console.log(`[Worker] 모델 "${model}" 찾지 못함`);
    return { success: false, error: `모델 "${model}" 없음` };

  } catch (error) {
    console.error('[Worker] 모델 선택 오류:', error);
    return { success: false, error: error.message };
  }
}

// ==================== 이미지 크기 선택 ====================
async function doSelectImageSize(size) {
  console.log(`[Worker] 이미지 크기 선택: ${size}`);

  try {
    await wait(300);

    // 메뉴 B (설정 버튼) hover하여 팝오버 열기
    const settingsBtn = findSettingsButton();
    if (!settingsBtn) {
      console.log('[Worker] 설정 버튼 없음');
      return { success: false, error: '설정 버튼 없음' };
    }

    console.log('[Worker] 설정 버튼 hover (크기 선택)');
    settingsBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await wait(500);

    // 크기 옵션 찾기 (div.size-option)
    const sizeOptions = document.querySelectorAll('div.size-option');
    console.log(`[Worker] 크기 옵션 ${sizeOptions.length}개 발견`);

    for (const option of sizeOptions) {
      const text = (option.textContent || '').trim();
      // "자동" 또는 "1K", "2K", "4K" 매칭
      if (text === size || text.startsWith(size)) {
        option.click();
        await wait(300);
        console.log(`[Worker] 크기 ${size} 선택 완료`);
        // 메뉴 닫기
        settingsBtn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        return { success: true, size };
      }
    }

    // 찾지 못한 경우 메뉴 닫기
    settingsBtn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await wait(200);

    console.log(`[Worker] 크기 "${size}" 찾지 못함`);
    return { success: false, error: `크기 "${size}" 없음` };

  } catch (error) {
    console.error('[Worker] 크기 선택 오류:', error);
    return { success: false, error: error.message };
  }
}

// ==================== 이미지 비율 선택 ====================
async function doSelectAspectRatio(ratio) {
  console.log(`[Worker] 이미지 비율 선택: ${ratio}`);

  try {
    await wait(300);

    // 메뉴 B (설정 버튼) hover하여 팝오버 열기
    const settingsBtn = findSettingsButton();
    if (!settingsBtn) {
      console.log('[Worker] 설정 버튼 없음');
      return { success: false, error: '설정 버튼 없음' };
    }

    console.log('[Worker] 설정 버튼 hover (비율 선택)');
    settingsBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await wait(500);

    // 비율 옵션 찾기 (div.ratio-option)
    const ratioOptions = document.querySelectorAll('div.ratio-option');
    console.log(`[Worker] 비율 옵션 ${ratioOptions.length}개 발견`);

    for (const option of ratioOptions) {
      // ratio-label 내부 텍스트 확인
      const label = option.querySelector('.ratio-label');
      const text = label ? label.textContent.trim() : option.textContent.trim();

      if (text === ratio) {
        option.click();
        await wait(300);
        console.log(`[Worker] 비율 ${ratio} 선택 완료`);
        // 메뉴 닫기
        settingsBtn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        return { success: true, ratio };
      }
    }

    // 찾지 못한 경우 메뉴 닫기
    settingsBtn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await wait(200);

    console.log(`[Worker] 비율 "${ratio}" 찾지 못함`);
    return { success: false, error: `비율 "${ratio}" 없음` };

  } catch (error) {
    console.error('[Worker] 비율 선택 오류:', error);
    return { success: false, error: error.message };
  }
}

// ==================== 자동 프롬프트 비활성화 ====================
async function doDisableAutoPrompt() {
  console.log('[Worker] 자동 프롬프트 비활성화');

  try {
    await wait(300);

    // 자동 프롬프트 토글 찾기
    const toggle = document.querySelector(SELECTORS.autoPromptToggle);
    if (!toggle) {
      console.log('[Worker] 자동 프롬프트 토글 없음');
      return { success: false, error: '자동 프롬프트 토글 없음' };
    }

    // active 클래스가 있으면 현재 켜져있는 상태 → 클릭해서 끄기
    if (toggle.classList.contains('active')) {
      toggle.click();
      await wait(300);
      console.log('[Worker] 자동 프롬프트 비활성화 완료');
      return { success: true, wasActive: true };
    } else {
      console.log('[Worker] 자동 프롬프트 이미 꺼져있음');
      return { success: true, wasActive: false };
    }

  } catch (error) {
    console.error('[Worker] 자동 프롬프트 비활성화 오류:', error);
    return { success: false, error: error.message };
  }
}

// ==================== 프롬프트 입력 ====================
async function doInputPrompt(message) {
  console.log('[Worker] 프롬프트 입력');
  console.log('[Worker] 메시지 길이:', message.length);

  try {
    await wait(500);

    const textarea = document.querySelector(SELECTORS.promptInput);
    if (!textarea) {
      console.log('[Worker] 입력창 없음');
      return { success: false, error: '입력창 없음' };
    }

    textarea.focus();
    await wait(100);

    // React/Vue 호환 값 설정
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(textarea, message);
    } else {
      textarea.value = message;
    }

    // 이벤트 발생
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    await wait(200);

    console.log('[Worker] 프롬프트 입력 완료');
    return { success: true };

  } catch (error) {
    console.error('[Worker] 입력 오류:', error);
    return { success: false, error: error.message };
  }
}

// ==================== 전송 버튼 클릭 ====================
async function doSend() {
  console.log('[Worker] 전송');

  try {
    await wait(300);

    const sendBtn = document.querySelector(SELECTORS.sendButton);
    if (!sendBtn) {
      console.log('[Worker] 전송 버튼 없음');
      return { success: false, error: '전송 버튼 없음' };
    }

    sendBtn.click();
    await wait(2000);

    // 입력창이 비워졌는지 확인 (전송 성공 판단)
    const textarea = document.querySelector(SELECTORS.promptInput);
    const currentValue = textarea?.value || '';
    if (currentValue.length === 0) {
      console.log('[Worker] 전송 확인 완료');
      return { success: true };
    }

    console.log('[Worker] 전송 실패 - 입력창 비워지지 않음');
    return { success: false, error: '전송 실패' };

  } catch (error) {
    console.error('[Worker] 전송 오류:', error);
    return { success: false, error: error.message };
  }
}

// ==================== 파일 번호 성공/실패 파싱 ====================
function parseFileNumberResults(newText, fileNumbers) {
  const failedNumbers = new Set();

  const sortedNums = [...fileNumbers].sort((a, b) => a - b);

  for (let i = 0; i < sortedNums.length; i++) {
    const num = sortedNums[i];
    const nextNum = sortedNums[i + 1];

    // 이 파일 번호의 섹션 찾기
    const numRegex = new RegExp(`\\b${num}\\.png\\b`);
    const match = numRegex.exec(newText);
    if (!match) continue;

    // 섹션 끝 (다음 파일 번호 또는 텍스트 끝)
    let sectionEnd = newText.length;
    if (nextNum !== undefined) {
      const nextRegex = new RegExp(`\\b${nextNum}\\.png\\b`);
      const nextMatch = nextRegex.exec(newText.slice(match.index + 1));
      if (nextMatch) {
        sectionEnd = match.index + 1 + nextMatch.index;
      }
    }

    const section = newText.slice(match.index, sectionEnd);
    if (section.includes('Failure') || section.includes('NSFW') || section.includes('nsfw')) {
      failedNumbers.add(num);
    }
  }

  const successNumbers = fileNumbers.filter(n => !failedNumbers.has(n));
  return { successNumbers, failedNumbers: [...failedNumbers] };
}

// ==================== 이미지 생성 대기 ====================
async function doWaitGeneration(expectedCount, maxWaitSec, fileNumbers) {
  console.log(`[Worker] 이미지 생성 대기 (예상: ${expectedCount}개, 최대: ${maxWaitSec}초)`);

  const startTime = Date.now();
  const checkInterval = 2000; // 2초마다 체크

  // 현재 페이지의 이미지 개수 기록 (시작 전)
  const initialImageCount = document.querySelectorAll('div.image-generated').length;
  console.log(`[Worker] 초기 이미지 수: ${initialImageCount}`);

  // 현재 페이지 텍스트 길이 스냅샷 (이전 배치 텍스트 무시용)
  const initialTextLength = document.body.innerText.length;
  console.log(`[Worker] 초기 텍스트 길이: ${initialTextLength}`);

  // STEP 1: 이미지 생성 시작 대기
  console.log('[Worker] STEP 1: 이미지 생성 시작 대기...');
  let generationStarted = false;
  let nsfwDetected = false;
  const maxStartWait = 180000; // 시작까지 최대 180초 대기

  while (Date.now() - startTime < maxStartWait) {
    await wait(checkInterval);

    const currentPageText = document.body.innerText;
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // 새로 추가된 텍스트만 확인 (이전 배치 텍스트 제외)
    const newText = currentPageText.slice(initialTextLength);

    // 새 텍스트에서 이미지 생성 시작 감지
    if (newText.includes('도구 사용') || newText.includes('이미지 생성') || newText.includes('생성하겠습니다')) {
      console.log(`[Worker] ${elapsed}초 - 이미지 생성 시작됨! (새 텍스트 감지)`);
      generationStarted = true;
      break;
    }

    // 이미지가 이미 생성되기 시작한 경우
    const currentImages = document.querySelectorAll('div.image-generated').length;
    if (currentImages > initialImageCount) {
      console.log(`[Worker] ${elapsed}초 - 새 이미지 감지됨 (${currentImages - initialImageCount}개)`);
      generationStarted = true;
      break;
    }

    // NSFW/Failure 감지 (중단하지 않고 플래그만 설정)
    if ((newText.includes('NSFW') || newText.includes('nsfw') || newText.includes('Failure')) && !nsfwDetected) {
      console.log('[Worker] NSFW/Failure 감지됨 - 카운트 계속 진행');
      nsfwDetected = true;
    }

    // 5시간 제한 감지 (근접은 진행 가능, 도달만 중단)
    if (newText.includes('제한에 도달')) {
      console.log('[Worker] 5시간 제한 도달 감지됨');
      return { success: false, error: 'RATE_LIMIT', generatedCount: 0, missingCount: expectedCount };
    }
    if (newText.includes('제한에 근접')) {
      console.log('[Worker] 5시간 제한 근접 - 계속 진행');
    }

    // 새 텍스트에서 에러 메시지 감지
    if (newText.includes('요청이 중단') || newText.includes('오류가 발생')) {
      console.log('[Worker] 에러 감지됨');
      return { success: false, error: '요청 중단 또는 오류', generatedCount: 0, missingCount: expectedCount };
    }

    console.log(`[Worker] ${elapsed}초 - 생성 시작 대기 중...`);
  }

  if (!generationStarted) {
    console.log('[Worker] 이미지 생성이 시작되지 않음');
    return { success: false, error: '생성 시작 안됨', generatedCount: 0, missingCount: expectedCount };
  }

  // STEP 2: 이미지 생성 완료 대기
  console.log('[Worker] STEP 2: 이미지 생성 완료 대기...');
  let lastImageCount = initialImageCount;
  let lastTextLength = document.body.innerText.length;
  let stableCount = 0;

  while (Date.now() - startTime < maxWaitSec * 1000) {
    await wait(checkInterval);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const currentPageText = document.body.innerText;
    const currentTextLength = currentPageText.length;

    // 현재 생성된 이미지 수 (새로 생성된 것만)
    const currentTotalImages = document.querySelectorAll('div.image-generated').length;
    const newImagesCount = currentTotalImages - initialImageCount;

    console.log(`[Worker] ${elapsed}초 - 새 이미지: ${newImagesCount}/${expectedCount} (텍스트 변화: ${currentTextLength !== lastTextLength ? 'Y' : 'N'})`);

    // 예상 개수 도달
    if (newImagesCount >= expectedCount) {
      // 스트리밍 완료 대기
      await wait(3000);
      console.log('[Worker] 모든 이미지 생성 완료!');
      return {
        success: true,
        generatedCount: newImagesCount,
        missingCount: 0,
        missingIndices: [],
        nsfwDetected,
        successFileNumbers: fileNumbers.length > 0 ? fileNumbers : null
      };
    }

    // 이미지 수 AND 텍스트 모두 변화 없을 때만 stableCount 증가
    const imageChanged = currentTotalImages !== lastImageCount;
    const textChanged = currentTextLength !== lastTextLength;

    if (!imageChanged && !textChanged) {
      stableCount++;
      // 이미지 0개: 120초(60회), 1개+: 90초(45회)
      const stableThreshold = (newImagesCount === 0) ? 60 : 45;
      if (stableCount >= stableThreshold) {
        console.log(`[Worker] 생성 완료로 판단 (${stableCount * 2}초간 변화 없음)`);
        break;
      }
    } else {
      stableCount = 0;
    }

    lastImageCount = currentTotalImages;
    lastTextLength = currentTextLength;

    // 새 텍스트에서 에러/NSFW 감지
    const newText = currentPageText.slice(initialTextLength);
    if ((newText.includes('NSFW') || newText.includes('nsfw') || newText.includes('Failure')) && !nsfwDetected) {
      console.log('[Worker] 생성 중 NSFW/Failure 감지 - 카운트 계속 진행');
      nsfwDetected = true;
    }
    if (newText.includes('제한에 도달')) {
      console.log('[Worker] 생성 중 5시간 제한 도달 감지');
      return { success: false, error: 'RATE_LIMIT', generatedCount: newImagesCount, missingCount: Math.max(0, expectedCount - newImagesCount), missingIndices: [] };
    }
    if (newText.includes('요청이 중단') || newText.includes('오류가 발생')) {
      console.log('[Worker] 생성 중 에러 감지');
      break;
    }
  }

  // 텍스트 완료 후 이미지 렌더링 추가 대기 (div.image-generated가 늦게 추가되는 경우)
  let finalTotalImages = document.querySelectorAll('div.image-generated').length;
  let generatedCount = finalTotalImages - initialImageCount;

  if (generatedCount < expectedCount) {
    console.log(`[Worker] 이미지 부족 (${generatedCount}/${expectedCount}) - 이미지 렌더링 추가 대기...`);
    const postWaitMax = 60000; // 최대 60초 추가 대기
    const postWaitStart = Date.now();

    while (Date.now() - postWaitStart < postWaitMax) {
      await wait(checkInterval);
      finalTotalImages = document.querySelectorAll('div.image-generated').length;
      generatedCount = finalTotalImages - initialImageCount;
      const postElapsed = Math.round((Date.now() - postWaitStart) / 1000);
      console.log(`[Worker] 추가 대기 ${postElapsed}초 - 이미지: ${generatedCount}/${expectedCount}`);

      if (generatedCount >= expectedCount) {
        await wait(3000); // 렌더링 안정화 대기
        console.log('[Worker] 추가 대기 중 모든 이미지 감지 완료!');
        break;
      }
    }

    // 추가 대기 후 최종 카운트
    finalTotalImages = document.querySelectorAll('div.image-generated').length;
    generatedCount = finalTotalImages - initialImageCount;
  }

  const missingCount = Math.max(0, expectedCount - generatedCount);

  console.log(`[Worker] 대기 종료 - 새로 생성: ${generatedCount}, 누락: ${missingCount}`);

  // 파일 번호 성공/실패 파싱
  let successFileNumbers = null;
  if (fileNumbers.length > 0 && missingCount > 0) {
    const newText = document.body.innerText.slice(initialTextLength);
    const parseResult = parseFileNumberResults(newText, fileNumbers);
    successFileNumbers = parseResult.successNumbers;
    console.log(`[Worker] 파일 번호 파싱 - 성공: [${parseResult.successNumbers}], 실패: [${parseResult.failedNumbers}]`);
  } else if (fileNumbers.length > 0) {
    successFileNumbers = fileNumbers;
  }

  return {
    success: generatedCount > 0,
    generatedCount,
    missingCount,
    missingIndices: [],
    nsfwDetected,
    successFileNumbers
  };
}

// ==================== Genspark 대기 상태 확인 ====================
async function waitForGensparkIdle(maxWaitMs = 30000) {
  const startTime = Date.now();
  const checkInterval = 2000;
  let stableCount = 0;
  let lastTextLength = document.body.innerText.length;

  console.log('[Worker] Genspark 대기 상태 확인 시작...');

  while (Date.now() - startTime < maxWaitMs) {
    await wait(checkInterval);

    const pageText = document.body.innerText;
    const currentTextLength = pageText.length;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const textChanged = currentTextLength !== lastTextLength;
    lastTextLength = currentTextLength;

    // 에러 감지
    const hasError = pageText.includes('요청이 중단') || pageText.includes('오류가 발생');

    // 입력창 상태 확인
    const textarea = document.querySelector(SELECTORS.promptInput);
    const isInputReady = textarea && !textarea.disabled && !textarea.readOnly;

    if (hasError) {
      console.log(`[Worker] ${elapsed}초 - 에러 감지됨`);
      return false;
    }

    // 입력창 준비됨 + 텍스트 변화 없음 = 응답 완료
    if (isInputReady && !textChanged) {
      stableCount++;
      console.log(`[Worker] ${elapsed}초 - 대기 상태 감지 (${stableCount}/3)`);

      if (stableCount >= 3) { // 6초간 안정적으로 대기 상태
        console.log('[Worker] Genspark 대기 상태 확인됨!');
        return true;
      }
    } else {
      stableCount = 0;
      console.log(`[Worker] ${elapsed}초 - 아직 처리 중... (입력: ${isInputReady ? 'Y' : 'N'}, 텍스트변화: ${textChanged ? 'Y' : 'N'})`);
    }
  }

  console.log('[Worker] Genspark 대기 상태 확인 타임아웃 - 계속 진행');
  return false;
}

// ==================== AI 드라이브로 저장 요청 ====================
async function doRequestSaveToDrive() {
  console.log('[Worker] AI 드라이브 저장 요청');

  try {
    // Genspark 입력 가능 상태까지 대기
    await waitForInputReady(15000);
    await wait(1000);

    const textarea = document.querySelector(SELECTORS.promptInput);
    if (!textarea) {
      console.log('[Worker] 입력창 없음');
      return { success: false, error: '입력창 없음' };
    }

    // AI 드라이브 폴더 저장 요청 메시지 입력
    const saveMessage = `생성된 이미지를 AI 드라이브에 저장해줘.
먼저 한국 시간(KST, UTC+9) 기준으로 [YYMMDD_HHMM] 형식의 폴더를 만들고, 그 폴더 안에 이미지들을 다운로드해줘.`;

    textarea.focus();
    await wait(100);

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(textarea, saveMessage);
    } else {
      textarea.value = saveMessage;
    }

    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(500);

    // 전송 (재시도 포함)
    for (let attempt = 1; attempt <= 3; attempt++) {
      const sendBtn = document.querySelector(SELECTORS.sendButton);
      if (sendBtn) {
        sendBtn.click();
        console.log(`[Worker] 전송 버튼 클릭 (${attempt}차)`);
        await wait(1000);

        // 입력창이 비워졌는지 확인 (전송 성공 판단)
        const currentValue = textarea.value || '';
        if (currentValue.length === 0 || currentValue !== saveMessage) {
          console.log('[Worker] AI 드라이브 저장 요청 완료');
          return { success: true };
        }
        console.log(`[Worker] 전송 안됨 - 재시도 ${attempt}/3`);
        await wait(1000);
      } else {
        console.log('[Worker] 전송 버튼 없음 - 대기');
        await wait(2000);
      }
    }

    console.log('[Worker] AI 드라이브 저장 요청 완료 (전송 확인 불가)');
    return { success: true };

  } catch (error) {
    console.error('[Worker] 저장 요청 오류:', error);
    return { success: false, error: error.message };
  }
}

// ==================== 입력 가능 상태 대기 ====================
async function waitForInputReady(maxWaitMs = 15000) {
  const startTime = Date.now();
  console.log('[Worker] 입력 가능 상태 대기...');

  // 먼저 입력창이 존재할 때까지 대기
  while (Date.now() - startTime < maxWaitMs) {
    const textarea = document.querySelector(SELECTORS.promptInput);
    const sendBtn = document.querySelector(SELECTORS.sendButton);

    if (textarea && !textarea.disabled && sendBtn) {
      break;
    }
    await wait(1000);
  }

  // 텍스트 스트리밍 완료 대기 (1초간 텍스트 변화 없으면 OK)
  let lastTextLength = document.body.innerText.length;
  let stableCount = 0;

  while (Date.now() - startTime < maxWaitMs && stableCount < 2) {
    await wait(500);
    const currentTextLength = document.body.innerText.length;

    if (currentTextLength === lastTextLength) {
      stableCount++;
    } else {
      stableCount = 0;
      lastTextLength = currentTextLength;
    }
  }

  if (stableCount >= 2) {
    console.log('[Worker] 입력 가능 상태 확인됨 (텍스트 안정)');
    return true;
  }

  console.log('[Worker] 입력 가능 상태 대기 타임아웃 - 계속 진행');
  return false;
}

// ==================== 저장 완료 대기 ====================
async function doWaitSaveComplete(maxWaitSec) {
  console.log(`[Worker] 저장 완료 대기 (최대: ${maxWaitSec}초)`);

  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitSec * 1000) {
    await wait(3000);

    // AI 드라이브 링크 감지 (aidrive 포함 링크)
    const driveLinks = document.querySelectorAll('a[href*="aidrive"]');
    for (const link of driveLinks) {
      const href = link.getAttribute('href') || '';
      // YYMMDD_N 형식 폴더 또는 generated_images 폴더 링크
      if (href.includes('aidrive/files/') || href.includes('aidrive/folder/')) {
        console.log('[Worker] AI 드라이브 폴더 링크 감지 - 클릭');
        console.log('[Worker] 링크:', href);
        await wait(1000);
        link.click();
        return { success: true, hasDriveLink: true, clicked: true };
      }
    }

    // AI 드라이브 텍스트로 링크 찾기 (백업)
    const allLinks = document.querySelectorAll('a');
    for (const link of allLinks) {
      const text = (link.textContent || '').trim();
      if (text.includes('AI 드라이브') || text.includes('폴더 확인') || text.includes('드라이브에서')) {
        console.log('[Worker] AI 드라이브 링크 (텍스트) 감지 - 클릭');
        await wait(1000);
        link.click();
        return { success: true, hasDriveLink: true, clicked: true };
      }
    }

    // 저장 완료 메시지 감지 (링크 없이 완료된 경우)
    const pageText = document.body.innerText;
    if (pageText.includes('성공적으로 저장') ||
        pageText.includes('폴더에 저장') ||
        (pageText.includes('저장') && pageText.includes('완료'))) {
      console.log('[Worker] 저장 완료 감지 (링크 탐색 계속)');
      // 링크가 나타날 때까지 조금 더 대기
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[Worker] ${elapsed}초 경과...`);
  }

  console.log('[Worker] 저장 완료 대기 타임아웃');
  return { success: false, error: '타임아웃' };
}

// ==================== 새 대화 시작 ====================
async function doNewChat() {
  console.log('[Worker] 새 대화 시작');

  try {
    // "새 대화" 또는 "+" 버튼 찾기
    const selectors = [
      'button[aria-label*="new"]',
      'button[aria-label*="새"]',
      'button[title*="new"]',
      'button[title*="새"]',
      '[data-action="new-chat"]',
      '.new-chat-btn',
      '.new-conversation'
    ];

    for (const selector of selectors) {
      const btn = document.querySelector(selector);
      if (btn) {
        btn.click();
        await wait(1000);
        console.log('[Worker] 새 대화 버튼 클릭');
        return { success: true, method: 'button' };
      }
    }

    // 버튼을 찾지 못한 경우 페이지 새로고침
    console.log('[Worker] 새 대화 버튼 없음 - 페이지 새로고침');
    window.location.href = 'https://www.genspark.ai/ai_image';
    return { success: true, method: 'navigate' };

  } catch (error) {
    console.error('[Worker] 새 대화 오류:', error);
    return { success: false, error: error.message };
  }
}

// ==================== 누락 이미지 재생성 요청 ====================
async function doRequestRegenerate(missingIndices, model) {
  console.log(`[Worker] 누락 이미지 재생성 요청: ${missingIndices.join(', ')}`);

  if (!missingIndices || missingIndices.length === 0) {
    return { success: true, message: '재생성할 이미지 없음' };
  }

  try {
    const textarea = document.querySelector(SELECTORS.promptInput);
    if (!textarea) {
      return { success: false, error: '입력창 없음' };
    }

    // 재생성 요청 메시지 생성
    const regenMessage = `다음 순번의 이미지가 생성되지 않았어. 다시 생성해줘.
이미지 생성 모델: ${model}
파일명은 반드시 해당 순번으로 지정해줘.

누락된 순번: ${missingIndices.join(', ')}`;

    textarea.focus();
    await wait(100);

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(textarea, regenMessage);
    } else {
      textarea.value = regenMessage;
    }

    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);

    // 전송
    const sendBtn = document.querySelector(SELECTORS.sendButton);
    if (sendBtn) {
      sendBtn.click();
      await wait(500);
    }

    console.log('[Worker] 재생성 요청 완료');
    return { success: true };

  } catch (error) {
    console.error('[Worker] 재생성 요청 오류:', error);
    return { success: false, error: error.message };
  }
}

// ==================== 이미지 URL 수집 (원본 URL만 반환) ====================
async function doCollectImageUrls() {
  console.log('[Worker] 이미지 URL 수집 시작');
  const imgs = document.querySelectorAll('div.image-generated img, div.image-grid img');
  const allSrcs = [...new Set([...imgs].map(img => img.src))];
  const newSrcs = allSrcs.filter(src => !downloadedSrcs.has(src));
  console.log(`[Worker] 전체 ${allSrcs.length}개, 신규 ${newSrcs.length}개`);

  if (newSrcs.length === 0) {
    console.log('[Worker] 새로운 이미지 없음');
    return { success: true, urls: [] };
  }

  for (const src of newSrcs) {
    downloadedSrcs.add(src);
  }

  console.log(`[Worker] URL 수집 완료: ${newSrcs.length}개 (추적 중: ${downloadedSrcs.size}개)`);
  return { success: true, urls: newSrcs };
}

// ==================== 단일 이미지 PNG 변환 ====================
async function doConvertSingleImage(srcUrl) {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = srcUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    return { success: true, dataUrl };
  } catch (e) {
    console.warn('[Worker] PNG 변환 실패:', srcUrl);
    return { success: false, dataUrl: srcUrl };
  }
}

// ==================== 메시지 핸들러 ====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[Worker] 명령:', msg.type);

  const handlers = {
    'DO_SELECT_MODEL': () => doSelectModel(msg.model),
    'DO_SELECT_IMAGE_SIZE': () => doSelectImageSize(msg.size),
    'DO_SELECT_ASPECT_RATIO': () => doSelectAspectRatio(msg.ratio),
    'DO_DISABLE_AUTO_PROMPT': () => doDisableAutoPrompt(),
    'DO_INPUT_PROMPT': () => doInputPrompt(msg.message),
    'DO_SEND': () => doSend(),
    'DO_WAIT_GENERATION': () => doWaitGeneration(msg.expectedCount || 5, msg.maxWaitSec || 120, msg.fileNumbers || []),
    'DO_REQUEST_SAVE_TO_DRIVE': () => doRequestSaveToDrive(),
    'DO_WAIT_SAVE_COMPLETE': () => doWaitSaveComplete(msg.maxWaitSec || 60),
    'DO_NEW_CHAT': () => doNewChat(),
    'DO_REQUEST_REGENERATE': () => doRequestRegenerate(msg.missingIndices, msg.model),
    'WAIT_INPUT_READY': () => waitForInputReady(msg.maxWaitMs || 15000).then(ready => ({ success: ready })),
    'WAIT_IDLE': () => waitForGensparkIdle(msg.maxWaitMs || 30000).then(idle => ({ success: idle })),
    'DO_COLLECT_IMAGE_URLS': () => doCollectImageUrls(),
    'DO_CONVERT_SINGLE_IMAGE': () => doConvertSingleImage(msg.srcUrl),
    'PING': () => Promise.resolve({ success: true, message: 'pong' })
  };

  const handler = handlers[msg.type];
  if (!handler) return; // 모르는 메시지는 무시 → content-chat.js가 처리

  handler().then(result => {
    console.log('[Worker] 결과:', result);
    sendResponse(result);
  }).catch(error => {
    console.error('[Worker] 실패:', error);
    sendResponse({ success: false, error: error.message });
  });
  return true; // 비동기 응답
});

console.log('[Worker] 준비 완료');

})(); // end of IIFE
} // end of if (중복 실행 방지)
