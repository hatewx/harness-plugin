import assert from "node:assert/strict";
import { detectHarness, formatHookOutput, isMainlyEnglish } from "./hooks/scripts/prompt-policy.mjs";

assert.equal(isMainlyEnglish("How you are?"), true);
assert.equal(isMainlyEnglish("请帮我修复这个问题"), false);
assert.equal(isMainlyEnglish("Please fix this issue，并说明原因"), true);
assert.equal(isMainlyEnglish("const answer = foo();"), false);

assert.deepEqual(formatHookOutput("How are you?", "claude"), {
  systemMessage: "\nHow are you?",
});
assert.deepEqual(formatHookOutput("How are you?", "codex"), {
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "How are you?",
  },
});

assert.equal(detectHarness({ ENGLISH_IMPROVER_HARNESS: "codex" }), "codex");
assert.equal(detectHarness({ PLUGIN_ROOT: "/tmp/plugin" }), "codex");
assert.equal(detectHarness({ CLAUDE_PLUGIN_ROOT: "/tmp/plugin" }), "claude");
