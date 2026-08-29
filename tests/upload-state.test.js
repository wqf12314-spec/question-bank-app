import test from "node:test";
import assert from "node:assert/strict";
import { transitionUploadState } from "../src/utils/uploadState.js";

test("上传状态机覆盖哈希、上传、校验、处理和完成链路", () => {
  let state = "idle";
  for (const next of [
    "hashing",
    "uploading",
    "verifying",
    "processing",
    "done",
  ]) {
    state = transitionUploadState(state, next);
  }
  assert.equal(state, "done");
});

test("上传状态机允许暂停恢复和失败重试", () => {
  assert.equal(transitionUploadState("uploading", "paused"), "paused");
  assert.equal(transitionUploadState("paused", "hashing"), "hashing");
  assert.equal(transitionUploadState("failed", "hashing"), "hashing");
});

test("文件上传完成后可以继续进入后台导入", () => {
  assert.equal(transitionUploadState("done", "processing"), "processing");
  assert.equal(transitionUploadState("processing", "done"), "done");
});

test("秒传命中后可以跳过分片上传进入校验", () => {
  assert.equal(transitionUploadState("hashing", "verifying"), "verifying");
});

test("后台导入失败后可以重新进入处理状态", () => {
  assert.equal(transitionUploadState("failed", "processing"), "processing");
});

test("上传状态机拒绝跳过校验的非法跳转", () => {
  assert.throws(
    () => transitionUploadState("uploading", "done"),
    /Invalid upload state transition/,
  );
});
