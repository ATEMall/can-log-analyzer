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
  getStats: (filePath) => ipcRenderer.invoke('file:getStats', filePath),

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
  }
});
