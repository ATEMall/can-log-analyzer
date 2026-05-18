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

// ==================== DBC Parser ====================

function parseDBC(content) {
  const messages = [];
  const lines = content.split(/\r?\n/);
  let currentMessage = null;

  for (const line of lines) {
    const trimmed = line.trim();
    
    const msgMatch = trimmed.match(/^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/);
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

    const sigMatch = trimmed.match(/^SG_\s+(\w+)\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\((\d+\.?\d*),(-?\d+\.?\d*)\)\s*\[(-?\d+\.?\d*)\|(-?\d+\.?\d*)\]\s*"([^"]*)"\s*(\w*)/);
    if (sigMatch && currentMessage) {
      currentMessage.signals.push({
        name: sigMatch[1], startBit: parseInt(sigMatch[2]), length: parseInt(sigMatch[3]),
        byteOrder: sigMatch[4] === '1' ? 'little' : 'big', signed: sigMatch[5] === '-',
        scale: parseFloat(sigMatch[6]), offset: parseFloat(sigMatch[7]),
        min: parseFloat(sigMatch[8]), max: parseFloat(sigMatch[9]),
        unit: sigMatch[10], receiver: sigMatch[11]
      });
    }
  }

  if (currentMessage) messages.push(currentMessage);
  return messages;
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
  // Data frames have numeric/hex ID after bus type: "Li 29 Rx" vs event "Li SleepModeEvent"
  const liEventMatch = t.match(/^\d[\d.]*\s+(?:Li|CAN|CANFD)\s+[A-Za-z_]/);
  if (liEventMatch) return true;

  // Start of measurement marker
  if (/Start of measurement/.test(t) && !/Tx|Rx/.test(t)) return true;

  return false;
}

/**
 * Parse a single ASC data line - supports multiple formats:
 *
 * Format 1 - Vector CANoe standard:
 *   2.501000 1 C8 Tx d 8 09 08 07 06 05 04 03 02
 *   ^ts     ^ch ^id ^dir ^dlc ^data
 *
 * Format 2 - TSMaster CAN/CANFD/LIN:
 *   3.375730 Li 29              Rx     8 ea 00 20 01 ff ff ff ff  checksum=...
 *   ^ts     ^type ^id           ^dir  ^dlc ^data
 */
