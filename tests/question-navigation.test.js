import test from "node:test";
import assert from "node:assert/strict";

test("getAdjacentQuestion navigates forward and backward with wrapping", async () => {
  let navigationModule;

  try {
    navigationModule = await import("../src/utils/questionNavigation.js");
  } catch {
    navigationModule = null;
  }

  assert.ok(navigationModule, "question navigation helper should exist");

  const questions = [{ id: 1 }, { id: 2 }, { id: 3 }];

  assert.equal(navigationModule.getAdjacentQuestion(questions, 2, 1).id, 3);
  assert.equal(navigationModule.getAdjacentQuestion(questions, 2, -1).id, 1);
  assert.equal(navigationModule.getAdjacentQuestion(questions, 1, -1).id, 3);
  assert.equal(navigationModule.getAdjacentQuestion(questions, 3, 1).id, 1);
});
