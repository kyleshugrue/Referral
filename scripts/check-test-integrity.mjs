import fs from "node:fs";
import path from "node:path";

const securitySuites = [
  "server/routes/p0-security.integration.test.ts",
];

const requiredMarkers = [
  "Firebase identity binding",
  "CSRF and bearer behavior",
  "privacy",
  "administrative authorization",
];

const failures = [];

for (const relativePath of securitySuites) {
  const absolutePath = path.resolve(relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${relativePath} is missing`);
    continue;
  }

  const source = fs.readFileSync(absolutePath, "utf8");
  if (/\b(?:describe|it|test)\.(?:skip|todo|only)\b/.test(source)) {
    failures.push(`${relativePath} contains skip, todo, or only test modifiers`);
  }
  for (const marker of requiredMarkers) {
    if (!source.toLowerCase().includes(marker.toLowerCase())) {
      failures.push(`${relativePath} is missing required coverage marker: ${marker}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Test integrity gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Test integrity gate passed for ${securitySuites.length} security suite(s).`);
