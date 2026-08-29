import {
  chromium,
  expect,
  test,
  _electron as electron,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  browserCrossClientUser,
  browserAdminUser,
  browserLearnerUser,
  browserQuestionTitle,
  browserRestartQuestionTitle,
  browserRestartUploadPath,
  browserRestartUser,
  browserReviewQuestionTitle,
  browserReviewUploadPath,
  browserTestUser,
  browserUploadPath,
  electronUploadPath,
  electronUploadQuestionTitle,
} from "./support/test-data.js";

const apiBaseUrl = "http://127.0.0.1:3003";

test("登录、上传暂停恢复、导入进度和刷题形成浏览器闭环", async ({
  context,
  page,
}) => {
  const consoleErrors = [];
  context.on("page", (openedPage) => {
    openedPage.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
  });

  let phase = "initial";
  const initialParts = [];
  const resumedParts = [];
  let importEventRequestCount = 0;
  let resumedLastEventId;
  await context.route(`${apiBaseUrl}/uploads/**/parts/**`, async (route) => {
    const partNumber = Number(route.request().url().split("/").at(-1));
    if (phase === "initial") initialParts.push(partNumber);
    if (phase === "resume") resumedParts.push(partNumber);

    if (phase === "initial" && partNumber !== 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
      if (phase !== "initial") {
        await route.abort().catch(() => {});
        return;
      }
    }
    await route.continue().catch(() => {});
  });
  await context.route(`${apiBaseUrl}/import-jobs/*/events`, async (route) => {
    importEventRequestCount += 1;
    const jobId = route.request().url().split("/").at(-2);
    const lastEventId = route.request().headers()["last-event-id"];

    if (importEventRequestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `id: 7\nevent: validating\ndata: ${JSON.stringify({ id: jobId, status: "VALIDATING", totalItems: 1 })}\n\n`,
      });
      return;
    }
    if (importEventRequestCount === 2) {
      expect(lastEventId).toBe("7");
      await route.abort("failed");
      return;
    }
    resumedLastEventId = lastEventId;
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("邮箱").fill(browserTestUser.email);
  await page.getByLabel("密码").fill(browserTestUser.password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await expect(page.getByTitle(browserTestUser.email)).toBeVisible();
  const keepLocalButton = page.getByRole("button", {
    name: "保留本地，暂不上传",
  });
  if (await keepLocalButton.isVisible()) {
    await keepLocalButton.click();
    await page.getByRole("button", { name: "完成", exact: true }).click();
  }

  await page.goto("/#/questions");
  await expect(page.getByRole("heading", { name: "题库管理" })).toBeVisible();
  const fileInput = page.locator('.upload-panel input[type="file"]');
  await fileInput.setInputFiles(browserUploadPath);
  await page.getByRole("button", { name: "开始上传" }).click();
  await expect(page.getByText("上传分片", { exact: true })).toBeVisible();
  await expect(page.locator(".upload-progress-detail")).toContainText("8.0 MB");

  phase = "paused";
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByText("已暂停，可继续", { exact: true })).toBeVisible();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1700));
  expect(initialParts).toContain(1);

  await page.close();
  page = await context.newPage();
  await page.goto("/#/questions");
  await expect(page.getByTitle(browserTestUser.email)).toBeVisible();
  await expect(page).toHaveURL(/#\/questions$/);

  phase = "resume";
  await page
    .locator('.upload-panel input[type="file"]')
    .setInputFiles(browserUploadPath);
  await page.getByRole("button", { name: "开始上传" }).click();
  await expect(page.getByText("导入任务：SUCCEEDED")).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.locator(".import-job-status")).toContainText("1/1");
  await expect(page.getByText("导入进度连接中断，正在重试")).toHaveCount(0);
  expect(resumedParts).not.toContain(1);
  expect(importEventRequestCount).toBeGreaterThanOrEqual(3);
  expect(resumedLastEventId).toBe("7");

  await page.reload();
  await expect(page.getByTitle(browserTestUser.email)).toBeVisible();
  const questionCard = page
    .locator(".question-item")
    .filter({ hasText: browserQuestionTitle });
  await expect(questionCard).toBeVisible();
  await questionCard.getByRole("link", { name: "开始练习" }).click();
  await expect(
    page.getByRole("heading", { name: browserQuestionTitle }),
  ).toBeVisible();
  await page
    .getByPlaceholder("先写下自己的理解，再提交答案")
    .fill("断点续传先查询服务端缺片，再只补传缺失分片。");
  await page.getByRole("button", { name: "提交答案" }).click();
  await page.getByRole("button", { name: "基本掌握" }).click();
  await expect(page.getByText("已记录：基本掌握")).toBeVisible();
  await expect(page.getByRole("heading", { name: "复习记录" })).toBeVisible();

  expect(
    consoleErrors.filter((message) => !message.includes("net::ERR_FAILED")),
  ).toEqual([]);
  expect(
    consoleErrors.some((message) => message.includes("net::ERR_FAILED")),
  ).toBe(true);
});

