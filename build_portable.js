/**
 * Manual build script - assembles Electron app from local cache, no network.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const RELEASE = path.join(ROOT, 'release');
const ELECTRON_CACHE = path.join(
  process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'electron',
  'electron-v28.3.3-win32-x64'
);

console.log('=== CAN Log Analyzer - Manual Build ===\n');

// Step 1: Verify
console.log('[1/5] Checking prerequisites...');
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('ERROR: dist/ not found. Run "npx vite build" first.');
  process.exit(1);
}
if (!fs.existsSync(path.join(ELECTRON_CACHE, 'electron.exe'))) {
  console.error('ERROR: Electron cache not found at: ' + ELECTRON_CACHE);
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version || '1.0.0';
console.log('  Version:', version);

// Step 2: Clean and create release dir
console.log('\n[2/5] Preparing release directory...');
if (fs.existsSync(RELEASE)) {
  fs.rmSync(RELEASE, { recursive: true, force: true });
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const unpackedDir = path.join(RELEASE, 'win-unpacked');
const resourcesDir = path.join(unpackedDir, 'resources');
const appDir = path.join(resourcesDir, 'app');
fs.mkdirSync(appDir, { recursive: true });

// Step 3: Copy Electron runtime
console.log('[3/5] Copying Electron runtime...');
const entries = fs.readdirSync(ELECTRON_CACHE, { withFileTypes: true });
let count = 0;
for (const entry of entries) {
  const src = path.join(ELECTRON_CACHE, entry.name);
  const dest = path.join(unpackedDir, entry.name);
  if (entry.isFile() && !entry.name.endsWith('.zip')) {
    fs.copyFileSync(src, dest);
    count++;
  } else if (entry.isDirectory() && entry.name !== 'resources') {
    // Copy locales only (skip nested resources)
    copyDirSync(src, dest);
    count++;
  }
}
console.log('  Copied', count, 'files');

// Step 4: Copy app files
console.log('[4/5] Copying application files...');
// dist
copyDirSync(path.join(ROOT, 'dist'), path.join(appDir, 'dist'));
console.log('  Copied dist/');

// electron
const electronAppDir = path.join(appDir, 'electron');
fs.mkdirSync(electronAppDir, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'electron', 'main.js'), path.join(electronAppDir, 'main.js'));
fs.copyFileSync(path.join(ROOT, 'electron', 'preload.js'), path.join(electronAppDir, 'preload.js'));
console.log('  Copied electron/');

// package.json
const appPkg = {
  name: 'can-log-analyzer',
  version: version,
  main: 'electron/main.js',
  dependencies: pkg.dependencies || {}
};
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(appPkg, null, 2));
console.log('  Created app package.json');

// Step 5: Create launcher + ZIP
console.log('[5/5] Creating launcher and ZIP...');

// Launcher batch file
const bat = '@echo off\r\nstart "" "%~dp0electron.exe" "%~dp0resources/app"\r\n';
fs.writeFileSync(path.join(unpackedDir, 'CAN Log Analyzer.bat'), bat);
console.log('  Created launcher: CAN Log Analyzer.bat');

// ZIP - portable version
const zipName = 'CAN-Log-Analyzer-Portable-v' + version + '.zip';
const zipPath = path.join(RELEASE, zipName);
console.log('  Zipping to:', zipName);
execSync(
  'powershell -Command "Compress-Archive -Path \'' + unpackedDir + '\\*\' -DestinationPath \'' + zipPath + '\' -Force"',
  { stdio: 'inherit' }
);
console.log('  Created:', zipName);

// Summary
const totalSize = fs.statSync(zipPath).size;
console.log('\n========================================');
console.log('BUILD COMPLETE!');
console.log('========================================');
console.log('Portable ZIP:', zipPath);
console.log('Size:', (totalSize / (1024 * 1024)).toFixed(1), 'MB');
console.log('Unpacked dir:', unpackedDir);
console.log('\nTo run: Double-click "CAN Log Analyzer.bat" in win-unpacked/');
