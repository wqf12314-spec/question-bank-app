const { contextBridge, ipcRenderer } = require("electron");

const uploadProgressCallbacks = new Map();
ipcRenderer.on("upload:progress", (_event, progress) => {
  uploadProgressCallbacks.get(progress?.requestId)?.(progress.completedBytes);
});

contextBridge.exposeInMainWorld("desktopAPI", {
  isDesktop: true,
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    setAlwaysOnTop: (enabled) =>
      ipcRenderer.invoke("window:set-always-on-top", enabled),
    getState: () => ipcRenderer.invoke("window:get-state"),
  },
  data: {
    load: () => ipcRenderer.invoke("data:load"),
    save: (payload) => ipcRenderer.invoke("data:save", payload),
    export: (payload) => ipcRenderer.invoke("data:export", payload),
    import: () => ipcRenderer.invoke("data:import"),
  },
  auth: {
    login: (request) => ipcRenderer.invoke("auth:login", request),
    refresh: (request) => ipcRenderer.invoke("auth:refresh", request),
    logout: (request) => ipcRenderer.invoke("auth:logout", request),
  },
  upload: {
    part: async (request, onProgress) => {
      if (typeof onProgress === "function") {
        uploadProgressCallbacks.set(request.requestId, onProgress);
      }
      try {
        return await ipcRenderer.invoke("upload:part", request);
      } finally {
        uploadProgressCallbacks.delete(request.requestId);
      }
    },
    abort: (requestId) => ipcRenderer.invoke("upload:abort", requestId),
  },
  request: (request) => ipcRenderer.invoke("api:request", request),
});
