const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { spawn } = require('child_process');
const readline = require('readline');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#f5f5f5',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true
    },
    title: 'CAN Log Analyzer',
    show: true
  });

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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ==================== DBC Parser (Full - all signals) ====================

function parseDBC(content) {
  const messages = [];
  const lines = content.split(/\r?\n/);
  let currentMessage = null;
  // Also collect value definitions (VAL_) for enum-type signals
  const valueDefs = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // BO_ - Message definition
    const msgMatch = trimmed.match(/^BO_\s+(\d+)\s+([\w\-\.]+)\s*:\s*(\d+)\s+([\w\-\.]+)/);
    if (msgMatch) {
      if (currentMessage) messages.push(currentMessage);
      currentMessage = {
        id: parseInt(msgMatch[1]),
        name: msgMatch[2],
        dlc: parseInt(msgMatch[3]),
        sender: msgMatch[4],
        signals: []
      };
      continue;
    }

    // SG_ - Signal definition (standard + multiplex mux indicators)
    // Format: SG_ <name> [M|m<n>|m<n>M] : <startBit>|<length>@<byteOrder><valueType> (<scale>,<offset>) [<min>|<max>] "<unit>" <receivers>
    const sigMatch = trimmed.match(
      /^SG_\s+([\w\-\.]+)\s*(M|m\d+M?|)?\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\((-?[\d.eE+\-]+),(-?[\d.eE+\-]+)\)\s*\[(-?[\d.eE+\-]+)\|(-?[\d.eE+\-]+)\]\s*"([^"]*)"\s*(.*)/
    );
    if (sigMatch && currentMessage) {
      const receivers = sigMatch[12]
        ? sigMatch[12].trim().split(/\s*,\s*/).filter(r => r && r !== 'Vector__XXX')
        : [];
      currentMessage.signals.push({
        name: sigMatch[1],
        muxIndicator: sigMatch[2] ? sigMatch[2].trim() : '',
        startBit: parseInt(sigMatch[3]),
        length: parseInt(sigMatch[4]),
        byteOrder: sigMatch[5] === '1' ? 'little' : 'big',  // 1=Intel(little-endian), 0=Motorola(big-endian)
        signed: sigMatch[6] === '-',
        scale: parseFloat(sigMatch[7]),
        offset: parseFloat(sigMatch[8]),
        min: parseFloat(sigMatch[9]),
        max: parseFloat(sigMatch[10]),
        unit: sigMatch[11],
        receivers: receivers
      });
      continue;
    }

    // VAL_ - Value definitions (for enum signals)
    // Format: VAL_ <msgId> <sigName> <value> "<label>" ... ;
    const valMatch = trimmed.match(/^VAL_\s+(\d+)\s+([\w\-\.]+)\s+(.*)\s*;?/);
    if (valMatch) {
      const msgId = parseInt(valMatch[1]);
      const sigName = valMatch[2];
      const pairs = valMatch[3];
      const key = `${msgId}:${sigName}`;
      const vals = {};
      const pairMatches = [...pairs.matchAll(/(\d+)\s+"([^"]*)"/g)];
      for (const pm of pairMatches) {
        vals[parseInt(pm[1])] = pm[2];
      }
      if (!valueDefs[key]) valueDefs[key] = {};
      Object.assign(valueDefs[key], vals);
    }
  }

  if (currentMessage) messages.push(currentMessage);

  // Attach value definitions to signals
  for (const msg of messages) {
    for (const sig of msg.signals) {
      const key = `${msg.id}:${sig.name}`;
      if (valueDefs[key]) {
        sig.valueDefs = valueDefs[key];
      }
    }
  }

  return messages;
}

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
    // Motorola byte order (MSB first)
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = 7 - (bitPos % 8);
      if (byteIdx < data.length) {
        const bit = BigInt((data[byteIdx] >> bitIdx) & 1);
        rawValue |= bit << BigInt(length - 1 - i);
      }
      // Calculate next bit position for Motorola
      if ((bitPos % 8) === 0) {
        bitPos += 15;
      } else {
        bitPos--;
      }
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
 * Encode a physical value back to raw integer
 */
function encodeSignalRaw(physicalValue, signal) {
  const { scale, offset } = signal;
  if (scale === 0) return 0;
  return Math.round((physicalValue - offset) / scale);
}

/**
 * Write a raw integer value into data bytes (little-endian / big-endian)
 */
