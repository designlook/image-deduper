const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('imageDeduper', {
  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
  scanDirectory: options => ipcRenderer.invoke('scan-directory', options),
  stopScan: scanId => ipcRenderer.invoke('stop-scan', scanId),
  imagePreview: filePath => ipcRenderer.invoke('image-preview', filePath),
  deleteDuplicates: payload => ipcRenderer.invoke('delete-duplicates', payload),
  showFile: filePath => ipcRenderer.invoke('show-file', filePath)
})
