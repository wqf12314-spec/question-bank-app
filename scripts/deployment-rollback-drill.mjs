import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "knowledge-route-deploy-"));
const pointer = join(root, "current-release.txt");
const report = { previous: "v1-stable", candidate: "v2-candidate", events: [] };
try {
  await writeFile(pointer, report.previous, "utf8");
  report.events.push("stable release serving");
  await writeFile(pointer, report.candidate, "utf8");
  report.events.push("candidate activated");
  const smokePassed = false;
  if (!smokePassed) {
    await writeFile(pointer, report.previous, "utf8");
    report.events.push("smoke failed; pointer rolled back");
  }
  const active = await readFile(pointer, "utf8");
  if (active !== report.previous)
    throw new Error("rollback did not restore stable release");
  report.active = active;
  report.result = "passed";
  console.log(JSON.stringify(report));
} finally {
  await rm(root, { recursive: true, force: true });
}