function writeSignalToBytes(data, signal, rawValue) {
  const { startBit, length, byteOrder } = signal;
  const rawBig = BigInt(rawValue);
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
    // Motorola byte order
    let bitPos = startBit;
    for (let i = 0; i < length; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = 7 - (bitPos % 8);
      if (byteIdx < data.length) {
        const bit = Number((maskedRaw >> BigInt(length - 1 - i)) & BigInt(1));
        if (bit) {
          data[byteIdx] |= (1 << bitIdx);
        } else {
          data[byteIdx] &= ~(1 << bitIdx);
        }
      }
      if ((bitPos % 8) === 0) {
        bitPos += 15;
      } else {
        bitPos--;
      }
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

// Header line patterns (always non-data)
const HEADER_PATTERNS = [
  /^date\s/, /^base\s+/, /^timestamps\s/, /^internal\s/,
  /^\/\//, /^Start\s+of\s+measurement/, /^Begin\s*:/,
];

// Check if a line is a pure event/log line (NOT a CAN/LIN data frame)
function isNonDataLine(line) {
  const t = line.trim();
  if (!t || t.length < 15) return true;

  // Standard header patterns
  for (const p of HEADER_PATTERNS) {
    if (p.test(t)) return true;
  }

  // SV: lines are TSMaster signal variable updates, never CAN frames
  if (/^\d[\d.]*\s+SV:/.test(t)) return true;

  // Li/CAN/CANFD followed by an alphabetic name = event (not data frame)
  const liEventMatch = t.match(/^\d[\d.]*\s+(?:Li|CAN|CANFD)\s+[A-Za-z_]/);
  if (liEventMatch) return true;

  // Start of measurement marker
  if (/Start of measurement/.test(t) && !/Tx|Rx/.test(t)) return true;

  return false;
}

/**
 * Parse a single ASC data line - supports multiple formats
 */
function parseASCDataLine(line) {
  let trimmed = line.trim();

  // Must start with a timestamp
  const tsMatch = trimmed.match(/^([\d.]+)\s+(.*)$/);
  if (!tsMatch) return null;

  const timestamp = parseFloat(tsMatch[1]);
  const rest = tsMatch[2];
  if (rest.length < 5) return null;

  // --- Strategy 1: Vector standard format ---
  const vectorMatch = rest.match(/^(\d+)\s+([0-9A-Fa-f]+)\s+(Tx|Rx)\s+[dr]\s+(\d+)\s+([0-9A-Fa-f][0-9A-Fa-f](?:\s+[0-9A-Fa-f][0-9A-Fa-f])*)\s*/);
  if (vectorMatch) {
    const dataStr = vectorMatch[5].trim();
    const data = dataStr.split(/\s+/).map(b => parseInt(b, 16));
    return {
      timestamp,
      channel: parseInt(vectorMatch[1]),
      id: parseInt(vectorMatch[2], 16),
      direction: vectorMatch[3],
      dlc: parseInt(vectorMatch[4]),
      data
    };
  }

  // --- Strategy 2: TSMaster format (CAN / CANFD / LIN) ---
  const tsMasterMatch = rest.match(/^(CAN|CANFD|Li)\s+([0-9A-Fa-f]+)\s+(Tx|Rx)\s+(\d+)\s+((?:[0-9A-Fa-f]{2}\s+)+)/i);
  if (tsMasterMatch) {
    const busType = tsMasterMatch[1].toUpperCase();
    const dataStr = tsMasterMatch[5].trim();
    const data = dataStr.split(/\s+/).filter(Boolean).map(b => parseInt(b, 16));
    const dlc = Math.min(parseInt(tsMasterMatch[4]), data.length);
    const chMap = { 'CAN': 1, 'CANFD': 1, 'Li': 2 };
    return {
      timestamp,
      channel: chMap[busType] || 1,
      id: parseInt(tsMasterMatch[2], 16),
      direction: tsMasterMatch[3],
      dlc,
      data: data.slice(0, dlc)
    };
  }

  // --- Strategy 3: Flexible fallback ---
  const flexMatch = rest.match(/^\S+\s+([0-9A-Fa-f]+)\s+(Tx|Rx)\s+(\d{1,2})\s+((?:[0-9A-Fa-f]{2}\s*)+)/i);
  if (flexMatch && !isNonDataLine(rest)) {
    const dataStr = flexMatch[4].trim();
    const rawData = dataStr.split(/\s+/).filter(b => /^[0-9A-Fa-f]{2}$/i.test(b)).map(b => parseInt(b, 16));
    if (rawData.length >= 1) {
      const dlc = Math.min(parseInt(flexMatch[3]), rawData.length);
      return {
        timestamp,
        channel: 1,
        id: parseInt(flexMatch[1], 16),
        direction: flexMatch[2],
        dlc,
        data: rawData.slice(0, dlc)
      };
    }
  }

  return null;
}

async function loadASCFile(filePath, selectedIds) {
  return new Promise((resolve, reject) => {
    const headerLines = [];
    const messages = [];

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity
    });

    let skippedLines = 0;

    rl.on('line', (line) => {
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
        skippedLines++;
      }
    });

    rl.on('close', () => {
      console.log(`ASC parse complete: ${messages.length} frames, ${skippedLines} non-frame lines`);
      resolve({ headerLines, messages });
    });

    rl.on('error', reject);
  });
}

