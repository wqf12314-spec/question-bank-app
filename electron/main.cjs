const { app, BrowserWindow, dialog, ipcMain, Menu, net } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const API_ORIGINS = new Set([
  "http://localhost:3002",
  "https://question-bank-api-2vsg.onrender.com",
]);

const DATA_FILE_NAME = "learning-data.json";
let mainWindow;

function getDataFilePath() {
  return path.join(app.getPath("userData"), DATA_FILE_NAME);
}

function validateBackup(payload) {
  if (
    !payload ||
    payload.schemaVersion !== 1 ||
    !payload.localStorage ||
    typeof payload.localStorage !== "object" ||
    Array.isArray(payload.localStorage) ||
    Object.values(payload.localStorage).some((value) => typeof value !== "string")
  ) {
    throw new Error("备份文件格式不正确");
  }
  return payload;
}

async function writeBackup(payload) {
  const validPayload = validateBackup(payload);
  const targetPath = getDataFilePath();
  const temporaryPath = `${targetPath}.tmp`;

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(temporaryPath, JSON.stringify(validPayload, null, 2), "utf8");
  await fs.rename(temporaryPath, targetPath);
  return targetPath;
}

function registerIpcHandlers() {
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) return false;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("window:set-always-on-top", (_event, enabled) => {
    mainWindow?.setAlwaysOnTop(Boolean(enabled));
    return mainWindow?.isAlwaysOnTop() ?? false;
  });
  ipcMain.handle("window:get-state", () => ({
    alwaysOnTop: mainWindow?.isAlwaysOnTop() ?? false,
    maximized: mainWindow?.isMaximized() ?? false,
  }));

  ipcMain.handle("data:load", async () => {
    try {
      const content = await fs.readFile(getDataFilePath(), "utf8");
      return validateBackup(JSON.parse(content));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  });
  ipcMain.handle("data:save", (_event, payload) => writeBackup(payload));
  ipcMain.handle("data:export", async (_event, payload) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出学习数据",
      defaultPath: `knowledge-navigator-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, JSON.stringify(validateBackup(payload), null, 2), "utf8");
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle("data:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "导入学习数据",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const content = await fs.readFile(result.filePaths[0], "utf8");
    return validateBackup(JSON.parse(content));
  });

  ipcMain.handle("api:request", async (_event, request) => {
    const url = new URL(request.url);
    if (!API_ORIGINS.has(url.origin)) {
      throw new Error(`不允许访问该 API：${url.origin}`);
    }

    const response = await net.fetch(url.toString(), {
      method: request.method || "GET",
      headers: request.headers,
      body: request.body,
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: await response.text(),
    };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 380,
    minHeight: 520,
    show: false,
    frame: false,
    resizable: true,
    maximizable: true,
    alwaysOnTop: true,
    backgroundColor: "#eff9fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
