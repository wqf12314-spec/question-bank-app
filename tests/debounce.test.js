import test from "node:test";
import assert from "node:assert/strict";
import { debounce } from "../src/utils/debounce.js";

test("debounce only runs the latest search after the quiet period", async () => {
  const calls = [];
  const search = debounce((keyword) => calls.push(keyword), 10);
  search("v");
  search("vu");
  search("vue");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(calls, ["vue"]);
});

test("debounce can cancel a pending search", async () => {
  let called = false;
  const search = debounce(() => {
    called = true;
  }, 10);
  search();
  search.cancel();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(called, false);
});
