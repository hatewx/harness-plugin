/**
 * Shared prompt and harness policy for the English Improver hook.
 * Claude and Codex share detection, but each harness receives its own output shape.
 */

const CODE_KEYWORDS = /\b(const|let|var|function|import|export|class|interface)\b/i

/** Determine whether a prompt is predominantly written in English. */
export const isMainlyEnglish = (message) => {
  if (!message || message.trim().length < 3) return false
  if (/^\s*[\/"`]/.test(message)) return false

  const latinCount = (message.match(/[A-Za-z]/g) ?? []).length
  const cjkCount = (message.match(/[\u4e00-\u9fff]/g) ?? []).length
  const letterCount = latinCount + cjkCount
  if (latinCount < 3 || letterCount === 0) return false

  const codeIndicators = (message.match(/[{}();[\]=<>]/g) ?? []).length
  const codeLike = CODE_KEYWORDS.test(message) && codeIndicators > 0
  if (codeLike || codeIndicators > message.length * 0.1) return false

  return latinCount / letterCount >= 0.65
}

/** Identify the active harness, with an explicit override for integration tests. */
export const detectHarness = (env = process.env) =>
  env.ENGLISH_IMPROVER_HARNESS === "codex" || env.PLUGIN_ROOT ? "codex" : "claude"

/** Format the one JSON response shape accepted by the active harness. */
export const formatHookOutput = (suggestion, harness) => {
  if (!suggestion?.trim()) return {}
  if (harness === "codex") {
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: suggestion,
      },
    }
  }
  return { systemMessage: `\n${suggestion}` }
}
