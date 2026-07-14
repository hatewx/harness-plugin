import type { Plugin } from "@opencode-ai/plugin"
import { checkEnglish, shouldImprove } from "./hooks/scripts/check-english"

// Session-scoped storage for suggestions to inject into LLM context
const pendingSuggestions = new Map<string, string>()

const EnglishImproverPlugin: Plugin = async ({ client }) => {
  client.app.log({
    body: { service: "english-improver", level: "info", message: "plugin loaded" }
  })

  return {
    "chat.message": async (input, output) => {
      const userMessage = output.parts
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text || "")
        .join(" ")

      if (!shouldImprove(userMessage)) {
        return
      }

      try {
        const suggestion = await checkEnglish(userMessage)
        if (suggestion) {
          // Toast: immediate user feedback (non-blocking display)
          // await client.tui.showToast({
          //   body: {
          //     message: `📝 ${suggestion}`,
          //     variant: "warning",
          //     duration: 10000
          //   }
          // })
          // Store for injection into assistant reply (appears in chat content)
          pendingSuggestions.set(input.sessionID, suggestion)
        }
      } catch (error) {
        client.app.log({
          body: {
            service: "english-improver",
            level: "error",
            message: "checkEnglish failed",
            extra: { error: String(error) }
          }
        })
      }
    },
    'experimental.text.complete': async (input, output) => {
      const suggestion = input.sessionID
        ? pendingSuggestions.get(input.sessionID)
        : undefined
      if (suggestion) {
        output.text = `${suggestion}\n\n${output.text}`
        pendingSuggestions.delete(input.sessionID!)
      }
    }
  }
}

export default EnglishImproverPlugin


if (import.meta.url?.includes(process?.argv?.[1])) {
  const result = await checkEnglish("Hello, how  you are?")
  console.log(result)
}
