import { createRequire } from "node:module";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverRequire = createRequire(resolve(rootDir, "server", "package.json"));
const { config } = serverRequire("dotenv");
const { Pool } = serverRequire("pg");
const bcrypt = serverRequire("bcryptjs");

config({ path: resolve(rootDir, "server", ".env.test"), quiet: true });

export const browserTestUser = {
  email: "playwright-editor@example.test",
  password: "correct-password-123",
};
export const browserLearnerUser = {
  email: "playwright-learner@example.test",
  password: "correct-password-123",
};
export const browserCrossClientUser = {
  email: "playwright-cross-client@example.test",
  password: "correct-password-123",
};
export const browserRestartUser = {
  email: "playwright-browser-restart@example.test",
  password: "correct-password-123",
};
export const browserAdminUser = {
  email: "playwright-admin@example.test",
  password: "correct-password-123",
};
export const browserQuestionTitle = "Playwright-E2E-可靠上传题";
export const electronUploadQuestionTitle = "Playwright-E2E-Electron重启续传题";
export const browserRestartQuestionTitle =
  "Playwright-E2E-浏览器进程重启续传题";
export const browserQuestionPrefix = "playwright-e2e-";
export const browserReviewQuestionTitle = "Playwright-E2E-待审核导入题";
export const browserReviewUploadPath = resolve(
  rootDir,
  "e2e",
  ".tmp",
  "playwright-review-question-bank.json",
);
export const browserUploadPath = resolve(
  rootDir,
  "e2e",
  ".tmp",
  "playwright-question-bank.json",
);
export const electronUploadPath = resolve(
  rootDir,
  "e2e",
  ".tmp",
  "electron-resume-question-bank.json",
);
export const browserRestartUploadPath = resolve(
  rootDir,
  "e2e",
  ".tmp",
  "browser-process-resume-question-bank.json",
);

function getTestDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for browser tests");
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(
      "Browser tests refuse to use a database without 'test' in its name",
    );
  }
  return url;
}

export async function prepareBrowserTestData() {
  await cleanupBrowserTestData();
  const pool = new Pool({ connectionString: getTestDatabaseUrl() });
  try {
    const passwordHash = await bcrypt.hash(browserTestUser.password, 4);
    await pool.query(
      `INSERT INTO "User" (email, "passwordHash", role, "createdAt", "updatedAt")
       VALUES ($1, $3, 'EDITOR', NOW(), NOW()),
              ($2, $3, 'LEARNER', NOW(), NOW()),
              ($4, $3, 'EDITOR', NOW(), NOW()),
              ($5, $3, 'EDITOR', NOW(), NOW()),
              ($6, $3, 'ADMIN', NOW(), NOW())`,
      [
        browserTestUser.email,
        browserLearnerUser.email,
        passwordHash,
        browserCrossClientUser.email,
        browserRestartUser.email,
        browserAdminUser.email,
      ],
    );
  } finally {
    await pool.end();
  }
  await createLargeQuestionBank(browserUploadPath, browserQuestionTitle);
  await createLargeQuestionBank(
    electronUploadPath,
    electronUploadQuestionTitle,
  );
  await createLargeQuestionBank(
    browserRestartUploadPath,
    browserRestartQuestionTitle,
  );
  await mkdir(dirname(browserReviewUploadPath), { recursive: true });
  await writeFile(
    browserReviewUploadPath,
    JSON.stringify({
      schemaVersion: 1,
      questions: [
        {
          title: browserReviewQuestionTitle,
          answer: "审核前答案",
          category: "工程化",
          tags: ["审核"],
          difficulty: "进阶",
        },
      ],
    }),
  );
}

export async function cleanupBrowserTestData() {
  const pool = new Pool({ connectionString: getTestDatabaseUrl() });
  let sessionIds = [];
  try {
    const sessions = await pool.query(
      `SELECT us.id
       FROM "UploadSession" us
       JOIN "User" u ON u.id = us."userId"
       WHERE u.email IN ($1, $2, $3, $4, $5)`,
      [
        browserTestUser.email,
        browserLearnerUser.email,
        browserCrossClientUser.email,
        browserRestartUser.email,
        browserAdminUser.email,
      ],
    );
    sessionIds = sessions.rows.map(({ id }) => id);
    await pool.query(`DELETE FROM "User" WHERE email IN ($1, $2, $3, $4, $5)`, [
      browserTestUser.email,
      browserLearnerUser.email,
      browserCrossClientUser.email,
      browserRestartUser.email,
      browserAdminUser.email,
    ]);
    await pool.query(`DELETE FROM "Question" WHERE "normalizedTitle" LIKE $1`, [
      `${browserQuestionPrefix}%`,
    ]);
  } finally {
    await pool.end();
  }

  const uploadRoot = resolve(rootDir, "server", ".data", "uploads");
  const names = await readdir(uploadRoot).catch(() => []);
  await Promise.all(
    names
      .filter((name) => sessionIds.some((id) => name.startsWith(`${id}.`)))
      .map((name) => rm(resolve(uploadRoot, name), { force: true })),
  );
  await rm(browserUploadPath, { force: true });
  await rm(electronUploadPath, { force: true });
  await rm(browserRestartUploadPath, { force: true });
  await rm(browserReviewUploadPath, { force: true });
}

async function createLargeQuestionBank(targetPath, questionTitle) {
  await mkdir(dirname(targetPath), { recursive: true });
  const prefix = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      questions: [
        {
          title: questionTitle,
          answer: "用可恢复分片和服务端校验保证上传可靠性。",
          category: "工程化",
          tags: ["Playwright", "上传"],
          difficulty: "进阶",
        },
      ],
    }).replace(/}$/, ',"padding":"'),
  );
  const suffix = Buffer.from('"}');
  const totalBytes = 40 * 1024 * 1024 + 101;
  const paddingBytes = totalBytes - prefix.length - suffix.length;
  const output = createWriteStream(targetPath, { flags: "w" });
  output.write(prefix);
  const chunk = Buffer.alloc(1024 * 1024, 0x61);
  let remaining = paddingBytes;
  while (remaining > 0) {
    const length = Math.min(remaining, chunk.length);
    if (!output.write(chunk.subarray(0, length))) {
      await new Promise((resolveDrain) => output.once("drain", resolveDrain));
    }
    remaining -= length;
  }
  await new Promise((resolveFinish, reject) => {
    output.end(suffix, resolveFinish);
    output.on("error", reject);
  });
}
