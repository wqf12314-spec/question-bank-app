import {
  createLocalDataBackup,
  parseLocalDataBackup,
  restoreLocalData,
} from "./localDataTransfer";

let saveTimer;

export function isDesktopApp() {
  return Boolean(window.desktopAPI?.isDesktop);
}

export async function persistDesktopData() {
  if (!isDesktopApp()) return;
  await window.desktopAPI.data.save(createLocalDataBackup(localStorage));
}

function scheduleDesktopSave() {
  if (!isDesktopApp()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persistDesktopData(), 120);
}

function installStorageMirror() {
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;

  Storage.prototype.setItem = function setItem(key, value) {
    originalSetItem.call(this, key, value);
    if (this === localStorage) scheduleDesktopSave();
  };
  Storage.prototype.removeItem = function removeItem(key) {
    originalRemoveItem.call(this, key);
    if (this === localStorage) scheduleDesktopSave();
  };
  Storage.prototype.clear = function clear() {
    originalClear.call(this);
    if (this === localStorage) scheduleDesktopSave();
  };
}

export async function initializeDesktopData() {
  if (!isDesktopApp()) return;

  const saved = await window.desktopAPI.data.load();
  if (saved) {
    // 必须在 Pinia Store 创建前恢复，否则 Store 会先把空数据写回去。
    restoreLocalData(localStorage, parseLocalDataBackup(saved));
  } else {
    await persistDesktopData();
  }
  installStorageMirror();
}
