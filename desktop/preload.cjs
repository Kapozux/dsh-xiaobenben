const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('fy', {
  hover: inside => ipcRenderer.send('fy:hover', !!inside),
  quit: () => ipcRenderer.send('fy:quit'),
})
