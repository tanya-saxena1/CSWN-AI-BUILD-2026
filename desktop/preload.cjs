const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  start: () => ipcRenderer.invoke('desktop:start'),
  stop: () => ipcRenderer.invoke('desktop:stop'),
  pause: () => ipcRenderer.invoke('desktop:pause'),
  resume: () => ipcRenderer.invoke('desktop:resume'),
  move: (x, y) => ipcRenderer.send('desktop:move', x, y),
  click: () => ipcRenderer.send('desktop:click'),
  wheel: (delta) => ipcRenderer.send('desktop:wheel', delta),
  restore: () => ipcRenderer.invoke('desktop:restore'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:state', listener);
    return () => ipcRenderer.removeListener('desktop:state', listener);
  }
});