test("管理员在浏览器完成导入预览、逐项修正和审核发布", async ({ page }) => {
  await page.goto("/#/questions");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("邮箱").fill(browserAdminUser.email);
  await page.getByLabel("密码").fill(browserAdminUser.password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await expect(page.getByTitle(browserAdminUser.email)).toBeVisible();
  const keepLocalButton = page.getByRole("button", {
    name: "保留本地，暂不上传",
  });
  await expect(keepLocalButton).toBeVisible();
  await keepLocalButton.click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "检查本地学习记录" }),
  ).toBeHidden();
  await page.goto("/#/questions");
  await expect(page.getByRole("heading", { name: "题库管理" })).toBeVisible();

  await page
    .locator('.upload-panel input[type="file"]')
    .setInputFiles(browserReviewUploadPath);
  await page.getByLabel("先导入为待审核草稿").check();
  await page.getByRole("button", { name: "开始上传" }).click();
  await expect(page.getByText("导入任务：WAITING_REVIEW")).toBeVisible({
    timeout: 60_000,
  });

  const review = page.locator(".import-review-question");
  await expect(review).toHaveCount(1);
  await expect(review.getByLabel("题目")).toHaveValue(
    browserReviewQuestionTitle,
  );
  const revisedTitle = `${browserReviewQuestionTitle}-已修正`;
  await review.getByLabel("题目").fill(revisedTitle);
  await review.getByLabel("答案").fill("管理员确认后的答案");
  await review.getByRole("button", { name: "保存修正" }).click();
  await expect(review.getByText("已保存", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "审核并发布" }).click();
  await expect(page.getByText("导入任务：SUCCEEDED")).toBeVisible();
  await page.reload();
  await expect(page.getByText(revisedTitle, { exact: true })).toBeVisible();
});

