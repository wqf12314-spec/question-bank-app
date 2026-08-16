const { contextBridge, ipcRenderer } = require("electron");

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
  request: (request) => ipcRenderer.invoke("api:request", request),
});
