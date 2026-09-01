const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { spawn } = require('child_process');
const readline = require('readline');
const { buildBLFBuffer, parseBLFBuffer, parseBLFBufferDetailed } = require('./blf');
const { isNonDataLine, parseASCDataLine, generateASC } = require('./asc');
const { parseDBC, decodeSignalFrame, getEnumLabel } = require('./dbc');
const { buildDecodeContext, decodeFramesChunk, decodeAll } = require('./signalDecode');

const APP_VERSION = app.getVersion();
const OFFICIAL_SITE = 'https://atemall-ai.com';
const GITHUB_REPO = 'https://github.com/ATEMall/can-log-analyzer';

let mainWindow;

// ==================== R2: main-process message store ====================
// Parsed logs live here (keyed by source file path); the renderer sends only
// the file path + signal selection for decoding, never the full frame array.
const messageStore = new Map();
// Decode cancellation flag: set by signal:decodeCancel, checked at block
// boundaries so a cancel takes effect within one chunk (<= ~500k frames).
let decodeCancelled = false;

function storeMessages(filePath, messages) {
  if (!filePath || !messages) return;
  messageStore.set(filePath, messages);
}

function clearMessageStore() {
  messageStore.clear();
  decodeCancelled = false;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ==================== R5/R6: settings + recent files ====================
// Preferences live in %APPDATA%/can-log-analyzer/settings.json (userData).
// Holds: windowBounds, lastTab, defaultSampleStep, defaultExportDir and the
// recent-file lists (recent_log / recent_dbc / recent_project, 10 each).
let settings = null;

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    settings = {};
  }
  return settings;
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('saveSettings failed:', err.message);
  }
}

function getSetting(key, def) {
  return settings && settings[key] !== undefined ? settings[key] : def;
}

function setSetting(patch) {
  settings = { ...(settings || loadSettings()), ...patch };
  saveSettings();
  return settings;
}

function addRecent(type, filePath) {
  const key = `recent_${type}`;
  const list = (settings && settings[key] ? settings[key] : []).filter(p => p !== filePath);
  list.unshift(filePath);
  setSetting({ [key]: list.slice(0, 10) });
  return list.slice(0, 10);
}

function createWindow() {
  // Try multiple paths for logo (dev: public/, production: dist/)
  const logoPaths = [
    path.join(__dirname, '../dist/logo.png'),
    path.join(__dirname, '../public/logo.png'),
    path.join(app.getAppPath(), 'dist/logo.png'),
    path.join(app.getAppPath(), 'public/logo.png')
  ];
  let icon = undefined;
  for (const p of logoPaths) {
    if (fs.existsSync(p)) { icon = p; break; }
  }

  // R6: restore the persisted window size/position.
  const savedBounds = getSetting('windowBounds', null);
  mainWindow = new BrowserWindow({
    width: savedBounds?.width || 1400,
    height: savedBounds?.height || 900,
    x: savedBounds?.x,
    y: savedBounds?.y,
    backgroundColor: '#f5f5f5',
    icon: icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true
    },
    title: 'CAN Log Analyzer',
    show: false
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // R6: persist window bounds on move/resize (debounced).
  let boundsTimer = null;
  const saveBounds = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const b = mainWindow.getBounds();
      setSetting({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
    }
  };
  mainWindow.on('resize', () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 500); });
  mainWindow.on('move', () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 500); });

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173').catch(err => {
      console.error('Failed to load URL:', err);
    });
    
    setTimeout(() => {
      try { mainWindow.webContents.openDevTools(); } catch(e) {}
    }, 1000);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath).then(() => {
        mainWindow.show();
      }).catch(err => {
        console.error('loadFile error:', err);
        showErrorPage(indexPath);
      });
    } else {
      showErrorPage(indexPath);
    }
  }
}

function showErrorPage(p) {
  mainWindow.loadURL(`data:text/html,<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;padding:40px;background:#f5f5f5;">
    <h1>CAN Log Analyzer</h1>
    <h2>Error</h2>
    <p>Could not load the application.</p>
    <p>Expected file: ${p}</p>
  </body></html>`).then(() => {
    mainWindow.show();
  }).catch(err => {
    console.error('Error loading error page:', err);
    mainWindow.show();
  });
}

// R5: single instance + .claproj file-association open (double-click on a
// project file, or a second launch while the app is running).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const proj = argv.find(a => typeof a === 'string' && a.endsWith('.claproj'));
    if (proj && mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.send('project:open-request', proj);
    }
  });

  app.whenReady().then(() => {
    loadSettings();
    buildApplicationMenu();
    createWindow();
    // Open a .claproj passed on the command line (file association).
    const proj = process.argv.find(a => typeof a === 'string' && a.endsWith('.claproj'));
    if (proj) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('project:open-request', proj);
        }
      }, 800);
    }
  });
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ==================== Application Menu ====================

/**
 * Broadcast a semantic menu action to the renderer. The renderer wires these
 * to React state (Help > 使用手册 opens the in-window HelpModal; Tool > 清空
 * wipes the loaded data; View > Reload toggles DevTools).
 */
function sendMenuAction(action, payload) {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send('menu:action', { action, payload });
  }
}

// R6: dynamic "Recent Files" submenu — logs, DBC files and projects (10 each,
// most recent first). Rebuilt on every menu open via buildApplicationMenu().
function buildRecentSubmenu() {
  const rec = loadSettings();
  const items = [];
  const addGroup = (label, list, action) => {
    if (list && list.length) {
      items.push({ label, enabled: false });
      for (const p of list) {
        items.push({ label: p, click: () => sendMenuAction(action, p) });
      }
      items.push({ type: 'separator' });
    }
  };
  addGroup('最近日志', rec.recent_log, 'file:open-recent-log');
  addGroup('最近 DBC', rec.recent_dbc, 'file:open-recent-dbc');
  addGroup('最近工程', rec.recent_project, 'file:open-recent-project');
  if (items.length === 0) items.push({ label: '（无最近文件）', enabled: false });
  items.push({ type: 'separator' });
  items.push({
    label: '清除最近列表',
    click: () => {
      setSetting({ recent_log: [], recent_dbc: [], recent_project: [] });
      buildApplicationMenu();
    }
  });
  return items;
}

