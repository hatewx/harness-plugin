import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(root, "skills");

for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
  assert.ok(fs.existsSync(skillFile), `${entry.name} must contain SKILL.md`);
  const content = fs.readFileSync(skillFile, "utf8");
  assert.match(content, /^---\n[\s\S]*?\n---/, `${entry.name} must have frontmatter`);
}

