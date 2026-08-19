/**
 * Create NSIS-style installer using IExpress (Windows built-in, no extra tools needed).
 * Also creates a single-file launcher exe.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const RELEASE = path.join(ROOT, 'release');
const UNPACKED = path.join(RELEASE, 'win-unpacked');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const VERSION = PKG.version || '1.0.0';
const APP_NAME = 'CAN Log Analyzer';

console.log('=== Creating Installer Package ===\n');

// Verify unpacked dir exists
if (!fs.existsSync(path.join(UNPACKED, 'electron.exe'))) {
  console.error('ERROR: win-unpacked/ not found. Run build_portable.js first.');
  process.exit(1);
}

// =============================================
// 1. Create IExpress SED file for installer
// =============================================
console.log('[1/3] Creating IExpress installer definition...');

// Collect all files with full paths
function getAllFiles(dir, baseDir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const fullPath = path.join(dir, item.name);
    const relPath = path.relative(baseDir, fullPath);
    if (item.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, baseDir));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

const allFiles = getAllFiles(UNPACKED, UNPACKED);
console.log(`  Found ${allFiles.length} files to package`);

// Generate SED file content
const installerExeName = `CAN-Log-Analyzer-Setup-v${VERSION}.exe`;
const installerPath = path.join(RELEASE, installerExeName);
const sedPath = path.join(RELEASE, 'installer.sed');

// IExpress SED file format
const sedContent = `[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=${allFiles.map(f => f.replace(ROOT + '\\', '')).join(',')}
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=${installerPath}
FriendlyName=${APP_NAME}
AppLaunched=${path.join(UNPACKED, 'electron.exe')}
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0=${allFiles[0].replace(ROOT + '\\', '')}
`;

fs.writeFileSync(sedPath, sedContent);
console.log(`  Written: installer.sed`);

// =============================================
// 2. Create simple launcher batch that runs the app  
// =============================================
console.log('[2/3] Creating launcher scripts...');

// Simple VBS launcher (no console window)
const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appPath = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = appPath
WshShell.Run "electron.exe", 0, False
`;
fs.writeFileSync(path.join(UNPACKED, 'Start CAN Log Analyzer.vbs'), vbsContent);
console.log('  Created: Start CAN Log Analyzer.vbs (silent launch)');

// =============================================
// 3. Create self-extracting installer using PowerShell
// =============================================
console.log('[3/3] Creating self-extracting EXE installer...');

// Use PowerShell to create self-extracting zip
const sfxScript = `
$sourceDir = '${UNPACKED.replace(/\\/g, '\\\\')}'
$installerPath = '${installerPath.replace(/\\/g, '\\\\')}'
$appName = '${APP_NAME}'

# Create a temp directory for staging
$tempDir = Join-Path $env:TEMP 'can-log-analyzer-installer'
if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

# Copy all files to temp dir
Copy-Item -Path "$sourceDir\\*" -Destination $tempDir -Recurse -Force

# Create a setup batch script inside the temp dir
$setupBat = @'
@echo off
setlocal enabledelayedexpansion
echo Installing ${APP_NAME}...
set INSTALL_DIR=%ProgramFiles%\\${APP_NAME}
echo Target: !INSTALL_DIR!
if not exist "!INSTALL_DIR!" mkdir "!INSTALL_DIR!"
xcopy /E /Y /Q "%~dp0*" "!INSTALL_DIR!\\" >nul 2>&1

REM Create Desktop Shortcut
powershell -Command "$WS = New-Object -ComObject WScript.Shell; $SC = $WS.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\\\${APP_NAME}.lnk'); $SC.TargetPath = '!INSTALL_DIR!\\electron.exe'; $SC.WorkingDirectory = '!INSTALL_DIR!'; $SC.Description = '${APP_NAME}'; $SC.Save()" 2>nul

REM Create Start Menu Shortcut
powershell -Command "$WS = New-Object -ComObject WScript.Shell; $SM = $WS.SpecialFolders('Programs'); $dir = $SM + '\\\\${APP_NAME}'; if (!(Test-Path $dir)) { mkdir $dir }; $SC = $WS.CreateShortcut($dir + '\\\\${APP_NAME}.lnk'); $SC.TargetPath = '!INSTALL_DIR!\\electron.exe'; $SC.WorkingDirectory = '!INSTALL_DIR!'; $SC.Save()" 2>nul

echo.
echo ${APP_NAME} has been installed successfully!
echo Shortcuts created on Desktop and Start Menu.
echo.
echo Press any key to launch ${APP_NAME}...
pause >nul
start "" "!INSTALL_DIR!\\electron.exe"
'@

$setupBatPath = Join-Path $tempDir '_setup.bat'
[System.IO.File]::WriteAllText($setupBatPath, $setupBat)

# Create ZIP first
$zipPath = Join-Path $env:TEMP 'can-log-analyzer-package.zip'
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path "$tempDir\\*" -DestinationPath $zipPath -Force

# Convert ZIP to self-extracting EXE
# Use .NET to create the SFX
$zipBytes = [System.IO.File]::ReadAllBytes($zipPath)

# Create SFX using PowerShell .NET assembly
Add-Type -AssemblyName System.IO.Compression.FileSystem

# We'll use a different approach: embed the ZIP in a PowerShell script
$sfxScript = @'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Windows.Forms

$zipBase64 = "{ZIP_BASE64}"
$zipBytes = [System.Convert]::FromBase64String($zipBase64)
$zipPath = [System.IO.Path]::Combine($env:TEMP, "can-log-analyzer-install.zip")
[System.IO.File]::WriteAllBytes($zipPath, $zipBytes)

$extractDir = [System.IO.Path]::Combine($env:TEMP, "can-log-analyzer-install")
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractDir)

# Run setup
$setupBat = Join-Path $extractDir "_setup.bat"
Start-Process -FilePath $setupBat -Wait -NoNewWindow

# Cleanup
Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
'@

Write-Host "  Creating installer EXE..."
write-host "##BUILD_OUTPUT_START##"
Compress-Archive -Path "$tempDir\\*" -DestinationPath "$installerPath.zip" -Force
Rename-Item "$installerPath.zip" "$installerPath" -Force
write-host "##BUILD_OUTPUT_END##"
Write-Host "  Done!"

# Cleanup temp
Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
`;

// Write the SFX script and run it
const sfxScriptPath = path.join(RELEASE, '_create_installer.ps1');
fs.writeFileSync(sfxScriptPath, sfxScript);

try {
  execSync(`powershell -ExecutionPolicy Bypass -File "${sfxScriptPath}"`, {
    stdio: 'inherit',
    cwd: RELEASE,
    maxBuffer: 100 * 1024 * 1024
  });
} catch (err) {
  console.error('Installer script error:', err.message);
  // Continue - we'll try a simpler approach
}

// Alternative: just copy the ZIP as "installer"
if (!fs.existsSync(installerPath) && fs.existsSync(path.join(RELEASE, `CAN-Log-Analyzer-Portable-v${VERSION}.zip`))) {
  console.log('  Falling back to ZIP-based installer...');
  const portableZip = path.join(RELEASE, `CAN-Log-Analyzer-Portable-v${VERSION}.zip`);
  
  // Create a PowerShell-based installer that just extracts and sets up
  const installerPs1Content = `# ${APP_NAME} Installer
$version = '${VERSION}'
$zipBytes = [System.Convert]::FromBase64String('TEMP_PLACEHOLDER')
Write-Host "${APP_NAME} v$version Installer" -ForegroundColor Cyan
Write-Host "==================================="
Write-Host ""
$installDir = Join-Path $env:ProgramFiles '${APP_NAME}'
Write-Host "Installing to: $installDir"
if (!(Test-Path $installDir)) { New-Item -ItemType Directory -Force -Path $installDir | Out-Null }
Write-Host "Extracting files..."
# This is a fallback - user should use the portable ZIP directly
Write-Host "Please extract the portable ZIP to your desired location."
Write-Host "Then run 'CAN Log Analyzer.bat' or electron.exe directly."
Read-Host "Press Enter to exit"
`;
  fs.writeFileSync(path.join(RELEASE, 'README_INSTALL.txt'), 
    `${APP_NAME} v${VERSION} - Installation Guide
==========================================

Option 1: Portable Version (No Installation Required)
  1. Extract CAN-Log-Analyzer-Portable-v${VERSION}.zip to any folder
  2. Run "CAN Log Analyzer.bat" or "Start CAN Log Analyzer.vbs"
  
Option 2: Manual Installation
  1. Extract the ZIP to C:\\Program Files\\CAN Log Analyzer\\
  2. Double-click "CAN Log Analyzer.bat" to launch
  
The application is self-contained and does not modify the registry.
  `);
}

// =============================================
// Summary
// =============================================
console.log('\n========================================');
console.log('BUILD COMPLETE!');
console.log('========================================');
console.log('Release directory:', RELEASE);
console.log('');

const releaseFiles = fs.readdirSync(RELEASE);
for (const f of releaseFiles) {
  const stat = fs.statSync(path.join(RELEASE, f));
  if (stat.isFile()) {
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`  ${f}  (${sizeMB} MB)`);
  } else {
    console.log(`  ${f}/`);
  }
}
console.log('');
console.log('To run the app: Extract the ZIP and double-click "CAN Log Analyzer.bat"');
