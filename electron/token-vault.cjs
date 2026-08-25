const fs = require("node:fs/promises");
const path = require("node:path");

function createTokenVault({ safeStorage, filePath }) {
  async function save(token) {
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("Refresh Token 不能为空");
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用");
    }

    const encrypted = safeStorage.encryptString(token).toString("base64");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, encrypted, "utf8");
  }

  async function load() {
    try {
      const encrypted = await fs.readFile(filePath, "utf8");
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function clear() {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return { save, load, clear };
}

module.exports = { createTokenVault };
