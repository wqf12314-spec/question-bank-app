import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let questionRequests = 0;
  let releaseFirstRequest;
  const firstRequest = new Promise((resolve) => {
    releaseFirstRequest = resolve;
  });
  await page.route("**/auth/refresh", async (route) => {
    await firstRequest;
    await route.fulfill({ status: 401, json: { message: "No session" } });
  });
  await page.route("**/questions", async (route) => {
    questionRequests += 1;
    if (questionRequests === 1) {
      // Hold the startup read until guest session recovery cancels it.
      releaseFirstRequest();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await route
      .fulfill({
        json: [
          {
            id: 1,
            title: "Guest recovery regression",
            answer: "Answer",
            category: "Test",
            tags: [],
            difficulty: "Basic",
          },
        ],
      })
      .catch(() => {});
  });
  await page.goto(process.env.TEST_APP_URL || "http://127.0.0.1:4175");
  await page.getByText("当前题池 1 道，共 1 道题").waitFor();
  assert.ok(
    questionRequests >= 2,
    "Guest recovery must restart the cancelled question request",
  );
  console.log(
    "PASS: mobile guest startup reloads questions after failed session recovery",
  );
} finally {
  await browser.close();
}