function buildApplicationMenu() {
  const isMac = process.platform === 'darwin';

  // File menu (mostly native defaults so users keep their muscle memory;
  // we override the Quit label on non-mac to keep it short).
  const fileMenu = {
    label: 'File',
    submenu: [
      {
        label: 'Open ASC…',
        accelerator: 'CmdOrCtrl+O',
        click: () => sendMenuAction('file:open-asc')
      },
      {
        label: 'Open BLF…',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: () => sendMenuAction('file:open-blf')
      },
      {
        label: 'Load DBC…',
        accelerator: 'CmdOrCtrl+D',
        click: () => sendMenuAction('file:load-dbc')
      },
      { type: 'separator' },
      // R5: project save / restore
      {
        label: 'Open Project…',
        accelerator: 'CmdOrCtrl+Shift+P',
        click: () => sendMenuAction('file:open-project')
      },
      {
        label: 'Save Project',
        accelerator: 'CmdOrCtrl+S',
        click: () => sendMenuAction('file:save-project')
      },
      { type: 'separator' },
      // R6: recent files (logs / DBC / projects), rebuilt on every open.
      {
        label: 'Recent Files',
        submenu: buildRecentSubmenu()
      },
      { type: 'separator' },
      {
        label: 'Export ASC…',
        accelerator: 'CmdOrCtrl+E',
        click: () => sendMenuAction('file:export-asc')
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  };

  const editMenu = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  };

  const viewMenu = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  };

  // Tool menu — app-level actions that used to live as inline buttons in the
  // header (清空). New "tools" can be added here without further UI churn.
  const toolMenu = {
    label: 'Tool',
    submenu: [
      {
        label: '清空所有数据',
        accelerator: 'CmdOrCtrl+Shift+Delete',
        click: () => sendMenuAction('tool:clear')
      },
      { type: 'separator' },
      {
        label: 'Convert ASC → BLF',
        click: () => sendMenuAction('tool:convert-asc-blf')
      },
      {
        label: 'Convert Physical CSV → ASC',
        click: () => sendMenuAction('tool:convert-csv-asc')
      }
    ]
  };

  const windowMenu = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            { role: 'window' }
          ]
        : [{ role: 'close' }])
    ]
  };

  // Help menu — opens the in-window HelpModal (no external page).
  const helpMenu = {
    label: 'Help',
    submenu: [
      {
        label: '使用手册',
        accelerator: 'F1',
        click: () => sendMenuAction('help:open')
      },
      {
        label: '访问官网',
        click: () => shell.openExternal(OFFICIAL_SITE)
      },
      {
        label: 'GitHub 仓库',
        click: () => shell.openExternal(GITHUB_REPO)
      }
    ]
  };

  // About menu — sits next to Help in the menu bar per product request.
  const aboutMenu = {
    label: 'About',
    submenu: [
      {
        label: '关于 CAN Log Analyzer Pro',
        click: () => {
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'About CAN Log Analyzer Pro',
            message: 'CAN Log Analyzer Pro',
            detail:
              `Version: v${APP_VERSION}\n\n` +
              '基于 Electron + React + Ant Design 构建的 CAN 报文分析工具，\n' +
              '支持 ASC / BLF 加载、DBC 解码、信号解析、CRC 计算、CSV 导出等功能。\n\n' +
              `官网: ${OFFICIAL_SITE}\n` +
              `GitHub: ${GITHUB_REPO}`,
            buttons: ['关闭', '访问官网', '打开 GitHub'],
            defaultId: 0,
            cancelId: 0
          }).then((res) => {
            if (res.response === 1) shell.openExternal(OFFICIAL_SITE);
            if (res.response === 2) shell.openExternal(GITHUB_REPO);
          });
        }
      },
      { type: 'separator' },
      {
        label: 'View License',
        click: () => shell.openExternal(`${GITHUB_REPO}/blob/main/LICENSE`)
      }
    ]
  };

  const template = [
    fileMenu,
    editMenu,
    viewMenu,
    toolMenu,
    windowMenu,
    helpMenu,
    aboutMenu
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ==================== DBC Parser & Signal Decoding ====================
// parseDBC / decodeSignalFrame / getEnumLabel are implemented in ./dbc
// (pure module, unit-testable; supports CAN FD 64-byte payloads).

// ==================== Signal Encoding/Decoding ====================

/**
 * Decode a signal from a CAN data bytes array
 */
function decodeSignal(data, signal) {
  const { startBit, length, byteOrder, signed, scale, offset } = signal;
  
  let rawValue = BigInt(0);
  
  if (byteOrder === 'little') {
    // Intel byte order (LSB first)
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        const bit = BigInt((data[byteIdx] >> bitIdx) & 1);
        rawValue |= bit << BigInt(i);
      }
      bitPos++;
    }
  } else {
    // Motorola (big-endian): DBC (Vector) bit numbering — byte n's MSB is bit
    // number 8n+7, LSB is 8n. startBit = signal MSB (byte-aligned signals start
    // at 7/15/23/31/...). Sawtooth walk: MSB->LSB within a byte, +15 jump at
    // byte boundaries. Same semantics as dbc.js decodeSignalFrame.
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        const bit = BigInt((data[byteIdx] >> bitIdx) & 1);
        rawValue |= bit << BigInt(length - 1 - i);
      }
      if ((bitPos % 8) === 0) bitPos += 15; else bitPos--;
    }
  }
  
  // Handle signed values
  let numericRaw = Number(rawValue);
  if (signed) {
    const maxVal = Math.pow(2, length);
    if (numericRaw >= maxVal / 2) {
      numericRaw -= maxVal;
    }
  }
  
  return numericRaw * scale + offset;
}

/**
 * Encode a physical value back to raw integer (or float bit pattern)
 */
function encodeSignalRaw(physicalValue, signal) {
  const { scale, offset, valueType } = signal;
  // R3: float signals keep the IEEE754 bit pattern as the raw value.
  // Returns BigInt for float64 (64-bit patterns are not Number-safe).
  if (valueType === 'float32' || valueType === 'float64') {
    const nbytes = valueType === 'float32' ? 4 : 8;
    const buf = Buffer.alloc(nbytes);
    const phys = (physicalValue - offset) / scale;
    const little = signal.byteOrder === 'little';
    if (nbytes === 4) {
      if (little) buf.writeFloatLE(phys, 0);
      else buf.writeFloatBE(phys, 0);
      return little ? buf.readUInt32LE(0) : buf.readUInt32BE(0);
    }
    if (little) buf.writeDoubleLE(phys, 0);
    else buf.writeDoubleBE(phys, 0);
    return little ? buf.readBigUInt64LE(0) : buf.readBigUInt64BE(0);
  }
  if (scale === 0) return 0;
  return Math.round((physicalValue - offset) / scale);
}