function generateASC(headerLines, messages) {
  const output = [...headerLines, ''];
  
  for (const msg of messages) {
    const dataStr = msg.data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    output.push(`${msg.timestamp.toFixed(6)} ${msg.channel} ${msg.id.toString(16).toUpperCase()} ${msg.direction} d ${msg.dlc} ${dataStr}`);
  }
  
  return output.join('\r\n');
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
            "data": [int(b) for b in list(msg.data[:64])]
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
  const signature = buffer.toString('ascii', 0, 4);
  if (signature !== 'LOGG') throw new Error('Invalid BLF file');
  
  const headerSize = buffer.readUInt16LE(4);
  const dataOffset = Math.max(headerSize, 144);
  
  if (dataOffset >= buffer.length) throw new Error('Invalid BLF: corrupted header');
  
  const messages = [];
  let searchOff = dataOffset;
  
  while (searchOff < buffer.length - 4) {
    if ((buffer[searchOff] === 0x78) && 
        [0x01, 0x5e, 0x9c, 0xda].includes(buffer[searchOff + 1])) {
      try {
        const decomp = zlib.inflateSync(buffer.slice(searchOff));
        if (decomp.length < 16) { searchOff++; continue; }
        
        let off = 0;
        while (off + 20 <= decomp.length) {
          const sig = decomp.toString('ascii', off, off + 4);
          if (sig !== 'LOBJ') { off++; continue; }
          
          const hdrLen = decomp.readUInt16LE(off + 4);
          const objType = decomp.readUInt16LE(off + 8);
          const objSize = decomp.readUInt32LE(off + 12);
          
          if (objSize < 32 || off + objSize > decomp.length) break;
          
          if ([1, 2, 144].includes(objType) && objSize >= hdrLen + 12) {
            try {
              const p = off + hdrLen;
              const ch = decomp.readUInt8(p);
              const rawId = decomp.readUInt32LE(p + 4);
              const id = rawId & (rawId > 0x7FF ? 0x1FFFFFFF : 0x7FF);
              
              let dlc;
              if (objType === 144) {
                dlc = decomp.readUInt8(p + 2);
                if (dlc > 64) dlc = Math.min(dlc & 0x0F, 8);
              } else {
                dlc = decomp.readUInt8(p + 8);
              }
              
              const dataLen = Math.min(dlc, 64);
              const data = [];
              for (let i = 0; i < dataLen; i++) {
                data.push(decomp.readUInt8(p + 12 + i));
              }
              
              let timestamp = 0;
              const tsPos = off + objSize - 8;
              if (tsPos >= off + hdrLen && tsPos + 8 <= decomp.length) {
                const rawTs = decomp.readBigUInt64LE(tsPos);
                timestamp = Number(rawTs) > 1e9 ? Number(rawTs) / 1e6 : Number(rawTs) / 1e7;
              }
              
              if (selectedIds.size === 0 || selectedIds.has(id)) {
                messages.push({ timestamp, channel: ch, id, direction: 'Rx', dlc, data });
              }
            } catch (e) { /* skip bad object */ }
          }
          
          off += objSize;
          if (objSize === 0) off++;
        }
        
        searchOff += Math.max(Math.floor(decomp.length / 10), 256);
        continue;
      } catch (e) {
        // Not valid zlib or failed decompression
      }
    }
    searchOff++;
  }
  
  const now = new Date();
  const dateStr = now.toISOString().replace('T', ' ').substring(0, 19);
  
  return {
    headerLines: [`date ${dateStr}`, 'base hex  timestamps absolute', 'internal events logged'],
    messages
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
    return { success: true, messages };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:loadASC', async (event, filePath, selectedIds) => {
  try {
    const idSet = new Set(selectedIds || []);
    const result = await loadASCFile(filePath, idSet);
    
    try {
      const stats = await fs.promises.stat(filePath);
      if (stats.size > 100 * 1024 * 1024) {
        await saveCompressed(filePath, generateASC(result.headerLines, result.messages));
      }
    } catch (_) {}
    
    return { success: true, ...result, totalCount: result.messages.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('file:loadBLF', async (event, filePath, selectedIds) => {
  try {
    const idSet = new Set(selectedIds || []);
    const result = await loadBLFFile(filePath, idSet);
    return { success: true, ...result, totalCount: result.messages.length };
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
