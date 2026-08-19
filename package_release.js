/**
 * Creates the final release assets with setup instructions.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const RELEASE = path.join(ROOT, 'release');
const UNPACKED = path.join(RELEASE, 'win-unpacked');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const VERSION = PKG.version || '1.0.0';
const APP_NAME = (PKG.build && PKG.build.productName) || PKG.productName || 'CAN Log Analyzer';

console.log('=== Packaging ' + APP_NAME + ' v' + VERSION + ' ===\n');

const EXE_NAME = fs.existsSync(path.join(UNPACKED, `${APP_NAME}.exe`)) ? `${APP_NAME}.exe` : 'electron.exe';
if (!fs.existsSync(path.join(UNPACKED, EXE_NAME))) {
  console.error('ERROR: run build_portable.js first');
  process.exit(1);
}

// 1. Create silent launcher VBS (no console window)
const vbs = `' ${APP_NAME} Launcher
Set oShell = CreateObject("WScript.Shell")
Set oFSO = CreateObject("Scripting.FileSystemObject")
sPath = oFSO.GetParentFolderName(WScript.ScriptFullName)
oShell.CurrentDirectory = sPath
oShell.Run """" & sPath & "\\${EXE_NAME}""", 0, False
`;
fs.writeFileSync(path.join(UNPACKED, 'Launch.vbs'), vbs);

// 2. Create install batch script (copy to Program Files + shortcuts)
const installBat = `@echo off
title ${APP_NAME} Installer
echo ========================================
echo  ${APP_NAME} v${VERSION} Installer
echo ========================================
echo.
set "INSTALL_DIR=%ProgramFiles%\\${APP_NAME}"
echo Target: %INSTALL_DIR%
echo.

if exist "%INSTALL_DIR%" (
    echo Previous installation found. Removing...
    rmdir /s /q "%INSTALL_DIR%" 2>nul
)

echo Copying files...
mkdir "%INSTALL_DIR%"
xcopy /E /Y /Q "%~dp0*" "%INSTALL_DIR%\\" >nul 2>&1

echo Creating shortcuts...
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $desktop = [Environment]::GetFolderPath('Desktop'); ^
   $sc = $ws.CreateShortcut("$desktop\\${APP_NAME}.lnk"); ^
   $sc.TargetPath = '%INSTALL_DIR%\\${EXE_NAME}'; ^
   $sc.WorkingDirectory = '%INSTALL_DIR%'; ^
   $sc.Description = 'CAN bus log analysis tool'; ^
   $sc.IconLocation = '%INSTALL_DIR%\\${EXE_NAME},0'; ^
   $sc.Save()"

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $startMenu = [Environment]::GetFolderPath('StartMenu'); ^
   $dir = Join-Path $startMenu 'Programs\\${APP_NAME}'; ^
   if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force ^| Out-Null }; ^
   $sc = $ws.CreateShortcut(Join-Path $dir '${APP_NAME}.lnk'); ^
   $sc.TargetPath = '%INSTALL_DIR%\\${EXE_NAME}'; ^
   $sc.WorkingDirectory = '%INSTALL_DIR%'; ^
   $sc.Save()"

echo.
echo ========================================
echo  Installation Complete!
echo ========================================
echo.
echo  Desktop shortcut created.
echo  Launch from: %INSTALL_DIR%\\${EXE_NAME}
echo.
echo  Press any key to launch ${APP_NAME}...
pause >nul
start "" "%INSTALL_DIR%\\${EXE_NAME}"
`;
fs.writeFileSync(path.join(UNPACKED, 'Setup.bat'), installBat);

// 3. Create README
const readme = `${APP_NAME} v${VERSION}
=============================

Three ways to use this application:

[Option A] Quick Run (no installation)
  Open the "win-unpacked" folder
  Double-click "CAN Log Analyzer.exe" to launch

[Option B] Run the Installer
  Double-click "CAN Log Analyzer Setup 1.0.0.exe"
  Follow the installation wizard

[Option C] Portable
  Extract CAN Log Analyzer-Portable-1.0.0.exe or use the ZIP
  Run "CAN Log Analyzer.exe" directly

------------------------------------------------------------
Quick Start:
  1. Load an ASC log file (e.g., TestExample/powertrain.asc)
  2. Load a DBC definition file (e.g., TestExample/powertrain.dbc)
  3. Select messages to analyze
  4. View decoded signals and plots
`;
fs.writeFileSync(path.join(RELEASE, 'README.txt'), readme);

// 4. Copy TestExample into the unpacked dir for convenience
const testDir = path.join(UNPACKED, 'TestExample');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}
const testFiles = fs.readdirSync(path.join(ROOT, 'TestExample'));
for (const f of testFiles) {
  fs.copyFileSync(path.join(ROOT, 'TestExample', f), path.join(testDir, f));
}

// 5. Create the installable ZIP with Setup.bat
const installZip = path.join(RELEASE, `CAN-Log-Analyzer-Installer-v${VERSION}.zip`);
// Already created by build_portable.js as portable ZIP

// 6. Remove unnecessary artifacts
const cleanupFiles = ['_create_installer.ps1', 'installer.sed'];
for (const f of cleanupFiles) {
  const fp = path.join(RELEASE, f);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

// Summary
console.log('Release assets:\n');
const files = fs.readdirSync(RELEASE);
for (const f of files.sort()) {
  const full = path.join(RELEASE, f);
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    const mb = (stat.size / 1048576).toFixed(1);
    console.log(`  [${mb} MB]  ${f}`);
  } else {
    console.log(`  [DIR]     ${f}/`);
  }
}
console.log(`\nDone! Release files in: ${RELEASE}`);
console.log('Share the ZIP file or the entire win-unpacked/ folder.');
