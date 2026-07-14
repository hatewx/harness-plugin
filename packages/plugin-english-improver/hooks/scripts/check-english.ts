/**
 * English Improver Script
 *
 * Run via: bun ./scripts/check-english.ts
 *
 * Test with stdin:
 *   echo '{"prompt":"How you are?"}' | bun ./scripts/check-english.ts
 *
 * Check logs:
 *   tail -f check-english.log  (at package root)
 */

import { readFileSync, appendFileSync, existsSync, writeFileSync } from "fs"
import { fileURLToPath } from "url"
import { join } from "path"

// Find package root by traversing up from current module
const dir = fileURLToPath(new URL(".", import.meta.url))
let pkgRoot = dir
for (let i = 0; i < 5; i++) {
  if (existsSync(join(pkgRoot, "package.json"))) break
  pkgRoot = join(pkgRoot, "..")
}
const LOG_FILE = process.env.ENGLISH_IMPROVER_LOG_PATH ?? join(pkgRoot, "check-english.log")

const log = (msg: string, data?: object) => {
  const line = `[${new Date().toISOString()}] ${msg}${data ? " " + JSON.stringify(data) : ""}\n`
  if (existsSync(LOG_FILE)) {
    appendFileSync(LOG_FILE, line)
  } else {
    writeFileSync(LOG_FILE, line)
  }
}

// 判断是否需要检查英文
export const shouldImprove = (message: string): boolean => {
  if (!message || message.trim().length < 3) return false
  if (message.trim().startsWith("/")) return false
  if (message.trim().startsWith('"')) return false

  const chineseChars = (message.match(/[\u4e00-\u9fff]/g) || []).length
  if (chineseChars > 3) return false

  const codeIndicators = (message.match(/[{}();[\]]/g) || []).length
  if (codeIndicators > message.length * 0.1) return false

  return /[a-zA-Z]{3,}/.test(message)
}

export const getSkillPrompt = (): string => {
  const skillUrl = new URL("../../skills/english-improver/SKILL.md", import.meta.url)
  try {
    // hooks/scripts/ -> ../../skills/english-improver/SKILL.md (must match src/utils.ts)
    const skillContent = readFileSync(fileURLToPath(skillUrl), "utf-8")
    log("skillContent loaded successfully")
    return skillContent.replace(/^---\n[\s\S]*?\n---\n/, "")
  } catch {
    log("error", { message: "Failed to read SKILL.md from url: " + skillUrl.toString() })
    return `You are an English language improver. Reply with ONLY one valid JSON object (double-quoted keys and strings, no markdown fences). Keys: "original" (string), "corrected_versions" (array of 0-2 strings), "explanation" (string). If the text is already fine, use corrected_versions: [] and explanation: "".`
  }
}

// 异步调用 API 检查英文（不阻塞主流程）
export async function checkEnglish(content: string): Promise<string | undefined> {
  const startTime = Date.now()
  const apiKey = process.env.MINI_AUTH_TOKEN

  if (!apiKey) {
    log("skip_no_env")
    return
  }

  // MiniMax API endpoint (hardcoded, compatible with OpenAI format)
  const baseUrl = "https://api.minimaxi.com/v1/chat/completions"
  const model = "MiniMax-M2.7-highspeed"

  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        messages: [
          { role: "system", content: getSkillPrompt() },
          { role: "user", content }
        ]
      })
    })

    if (!response.ok) {
      log("api_error", { status: response.status })
      return
    }

    const data = await response.json() as any

    const suggestion = data.choices?.[0]?.message?.content || ""
    log("check-english-suggestion", { suggestion })

    if (suggestion) {
      log("check-english-done", { duration: Date.now() - startTime })
      return formatSuggestion(suggestion)
    }
  } catch (error) {
    log("error", { message: String(error) })
  }
}

// Parse JSON response and format for terminal display
interface SuggestionData {
  original?: string
  corrected_versions?: string[]
  /** legacy key from older prompts */
  versions?: string[]
  explanation?: string
}