/**
 * Write a raw integer value into data bytes (little-endian / big-endian)
 */
function writeSignalToBytes(data, signal, rawValue) {
  const { startBit, length, byteOrder } = signal;
  const rawBig = typeof rawValue === 'bigint' ? rawValue : BigInt(rawValue);
  const mask = (BigInt(1) << BigInt(length)) - BigInt(1);
  const maskedRaw = rawBig & mask;
  
  if (byteOrder === 'little') {
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        const bit = Number((maskedRaw >> BigInt(i)) & BigInt(1));
        if (bit) {
          data[byteIdx] |= (1 << bitIdx);
        } else {
          data[byteIdx] &= ~(1 << bitIdx);
        }
      }
      bitPos++;
    }
  } else {
    // Motorola (big-endian): DBC (Vector) bit numbering — byte n's MSB is bit
    // number 8n+7, LSB is 8n. startBit = signal MSB. Sawtooth walk (mirrors
    // dbc.js decodeSignalFrame / write side).
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        const bit = Number((maskedRaw >> BigInt(length - 1 - i)) & BigInt(1));
        if (bit) {
          data[byteIdx] |= (1 << bitIdx);
        } else {
          data[byteIdx] &= ~(1 << bitIdx);
        }
      }
      if ((bitPos % 8) === 0) bitPos += 15; else bitPos--;
    }
  }
}

// ==================== CRC Algorithms ====================

const CRC_ALGORITHMS = {
  'CRC8': { poly: 0x07, init: 0x00, xorOut: 0x00, width: 8, refIn: false, refOut: false },
  'CRC8_SAE_J1850': { poly: 0x1D, init: 0xFF, xorOut: 0xFF, width: 8, refIn: false, refOut: false },
  'CRC8_SAE_J1850_ZERO': { poly: 0x1D, init: 0x00, xorOut: 0x00, width: 8, refIn: false, refOut: false },
  'CRC8_8H2F': { poly: 0x2F, init: 0xFF, xorOut: 0xFF, width: 8, refIn: false, refOut: false },
  'CRC8_AUTOSAR': { poly: 0x2F, init: 0xFF, xorOut: 0xFF, width: 8, refIn: false, refOut: false },
  'CRC8_MAXIM': { poly: 0x31, init: 0x00, xorOut: 0x00, width: 8, refIn: true, refOut: true },
  'CRC8_ROHC': { poly: 0x07, init: 0xFF, xorOut: 0x00, width: 8, refIn: true, refOut: true },
  'CRC8_ITU': { poly: 0x07, init: 0x00, xorOut: 0x55, width: 8, refIn: false, refOut: false },
  'CRC16_CCITT': { poly: 0x1021, init: 0xFFFF, xorOut: 0x0000, width: 16, refIn: false, refOut: false },
  'CRC16_CCITT_FALSE': { poly: 0x1021, init: 0xFFFF, xorOut: 0x0000, width: 16, refIn: false, refOut: false },
  'CRC16_IBM': { poly: 0x8005, init: 0x0000, xorOut: 0x0000, width: 16, refIn: true, refOut: true },
  'CRC16_MODBUS': { poly: 0x8005, init: 0xFFFF, xorOut: 0x0000, width: 16, refIn: true, refOut: true },
  'CRC16_XMODEM': { poly: 0x1021, init: 0x0000, xorOut: 0x0000, width: 16, refIn: false, refOut: false },
  'CRC16_AUG_CCITT': { poly: 0x1021, init: 0x1D0F, xorOut: 0x0000, width: 16, refIn: false, refOut: false },
  'CRC32': { poly: 0x04C11DB7, init: 0xFFFFFFFF, xorOut: 0xFFFFFFFF, width: 32, refIn: true, refOut: true },
  'CRC32_BZIP2': { poly: 0x04C11DB7, init: 0xFFFFFFFF, xorOut: 0xFFFFFFFF, width: 32, refIn: false, refOut: false },
  'NONE': null
};

function reflectByte(b) {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    if (b & (1 << i)) r |= (1 << (7 - i));
  }
  return r;
}

function reflectValue(val, width) {
  let r = 0;
  for (let i = 0; i < width; i++) {
    if (val & (1 << i)) r |= (1 << (width - 1 - i));
  }
  return r;
}

/**
 * Calculate CRC for given data bytes using specified algorithm
 * @param {number[]} data - byte array
 * @param {string} algName - algorithm name key
 * @param {number[]} excludeBitPositions - bit positions to exclude from CRC calc (CRC signal bits themselves)
 * @returns {number} CRC value
 */
function calculateCRC(data, algName) {
  const alg = CRC_ALGORITHMS[algName];
  if (!alg) return 0;
  
  const { poly, init, xorOut, width, refIn, refOut } = alg;
  const widthMask = (width === 32) ? 0xFFFFFFFF : ((1 << width) - 1);
  const topBit = 1 << (width - 1);
  
  let crc = init;
  
  for (let byteIdx = 0; byteIdx < data.length; byteIdx++) {
    let b = data[byteIdx];
    if (refIn) b = reflectByte(b);
    
    for (let i = 0; i < 8; i++) {
      const bit = (b >> (7 - i)) & 1;
      const topCrcBit = (crc & topBit) ? 1 : 0;
      crc = (crc << 1) & widthMask;
      if (topCrcBit ^ bit) crc ^= poly;
    }
  }
  
  if (refOut) crc = reflectValue(crc, width);
  crc ^= xorOut;
  return crc & widthMask;
}

// ==================== Physical CSV Parser ====================

/**
 * Parse TSMaster physical value CSV log file
 * Format:
 *   #HEADER
 *   #TITLES
 *   (row, time, sig1_name_(msgId), sig2_name_(msgId), ...)
 *   #UNITS
 *   #DATATYPES
 *   #DATA
 *   (rowNum, timestamp_s, val1, val2, ...)
 */
