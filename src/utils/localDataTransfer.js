export const LOCAL_DATA_SCHEMA_VERSION = 1;

export function createLocalDataBackup(storage, now = new Date()) {
  const values = {};

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) values[key] = storage.getItem(key);
  }

  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    localStorage: values,
  };
}

export function parseLocalDataBackup(input) {
  const payload = typeof input === "string" ? JSON.parse(input) : input;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("备份文件最外层必须是 JSON 对象");
  }
  if (payload.schemaVersion !== LOCAL_DATA_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 必须是 ${LOCAL_DATA_SCHEMA_VERSION}`);
  }
  if (
    !payload.localStorage ||
    typeof payload.localStorage !== "object" ||
    Array.isArray(payload.localStorage)
  ) {
    throw new Error("备份文件缺少 localStorage 对象");
  }
  if (Object.values(payload.localStorage).some((value) => typeof value !== "string")) {
    throw new Error("localStorage 中的值必须是字符串");
  }

  return payload;
}

export function restoreLocalData(storage, input) {
  const payload = parseLocalDataBackup(input);
  storage.clear();
  Object.entries(payload.localStorage).forEach(([key, value]) => {
    storage.setItem(key, value);
  });
  return payload;
}