function parseASCDataLine(line) {
  let trimmed = line.trim();

  // Must start with a timestamp
  const tsMatch = trimmed.match(/^([\d.]+)\s+(.*)$/);
  if (!tsMatch) return null;

  const timestamp = parseFloat(tsMatch[1]);
  const rest = tsMatch[2];
  if (rest.length < 5) return null; // too short to be a valid frame

  // --- Strategy 1: Vector standard format ---
  // Pattern: <channel> <hex_id> <Tx|Rx> <d|r> <dlc> <hex_bytes...>
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
  // Pattern: <CAN|CANFD|Li> <id> <Rx|Tx> <dlc> <hex_data...>
  // The key markers are the bus type prefix before the ID
  const tsMasterMatch = rest.match(/^(CAN|CANFD|Li)\s+([0-9A-Fa-f]+)\s+(Tx|Rx)\s+(\d+)\s+((?:[0-9A-Fa-f]{2}\s+)+)/i);
  if (tsMasterMatch) {
    const busType = tsMasterMatch[1].toUpperCase();
    const dataStr = tsMasterMatch[5].trim();
    const data = dataStr.split(/\s+/).filter(Boolean).map(b => parseInt(b, 16));
    const dlc = Math.min(parseInt(tsMasterMatch[4]), data.length);

    // Map bus type to channel number
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
  // Look for: timestamp + some_id + Rx/Tx + numeric_dlc + hex_data
  // This catches variations and edge cases
  const flexMatch = rest.match(/^\S+\s+([0-9A-Fa-f]+)\s+(Tx|Rx)\s+(\d{1,2})\s+((?:[0-9A-Fa-f]{2}\s*)+)/i);
  if (flexMatch && !isNonDataLine(rest)) {
    const dataStr = flexMatch[4].trim();
    const rawData = dataStr.split(/\s+/).filter(b => /^[0-9A-Fa-f]{2}$/i.test(b)).map(b => parseInt(b, 16));
    if (rawData.length >= 1) { // must have at least 1 valid byte
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

    // Use streaming readline for large files to avoid "Invalid string length" error
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity
    });

    let skippedLines = 0;

    rl.on('line', (line) => {
      // Safety limit for memory
      if (messages.length >= 1000000) return;

      // Collect header lines
      if (isNonDataLine(line)) {
        if (line.trim()) headerLines.push(line);
        return;
      }

      // Attempt to parse as a CAN data frame
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

/**
 * Parse BLF file using python-can library (BLFReader)
 * This handles all BLF variants including TSMaster's custom format
 */
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
        # Apply ID filter if specified
        if id_filter and msg.arbitration_id not in id_filter:
            continue
        
        # Extract channel as simple integer
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
        
        # Determine direction
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
        
        # Safety limit
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
    }, 600000); // 10 minute timeout for large files

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

// Fallback: pure JS BLF parser for when python-can is unavailable
async function loadBLFFallback(filePath, selectedIds) {
  const buffer = await fs.promises.readFile(filePath);
  const signature = buffer.toString('ascii', 0, 4);
  if (signature !== 'LOGG') throw new Error('Invalid BLF file');
  
  const headerSize = buffer.readUInt16LE(4);
  const dataOffset = Math.max(headerSize, 144);
  
  if (dataOffset >= buffer.length) throw new Error('Invalid BLF: corrupted header');
  
  // Find and decompress all zlib streams in the file
  const messages = [];
  let searchOff = dataOffset;
  
  while (searchOff < buffer.length - 4) {
    // Look for zlib magic bytes
    if ((buffer[searchOff] === 0x78) && 
        [0x01, 0x5e, 0x9c, 0xda].includes(buffer[searchOff + 1])) {
      try {
        const decomp = zlib.inflateSync(buffer.slice(searchOff));
        if (decomp.length < 16) { searchOff++; continue; }
        
        // Parse decompressed objects - handle Type 144 (TSMaster CAN FD) as well
        let off = 0;
        while (off + 20 <= decomp.length) {
          const sig = decomp.toString('ascii', off, off + 4);
          if (sig !== 'LOBJ') { off++; continue; }
          
          const hdrLen = decomp.readUInt16LE(off + 4);
          const objType = decomp.readUInt16LE(off + 8);
          const objSize = decomp.readUInt32LE(off + 12);
          
          if (objSize < 32 || off + objSize > decomp.length) break;
          
          // Accept type 1 (standard CAN), type 2 (CAN FD), type 144 (TSMaster custom)
          if ([1, 2, 144].includes(objType) && objSize >= hdrLen + 12) {
            try {
              const p = off + hdrLen;
              const ch = decomp.readUInt8(p);       // channel at byte 0
              // flags at byte 1, DLC indicator at byte 2
              // CAN ID at bytes 4-7 (little-endian)
              const rawId = decomp.readUInt32LE(p + 4);
              const id = rawId & (rawId > 0x7FF ? 0x1FFFFFFF : 0x7FF); // auto-detect std/ext
              
              // For type 144 (TSMaster), actual DLC might differ from byte[8]
              let dlc;
              if (objType === 144) {
                dlc = decomp.readUInt8(p + 2); // TSMaster stores real DLC here
                if (dlc > 64) dlc = Math.min(dlc & 0x0F, 8); // sanitize
              } else {
                dlc = decomp.readUInt8(p + 8); // Standard BLF layout
              }
              
              const dataLen = Math.min(dlc, 64);
              const data = [];
              for (let i = 0; i < dataLen; i++) {
                data.push(decomp.readUInt8(p + 12 + i)); // Data starts at offset +12 in payload
              }
              
              // Timestamp: last 8 bytes of the object, or use fallback
              let timestamp = 0;
              const tsPos = off + objSize - 8;
              if (tsPos >= off + hdrLen && tsPos + 8 <= decomp.length) {
                const rawTs = decomp.readBigUInt64LE(tsPos);
                // If ts looks like epoch seconds (> 1 billion), treat as seconds
                // Otherwise treat as 100ns ticks
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
        
        // Skip past this zlib stream roughly based on compressed size
        // This is approximate but good enough for single-stream files
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
  // Try python-can first (most reliable), fall back to JS parser
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

ipcMain.handle('dialog:saveFile', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'ASC Files', extensions: ['asc'] }]
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
    
    // Auto-compress if file is large (> 100MB)
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