function parsePhysicalCSV(content) {
  const lines = content.split(/\r?\n/);
  
  let section = 'header';
  let titles = [];
  let units = [];
  let dataRows = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed === '#HEADER') { section = 'header'; continue; }
    if (trimmed === '#TITLES') { section = 'titles'; continue; }
    if (trimmed === '#UNITS') { section = 'units'; continue; }
    if (trimmed === '#DATATYPES') { section = 'datatypes'; continue; }
    if (trimmed === '#DATA') { section = 'data'; continue; }
    
    if (section === 'titles') {
      // Parse titles line (skip the first two columns: row index + time)
      titles = trimmed.split(',');
      continue;
    }
    
    if (section === 'units') {
      units = trimmed.split(',');
      continue;
    }
    
    if (section === 'data') {
      const parts = trimmed.split(',');
      if (parts.length >= 2) {
        const rowIdx = parseInt(parts[0]);
        const timestamp = parseFloat(parts[1]);
        if (!isNaN(rowIdx) && !isNaN(timestamp)) {
          dataRows.push({ rowIdx, timestamp, values: parts.slice(2).map(v => v.trim()) });
        }
      }
    }
  }
  
  // Parse signal column definitions from titles
  // Title format: " , ,SigName_(MsgId), ..."
  // First two cols are index and time, skip them
  const signalCols = [];
  for (let i = 2; i < titles.length; i++) {
    const t = titles[i].trim();
    if (!t) { signalCols.push(null); continue; }
    
    // Extract signal name and message ID
    // Format: "C1-VIU_ASC_Req_Checksum_(333)"  -> sigName="C1-VIU_ASC_Req_Checksum_", msgId=333
    // Or more generally: "SomeName_(ID)"
    const match = t.match(/^(.*)\((\d+)\)\s*$/);
    if (match) {
      signalCols.push({
        fullName: t,
        // Remove trailing underscore or hyphen if present
        signalName: match[1].replace(/[_\-\s]+$/, ''),
        msgId: parseInt(match[2]),
        unit: (units[i] || '').trim(),
        colIndex: i - 2  // index in values array
      });
    } else {
      signalCols.push({ fullName: t, signalName: t, msgId: null, unit: (units[i] || '').trim(), colIndex: i - 2 });
    }
  }
  
  // Group signals by message ID
  const msgSignalMap = {};
  for (const col of signalCols) {
    if (!col || col.msgId === null) continue;
    if (!msgSignalMap[col.msgId]) msgSignalMap[col.msgId] = [];
    msgSignalMap[col.msgId].push(col);
  }
  
  return {
    titles,
    units,
    signalCols,
    dataRows,
    msgSignalMap,
    totalRows: dataRows.length,
    msgIds: Object.keys(msgSignalMap).map(Number)
  };
}

/**
 * Convert physical value CSV to CAN ASC messages using DBC definitions
 * 
 * @param {object} csvData - parsed CSV data from parsePhysicalCSV
 * @param {object[]} dbcMessages - parsed DBC messages
 * @param {string} crcAlgorithm - CRC algorithm name ('NONE' to skip)
 * @param {object} options - additional options
 * @returns {object[]} array of CAN messages
 */
function convertCSVToCANMessages(csvData, dbcMessages, crcAlgorithm = 'NONE', options = {}) {
  const { channel = 1, direction = 'Rx' } = options;
  
  // Build lookup: dbcMsgId -> dbcMessage
  const dbcMap = {};
  for (const msg of dbcMessages) {
    dbcMap[msg.id] = msg;
  }
  
  // For each CSV message ID, find matching DBC message
  // CSV uses decimal ID in parentheses
  const canMessages = [];
  
  // Detect CRC signals in each message
  // Common CRC signal name patterns
  const CRC_SIGNAL_PATTERNS = [
    /checksum/i, /crc/i, /chks/i, /chksum/i
  ];
  
  for (const row of csvData.dataRows) {
    // For each message ID that appears in CSV
    for (const msgId of csvData.msgIds) {
      const dbcMsg = dbcMap[msgId];
      if (!dbcMsg) continue; // No DBC definition for this CSV message
      
      const csvCols = csvData.msgSignalMap[msgId];
      if (!csvCols || csvCols.length === 0) continue;
      
      // Initialize data bytes
      const data = new Array(dbcMsg.dlc).fill(0);
      
      // Identify CRC signal if any
      let crcSignal = null;
      if (crcAlgorithm !== 'NONE') {
        for (const sig of dbcMsg.signals) {
          if (CRC_SIGNAL_PATTERNS.some(p => p.test(sig.name))) {
            crcSignal = sig;
            break;
          }
        }
      }

      // R3: multiplex — resolve the mux selector value first, then only write
      // branch signals matching that value (the selector itself is written in
      // the first pass below).
      const muxSig = dbcMsg.signals.find(s => s.muxIndicator === 'M') || null;
      let muxVal = null;
      if (muxSig) {
        for (const col of csvCols) {
          if (col.signalName !== muxSig.name) continue;
          const valIdx = col.colIndex;
          const strVal = valIdx < row.values.length ? row.values[valIdx] : '0';
          let v = parseFloat(strVal);
          if (isNaN(v)) v = 0;
          writeSignalToBytes(data, muxSig, encodeSignalRaw(v, muxSig));
          muxVal = Math.round(v);
          break;
        }
      }

      // Write each signal value
      for (const col of csvCols) {
        // Find matching DBC signal
        const csvSigName = col.signalName;
        let dbcSig = null;
        
        // Try exact match first, then fuzzy match
        for (const sig of dbcMsg.signals) {
          if (sig.name === csvSigName) { dbcSig = sig; break; }
        }
        if (!dbcSig) {
          // Try case-insensitive match
          for (const sig of dbcMsg.signals) {
            if (sig.name.toLowerCase() === csvSigName.toLowerCase()) { dbcSig = sig; break; }
          }
        }
        if (!dbcSig) {
          // Try partial match (CSV name may have prefix like "C1-")
          const nameParts = csvSigName.split(/[-_]/);
          for (const sig of dbcMsg.signals) {
            if (nameParts.some(part => part.length > 3 && sig.name.includes(part))) {
              dbcSig = sig; break;
            }
          }
        }
        
        if (dbcSig) {
          // R3: skip branch signals whose mux value does not match the frame's
          // selector value (mux value column drives which signal set is packed).
          if (muxSig && muxVal !== null && dbcSig.muxIndicator && dbcSig.muxIndicator !== 'M') {
            const m = dbcSig.muxIndicator.match(/^m(\d+)/);
            if (m && parseInt(m[1], 10) !== muxVal) continue;
          }
          // Skip CRC signal - will be calculated later
          if (crcSignal && dbcSig.name === crcSignal.name) continue;
          
          const valIdx = col.colIndex;
          const strVal = valIdx < row.values.length ? row.values[valIdx] : '0';
          let physVal = parseFloat(strVal);
          if (isNaN(physVal)) physVal = 0;
          
          const rawVal = encodeSignalRaw(physVal, dbcSig);
          writeSignalToBytes(data, dbcSig, rawVal);
        }
      }
      
      // Calculate and write CRC
      if (crcSignal && crcAlgorithm !== 'NONE') {
        // Calculate CRC over all bytes EXCEPT the CRC byte(s) - typical automotive CRC
        // Create a copy with CRC bytes zeroed
        const dataForCRC = [...data];
        // Zero out the CRC signal bytes for calculation
        const crcRawZero = 0;
        writeSignalToBytes(dataForCRC, crcSignal, crcRawZero);
        
        const crc = calculateCRC(dataForCRC, crcAlgorithm);
        writeSignalToBytes(data, crcSignal, crc);
      }
      
      canMessages.push({
        timestamp: row.timestamp,
        channel,
        id: msgId,
        direction,
        dlc: dbcMsg.dlc,
        data: [...data]
      });
    }
  }
  
  // Sort by timestamp
  canMessages.sort((a, b) => a.timestamp - b.timestamp);
  
  return canMessages;
}

