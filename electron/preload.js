const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File dialogs
  openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
  saveFile: (defaultName, filtersList) => ipcRenderer.invoke('dialog:saveFile', defaultName, filtersList),

  // File operations
  loadDBC: (filePath) => ipcRenderer.invoke('file:loadDBC', filePath),
  loadASC: (filePath, selectedIds) => ipcRenderer.invoke('file:loadASC', filePath, selectedIds),
  loadBLF: (filePath, selectedIds) => ipcRenderer.invoke('file:loadBLF', filePath, selectedIds),
  exportASC: (filePath, headerLines, messages) => ipcRenderer.invoke('file:exportASC', filePath, headerLines, messages),
  convertASCtoBLF: (filePath, messages) => ipcRenderer.invoke('file:convertASCtoBLF', filePath, messages),
  exportLogCSV: (filePath, messages, nameMap) => ipcRenderer.invoke('file:exportLogCSV', filePath, messages, nameMap),
  getStats: (filePath) => ipcRenderer.invoke('file:getStats', filePath),
  exportText: (filePath, content) => ipcRenderer.invoke('file:exportText', filePath, content),

  // New: Physical CSV operations
  loadPhysicalCSV: (filePath) => ipcRenderer.invoke('file:loadPhysicalCSV', filePath),
  convertCSVtoASC: (csvData, dbcMessages, crcAlgorithm, options) =>
    ipcRenderer.invoke('file:convertCSVtoASC', csvData, dbcMessages, crcAlgorithm, options),
  getCRCAlgorithms: () => ipcRenderer.invoke('file:getCRCAlgorithms'),

  // Export progress listener
  onExportProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('export:progress', handler);
    return () => ipcRenderer.removeListener('export:progress', handler);
  },

  // Application menu events (Help > 使用手册, Tool > 清空, etc.) dispatched
  // from the main process. Returns an unsubscribe function.
  onMenuEvent: (callback) => {
    const handler = (event, action) => callback(action);
    ipcRenderer.on('menu:action', handler);
    return () => ipcRenderer.removeListener('menu:action', handler);
  },

  // Open an external URL in the user's default browser. Used by the About
  // dialog for the official site and GitHub repo links.
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Signal decode operations
  decodeSignalFrames: (loadedMessages, selectedSignals, dbcMessages) =>
    ipcRenderer.invoke('signal:decodeFrames', loadedMessages, selectedSignals, dbcMessages),

  // R2: chunked decode — frames stay resident in the main process, results
  // stream back as decode:chunk-result events so the UI stays responsive on
  // 1M-frame logs.
  decodeChunked: (payload) => ipcRenderer.invoke('signal:decodeChunked', payload),
  decodeCancel: () => ipcRenderer.invoke('signal:decodeCancel'),
  onDecodeProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('decode:progress', handler);
    return () => ipcRenderer.removeListener('decode:progress', handler);
  },
  onDecodeChunkResult: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('decode:chunk-result', handler);
    return () => ipcRenderer.removeListener('decode:chunk-result', handler);
  },

  exportSignalCSV: (filePath, signalData, selectedSignals) =>
    ipcRenderer.invoke('signal:exportCSV', filePath, signalData, selectedSignals),

  // R5: project save / restore (.claproj)
  saveProject: (filePath, projectData) => ipcRenderer.invoke('project:save', filePath, projectData),
  openProject: (filePath) => ipcRenderer.invoke('project:open', filePath),

  // R6: preferences (settings.json in userData)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // R5: .claproj open requested by the OS — double-click on a project file or
  // a second instance launch while this one is already running. Returns an
  // unsubscribe function.
  onProjectOpenRequest: (callback) => {
    const handler = (event, filePath) => callback(filePath);
    ipcRenderer.on('project:open-request', handler);
    return () => ipcRenderer.removeListener('project:open-request', handler);
  }
});
