const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scenarioApi', Object.freeze({
  getAiProvider: () => ipcRenderer.invoke('scenario:get-ai-provider'),
  setAiProvider: (provider) => ipcRenderer.invoke('scenario:set-ai-provider', provider),
  generate: (input, previousDraft) => ipcRenderer.invoke('scenario:generate', { input, previousDraft }),
  save: (request, draft) => ipcRenderer.invoke('scenario:save', { request, draft }),
  autoSave: (request, draft) => ipcRenderer.invoke('scenario:auto-save', { request, draft }),
  open: () => ipcRenderer.invoke('scenario:open'),
  exportSubtitles: (chapterIndex, subtitles) => ipcRenderer.invoke('subtitle:export-srt', { chapterIndex, subtitles }),
}));

contextBridge.exposeInMainWorld('cProgramApi', Object.freeze({
  run: (executionId, source, stdin) => ipcRenderer.invoke('c-program:run', { executionId, source, stdin }),
  stop: (executionId) => ipcRenderer.invoke('c-program:stop', executionId),
  onOutput: (executionId, callback) => {
    const listener = (_event, payload) => {
      if (payload.executionId === executionId) callback(payload.stream, payload.text);
    };
    ipcRenderer.on('c-program:output', listener);
    return () => ipcRenderer.removeListener('c-program:output', listener);
  },
}));

contextBridge.exposeInMainWorld('voicevoxApi', Object.freeze({
  listSpeakers: () => ipcRenderer.invoke('voicevox:list-speakers'),
  synthesize: (text, styleId) => ipcRenderer.invoke('voicevox:synthesize', { text, styleId }),
  saveChapterAudio: (chapterIndex, audio, durationSeconds, styleId, narration, speakerName) =>
    ipcRenderer.invoke('voicevox:save-chapter-audio', { chapterIndex, audio, durationSeconds, styleId, narration, speakerName }),
  loadChapterAudio: (chapterIndex) => ipcRenderer.invoke('voicevox:load-chapter-audio', chapterIndex),
}));

contextBridge.exposeInMainWorld('videoApi', Object.freeze({
  checkFfmpeg: () => ipcRenderer.invoke('video:check-ffmpeg'),
  startExport: (chapterIndex) => ipcRenderer.invoke('video:export-start', { chapterIndex }),
  writeFrame: (exportId, frameIndex, frame) => ipcRenderer.invoke('video:export-frame', { exportId, frameIndex, frame }),
  finishExport: (exportId) => ipcRenderer.invoke('video:export-finish', { exportId }),
  cancelExport: (exportId) => ipcRenderer.invoke('video:export-cancel', exportId),
}));