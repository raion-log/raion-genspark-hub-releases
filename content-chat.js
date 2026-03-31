// ==================== RAION Genspark Hub v1.0.1 ====================
// Genspark AI 채팅 자동화 - 콘텐츠 스크립트

if (window.__RAION_CHAT_LOADED__) {
  console.log('[ChatWorker] 이미 로드됨');
} else {
  window.__RAION_CHAT_LOADED__ = true;
  console.log('[ChatWorker] v1.0.1 로드됨');

const wait = ms => new Promise(r => setTimeout(r, ms));

// ==================== 모델 선택 ====================
async function chatSelectModel(model) {
  console.log(`[ChatWorker] 모델 선택: "${model}"`);

  try {
    await wait(500);

    // 현재 모델 확인
    const currentLabel = document.querySelector('span.model-label');
    if (currentLabel && currentLabel.textContent.trim() === model) {
      console.log('[ChatWorker] 이미 선택됨');
      return { success: true, model, alreadySelected: true };
    }

    // 1. 모델 선택 버튼 클릭 → 드롭다운 열기
    const modelBtn = document.querySelector('div.model-selection-button');
    if (!modelBtn) {
      return { success: false, error: '모델 선택 버튼 없음' };
    }

    modelBtn.click();
    await wait(1000);

    // 드롭다운 열렸는지 확인
    if (!modelBtn.classList.contains('active')) {
      console.log('[ChatWorker] 드롭다운 안 열림, 한번 더 클릭');
      modelBtn.click();
      await wait(1000);
    }

    // 2. div.model-option 중 일치하는 것 클릭
    const options = document.querySelectorAll('div.model-option');
    console.log(`[ChatWorker] model-option ${options.length}개`);

    let found = false;
    for (const option of options) {
      const text = option.textContent.trim();
      if (text === model) {
        // 이미 selected인지 확인
        if (option.classList.contains('selected')) {
          console.log(`[ChatWorker] "${model}" 이미 선택됨`);
        } else {
          console.log(`[ChatWorker] "${model}" 클릭`);
          option.click();
          await wait(800);
        }
        found = true;
        break;
      }
    }

    // 3. 드롭다운 닫기 (항상)
    await wait(300);
    const btnAfter = document.querySelector('div.model-selection-button');
    if (btnAfter && btnAfter.classList.contains('active')) {
      console.log('[ChatWorker] 드롭다운 닫기');
      btnAfter.click();
      await wait(800);
    }

    if (!found) {
      return { success: false, error: `모델 "${model}" 없음` };
    }

    // 4. 선택 확인
    const newLabel = document.querySelector('span.model-label');
    console.log(`[ChatWorker] 최종 모델: "${newLabel?.textContent?.trim()}"`);
    return { success: true, model };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ==================== 메시지 전송 ====================
async function chatSendMessage(message) {
  console.log('[ChatWorker] 메시지 전송:', message.substring(0, 60));

  try {
    await wait(500);

    // textarea 찾기
    const textarea = document.querySelector('textarea[name="query"]');
    if (!textarea) {
      return { success: false, error: 'textarea[name="query"] 없음' };
    }

    // 값 설정 (Vue.js 호환)
    textarea.focus();
    await wait(200);

    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(textarea, message);
    } else {
      textarea.value = message;
    }

    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(500);

    console.log(`[ChatWorker] textarea 값 길이: ${textarea.value.length}`);

    // 전송: div.enter-icon-wrapper 클릭
    const sendBtn = document.querySelector('div.enter-icon-wrapper');
    if (sendBtn) {
      console.log('[ChatWorker] enter-icon-wrapper 클릭');
      sendBtn.click();
    } else {
      // 폴백: Enter 키
      console.log('[ChatWorker] 전송 버튼 없음, Enter 키 시도');
      textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
    }

    await wait(2000);

    const afterValue = textarea.value || '';
    console.log(`[ChatWorker] 전송 후 길이: ${afterValue.length}`);

    if (afterValue.length === 0) {
      return { success: true };
    }

    return { success: false, error: '전송 실패 - 입력창이 비워지지 않음' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ==================== 시스템 프롬프트 주입 ====================
async function chatInjectSystemPrompt(systemPrompt) {
  console.log('[ChatWorker] 시스템 프롬프트 주입');
  return await chatSendMessage(systemPrompt);
}

// ==================== 응답 대기 ====================
async function chatWaitForAcknowledgment(maxWaitSec = 120) {
  console.log(`[ChatWorker] 응답 대기 (${maxWaitSec}초)`);
  const startTime = Date.now();
  const initialLen = document.body.innerText.length;
  let lastLen = initialLen, stableCount = 0;

  while (Date.now() - startTime < maxWaitSec * 1000) {
    await wait(2000);
    const curLen = document.body.innerText.length;

    // 텍스트가 늘어난 후 안정되면 응답 완료
    if (curLen > initialLen) {
      if (curLen === lastLen) {
        stableCount++;
        // 4초간 변화 없으면 응답 완료
        if (stableCount >= 2) {
          // 입력창이 다시 활성화되었는지도 확인
          const textarea = document.querySelector('textarea[name="query"]');
          const isInputReady = textarea && !textarea.disabled;
          console.log(`[ChatWorker] 응답 완료 감지 (텍스트 안정, 입력창: ${isInputReady ? '활성' : '비활성'})`);
          await wait(1000);
          return { success: true, acknowledged: true };
        }
      } else {
        stableCount = 0;
      }
    }
    lastLen = curLen;
  }
  return { success: false, error: '타임아웃' };
}

async function chatWaitForResponse(maxWaitSec = 120) {
  const startTime = Date.now();
  const initialLen = document.body.innerText.length;
  let lastLen = initialLen, stableCount = 0;
  while (Date.now() - startTime < maxWaitSec * 1000) {
    await wait(2000);
    const curLen = document.body.innerText.length;
    if (curLen > initialLen && curLen === lastLen) {
      if (++stableCount >= 2) { await wait(1000); return { success: true }; }
    } else { stableCount = 0; lastLen = curLen; }
  }
  return { success: false, error: '타임아웃' };
}

async function chatGetLastResponse() {
  const sels = ['div.markdown-body:last-of-type', 'div.message-content:last-of-type', '[class*="answer"] [class*="content"]'];
  for (const sel of sels) {
    const els = document.querySelectorAll(sel);
    if (els.length) {
      const t = els[els.length - 1].textContent?.trim();
      if (t) return { success: true, text: t };
    }
  }
  return { success: true, text: '[응답을 직접 확인해주세요]' };
}

// ==================== 메시지 핸들러 ====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log(`[ChatWorker] 수신: ${msg.type}`);
  const handlers = {
    'CHAT_SELECT_MODEL': () => chatSelectModel(msg.model),
    'CHAT_INJECT_PROMPT': () => chatInjectSystemPrompt(msg.systemPrompt),
    'CHAT_SEND_MESSAGE': () => chatSendMessage(msg.message),
    'CHAT_WAIT_ACKNOWLEDGMENT': () => chatWaitForAcknowledgment(msg.maxWaitSec || 120),
    'CHAT_WAIT_RESPONSE': () => chatWaitForResponse(msg.maxWaitSec || 120),
    'CHAT_GET_LAST_RESPONSE': () => chatGetLastResponse(),
    'CHAT_CHECK_READY': () => Promise.resolve({
      success: true,
      ready: !!(document.querySelector('textarea[name="query"]') && document.querySelector('div.enter-icon-wrapper')),
      hasInput: !!document.querySelector('textarea[name="query"]'),
      hasSendBtn: !!document.querySelector('div.enter-icon-wrapper')
    }),
    'PING': () => Promise.resolve({ success: true, source: 'content-chat' })
  };
  const handler = handlers[msg.type];
  if (handler) {
    handler().then(r => { console.log(`[ChatWorker] ${msg.type} →`, r); sendResponse(r); })
             .catch(e => { console.error(`[ChatWorker] ${msg.type} 실패:`, e); sendResponse({ success: false, error: e.message }); });
    return true;
  }
});

console.log('[ChatWorker] 준비 완료');
} // end loaded check