// ==================== ASC Parser (streaming for large files) ====================
// isNonDataLine / parseASCDataLine / generateASC are implemented in ./asc
// (pure module, supports CAN FD up to 64 bytes in Vector/python-can and
//  TSMaster formats).

async function loadASCFile(filePath, selectedIds) {
  return new Promise((resolve, reject) => {
    const headerLines = [];
    const messages = [];
    const parseErrors = [];
    let parseErrorCount = 0;
    let lineNum = 0;

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      lineNum++;
      if (messages.length >= 1000000) return;

      if (isNonDataLine(line)) {
        if (line.trim()) headerLines.push(line);
        return;
      }

      const msg = parseASCDataLine(line);
      if (msg) {
        if (selectedIds.size === 0 || selectedIds.has(msg.id)) {
          messages.push(msg);
        }
      } else {
        // R4: a data-like line that failed to parse is a recoverable error.
        // Record it (cap the list at 100) and keep going.
        parseErrorCount++;
        if (parseErrors.length < 100) {
          parseErrors.push({
            lineNumber: lineNum,
            line: line.trim().slice(0, 200),
            reason: '无法解析的数据行（格式不识别或数据损坏）'
          });
        }
      }
    });

    rl.on('close', () => {
      console.log(`ASC parse complete: ${messages.length} frames, ${parseErrorCount} parse errors`);
      resolve({ headerLines, messages, parseErrors, parseErrorCount });
    });

    rl.on('error', reject);
  });
}

// ==================== BLF Handler (using python-can via subprocess) ====================

async function loadBLFFilePython(filePath, selectedIds) {
  const pythonScript = `
import sys
import json

try:
    import can
    from can.io.blf import BLFReader
except ImportError:
    print(json.dumps({"error": "python-can not installed. Run: pip3 install python-can"}))
    sys.exit(1)

blf_path = sys.argv[1]
id_filter = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 and sys.argv[2] else []

try:
    reader = BLFReader(blf_path)
    msgs = []
    
    for msg in reader:
        if id_filter and msg.arbitration_id not in id_filter:
            continue
        
        ch = 1
        try:
            ch_obj = msg.channel
            if hasattr(ch_obj, 'channel_info'):
                ch_info = ch_obj.channel_info
                if isinstance(ch_info, int):
                    ch = ch_info
                elif isinstance(ch_info, str):
                    for part in ch_info.split():
                        if part.isdigit():
                            ch = int(part)
                            break
            elif isinstance(ch_obj, int):
                ch = ch_obj
            elif isinstance(ch_obj, str):
                for part in ch_obj.split():
                    if part.isdigit():
                        ch = int(part)
                        break
        except Exception:
            pass
        
        direction = "Rx"
        try:
            if not hasattr(msg, 'is_rx') or msg.is_rx:
                direction = "Rx"
            else:
                direction = "Tx"
        except Exception:
            direction = "Rx"
        
        msgs.append({
            "timestamp": round(float(msg.timestamp), 6),
            "channel": ch,
            "id": int(msg.arbitration_id),
            "direction": direction,
            "dlc": int(msg.dlc),
            "data": [int(b) for b in list(msg.data[:64])],
            "isFd": bool(getattr(msg, 'is_fd', False)),
            "brs": bool(getattr(msg, 'bitrate_switch', False)),
            "esi": bool(getattr(msg, 'error_state_indicator', False))
        })
        
        if len(msgs) >= 1000000:
            break
    
    result = {
        "success": True,
        "count": len(msgs),
        "messages": msgs,
        "headerLines": [
            "base hex  timestamps absolute",
            "internal events logged"
        ]
    }
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

  return new Promise((resolve, reject) => {
    const filterStr = Array.from(selectedIds).join(',');
    const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
    const proc = spawn(pythonPath, ['-c', pythonScript, filePath, filterStr], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('BLF parsing timeout (file may be very large)'));
    }, 600000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Python process exited with code ${code}: ${stderr}`));
        return;
      }
      
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve({
            headerLines: result.headerLines || [],
            messages: result.messages || []
          });
        }
      } catch (parseErr) {
        reject(new Error(`Failed to parse Python output: ${parseErr.message}. Output: ${stdout.substring(0, 500)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start Python process: ${err.message}. Ensure python3 and python-can are installed.`));
    });
  });
}

