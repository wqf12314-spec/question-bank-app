import assert from "node:assert/strict";
import { test } from "node:test";
import { canAccess, filterByPermission } from "../src/utils/permissions.js";

test("permission rules distinguish learner, editor, and admin", () => {
  assert.equal(canAccess({ role: "ADMIN" }, ["ADMIN"]), true);
  assert.equal(canAccess({ role: "LEARNER" }, ["ADMIN"]), false);
  assert.equal(canAccess(null, []), true);
  assert.equal(canAccess(null, ["LEARNER"]), false);
});

test("menu filtering keeps public items and removes unauthorized items", () => {
  const items = [
    { label: "刷题" },
    { label: "编辑题库", roles: ["EDITOR", "ADMIN"] },
  ];
  assert.deepEqual(
    filterByPermission(items, { role: "LEARNER" }).map((item) => item.label),
    ["刷题"],
  );
  assert.deepEqual(
    filterByPermission(items, { role: "EDITOR" }).map((item) => item.label),
    ["刷题", "编辑题库"],
  );
});
