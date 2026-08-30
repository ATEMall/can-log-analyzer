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
  exportSignalCSV: (filePath, signalData, selectedSignals) =>
    ipcRenderer.invoke('signal:exportCSV', filePath, signalData, selectedSignals)
});
