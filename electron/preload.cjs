const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('frameRunner', {
  pickZip: () => ipcRenderer.invoke('frame-runner:pick-zip'),
  pickAudio: (jobId) => ipcRenderer.invoke('frame-runner:pick-audio', jobId),
  clearAudio: (jobId) => ipcRenderer.invoke('frame-runner:clear-audio', jobId),
  releaseJob: (jobId) => ipcRenderer.invoke('frame-runner:release-job', jobId),
  beginSave: (suggestedName) => ipcRenderer.invoke('frame-runner:begin-save', suggestedName),
  writeChunk: (saveId, position, data) => ipcRenderer.invoke('frame-runner:write-chunk', {saveId, position, data}),
  finishSave: (saveId) => ipcRenderer.invoke('frame-runner:finish-save', saveId),
  cancelSave: (saveId) => ipcRenderer.invoke('frame-runner:cancel-save', saveId),
});
