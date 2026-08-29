import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import pg from "pg";

config({ path: new URL("../.env.test", import.meta.url) });
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL is required");

const client = new pg.Client({ connectionString });
const suffix = randomUUID();
const title = `__expand_contract_${suffix}__`;
const legacyTimestamp = new Date();

await client.connect();
try {
  // 模拟旧应用：只写迁移前已有、且当时就必须由客户端提供的时间列。
  await client.query(
    `INSERT INTO "Question" ("title", "normalizedTitle", "answer", "category", "tags", "difficulty", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      title,
      title,
      "旧客户端答案",
      "兼容性测试",
      "[]",
      "基础",
      legacyTimestamp,
      legacyTimestamp,
    ],
  );
  const { rows } = await client.query(
    `SELECT "title", "answer", "category", "version", "status", "importJobId"
     FROM "Question" WHERE "normalizedTitle" = $1`,
    [title],
  );
  const row = rows[0];
  if (
    !row ||
    row.title !== title ||
    row.answer !== "旧客户端答案" ||
    row.version !== 1 ||
    row.status !== "DRAFT" ||
    row.importJobId !== null
  ) {
    throw new Error("expand-contract compatibility assertion failed");
  }
  console.log(
    JSON.stringify({
      status: "ok",
      scenario: "legacy-write-and-read-after-expand",
      version: row.version,
      statusValue: row.status,
    }),
  );
} finally {
  await client
    .query('DELETE FROM "Question" WHERE "normalizedTitle" = $1', [title])
    .catch(() => undefined);
  await client.end();
}