async function loadBLFFallback(filePath, selectedIds) {
  const buffer = await fs.promises.readFile(filePath);
  const detailed = parseBLFBufferDetailed(buffer, selectedIds);

  const now = new Date();
  const dateStr = now.toISOString().replace('T', ' ').substring(0, 19);

  return {
    headerLines: [`date ${dateStr}`, 'base hex  timestamps absolute', 'internal events logged'],
    messages: detailed.messages,
    parseErrors: detailed.errors,
    parseErrorCount: detailed.errorCount
  };
}

async function loadBLFFile(filePath, selectedIds) {
  try {
    console.log('Attempting BLF parse with python-can...');
    const result = await loadBLFFilePython(filePath, selectedIds);
    console.log(`python-can parsed ${result.messages.length} messages`);
    return result;
  } catch (pyErr) {
    console.warn(`python-can failed (${pyErr.message}), using fallback parser...`);
    return await loadBLFFallback(filePath, selectedIds);
  }
}

// ==================== File Handlers ====================

async function saveCompressed(filePath, data) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const gzip = zlib.createGzip({ level: 6 });
    
    gzip.on('data', chunk => chunks.push(chunk));
    gzip.on('end', async () => {
      const compressed = Buffer.concat(chunks);
      const compressedPath = filePath + '.gz';
      await fs.promises.writeFile(compressedPath, compressed);
      resolve(compressedPath);
    });
    gzip.on('error', reject);
    
    gzip.write(typeof data === 'string' ? Buffer.from(data) : data);
    gzip.end();
  });
}

// ==================== IPC Handlers ====================