const BOX_WIDTH = 60
const ANSI_RE = /\x1b\[[0-9;]*m/g
const BOLD_HIGHLIGHT = "\x1b[1;96m"
const RESET = "\x1b[0m"

const stripAnsi = (s: string): string => s.replace(ANSI_RE, "")

const charWidth = (ch: string): number => {
  const cp = ch.codePointAt(0) ?? 0
  if (
    (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2E80 && cp <= 0x303E) ||
    (cp >= 0x3040 && cp <= 0x33FF) ||
    (cp >= 0x3400 && cp <= 0x9FFF) ||
    (cp >= 0xAC00 && cp <= 0xD7AF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE6F) ||
    (cp >= 0xFF00 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x20000 && cp <= 0x3134F)
  ) return 2
  return 1
}

const visibleWidth = (s: string): number => {
  let w = 0
  for (const ch of stripAnsi(s)) w += charWidth(ch)
  return w
}

// Build a box content line with correct right-side closing border
const boxLine = (content: string, leftPad = 2): string => {
  const rightSpace = BOX_WIDTH - 2 - leftPad - visibleWidth(content)
  return "│" + " ".repeat(leftPad) + content + " ".repeat(Math.max(0, rightSpace)) + "│"
}

// Wrap text into lines that fit within maxWidth display columns
const wrapText = (text: string, maxWidth: number): string[] => {
  const words = text.split(" ")
  const lines: string[] = []
  let current = ""
  let currentWidth = 0

  for (const word of words) {
    const wordW = visibleWidth(word)
    if (currentWidth === 0) {
      current = word
      currentWidth = wordW
    } else if (currentWidth + 1 + wordW <= maxWidth) {
      current += " " + word
      currentWidth += 1 + wordW
    } else {
      if (current) lines.push(current)
      current = word
      currentWidth = wordW
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : [""]
}

const hRule = (l: string, m: string, r: string): string =>
  l + m.repeat(BOX_WIDTH - 2) + r

/** Strip XML-style model reasoning blocks that precede JSON (e.g. MiniMax M2.* chain-of-thought tags). */
const stripReasoningPreamble = (raw: string): string => {
  let s = raw
  // Old regex literals used `</think>` / wrong close tag; MiniMax emits <think>…</think> before JSON.
  s = s.replace(new RegExp('<think>' + "[\\s\\S]*?" + '</think>', "gi"), "")
  s = s.replace(new RegExp('<redacted_thinking>' + "[\\s\\S]*?" + '</redacted_thinking>', "gi"), "")
  s = s.replace(new RegExp("<thinking>[\\s\\S]*?</thinking>", "gi"), "")
  return s.trim()
}

/** First balanced `{ ... }` slice, for text after thinking or stray newlines. */
const extractJsonObject = (text: string): string | null => {
  const start = text.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (c === "\\" && inString) {
      escape = true
      continue
    }
    if (c === '"') {
      let backslashes = 0
      for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) backslashes++
      if (backslashes % 2 === 0) inString = !inString
      continue
    }
    if (inString) continue
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const normSentence = (s: string): string =>
  s.trim().replace(/\s+/g, " ").toLowerCase()

/** No UI: SKILL "no correction" shape, or model echoed the same sentence as the only suggestion(s). */
const shouldSuppressSuggestion = (data: SuggestionData, versions: string[]): boolean => {
  if (versions.length === 0) return true
  const orig = data.original?.trim()
  if (!orig) return false
  const o = normSentence(orig)
  return versions.every(v => normSentence(v) === o)
}

const formatSuggestion = (raw: string): string => {
  let cleaned = stripReasoningPreamble(raw)
  cleaned = cleaned.replace(/^```(?:json)?\n?/i, "").replace(/```$/gm, "").trim()

  const jsonSlice = extractJsonObject(cleaned) ?? cleaned

  try {
    const data: SuggestionData = JSON.parse(jsonSlice)
    const versions = data.corrected_versions ?? data.versions ?? []
    if (shouldSuppressSuggestion(data, versions)) {
      log("check-english-suppress", { reason: "no_meaningful_correction", original: data.original })
      return ""
    }
    const hasExpected =
      Boolean(data.original?.trim()) || versions.length > 0 || Boolean(data.explanation?.trim())
    if (!hasExpected) {
      log("check-english-format-warn", {
        reason: "parsed_json_missing_expected_fields",
        keys: Object.keys(data),
        preview: jsonSlice.length > 1200 ? jsonSlice.slice(0, 1200) + "…(truncated)" : jsonSlice,
      })
    }
    const lines: string[] = []

    lines.push(hRule("┌", "─", "┐"))
    lines.push(boxLine(`${BOLD_HIGHLIGHT}English Improver${RESET}`))
    lines.push(hRule("├", "─", "┤"))

    const sections: string[][] = []

    if (data.original) {
      const sec = [boxLine("Original:")]
      wrapText(`"${data.original}"`, BOX_WIDTH - 2 - 4).forEach(l => sec.push(boxLine(l, 4)))
      sections.push(sec)
    }

    if (versions.length > 0) {
      const sec = [boxLine("Suggestions:")]
      versions.forEach((v, i) => {
        const prefix = `${i + 1}. `
        const prefixW = visibleWidth(prefix)
        wrapText(v, BOX_WIDTH - 2 - 4 - prefixW).forEach((segment, si) =>
          sec.push(boxLine((si === 0 ? prefix : " ".repeat(prefixW)) + segment, 4))
        )
      })
      sections.push(sec)
    }

    if (data.explanation) {
      const sec = [boxLine("Explanation:")]
      wrapText(data.explanation, BOX_WIDTH - 2 - 4).forEach(l => sec.push(boxLine(l, 4)))
      sections.push(sec)
    }

    sections.forEach((sec, i) => {
      sec.forEach(l => lines.push(l))
      if (i < sections.length - 1) lines.push(hRule("├", "─", "┤"))
    })

    lines.push(hRule("└", "─", "┘"))
    return lines.join("\n")
  } catch (e) {
    const previewLen = 4000
    log("check-english-parse-error", {
      message: e instanceof Error ? e.message : String(e),
      jsonSliceLength: jsonSlice.length,
      jsonSlicePreview:
        jsonSlice.length > previewLen ? jsonSlice.slice(0, previewLen) + "…(truncated)" : jsonSlice,
      cleanedLength: cleaned.length,
    })
    return cleaned
  }
}

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString()
}

const main = async () => {
  let input: { user_prompt?: string; prompt?: string } = {}
  let raw = ""
  try {
    raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    // process.stdout.write("{}")
    process.exit(0)
  }

  // Debug: log the raw input and working directory
  log("check-english-raw-input", { raw: raw.substring(0, 500), cwd: process.cwd(), logFile: LOG_FILE })

  // Support both UserPromptSubmit format (user_prompt) and test format (prompt)
  const prompt = input.user_prompt ?? input.prompt ?? ""

  if (!shouldImprove(prompt)) {
    // process.stdout.write("{}")
    process.exit(0)
  }

  log("check-english-content", { content: prompt })

  try {
    const suggestion = await checkEnglish(prompt)
    if (suggestion?.trim()) {
      process.stdout.write(JSON.stringify({ systemMessage: `\n${suggestion}` }))
    } else {
      process.stdout.write("{}")
    }
    process.exit(0)
  } catch (err) {
    log("check-english-error", { message: String(err) })
    process.exit(0)
  }
}

if (typeof process !== 'undefined' && import.meta.url.endsWith(process?.argv?.[1])) {
  await main()
}
