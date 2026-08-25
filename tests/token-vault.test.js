import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTokenVault } = require("../electron/token-vault.cjs");

test("token vault persists only encrypted data and can clear it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "knowledge-vault-"));
  const filePath = path.join(directory, "refresh-token.bin");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace("encrypted:", ""),
  };
  const vault = createTokenVault({ safeStorage, filePath });

  await vault.save("refresh-secret");
  assert.notEqual(await readFile(filePath, "utf8"), "refresh-secret");
  assert.equal(await vault.load(), "refresh-secret");
  await vault.clear();
  assert.equal(await vault.load(), null);
});

test("token vault refuses plaintext fallback when secure storage is unavailable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "knowledge-vault-"));
  const vault = createTokenVault({
    safeStorage: { isEncryptionAvailable: () => false },
    filePath: path.join(directory, "refresh-token.bin"),
  });

  await assert.rejects(() => vault.save("refresh-secret"), /不可用/);
});
