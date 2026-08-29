const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  safeStorage,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createApiUrlValidator } = require("./api-origin.cjs");
const { createTokenVault } = require("./token-vault.cjs");

// Linux CI 没有桌面密钥环；测试进程显式选择 Chromium basic password store，生产仍使用系统安全存储。
if (process.platform === "linux" && process.env.NODE_ENV === "test") {
  app.commandLine.appendSwitch("password-store", "basic");
}

const getApiUrl = createApiUrlValidator(
  process.env.ELECTRON_ALLOWED_API_ORIGINS,
);

const DATA_FILE_NAME = "learning-data.json";
const TOKEN_FILE_NAME = "refresh-token.bin";
const MAX_IPC_UPLOAD_PART_BYTES = 16 * 1024 * 1024;
const UPLOAD_STREAM_CHUNK_BYTES = 256 * 1024;
const TEST_UPLOAD_CHUNK_DELAY_MS =
  process.env.NODE_ENV === "test"
    ? Math.max(0, Number(process.env.ELECTRON_UPLOAD_CHUNK_DELAY_MS) || 0)
    : 0;
const activeUploadRequests = new Map();
let mainWindow;

function getTokenVault() {
  return createTokenVault({
    safeStorage,
    filePath: path.join(app.getPath("userData"), TOKEN_FILE_NAME),
    fallbackKey:
      process.platform === "linux" && process.env.NODE_ENV === "test"
        ? crypto.createHash("sha256").update(app.getPath("userData")).digest()
        : undefined,
  });
}

async function requestApi(url, options = {}) {
  const parsed = getApiUrl(url);
  const response = await net.fetch(parsed.toString(), options);
  return { response, body: await response.text() };
}

function getApiData(body) {
  const payload = body ? JSON.parse(body) : null;
  if (!payload?.success) {
    throw new Error(payload?.error?.message || "API 请求失败");
  }
  return payload.data;
}

function getRefreshTokenFromCookie(response) {
  const cookies = response.headers.getSetCookie?.() || [
    response.headers.get("set-cookie") || "",
  ];
  const cookie = cookies.join(", ");
  const match = cookie.match(/(?:^|,\s*)refresh_token=([^;]+)/i);
  return match?.[1] || null;
}

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
    Object.values(payload.localStorage).some(
      (value) => typeof value !== "string",
    )
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
  await fs.writeFile(
    temporaryPath,
    JSON.stringify(validPayload, null, 2),
    "utf8",
  );
  await fs.rename(temporaryPath, targetPath);
  return targetPath;
}

function getUploadHeaders(headers = {}) {
  const allowed = new Set(["authorization", "content-type", "x-request-id"]);
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => allowed.has(name.toLowerCase()))
      .map(([name, value]) => [name, String(value)]),
  );
}

function getUploadBody(body) {
  const buffer = Buffer.from(body || []);
  if (buffer.length === 0 || buffer.length > MAX_IPC_UPLOAD_PART_BYTES) {
    throw new Error("分片大小超出 Electron IPC 允许范围");
  }
  return buffer;
}

async function uploadPartFromRenderer(event, request) {
  const requestId = String(request?.requestId || "");
  if (!requestId || activeUploadRequests.has(requestId)) {
    throw new Error("无效或重复的上传请求编号");
  }

  const url = getApiUrl(request.url);
  const body = getUploadBody(request.body);
  const controller = new AbortController();
  let offset = 0;
  const stream = new ReadableStream({
    async pull(streamController) {
      if (offset >= body.length) {
        streamController.close();
        return;
      }
      if (TEST_UPLOAD_CHUNK_DELAY_MS > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, TEST_UPLOAD_CHUNK_DELAY_MS),
        );
      }
      const end = Math.min(offset + UPLOAD_STREAM_CHUNK_BYTES, body.length);
      streamController.enqueue(body.subarray(offset, end));
      offset = end;
      if (!event.sender.isDestroyed()) {
        event.sender.send("upload:progress", {
          requestId,
          completedBytes: offset,
          totalBytes: body.length,
        });
      }
    },
  });

  activeUploadRequests.set(requestId, controller);
  try {
    const response = await net.fetch(url.toString(), {
      method: "POST",
      headers: getUploadHeaders(request.headers),
      body: stream,
      signal: controller.signal,
      duplex: "half",
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: await response.text(),
    };
  } finally {
    activeUploadRequests.delete(requestId);
  }
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
    await fs.writeFile(
      result.filePath,
      JSON.stringify(validateBackup(payload), null, 2),
      "utf8",
    );
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

  ipcMain.handle("auth:login", async (_event, request) => {
    const { response, body } = await requestApi(`${request.url}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: request.email,
        password: request.password,
      }),
    });
    const data = getApiData(body);
    if (!response.ok) throw new Error(data);
    const refreshToken = getRefreshTokenFromCookie(response);
    if (!refreshToken) throw new Error("登录响应缺少 Refresh Token Cookie");
    await getTokenVault().save(refreshToken);
    return { accessToken: data.accessToken, user: data.user };
  });

  ipcMain.handle("auth:refresh", async (_event, request) => {
    const refreshToken = await getTokenVault().load();
    if (!refreshToken) throw new Error("本机没有登录会话");
    const { response, body } = await requestApi(`${request.url}/auth/refresh`, {
      method: "POST",
      headers: { cookie: `refresh_token=${refreshToken}` },
    });
    if (!response.ok) {
      await getTokenVault().clear();
      throw new Error("登录会话已失效");
    }
    const data = getApiData(body);
    const nextRefreshToken = getRefreshTokenFromCookie(response);
    if (!nextRefreshToken) throw new Error("刷新响应缺少 Refresh Token Cookie");
    await getTokenVault().save(nextRefreshToken);
    return { accessToken: data.accessToken, user: data.user };
  });

  ipcMain.handle("auth:logout", async (_event, request) => {
    const refreshToken = await getTokenVault().load();
    if (refreshToken) {
      await requestApi(`${request.url}/auth/logout`, {
        method: "POST",
        headers: { cookie: `refresh_token=${refreshToken}` },
      });
    }
    await getTokenVault().clear();
    return { success: true };
  });

  ipcMain.handle("api:request", async (_event, request) => {
    const url = getApiUrl(request.url);

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
  ipcMain.handle("upload:part", uploadPartFromRenderer);
  ipcMain.handle("upload:abort", (_event, requestId) => {
    const controller = activeUploadRequests.get(String(requestId));
    controller?.abort("renderer-abort");
    return { aborted: Boolean(controller) };
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
