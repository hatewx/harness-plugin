import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(root, "skills");

const claudeManifestPath = path.join(root, ".claude-plugin", "plugin.json");
assert.ok(fs.existsSync(claudeManifestPath), "Claude plugin manifest must be packaged");
const claudeManifest = JSON.parse(fs.readFileSync(claudeManifestPath, "utf8"));
assert.equal(claudeManifest.name, "english-improver");
assert.equal(claudeManifest.version, "0.1.0");

const hooksPath = path.join(root, "hooks", "hooks.json");
const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
const hookCommand = hooks.hooks.UserPromptSubmit[0].hooks[0].command;
assert.match(hookCommand, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/scripts\/check-english\.ts/);

for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
  assert.ok(fs.existsSync(skillFile), `${entry.name} must contain SKILL.md`);
  const content = fs.readFileSync(skillFile, "utf8");
  assert.match(content, /^---\n[\s\S]*?\n---/, `${entry.name} must have frontmatter`);
}
