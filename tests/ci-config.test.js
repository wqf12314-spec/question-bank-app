import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";
import { readFile } from "node:fs/promises";
import { validateCiDocuments } from "../scripts/validate-ci-config.mjs";

async function loadDocuments() {
  const [ci, codeql, dependabot] = await Promise.all([
    readFile(".github/workflows/ci.yml", "utf8"),
    readFile(".github/workflows/codeql.yml", "utf8"),
    readFile(".github/dependabot.yml", "utf8"),
  ]);
  return {
    ci: parse(ci),
    codeql: parse(codeql),
    dependabot: parse(dependabot),
  };
}

test("CI 门禁覆盖格式、lint、测试和三个 service containers", async () => {
  const result = validateCiDocuments(await loadDocuments());
  assert.deepEqual(result.services.sort(), ["minio", "postgres", "redis"]);
  assert.deepEqual(result.dependabotDirectories, ["/", "/server"]);
});

test("CI 配置缺少 MinIO 时契约校验会失败", async () => {
  const documents = await loadDocuments();
  delete documents.ci.jobs.verify.services.minio;
  assert.throws(
    () => validateCiDocuments(documents),
    /CI 缺少 minio service container/,
  );
});
