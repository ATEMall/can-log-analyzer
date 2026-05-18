const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File dialogs
  openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
  saveFile: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),

  // File operations
  loadDBC: (filePath) => ipcRenderer.invoke('file:loadDBC', filePath),
  loadASC: (filePath, selectedIds) => ipcRenderer.invoke('file:loadASC', filePath, selectedIds),
  loadBLF: (filePath, selectedIds) => ipcRenderer.invoke('file:loadBLF', filePath, selectedIds),
  exportASC: (filePath, headerLines, messages) => ipcRenderer.invoke('file:exportASC', filePath, headerLines, messages),
  getStats: (filePath) => ipcRenderer.invoke('file:getStats', filePath),

  // Export progress listener
  onExportProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('export:progress', handler);
    return () => ipcRenderer.removeListener('export:progress', handler);
  }
});
