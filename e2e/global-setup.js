import { prepareBrowserTestData } from "./support/test-data.js";

export default async function globalSetup() {
  await prepareBrowserTestData();
}
