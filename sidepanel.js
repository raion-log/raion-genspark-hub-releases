// ==================== RAION Genspark Hub v1.0.1 ====================
// 메인 사이드패널 셸 + 뷰 라우터

console.log('[Hub] v1.0.1 로드됨');

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// 뷰 상태
let currentView = 'home';
let loadedViews = {};

// ========== RAION 인증 ==========
function setupAuthUI() {
  const loginBtn = document.getElementById('auth-login-btn');
  const emailInput = document.getElementById('auth-email');
  const logoutBtn = document.getElementById('logout-btn');
  loginBtn.addEventListener('click', handleAuthLogin);
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuthLogin(); });
  logoutBtn.addEventListener('click', async () => {
    await Auth.logout();
    showAuthOverlay();
    document.getElementById('header-user').style.display = 'none';
  });
}

async function handleAuthLogin() {
  const emailInput = document.getElementById('auth-email');
  const errorEl = document.getElementById('auth-error');
  const loginBtn = document.getElementById('auth-login-btn');
  const email = emailInput.value.trim();

  if (!email || !email.includes('@')) {
    errorEl.textContent = '올바른 이메일을 입력해주세요.';
    errorEl.style.display = 'block';
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = '인증 중...';
  errorEl.style.display = 'none';

  const result = await Auth.login(email);

  if (result.success) {
    const verifyResult = await Auth.verify();
    if (!verifyResult.valid) {
      await Auth.logout();
      errorEl.textContent = verifyResult.message || '세션 검증 실패';
      errorEl.style.display = 'block';
      loginBtn.disabled = false;
      loginBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> 로그인`;
      return;
    }
    hideAuthOverlay();
    updateAuthUserDisplay(email);
  } else {
    errorEl.textContent = result.message;
    errorEl.style.display = 'block';
  }

  loginBtn.disabled = false;
  loginBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> 로그인`;
}

async function checkAuth() {
  const loggedIn = await Auth.isLoggedIn();
  if (!loggedIn) { showAuthOverlay(); return; }
  const result = await Auth.verify();
  if (result.valid) {
    hideAuthOverlay();
    const email = await Auth.getEmail();
    updateAuthUserDisplay(email);
  } else {
    showAuthOverlay();
  }
  startSessionWatch();
}

let sessionWatchTimer = null;
let sessionWatchInterval = 300000; // 대기 중: 5분

function startSessionWatch() {
  if (sessionWatchTimer) return;
  sessionWatchTimer = setInterval(async () => {
    const loggedIn = await Auth.isLoggedIn();
    if (!loggedIn) return;
    const result = await Auth.verify();
    if (!result.valid) {
      console.log('[Auth] 세션 만료 감지:', result.message);
      showAuthOverlay(result.message);
      document.getElementById('header-user').style.display = 'none';
    }
  }, sessionWatchInterval);
}

function updateSessionWatchInterval(running) {
  const newInterval = running ? 20000 : 300000;
  if (newInterval === sessionWatchInterval) return;
  sessionWatchInterval = newInterval;
  if (sessionWatchTimer) {
    clearInterval(sessionWatchTimer);
    sessionWatchTimer = null;
    startSessionWatch();
  }
  console.log(`[Auth] 세션 검증 주기 변경: ${newInterval / 1000}초`);
}

function showAuthOverlay(errorMsg) {
  document.getElementById('auth-overlay').classList.add('visible');
  const errEl = document.getElementById('auth-error');
  if (errEl && errorMsg) { errEl.textContent = errorMsg; errEl.style.display = 'block'; }
}
function hideAuthOverlay() { document.getElementById('auth-overlay').classList.remove('visible'); }
function updateAuthUserDisplay(email) {
  if (email) {
    document.getElementById('user-email-display').textContent = email;
    document.getElementById('header-user').style.display = 'flex';
  }
}

// ========== 뷰 라우팅 ==========
async function navigateTo(viewName) {
  if (viewName === currentView) return;

  // 현재 뷰 숨기기
  const currentEl = $(`#view-${currentView}`);
  if (currentEl) currentEl.classList.remove('active');

  // 타겟 뷰
  const targetEl = $(`#view-${viewName}`);
  if (!targetEl) return;

  // 동적 로딩 (첫 방문 시)
  if ((viewName === 'chat' || viewName === 'image') && !loadedViews[viewName]) {
    try {
      const htmlRes = await fetch(chrome.runtime.getURL(`${viewName === 'chat' ? 'chat' : 'image'}/${viewName === 'chat' ? 'chat' : 'image'}-panel.html`));
      const html = await htmlRes.text();
      targetEl.innerHTML = html;

      // CSS 로드
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${viewName === 'chat' ? 'chat' : 'image'}/${viewName === 'chat' ? 'chat' : 'image'}-panel.css`;
      document.head.appendChild(link);

      // JS 로드
      const script = document.createElement('script');
      script.src = `${viewName === 'chat' ? 'chat' : 'image'}/${viewName === 'chat' ? 'chat' : 'image'}-panel.js`;
      document.body.appendChild(script);

      loadedViews[viewName] = true;
      console.log(`[Hub] ${viewName} 뷰 로드 완료`);
    } catch (e) {
      console.error(`[Hub] ${viewName} 뷰 로드 실패:`, e);
      return;
    }
  }

  targetEl.classList.add('active');
  currentView = viewName;

  // 현재 뷰 기록
  // chrome.storage.local.set({ lastHubView: viewName });
  console.log(`[Hub] 뷰 전환: ${viewName}`);
}

// ========== 초기화 ==========
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Hub] DOM 로드 완료');

  // 버전 표시
  const ver = chrome.runtime.getManifest().version;
  document.getElementById('header-version').textContent = `v${ver}`;
  const authVer = document.getElementById('auth-version');
  if (authVer) authVer.textContent = `v${ver}`;

  setupAuthUI();
  checkAuth();

  // 카드 클릭 이벤트 - 카테고리 선택 시 해당 페이지로 이동
  $('#nav-chat').addEventListener('click', () => {
    navigateTo('chat');
    navigateTabTo('https://www.genspark.ai/agents?type=ai_chat');
  });
  $('#nav-image').addEventListener('click', () => {
    navigateTo('image');
    navigateTabTo('https://www.genspark.ai/ai_image');
  });

  // 항상 홈 화면에서 시작 (카테고리 선택 후 이동)
});

// 탭을 특정 URL로 이동 (이미 해당 페이지면 이동 안 함)
function navigateTabTo(url) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab && tab.url) {
      // 이미 해당 도메인/경로에 있으면 이동 안 함
      const targetPath = new URL(url).pathname;
      try {
        const currentPath = new URL(tab.url).pathname;
        const currentHost = new URL(tab.url).hostname;
        if (currentHost.includes('genspark.ai') && currentPath === targetPath) return;
      } catch (e) {}
      chrome.tabs.update(tab.id, { url });
    }
  });
}

// 전역 뒤로가기 함수 (서브패널에서 호출)
window.navigateToHome = function() {
  navigateTo('home');
};

console.log('[Hub] 스크립트 로드 완료');

// ==================== 업데이트 UI ====================
function isNewerVersionSP(remote, local) {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}

function setUpdateBadge(status) {
  const badge = document.getElementById('update-badge');
  if (!badge) return;
  badge.className = 'update-badge';
  switch (status) {
    case 'checking':
      badge.textContent = '확인 중...';
      badge.classList.add('checking');
      break;
    case 'latest':
      badge.textContent = '\u2713 최신';
      badge.classList.add('latest');
      break;
    case 'available':
      badge.textContent = '업데이트';
      badge.classList.add('available');
      break;
  }
}

function showUpdateBanner(version, changelog, downloadUrl) {
  const banner = document.getElementById('update-banner');
  document.getElementById('update-version').textContent = `v${version}`;
  document.getElementById('update-changelog').textContent = changelog || '';
  document.getElementById('update-download-btn').href = downloadUrl;
  banner.style.display = 'block';
  setUpdateBadge('available');
}

function hideUpdateBanner() {
  const banner = document.getElementById('update-banner');
  if (banner) banner.style.display = 'none';
}

function checkStoredUpdate() {
  chrome.storage.local.get('availableUpdate', (result) => {
    const update = result.availableUpdate;
    if (!update) {
      setUpdateBadge('latest');
      return;
    }
    const currentVersion = chrome.runtime.getManifest().version;
    if (isNewerVersionSP(update.version, currentVersion)) {
      showUpdateBanner(update.version, update.changelog, update.download_url);
    } else {
      setUpdateBadge('latest');
    }
  });
}

document.getElementById('update-badge')?.addEventListener('click', () => {
  const badge = document.getElementById('update-badge');
  if (badge.classList.contains('available')) {
    chrome.storage.local.get('availableUpdate', (result) => {
      if (result.availableUpdate) {
        showUpdateBanner(result.availableUpdate.version, result.availableUpdate.changelog, result.availableUpdate.download_url);
      }
    });
  } else {
    chrome.runtime.sendMessage({ type: 'CHECK_UPDATE_NOW' });
  }
});

document.getElementById('update-refresh-btn')?.addEventListener('click', () => {
  const btn = document.getElementById('update-refresh-btn');
  btn.classList.add('spinning');
  chrome.runtime.sendMessage({ type: 'CHECK_UPDATE_NOW' }, () => {
    setTimeout(() => btn.classList.remove('spinning'), 1000);
  });
});

document.getElementById('update-dismiss-btn')?.addEventListener('click', () => {
  hideUpdateBanner();
});

checkStoredUpdate();

// 업데이트 메시지 수신
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'UPDATE_AVAILABLE') {
    showUpdateBanner(msg.version, msg.changelog, msg.download_url);
  }
  if (msg.type === 'UPDATE_CHECK_STATUS') {
    setUpdateBadge(msg.status);
  }
});