test("浏览器在 37% 暂停，关闭整个进程后从 IndexedDB 和服务端缺片恢复", async ({
  request,
}) => {
  const userDataDir = await mkdtemp(
    join(tmpdir(), "knowledge-upload-browser-"),
  );
  const launchBrowser = () =>
    chromium.launchPersistentContext(userDataDir, {
      baseURL: "http://127.0.0.1:4173",
      headless: true,
      viewport: { width: 1440, height: 1000 },
    });
  const readPersistedUpload = (page) =>
    page.evaluate(async () => {
      const database = await new Promise((resolveDb, rejectDb) => {
        const openRequest = indexedDB.open("knowledge-navigator-uploads", 1);
        openRequest.onsuccess = () => resolveDb(openRequest.result);
        openRequest.onerror = () => rejectDb(openRequest.error);
      });
      return new Promise((resolveValue, rejectValue) => {
        const readRequest = database
          .transaction("uploads")
          .objectStore("uploads")
          .getAll();
        readRequest.onsuccess = () => resolveValue(readRequest.result[0]);
        readRequest.onerror = () => rejectValue(readRequest.error);
      });
    });

  let context;
  let phase = "initial";
  const initialParts = [];
  const resumedParts = [];
  try {
    context = await launchBrowser();
    await context.route(`${apiBaseUrl}/uploads/**/parts/**`, async (route) => {
      const partNumber = Number(route.request().url().split("/").at(-1));
      if (phase === "initial") initialParts.push(partNumber);
      if (phase === "resume") resumedParts.push(partNumber);
      if (phase === "initial" && partNumber !== 1) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1800));
        if (phase !== "initial") {
          await route.abort().catch(() => {});
          return;
        }
      }
      await route.continue().catch(() => {});
    });

    let page = context.pages()[0] || (await context.newPage());
    await page.goto("/");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByLabel("邮箱").fill(browserRestartUser.email);
    await page.getByLabel("密码").fill(browserRestartUser.password);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "登录", exact: true })
      .click();
    await expect(page.getByTitle(browserRestartUser.email)).toBeVisible();
    const keepLocalButton = page.getByRole("button", {
      name: "保留本地，暂不上传",
    });
    if (await keepLocalButton.isVisible()) {
      await keepLocalButton.click();
      await page.getByRole("button", { name: "完成", exact: true }).click();
    }

    await page.goto("/#/questions");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: 4 * 1024 * 1024,
      connectionType: "wifi",
    });
    await page
      .locator('.upload-panel input[type="file"]')
      .setInputFiles(browserRestartUploadPath);
    await page.getByRole("button", { name: "开始上传" }).click();
    const pausedPercent = await page.evaluate(
      () =>
        new Promise((resolvePause, rejectPause) => {
          const timeout = setTimeout(
            () => rejectPause(new Error("上传进度未到达 37%")),
            45_000,
          );
          const pauseAtTarget = () => {
            const percent = document.querySelector(
              ".upload-progress-heading strong",
            )?.textContent;
            if (percent !== "37%") return false;
            const pauseButton = [...document.querySelectorAll("button")].find(
              (button) => button.textContent?.includes("暂停"),
            );
            if (!pauseButton) return false;
            pauseButton.click();
            clearTimeout(timeout);
            resolvePause(37);
            return true;
          };
          if (pauseAtTarget()) return;
          const observer = new MutationObserver(() => {
            if (pauseAtTarget()) observer.disconnect();
          });
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        }),
    );
    expect(pausedPercent).toBe(37);
    await expect(
      page.getByText("已暂停，可继续", { exact: true }),
    ).toBeVisible();
    phase = "paused";
    const persistedUpload = await readPersistedUpload(page);
    expect(persistedUpload.value.uploadedParts.length).toBeGreaterThan(0);

    const loginResponse = await request.post(`${apiBaseUrl}/auth/login`, {
      data: browserRestartUser,
    });
    const accessToken = (await loginResponse.json()).data.accessToken;
    const serverStatusResponse = await request.get(
      `${apiBaseUrl}/uploads/${persistedUpload.value.sessionId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(serverStatusResponse.ok()).toBe(true);
    const serverUploadedParts = (
      await serverStatusResponse.json()
    ).data.uploadedParts
      .map(({ partNumber }) => partNumber)
      .sort((a, b) => a - b);
    expect(serverUploadedParts).toEqual(persistedUpload.value.uploadedParts);

    await context.close();
    context = await launchBrowser();
    phase = "resume";
    await context.route(`${apiBaseUrl}/uploads/**/parts/**`, async (route) => {
      resumedParts.push(Number(route.request().url().split("/").at(-1)));
      await route.continue();
    });
    page = context.pages()[0] || (await context.newPage());
    await page.goto("/#/questions");
    await expect(page.getByTitle(browserRestartUser.email)).toBeVisible();
    await page
      .locator('.upload-panel input[type="file"]')
      .setInputFiles(browserRestartUploadPath);
    await page.getByRole("button", { name: "开始上传" }).click();
    const resumedUpload = await readPersistedUpload(page);
    expect(resumedUpload.value.sessionId).toBe(persistedUpload.value.sessionId);
    expect(resumedUpload.value.uploadedParts).toEqual(
      persistedUpload.value.uploadedParts,
    );
    await expect(page.getByText("导入任务：SUCCEEDED")).toBeVisible({
      timeout: 90_000,
    });

    expect(new Set(resumedParts).size).toBe(resumedParts.length);
    expect(
      resumedParts.some((partNumber) =>
        persistedUpload.value.uploadedParts.includes(partNumber),
      ),
    ).toBe(false);
    expect(resumedParts.length).toBe(
      Math.ceil((40 * 1024 * 1024 + 101) / (8 * 1024 * 1024)) -
        persistedUpload.value.uploadedParts.length,
    );
    expect(initialParts).toContain(1);

    const questionsResponse = await request.get(
      `${apiBaseUrl}/questions?keyword=${encodeURIComponent(browserRestartQuestionTitle)}`,
    );
    expect(questionsResponse.ok()).toBe(true);
    expect(
      (await questionsResponse.json()).data.some(
        (question) => question.title === browserRestartQuestionTitle,
      ),
    ).toBe(true);
  } finally {
    phase = "stopped";
    await context?.close().catch(() => {});
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("并发编辑冲突同时保留本地版本和服务器版本", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("邮箱").fill(browserTestUser.email);
  await page.getByLabel("密码").fill(browserTestUser.password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await expect(page.getByTitle(browserTestUser.email)).toBeVisible();
  const keepLocalButton = page.getByRole("button", {
    name: "保留本地，暂不上传",
  });
  if (await keepLocalButton.isVisible()) {
    await keepLocalButton.click();
    await page.getByRole("button", { name: "完成", exact: true }).click();
  }

  const loginResponse = await request.post(`${apiBaseUrl}/auth/login`, {
    data: browserTestUser,
  });
  expect(loginResponse.ok()).toBe(true);
  const accessToken = (await loginResponse.json()).data.accessToken;
  const listResponse = await request.get(
    `${apiBaseUrl}/questions?keyword=${encodeURIComponent(browserQuestionTitle)}`,
  );
  let question = (await listResponse.json()).data.find(
    (item) => item.title === browserQuestionTitle,
  );
  if (!question) {
    const createResponse = await request.post(`${apiBaseUrl}/questions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        title: browserQuestionTitle,
        answer: "用可恢复分片和服务端校验保证上传可靠性。",
        category: "工程化",
        tags: ["Playwright", "上传"],
        difficulty: "进阶",
      },
    });
    expect(createResponse.ok()).toBe(true);
    question = (await createResponse.json()).data;
  }

  await page.goto("/#/questions");
  // 题目可能是在应用首次加载后由 API 补种，刷新确保页面重新读取服务端列表。
  await page.reload();
  const questionCard = page
    .locator(".question-item")
    .filter({ hasText: browserQuestionTitle });
  await expect(questionCard).toBeVisible();
  await questionCard.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByRole("heading", { name: "编辑题目" })).toBeVisible();

  const serverAnswer = "服务器中的并发修改";
  const externalUpdate = await request.patch(
    `${apiBaseUrl}/questions/${question.id}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        title: question.title,
        answer: serverAnswer,
        category: question.category,
        tags: question.tags,
        difficulty: question.difficulty,
        version: question.version,
      },
    },
  );
  expect(externalUpdate.ok()).toBe(true);

  const localAnswer = "尚未提交成功的本地修改";
  await page
    .getByLabel("答案 Markdown 编辑器", { exact: true })
    .fill(localAnswer);
  await page.getByRole("button", { name: "保存修改", exact: true }).click();

  const conflictPanel = page.locator(".conflict-panel");
  await expect(
    conflictPanel.getByRole("heading", { name: "检测到并发修改" }),
  ).toBeVisible();
  await expect(
    conflictPanel.getByRole("heading", { name: "我的版本" }),
  ).toBeVisible();
  await expect(
    conflictPanel.getByRole("heading", { name: "服务器版本" }),
  ).toBeVisible();
  await expect(conflictPanel).toContainText(localAnswer);
  await expect(conflictPanel).toContainText(serverAnswer);
});

test("Web 作答后 Electron 同账号可读取，桌面进程重启后会话仍恢复", async ({
  page,
  request,
}) => {
  const loginResponse = await request.post(`${apiBaseUrl}/auth/login`, {
    data: browserCrossClientUser,
  });
  expect(loginResponse.ok()).toBe(true);
  const accessToken = (await loginResponse.json()).data.accessToken;
  const listResponse = await request.get(
    `${apiBaseUrl}/questions?keyword=${encodeURIComponent(browserQuestionTitle)}`,
  );
  let question = (await listResponse.json()).data.find(
    (item) => item.title === browserQuestionTitle,
  );
  if (!question) {
    const createResponse = await request.post(`${apiBaseUrl}/questions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        title: browserQuestionTitle,
        answer: "用可恢复分片和服务端校验保证上传可靠性。",
        category: "工程化",
        tags: ["Playwright", "上传"],
        difficulty: "进阶",
      },
    });
    expect(createResponse.ok()).toBe(true);
    question = (await createResponse.json()).data;
  }
  expect(question).toBeTruthy();

  await page.goto("/");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("邮箱").fill(browserCrossClientUser.email);
  await page.getByLabel("密码").fill(browserCrossClientUser.password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await expect(page.getByTitle(browserCrossClientUser.email)).toBeVisible();
  const keepLocalButton = page.getByRole("button", {
    name: "保留本地，暂不上传",
  });
  if (await keepLocalButton.isVisible()) {
    await keepLocalButton.click();
    await page.getByRole("button", { name: "完成", exact: true }).click();
  }

  const crossClientAnswer = `跨端同步记录-${Date.now()}`;
  await page.goto(`/#/practice?questionId=${question.id}`);
  await expect(
    page.getByRole("heading", { name: browserQuestionTitle }),
  ).toBeVisible();
  await page
    .getByPlaceholder("先写下自己的理解，再提交答案")
    .fill(crossClientAnswer);
  await page.getByRole("button", { name: "提交答案" }).click();
  await page.getByRole("button", { name: "基本掌握" }).click();
  await expect(page.getByText("已记录：基本掌握")).toBeVisible();

  const userDataDir = await mkdtemp(
    join(tmpdir(), "knowledge-route-electron-"),
  );
  const launchDesktop = () =>
    electron.launch({
      args: [resolve("."), `--user-data-dir=${userDataDir}`],
      cwd: resolve("."),
      env: {
        ...process.env,
        ELECTRON_ALLOWED_API_ORIGINS: apiBaseUrl,
        ELECTRON_RENDERER_URL: "http://127.0.0.1:4173",
      },
    });

  let electronApp;
  try {
    electronApp = await launchDesktop();
    let desktopPage = await electronApp.firstWindow();
    await desktopPage
      .getByRole("button", { name: "登录", exact: true })
      .click();
    await desktopPage.getByLabel("邮箱").fill(browserCrossClientUser.email);
    await desktopPage.getByLabel("密码").fill(browserCrossClientUser.password);
    await desktopPage
      .getByRole("dialog")
      .getByRole("button", { name: "登录", exact: true })
      .click();
    await expect(desktopPage.getByTitle("退出登录")).toBeVisible();
    const desktopKeepLocalButton = desktopPage.getByRole("button", {
      name: "保留本地，暂不上传",
    });
    await desktopKeepLocalButton
      .waitFor({ state: "visible", timeout: 5_000 })
      .catch(() => {});
    if (await desktopKeepLocalButton.isVisible()) {
      await desktopKeepLocalButton.click();
      await desktopPage
        .getByRole("button", { name: "完成", exact: true })
        .click();
    }
    expect(await desktopPage.evaluate(() => window.desktopAPI?.isDesktop)).toBe(
      true,
    );
    await expect(
      desktopPage.locator(".desktop-shell .review-history"),
    ).toContainText(crossClientAnswer, { timeout: 30_000 });

    await electronApp.close();
    electronApp = await launchDesktop();
    desktopPage = await electronApp.firstWindow();
    await expect(desktopPage.getByTitle("退出登录")).toBeVisible();
    expect(await desktopPage.evaluate(() => window.desktopAPI?.isDesktop)).toBe(
      true,
    );
    await expect(
      desktopPage.locator(".desktop-shell .review-history"),
    ).toContainText(crossClientAnswer, { timeout: 30_000 });
  } finally {
    await electronApp?.close().catch(() => {});
    await rm(userDataDir, { recursive: true, force: true });
  }

  const recordsResponse = await request.get(`${apiBaseUrl}/practice-records`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(recordsResponse.ok()).toBe(true);
  expect(
    (await recordsResponse.json()).data.some(
      (record) => record.userAnswer === crossClientAnswer,
    ),
  ).toBe(true);
});

test("题库页完整呈现错误重试、空状态、无匹配和权限不足状态", async ({
  page,
}) => {
  let questionResponse = "error";
  await page.route(`${apiBaseUrl}/questions*`, async (route) => {
    if (questionResponse === "error") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "TEST_DATABASE_UNAVAILABLE",
            message: "测试题库暂时不可用",
            requestId: "playwright-state-request-id",
          },
        }),
      });
      return;
    }
    if (questionResponse === "empty") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: 9_999_001,
            title: browserQuestionTitle,
            answer: "状态验收题答案",
            category: "工程化",
            tags: ["Playwright"],
            difficulty: "进阶",
            status: "PUBLISHED",
            version: 1,
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("邮箱").fill(browserLearnerUser.email);
  await page.getByLabel("密码").fill(browserLearnerUser.password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await expect(page.getByTitle(browserLearnerUser.email)).toBeVisible();
  const keepLocalButton = page.getByRole("button", {
    name: "保留本地，暂不上传",
  });
  if (await keepLocalButton.isVisible()) {
    await keepLocalButton.click();
    await page.getByRole("button", { name: "完成", exact: true }).click();
  }

  await page.goto("/#/questions");
  await expect(page.getByRole("heading", { name: "题库管理" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("当前账号只能浏览题库");
  await expect(page.getByRole("button", { name: "批量导入" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "编辑", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("测试题库暂时不可用");
  await expect(page.getByRole("alert")).toContainText(
    "playwright-state-request-id",
  );
  await expect(page.getByRole("heading", { name: "暂无题目" })).toBeVisible();

  questionResponse = "empty";
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "暂无题目" })).toBeVisible();

  questionResponse = "server";
  await page.evaluate(() => window.location.reload());
  await expect(page.getByText(browserQuestionTitle)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "编辑", exact: true }),
  ).toHaveCount(0);
  await page.getByPlaceholder("搜索题目、答案或标签").fill("绝对不存在的题目");
  await expect(
    page.getByRole("heading", { name: "没有匹配的题目" }),
  ).toBeVisible();
});

test("Electron IPC 上传报告字节进度并在进程重启后补传缺失分片", async ({
  request,
}) => {
  const userDataDir = await mkdtemp(
    join(tmpdir(), "knowledge-upload-electron-"),
  );
  const launchDesktop = () =>
    electron.launch({
      args: [resolve("."), `--user-data-dir=${userDataDir}`],
      cwd: resolve("."),
      env: {
        ...process.env,
        NODE_ENV: "test",
        ELECTRON_ALLOWED_API_ORIGINS: apiBaseUrl,
        ELECTRON_RENDERER_URL: "http://127.0.0.1:4173",
        ELECTRON_UPLOAD_CHUNK_DELAY_MS: "50",
      },
    });

  let electronApp;
  try {
    electronApp = await launchDesktop();
    let desktopPage = await electronApp.firstWindow();
    await desktopPage
      .getByRole("button", { name: "登录", exact: true })
      .click();
    await desktopPage.getByLabel("邮箱").fill(browserTestUser.email);
    await desktopPage.getByLabel("密码").fill(browserTestUser.password);
    await desktopPage
      .getByRole("dialog")
      .getByRole("button", { name: "登录", exact: true })
      .click();
    await expect(desktopPage.getByTitle("退出登录")).toBeVisible();
    const keepLocalButton = desktopPage.getByRole("button", {
      name: "保留本地，暂不上传",
    });
    if (await keepLocalButton.isVisible()) {
      await keepLocalButton.click();
      await desktopPage
        .getByRole("button", { name: "完成", exact: true })
        .click();
    }
    await desktopPage.locator("details.desktop-tools > summary").click();
    await expect(
      desktopPage.getByRole("heading", { name: "题库管理" }),
    ).toBeVisible();
    await desktopPage
      .locator('.upload-panel input[type="file"]')
      .setInputFiles(electronUploadPath);
    await desktopPage.getByRole("button", { name: "开始上传" }).click();
    await expect(
      desktopPage.getByText("上传分片", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        desktopPage.evaluate(async () => {
          const database = await new Promise((resolveDb, rejectDb) => {
            const request = indexedDB.open("knowledge-navigator-uploads", 1);
            request.onsuccess = () => resolveDb(request.result);
            request.onerror = () => rejectDb(request.error);
          });
          const values = await new Promise((resolveValues, rejectValues) => {
            const request = database
              .transaction("uploads")
              .objectStore("uploads")
              .getAll();
            request.onsuccess = () => resolveValues(request.result);
            request.onerror = () => rejectValues(request.error);
          });
          return Math.max(
            0,
            ...values.map((item) => item.value?.uploadedParts?.length || 0),
          );
        }),
      )
      .toBeGreaterThan(0);
    await desktopPage
      .getByRole("button", { name: "暂停", exact: true })
      .click();
    await expect(
      desktopPage.getByText("已暂停，可继续", { exact: true }),
    ).toBeVisible();
    const persistedUpload = await desktopPage.evaluate(async () => {
      const database = await new Promise((resolveDb, rejectDb) => {
        const openRequest = indexedDB.open("knowledge-navigator-uploads", 1);
        openRequest.onsuccess = () => resolveDb(openRequest.result);
        openRequest.onerror = () => rejectDb(openRequest.error);
      });
      return new Promise((resolveValue, rejectValue) => {
        const readRequest = database
          .transaction("uploads")
          .objectStore("uploads")
          .getAll();
        readRequest.onsuccess = () => resolveValue(readRequest.result[0]);
        readRequest.onerror = () => rejectValue(readRequest.error);
      });
    });
    expect(persistedUpload.value.uploadedParts.length).toBeGreaterThan(0);

    await electronApp.close();
    electronApp = await launchDesktop();
    desktopPage = await electronApp.firstWindow();
    await expect(desktopPage.getByTitle("退出登录")).toBeVisible();
    await desktopPage.locator("details.desktop-tools > summary").click();
    await expect(
      desktopPage.getByRole("heading", { name: "题库管理" }),
    ).toBeVisible();
    await desktopPage
      .locator('.upload-panel input[type="file"]')
      .setInputFiles(electronUploadPath);
    await desktopPage.getByRole("button", { name: "开始上传" }).click();
    await expect(
      desktopPage.getByText("上传分片", { exact: true }),
    ).toBeVisible();
    const resumedUpload = await desktopPage.evaluate(async () => {
      const database = await new Promise((resolveDb, rejectDb) => {
        const openRequest = indexedDB.open("knowledge-navigator-uploads", 1);
        openRequest.onsuccess = () => resolveDb(openRequest.result);
        openRequest.onerror = () => rejectDb(openRequest.error);
      });
      return new Promise((resolveValue, rejectValue) => {
        const readRequest = database
          .transaction("uploads")
          .objectStore("uploads")
          .getAll();
        readRequest.onsuccess = () => resolveValue(readRequest.result[0]);
        readRequest.onerror = () => rejectValue(readRequest.error);
      });
    });
    expect(resumedUpload.value.sessionId).toBe(persistedUpload.value.sessionId);
    expect(resumedUpload.value.uploadedParts).toEqual(
      persistedUpload.value.uploadedParts,
    );
    await expect(desktopPage.getByText("导入任务：SUCCEEDED")).toBeVisible({
      timeout: 90_000,
    });

    const questionsResponse = await request.get(
      `${apiBaseUrl}/questions?keyword=${encodeURIComponent(electronUploadQuestionTitle)}`,
    );
    expect(questionsResponse.ok()).toBe(true);
    expect(
      (await questionsResponse.json()).data.some(
        (question) => question.title === electronUploadQuestionTitle,
      ),
    ).toBe(true);
  } finally {
    await electronApp?.close().catch(() => {});
    await rm(userDataDir, { recursive: true, force: true });
  }
});
