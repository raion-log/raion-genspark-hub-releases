const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// === 설정 ===
const GITHUB_REPO = 'raion-log/raion-genspark-hub-releases';
const DIST_DIR = path.join(__dirname, 'dist');
const ZIP_NAME = 'dist.zip';
const LATEST_JSON = path.join(__dirname, 'latest.json');

// === CLI 인수 ===
const changelog = process.argv[2];
if (!changelog) {
  console.error('사용법: node deploy.js "변경사항 요약"');
  process.exit(1);
}

// === dist/manifest.json에서 버전 읽기 ===
const distManifestPath = path.join(DIST_DIR, 'manifest.json');
if (!fs.existsSync(distManifestPath)) {
  console.error('[Deploy] ERROR: dist/manifest.json을 찾을 수 없습니다.');
  console.error('[Deploy] 먼저 node build-obfuscate.js를 실행하세요.');
  process.exit(1);
}

const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf8'));
const version = distManifest.version;
const tag = `v${version}`;
console.log(`[Deploy] 버전: ${version}`);

// === 현재 latest.json보다 새 버전인지 검증 ===
if (fs.existsSync(LATEST_JSON)) {
  const current = JSON.parse(fs.readFileSync(LATEST_JSON, 'utf8'));
  if (!isNewerVersion(version, current.version)) {
    console.error(`[Deploy] ERROR: ${version}은(는) ${current.version}보다 새 버전이 아닙니다.`);
    console.error('[Deploy] manifest.json의 version을 올리고 다시 빌드하세요.');
    process.exit(1);
  }
}

// === dist.zip 생성 ===
const zipPath = path.join(__dirname, ZIP_NAME);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

console.log('[Deploy] dist.zip 생성 중...');
execSync(`cd "${DIST_DIR}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
console.log('[Deploy] dist.zip 생성 완료');

// === latest.json 업데이트 ===
const today = new Date().toISOString().split('T')[0];
const latestData = {
  version: version,
  changelog: changelog,
  download_url: `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${ZIP_NAME}`,
  released_at: today
};
fs.writeFileSync(LATEST_JSON, JSON.stringify(latestData, null, 2) + '\n', 'utf8');
console.log('[Deploy] latest.json 업데이트 완료');

// === GitHub Release 생성 ===
const releaseNotes = `${changelog}

## 설치 방법
1. 아래 dist.zip 다운로드
2. 압축 해제
3. Chrome → chrome://extensions 열기
4. 기존 RAION Genspark Hub 확장프로그램 삭제
5. "압축해제된 확장 프로그램을 로드합니다" 클릭
6. 압축 해제한 폴더 선택`;

console.log(`[Deploy] GitHub Release ${tag} 생성 중...`);
try {
  const notesEscaped = releaseNotes.replace(/"/g, '\\"');
  execSync(
    `gh release create "${tag}" "${zipPath}" --repo "${GITHUB_REPO}" --title "${tag}" --notes "${notesEscaped}"`,
    { stdio: 'inherit' }
  );
} catch (e) {
  console.error('[Deploy] GitHub Release 생성 실패.');
  console.error('[Deploy] gh CLI 설치 및 인증을 확인하세요: gh auth login');
  process.exit(1);
}

// === latest.json 커밋 & 푸시 ===
console.log('[Deploy] latest.json 커밋 중...');
try {
  execSync(`git add latest.json && git commit -m "Release ${tag}" && git push`, { stdio: 'inherit' });
} catch (e) {
  console.warn('[Deploy] ⚠ latest.json git push 실패 - 수동으로 push해주세요.');
}

// === 정리 ===
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

console.log(`\n✅ 배포 완료: ${tag}`);
console.log(`   변경사항: ${changelog}`);
console.log(`   다운로드: https://github.com/${GITHUB_REPO}/releases/tag/${tag}`);

function isNewerVersion(remote, local) {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
}
