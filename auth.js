/**
 * RAION 인앱 인증 모듈
 * Supabase Edge Functions 기반 이메일 인증 + 동시 접속 제한
 */
const Auth = (() => {
  const SUPABASE_URL = 'https://dnflcjpjzqmrybtcleqy.supabase.co/functions/v1';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuZmxjanBqenFtcnlidGNsZXF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NTIyMjUsImV4cCI6MjA4OTAyODIyNX0._g01argDVGK1Wmm0GT-ThidWu33ls--IR-7F20_zJF8';
  const EXTENSION_ID = 'genspark-hub';

  const STORAGE_KEYS = {
    token: 'raion_session_token',
    email: 'raion_user_email'
  };

  async function callFunction(name, body) {
    const res = await fetch(`${SUPABASE_URL}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
    return data;
  }

  function storageGet(keys) { return new Promise(resolve => chrome.storage.local.get(keys, resolve)); }
  function storageSet(items) { return new Promise(resolve => chrome.storage.local.set(items, resolve)); }
  function storageRemove(keys) { return new Promise(resolve => chrome.storage.local.remove(keys, resolve)); }

  return {
    async login(email) {
      try {
        const data = await callFunction('login', {
          email: email.trim().toLowerCase(),
          extension_id: EXTENSION_ID,
          device_info: { userAgent: navigator.userAgent, platform: navigator.platform, timestamp: new Date().toISOString() }
        });
        await storageSet({ [STORAGE_KEYS.token]: data.session_token, [STORAGE_KEYS.email]: email.trim().toLowerCase() });
        console.log('[Auth] 로그인 성공:', email);
        return { success: true, message: '로그인 성공' };
      } catch (err) {
        console.error('[Auth] 로그인 실패:', err.message);
        return { success: false, message: err.message };
      }
    },
    async verify() {
      try {
        const stored = await storageGet([STORAGE_KEYS.token, STORAGE_KEYS.email]);
        const token = stored[STORAGE_KEYS.token];
        if (!token) return { valid: false, message: '로그인 필요' };
        await callFunction('verify', { session_token: token, extension_id: EXTENSION_ID, email: stored[STORAGE_KEYS.email] });
        console.log('[Auth] 세션 유효');
        return { valid: true, message: '세션 유효' };
      } catch (err) {
        console.warn('[Auth] 세션 무효:', err.message);
        await storageRemove([STORAGE_KEYS.token, STORAGE_KEYS.email]);
        return { valid: false, message: err.message };
      }
    },
    async logout() {
      try {
        const stored = await storageGet([STORAGE_KEYS.token]);
        if (stored[STORAGE_KEYS.token]) await callFunction('logout', { session_token: stored[STORAGE_KEYS.token] }).catch(() => {});
      } finally {
        await storageRemove([STORAGE_KEYS.token, STORAGE_KEYS.email]);
        console.log('[Auth] 로그아웃 완료');
      }
    },
    async isLoggedIn() { const s = await storageGet([STORAGE_KEYS.token]); return !!s[STORAGE_KEYS.token]; },
    async getEmail() { const s = await storageGet([STORAGE_KEYS.email]); return s[STORAGE_KEYS.email] || null; },
    async getToken() { const s = await storageGet([STORAGE_KEYS.token]); return s[STORAGE_KEYS.token] || null; }
  };
})();
