import { cleanupBrowserTestData } from "./support/test-data.js";

export default async function globalTeardown() {
  await cleanupBrowserTestData();
}
