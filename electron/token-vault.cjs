const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function createTokenVault({ safeStorage, filePath, fallbackKey }) {
  function encryptWithFallback(token) {
    if (!fallbackKey) throw new Error("系统安全存储不可用");
    const key = Buffer.isBuffer(fallbackKey)
      ? fallbackKey
      : crypto.createHash("sha256").update(String(fallbackKey)).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return [
      "aes-gcm-v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(":");
  }

  function decryptWithFallback(value) {
    if (!fallbackKey || !value.startsWith("aes-gcm-v1:")) return null;
    const [, encodedIv, encodedTag, encodedCiphertext] = value.split(":");
    const key = Buffer.isBuffer(fallbackKey)
      ? fallbackKey
      : crypto.createHash("sha256").update(String(fallbackKey)).digest();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  async function save(token) {
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("Refresh Token 不能为空");
    }
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(token).toString("base64")
      : encryptWithFallback(token);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, encrypted, "utf8");
  }

  async function load() {
    try {
      const encrypted = await fs.readFile(filePath, "utf8");
      const fallbackValue = decryptWithFallback(encrypted);
      if (fallbackValue !== null) return fallbackValue;
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("系统安全存储不可用");
      }
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
