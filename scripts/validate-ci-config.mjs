import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readYaml(path) {
  return parse(await readFile(resolve(projectRoot, path), "utf8"));
}

function stepUses(steps, expected) {
  return steps.some((step) => step.uses === expected);
}

function stepRuns(steps, expected) {
  return steps.some((step) => String(step.run || "").includes(expected));
}

export function validateCiDocuments({ ci, codeql, dependabot }) {
  const problems = [];
  const verify = ci?.jobs?.verify;
  const services = verify?.services || {};
  const steps = verify?.steps || [];

  for (const service of ["postgres", "redis"]) {
    if (!services[service])
      problems.push(`CI 缺少 ${service} service container`);
  }
  if (
    !services.minio &&
    !stepRuns(steps, "docker run --detach --name question-bank-minio")
  ) {
    problems.push("CI 缺少 MinIO service container 或显式容器启动步骤");
  }

  for (const command of [
    "npm run ci:validate",
    "npm run format:check",
    "npm run lint",
    "npm test",
    "npm run test:minio",
    "npm run test:e2e",
    "npm run test:worker",
    "npm run test:browser",
    "npx prisma migrate deploy",
    "npx prisma validate",
  ]) {
    if (!stepRuns(steps, command)) problems.push(`CI 缺少命令：${command}`);
  }

  const codeqlSteps = codeql?.jobs?.analyze?.steps || [];
  for (const action of [
    "github/codeql-action/init@v3",
    "github/codeql-action/analyze@v3",
  ]) {
    if (!stepUses(codeqlSteps, action))
      problems.push(`CodeQL 缺少步骤：${action}`);
  }

  const dependabotDirectories = new Set(
    (dependabot?.updates || [])
      .filter((entry) => entry["package-ecosystem"] === "npm")
      .map((entry) => entry.directory),
  );
  for (const directory of ["/", "/server"]) {
    if (!dependabotDirectories.has(directory)) {
      problems.push(`Dependabot 未覆盖 ${directory}`);
    }
  }

  if (problems.length > 0) throw new Error(problems.join("\n"));

  return {
    services: Object.keys(services),
    qualityGateCommands: steps.filter((step) => step.run).length,
    dependabotDirectories: [...dependabotDirectories].sort(),
  };
}

export async function validateRepositoryCi() {
  return validateCiDocuments({
    ci: await readYaml(".github/workflows/ci.yml"),
    codeql: await readYaml(".github/workflows/codeql.yml"),
    dependabot: await readYaml(".github/dependabot.yml"),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await validateRepositoryCi();
  console.log(JSON.stringify({ status: "ok", ...result }, null, 2));
}
