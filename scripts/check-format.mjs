import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import prettier from "prettier";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const baselinePath = resolve(root, ".prettier-baseline.json");
const supportedExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".css", ".json", ".md"]);
const excluded = ["dist/", ".server/", "node_modules/", "tmp/", ".vercel/", "package-lock.json"];
const updateBaseline = process.argv.includes("--update-baseline");

const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
});
const files = listed
  .split("\0")
  .filter(Boolean)
  .filter((file) => supportedExtensions.has(file.slice(file.lastIndexOf("."))))
  .filter((file) => !excluded.some((entry) => file === entry || file.startsWith(entry)));

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : { version: 1, files: {} };
const nextBaseline = { version: 1, files: {} };
const failures = [];
let formatted = 0;
let grandfathered = 0;

for (const file of files) {
  const absolutePath = resolve(root, file);
  const source = readFileSync(absolutePath, "utf8");
  const options = (await prettier.resolveConfig(absolutePath)) || {};
  const conforms = await prettier.check(source, { ...options, filepath: absolutePath });
  if (conforms) {
    formatted += 1;
    continue;
  }

  const hash = createHash("sha256").update(source).digest("hex");
  nextBaseline.files[file] = hash;
  if (updateBaseline || baseline.files?.[file] === hash) {
    grandfathered += 1;
  } else {
    failures.push(relative(root, absolutePath));
  }
}

if (updateBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`);
  console.log(`Updated formatting baseline: ${grandfathered} legacy files, ${formatted} formatted files.`);
} else if (failures.length) {
  console.error("These changed files do not match Prettier formatting:");
  for (const file of failures) console.error(`- ${file}`);
  console.error(
    "Run Prettier on the files. Use format:baseline only when intentionally accepting audited legacy debt.",
  );
  process.exitCode = 1;
} else {
  console.log(`Formatting gate passed: ${formatted} formatted files, ${grandfathered} unchanged legacy files.`);
}
