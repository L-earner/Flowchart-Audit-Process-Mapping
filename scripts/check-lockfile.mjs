// Fails if package-lock.json pins packages to a private/hosted mirror (e.g.
// Replit's package firewall), which makes `npm ci` fail everywhere else.
// The repo's .npmrc sets `omit-lockfile-registry-resolved=true`, so registry
// packages should carry no `resolved` URL at all; any that do must point at
// the public npm registry.
import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const bad = [];
for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
  const resolved = pkg?.resolved;
  if (typeof resolved !== "string") continue;
  if (resolved.startsWith("https://registry.npmjs.org/")) continue;
  if (resolved.startsWith("file:") || resolved.startsWith("git")) continue;
  bad.push(`${path || "(root)"} -> ${resolved}`);
}

if (bad.length) {
  console.error(
    `package-lock.json has ${bad.length} package(s) resolved from a non-public registry:\n  ` +
      bad.slice(0, 10).join("\n  ") +
      (bad.length > 10 ? `\n  … and ${bad.length - 10} more` : "") +
      "\n\nFix: run `npm install --package-lock-only` (the repo .npmrc strips registry URLs) and commit the result.",
  );
  process.exit(1);
}
console.log("package-lock.json is registry-agnostic.");
