import { readFileSync } from "fs"
import { fileURLToPath } from "url"


// 判断是否需要检查英文
export const shouldImprove = (message: string): boolean => {
  if (!message || message.trim().length < 3) return false
  if (message.trim().startsWith("/")) return false

  const codeIndicators = (message.match(/[{}();[\]]/g) || []).length
  if (codeIndicators > message.length * 0.1) return false

  return /[a-zA-Z]{3,}/.test(message)
}

export const getSkillPrompt = (): string => {
  try {
    // Read the SKILL.md file
    const skillUrl = new URL("../skills/english-improver/SKILL.md", import.meta.url)
    const skillContent = readFileSync(fileURLToPath(skillUrl), "utf-8")
    // Extract content after the frontmatter
    const contentWithoutFrontmatter = skillContent.replace(/^---\n[\s\S]*?\n---\n/, "")

    return contentWithoutFrontmatter
  } catch (error) {
    console.error("Failed to read SKILL.md:", error)
    return ""
  }
}

// 调用 Claude API 检查英文
export async function checkEnglish(content: string): Promise<string | null> {
  // 从环境变量获取 API key（用户需要配置）
  const apiKey = 'sk-XQUhFKylacOVpP1mocKmawpMihnFDfOQ5tj1MnYGVAZ6Iddk'
  const baseUrl = 'https://api.moonshot.cn/v1/chat/completions'
  const model = 'kimi-k2.5'

  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model, // 使用最快最便宜的模型
        max_tokens: 200,
        messages: [
          {
            role: "system",
            content: getSkillPrompt()
          },
          {
            role: "user",
            content,
          }]
      })
    })

    if (!response.ok) {
      console.error("English Improver: API call failed", response.status)
      return null
    }

    // console.log(await response.text())

    // return null

    const data = await response.json() as any
    // Moonshot API 返回格式: choices[0].message.reasoning_content
    const suggestion = data.choices?.[0]?.message?.reasoning_content ||
      data.choices?.[0]?.message?.content || ""

    return suggestion.trim()
  } catch (error) {
    console.error("English Improver: Error calling API", error)
    return null
  }
}