ipcMain.handle('shell:openExternal', async (event, url) => {
  // Validate URL shape before forwarding to the system shell — opening
  // arbitrary file:// paths or javascript: URIs would be a security hole.
  if (typeof url !== 'string') return { success: false, error: 'invalid url' };
  if (!/^https?:\/\//i.test(url)) return { success: false, error: 'only http(s) urls allowed' };
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('dialog:openFile', async (event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (event, defaultName, filtersList) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: filtersList || [{ name: 'ASC Files', extensions: ['asc'] }]
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('file:loadDBC', async (event, filePath) => {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const messages = parseDBC(content);
    addRecent('dbc', filePath); // R6
    return { success: true, messages, rawContent: content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== R5: project save / restore ====================
ipcMain.handle('project:save', async (event, filePath, projectData) => {
  try {
    if (!projectData || projectData.format !== 'claproj') {
      return { success: false, error: '不是有效的工程数据（缺少 claproj 格式标记）' };
    }
    await fs.promises.writeFile(filePath, JSON.stringify(projectData, null, 2), 'utf8');
    addRecent('project', filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('project:open', async (event, filePath) => {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const project = JSON.parse(content);
    if (!project || project.format !== 'claproj') {
      return { success: false, error: '不是有效的 .claproj 工程文件（缺少 claproj 格式标记）' };
    }
    addRecent('project', filePath);
    return { success: true, project };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== R6: preferences ====================
ipcMain.handle('settings:get', async () => loadSettings());

ipcMain.handle('settings:set', async (event, patch) => {
  if (!patch || typeof patch !== 'object') return { success: false, error: '无效的设置数据' };
  return { success: true, settings: setSetting(patch) };
});

ipcMain.handle('file:loadASC', async (event, filePath, selectedIds) => {
  try {
    const idSet = new Set(selectedIds || []);
    const result = await loadASCFile(filePath, idSet);
    // R2: keep the parsed frames resident in the main process so chunked
    // decoding can stream over them without the renderer holding the corpus.
    storeMessages(filePath, result.messages);
    addRecent('log', filePath); // R6
    
    try {
      const stats = await fs.promises.stat(filePath);
      if (stats.size > 100 * 1024 * 1024) {
        await saveCompressed(filePath, generateASC(result.headerLines, result.messages));
      }
    } catch (_) {}
    
    return {
      success: true, ...result,
      parseErrors: result.parseErrors || [],
      parseErrorCount: result.parseErrorCount || 0,
      totalCount: result.messages.length
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:loadBLF', async (event, filePath, selectedIds) => {
  try {
    const idSet = new Set(selectedIds || []);
    const result = await loadBLFFile(filePath, idSet);
    // R2: keep parsed frames resident in the main process.
    storeMessages(filePath, result.messages);
    addRecent('log', filePath); // R6
    return {
      success: true, ...result,
      parseErrors: result.parseErrors || [],
      parseErrorCount: result.parseErrorCount || 0,
      totalCount: result.messages.length
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// R4: export a text report (e.g. parse error list) to a user-chosen file.
ipcMain.handle('file:exportText', async (event, filePath, content) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== New: Physical CSV Load ====================

ipcMain.handle('file:loadPhysicalCSV', async (event, filePath) => {
  try {
    // Large file: read in chunks with readline
    return new Promise((resolve, reject) => {
      let content = '';
      const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity
      });
      
      let lineCount = 0;
      let inData = false;
      let headerContent = '';
      let dataLines = [];
      
      rl.on('line', (line) => {
        lineCount++;
        if (!inData) {
          headerContent += line + '\n';
          if (line.trim() === '#DATA') inData = true;
        } else {
          // Limit data rows for memory safety
          if (dataLines.length < 500000) {
            dataLines.push(line);
          }
        }
      });
      
      rl.on('close', () => {
        try {
          const fullContent = headerContent + dataLines.join('\n');
          const result = parsePhysicalCSV(fullContent);
          resolve({
            success: true,
            totalRows: result.totalRows,
            msgIds: result.msgIds,
            signalCols: result.signalCols.filter(c => c !== null),
            dataRows: result.dataRows,
            msgSignalMap: result.msgSignalMap,
            titles: result.titles,
            units: result.units
          });
        } catch (err) {
          resolve({ success: false, error: err.message });
        }
      });
      
      rl.on('error', (err) => resolve({ success: false, error: err.message }));
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== New: CSV to ASC Conversion ====================

ipcMain.handle('file:convertCSVtoASC', async (event, csvData, dbcMessages, crcAlgorithm, options) => {
  try {
    const canMessages = convertCSVToCANMessages(csvData, dbcMessages, crcAlgorithm || 'NONE', options || {});
    
    const now = new Date();
    const dateStr = now.toDateString();
    const timeStr = now.toTimeString().split(' ')[0];
    const headerLines = [
      `date ${dateStr} ${timeStr}`,
      'base hex  timestamps absolute',
      'internal events logged',
      `// Generated by CAN Log Analyzer - Physical CSV to ASC`,
      `// CRC Algorithm: ${crcAlgorithm || 'NONE'}`,
      `// Total messages: ${canMessages.length}`
    ];
    
    return {
      success: true,
      messages: canMessages,
      headerLines,
      totalCount: canMessages.length
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== New: Get CRC Algorithms List ====================

ipcMain.handle('file:getCRCAlgorithms', async () => {
  return Object.keys(CRC_ALGORITHMS).map(name => ({
    name,
    description: getCRCDescription(name)
  }));
});

function getCRCDescription(name) {
  const descriptions = {
    'NONE': '不计算CRC（直接使用CSV中的原始值）',
    'CRC8': 'CRC-8 (Poly=0x07, 通用)',
    'CRC8_SAE_J1850': 'CRC-8/SAE-J1850 (汽车CAN常用)',
    'CRC8_SAE_J1850_ZERO': 'CRC-8/SAE-J1850 ZERO (初始值0)',
    'CRC8_8H2F': 'CRC-8/8H2F (AUTOSAR Profile 01)',
    'CRC8_AUTOSAR': 'CRC-8/AUTOSAR (Poly=0x2F)',
    'CRC8_MAXIM': 'CRC-8/MAXIM (Dallas/Maxim)',
    'CRC8_ROHC': 'CRC-8/ROHC (refIn=true)',
    'CRC8_ITU': 'CRC-8/ITU (xorOut=0x55)',
    'CRC16_CCITT': 'CRC-16/CCITT (Poly=0x1021)',
    'CRC16_CCITT_FALSE': 'CRC-16/CCITT-FALSE (Init=0xFFFF)',
    'CRC16_IBM': 'CRC-16/IBM (Poly=0x8005)',
    'CRC16_MODBUS': 'CRC-16/MODBUS (Modbus协议)',
    'CRC16_XMODEM': 'CRC-16/XMODEM (Init=0)',
    'CRC16_AUG_CCITT': 'CRC-16/AUG-CCITT (Init=0x1D0F)',
    'CRC32': 'CRC-32 (标准IEEE 802.3)',
    'CRC32_BZIP2': 'CRC-32/BZIP2 (非反射版本)',
  };
  return descriptions[name] || name;
}

// ==================== Convert ASC data to BLF ====================

ipcMain.handle('file:convertASCtoBLF', async (event, filePath, messages) => {
  try {
    if (!messages || messages.length === 0) {
      return { success: false, error: '没有可转换的消息数据' };
    }
    const buffer = buildBLFBuffer(messages);
    await fs.promises.writeFile(filePath, buffer);
    return { success: true, count: messages.length, bytes: buffer.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== Export ASC ====================

ipcMain.handle('file:exportASC', async (event, filePath, headerLines, messages) => {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath, { encoding: 'utf-8' });
    let progress = 0;
    const total = headerLines.length + messages.length;
    let processed = 0;
    const CHUNK_SIZE = 1000;

    const sendProgress = () => {
      const pct = Math.round((processed / total) * 100);
      if (pct !== progress) {
        progress = pct;
        event.sender.send('export:progress', { progress, processed, total });
      }
    };

    const writeChunk = (lines, callback) => {
      if (lines.length === 0) return callback();

      let remaining = lines.length;
      for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
        const chunk = lines.slice(i, i + CHUNK_SIZE);
        const canContinue = stream.write(chunk.join('\r\n') + '\r\n');
        processed += chunk.length;
        sendProgress();

        if (!canContinue) {
          stream.once('drain', () => {
            remaining -= chunk.length;
            if (remaining > 0) {
              writeChunk(lines.slice(i + CHUNK_SIZE), callback);
            } else {
              callback();
            }
          });
          return;
        }
      }
      callback();
    };

    stream.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    writeChunk([...headerLines, ''], () => {
      writeChunk(messages.map(msg => {
        const dataStr = msg.data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
        return `${msg.timestamp.toFixed(6)} ${msg.channel} ${msg.id.toString(16).toUpperCase()} ${msg.direction} d ${msg.dlc} ${dataStr}`;
      }), () => {
        stream.end(() => {
          event.sender.send('export:progress', { progress: 100, processed: total, total });
          resolve({ success: true });
        });
      });
    });
  });
});

// R7: export the loaded message log as CSV — columns time,id,name,dir,dlc,data.
// Streamed in blocks so 1M-frame logs do not block the main process.
ipcMain.handle('file:exportLogCSV', async (event, filePath, messages, nameMap) => {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath, { encoding: 'utf-8' });
    const list = messages || [];
    const names = nameMap || {};
    const CHUNK = 5000;
    let written = 0;

    stream.on('error', (err) => resolve({ success: false, error: err.message }));
    stream.write(['time', 'id', 'name', 'dir', 'dlc', 'data'].join(',') + '\r\n');

    const writeRows = (start) => {
      const end = Math.min(start + CHUNK, list.length);
      for (let i = start; i < end; i++) {
        const m = list[i];
        const idStr = '0x' + m.id.toString(16).toUpperCase();
        const name = names[m.id] != null ? `"${names[m.id]}"` : '';
        const dataStr = `"${(m.data || []).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}"`;
        stream.write(`${m.timestamp.toFixed(6)},${idStr},${name},${m.direction},${m.dlc},${dataStr}\r\n`);
        written++;
      }
      if (end < list.length) {
        if (stream.writableNeedDrain) stream.once('drain', () => writeRows(end));
        else setImmediate(() => writeRows(end));
      } else {
        stream.end(() => resolve({ success: true, rowsWritten: written }));
      }
    };
    writeRows(0);
  });
});

ipcMain.handle('file:getStats', async (event, filePath) => {
  try {
    const stats = await fs.promises.stat(filePath);
    return {
      size: stats.size,
      formattedSize: formatFileSize(stats.size),
      modified: stats.mtime
    };
  } catch (error) {
    return null;
  }
});

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ==================== Signal Decode Engine ====================

/**
 * Decode a single signal value from CAN data bytes.
 *
 * This is a refined version of the existing decodeSignal function,
 * with extra care for Motorola bit ordering (per cantools/canmatrix standard).
 *
 * Intel (little-endian):
 *   Bits are numbered LSB first within each byte, then across bytes.
 *   startBit is the LSB position of the signal.
 *
 * Motorola (big-endian):
 *   Bits are numbered MSB first. startBit is the MSB position.
 *   The "sawtooth" pattern: from startBit (MSB), move to the next byte's LSB,
 *   progress upward through bits in that byte, then wrap to the first byte's
 *   remaining lower bits.
 *
 * @param {number[]} data - CAN data bytes (0-255 each)
 * @param {object} signal - Signal definition from DBC
 * @returns {number|string} Physical value, or enum label string
 */
// decodeSignalFrame is implemented in ./dbc (pure module, supports CAN FD
// 64-byte payloads and >32-bit signals).

/**
 * Decode signal frames from loaded CAN messages.
 *
 * For each frame in the log, match its message ID against DBC definitions,
 * then decode each selected signal using decodeSignalFrame.
 * Handles multiplexed signals (mux) and VAL_ enum labels.
 *
 * Performance: processes up to 1M frames in main process.
 * For >100K frames, streaming with progress reporting is used.
 *
 * @param {object[]} loadedMessages - Array of parsed CAN frames
 * @param {object[]} selectedSignals - [{msgId, signalName}, ...]
 * @param {object[]} dbcMessages - Parsed DBC message definitions
 * @returns {object} { success, signalData, stats }
 */
// Legacy one-shot decode: identical results to the chunked path (shared engine).
ipcMain.handle('signal:decodeFrames', async (event, loadedMessages, selectedSignals, dbcMessages) => {
  try {
    return { success: true, ...decodeAll(loadedMessages, selectedSignals, dbcMessages) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== R2: Chunked decode protocol ====================
// render -> main:  signal:decodeChunked { filePath, messages?, selectedSignals,
//                                         dbcMessages, chunkSize }
//   messages  optional fallback when the corpus was not stored in main
//   (e.g. generated by CSV -> ASC conversion). filePath takes precedence.
// main -> render: decode:progress { chunk, totalChunks, percent }
//                 decode:chunk-result { chunkIndex, rows, decodedCount }
// render -> main: signal:decodeCancel (checked at block boundaries)
const DEFAULT_CHUNK_SIZE = 500000;

ipcMain.handle('signal:decodeChunked', async (event, payload) => {
  const {
    filePath, messages, selectedSignals = [], dbcMessages = [], chunkSize
  } = payload || {};

  try {
    // Prefer the resident corpus; fall back to an explicitly passed array.
    let frames = filePath ? messageStore.get(filePath) : null;
    if (!frames) frames = messages || [];
    if (!Array.isArray(frames) || frames.length === 0) {
      return { success: false, error: '没有可解码的报文：请先加载日志文件' };
    }

    decodeCancelled = false;
    const ctx = buildDecodeContext(dbcMessages, selectedSignals);
    const total = frames.length;
    const size = Math.max(1, Math.min(Number(chunkSize) || DEFAULT_CHUNK_SIZE, total));
    const totalChunks = Math.ceil(total / size);
    // R2 Phase 2: on multi-chunk corpora the decode runs pure-streaming — the
    // rows are delivered exclusively via the decode:chunk-result events, and
    // the return payload carries only stats. Returning the full array as well
    // would double the peak memory on 1M-frame logs.
    const streaming = totalChunks > 1;
    const signalData = [];
    let decodedFrameCount = 0;
    let cancelled = false;

    for (let chunk = 0; chunk < totalChunks; chunk++) {
      if (decodeCancelled) { cancelled = true; break; }
      const start = chunk * size;
      const block = frames.slice(start, Math.min(start + size, total));
      const { rows, decodedCount } = decodeFramesChunk(block, ctx);
      decodedFrameCount += decodedCount;

      // Yield to the event loop so the UI thread stays responsive.
      await new Promise(resolve => setImmediate(resolve));

      // Send the progress + incremental result for this block.
      sendToRenderer('decode:progress', {
        chunk, totalChunks, percent: Math.min(100, Math.round(((chunk + 1) / totalChunks) * 100))
      });
      sendToRenderer('decode:chunk-result', {
        chunkIndex: chunk,
        rows,
        decodedCount,
        last: chunk === totalChunks - 1
      });

      // Single-chunk runs keep the rows inline (small corpus, no event-loss
      // risk); multi-chunk runs stay pure-streaming.
      if (!streaming) for (const r of rows) signalData.push(r);
    }

    return {
      success: true,
      cancelled,
      signalData: streaming ? undefined : signalData,
      streaming,
      stats: {
        totalFrames: total,
        decodedFrames: decodedFrameCount,
        selectedSignals: selectedSignals.length,
        encodedSignals: ctx.encodedCount,
        signalKeys: ctx.signalKeys.length,
        chunks: totalChunks
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    decodeCancelled = false;
  }
});

ipcMain.handle('signal:decodeCancel', async () => {
  decodeCancelled = true;
  return { success: true };
});

// getEnumLabel is implemented in ./dbc (pure module).

// ==================== Signal CSV Export ====================

ipcMain.handle('signal:exportCSV', async (event, filePath, signalData, selectedSignals) => {
  return new Promise((resolve, reject) => {
    try {
      const writeStream = fs.createWriteStream(filePath, { encoding: 'utf-8' });

      // Build CSV header: timestamp, signal1, signal2, ...
      const headers = ['timestamp', ...selectedSignals.map(s => s.signalName)];
      writeStream.write(headers.map(h => `"${h}"`).join(',') + '\r\n');

      // Write data rows
      let written = 0;
      for (const row of signalData) {
        const values = [row.t.toFixed(6)];
        for (const sig of selectedSignals) {
          const key = `${sig.msgId}::${sig.signalName}`;
          const val = row.signals[key];
          const lbl = row.signals[key + '::label'];
          if (val === null || val === undefined) {
            values.push('');
          } else if (lbl !== undefined) {
            values.push(`"${lbl}"`);
          } else if (typeof val === 'string') {
            values.push(`"${val}"`);
          } else {
            values.push(val.toString());
          }
        }
        writeStream.write(values.join(',') + '\r\n');
        written++;
      }

      writeStream.end(() => {
        resolve({ success: true, rowsWritten: written });
      });

      writeStream.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
});
