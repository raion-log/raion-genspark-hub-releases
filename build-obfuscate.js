const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const DIST = path.join(__dirname, 'dist');

// 난독화 대상 JS 파일
const jsFiles = [
  'background.js',
  'content-image.js',
  'content-chat.js',
  'sidepanel.js',
  'chat/chat-panel.js',
  'image/image-panel.js'
];

// 서비스 워커 파일 (window 객체 없음)
const serviceWorkerFiles = ['background.js'];

// 그대로 복사할 파일
const copyFiles = ['manifest.json', 'auth.js'];

// 복사할 폴더
const copyDirs = ['icons', 'data'];

// HTML 파일
const htmlFiles = [
  'sidepanel.html',
  'chat/chat-panel.html',
  'image/image-panel.html'
];

// CSS 파일
const cssFiles = [
  'sidepanel.css',
  'chat/chat-panel.css',
  'image/image-panel.css'
];

// HTML 압축
function minifyHTML(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s*=\s*/g, '=')
    .trim();
}

// CSS 압축
function minifyCSS(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*{\s*/g, '{')
    .replace(/\s*}\s*/g, '}')
    .replace(/\s*:\s*/g, ':')
    .replace(/\s*;\s*/g, ';')
    .replace(/\s*,\s*/g, ',')
    .replace(/;}/g, '}')
    .trim();
}

// 일반 페이지용 난독화 설정
const obfuscationOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.8,
  debugProtection: true,
  debugProtectionInterval: 2000,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 3,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 1,
  stringArrayEncoding: ['base64', 'rc4'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 3,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 1,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

// 서비스 워커용 난독화 설정
const serviceWorkerOptions = {
  ...obfuscationOptions,
  selfDefending: false,
  debugProtection: false,
  debugProtectionInterval: 0,
  disableConsoleOutput: false
};

// dist 폴더 생성
if (!fs.existsSync(DIST)) {
  fs.mkdirSync(DIST, { recursive: true });
}

// 서브 디렉토리 생성
['chat', 'image', 'data', 'icons'].forEach(dir => {
  const dirPath = path.join(DIST, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// 폴더 재귀 복사
function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  fs.readdirSync(src).forEach(item => {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

// 폴더 복사
copyDirs.forEach(dir => {
  const srcDir = path.join(SRC, dir);
  const destDir = path.join(DIST, dir);
  if (fs.existsSync(srcDir)) {
    copyDirRecursive(srcDir, destDir);
    console.log(`[OK] ${dir}/ copied`);
  }
});

// 일반 파일 복사
copyFiles.forEach(file => {
  const src = path.join(SRC, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(DIST, file));
    console.log(`[OK] ${file} copied`);
  }
});

// HTML 압축 처리
htmlFiles.forEach(file => {
  const src = path.join(SRC, file);
  if (fs.existsSync(src)) {
    const original = fs.readFileSync(src, 'utf8');
    const minified = minifyHTML(original);
    fs.writeFileSync(path.join(DIST, file), minified, 'utf8');
    console.log(`[OK] ${file} minified (${original.length} -> ${minified.length} chars)`);
  }
});

// CSS 압축 처리
cssFiles.forEach(file => {
  const src = path.join(SRC, file);
  if (fs.existsSync(src)) {
    const original = fs.readFileSync(src, 'utf8');
    const minified = minifyCSS(original);
    fs.writeFileSync(path.join(DIST, file), minified, 'utf8');
    console.log(`[OK] ${file} minified (${original.length} -> ${minified.length} chars)`);
  }
});

// JS 파일 난독화
jsFiles.forEach(file => {
  const src = path.join(SRC, file);
  if (!fs.existsSync(src)) {
    console.log(`[SKIP] ${file} not found`);
    return;
  }

  const code = fs.readFileSync(src, 'utf8');
  console.log(`[...] ${file} (${code.length} chars) obfuscating...`);

  const options = serviceWorkerFiles.includes(file) ? serviceWorkerOptions : obfuscationOptions;
  const result = JavaScriptObfuscator.obfuscate(code, options);
  const obfuscated = result.getObfuscatedCode();

  fs.writeFileSync(path.join(DIST, file), obfuscated, 'utf8');
  console.log(`[OK] ${file} -> ${obfuscated.length} chars (${Math.round(obfuscated.length / code.length * 100)}%)`);
});

console.log('\n=== Done! dist/ folder ready ===');
