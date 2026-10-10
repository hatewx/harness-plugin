/** 员工离职时预览或删除 PineRouter 上归属于 userid / ss:userid 的全部 Key。 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

type Json = Record<string, unknown>
export type Gateway = (route: string, data?: Json) => Promise<Json>
type Options = { username?: string; userid?: string; localMapping?: boolean; mapping: string }
const DEFAULT_MAPPING = join(homedir(), 'Work/noesis/02-工作/pf/local.uuid-mapping.csv')

/** 判断接口返回值是否为普通 JSON 对象。 */
function isRecord(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 读取必需配置，错误中不包含凭据。 */
export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`缺少环境变量 ${name}`)
  return value
}

/** 请求管理接口，隐藏响应正文以避免泄漏 Key。 */
export async function requestJson(url: string, token: string, data?: Json): Promise<Json> {
  let response: Response
  try {
    response = await fetch(url, {
      method: data ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'litellm-changed-by': requiredEnv('PINE_ROUTER_OPERATOR') } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new Error('接口连接失败或超时')
  }
  if (!response.ok) throw new Error(`接口请求失败 HTTP ${response.status}`)
  const body: unknown = await response.json().catch(() => undefined)
  if (!isRecord(body) || body.error || (body.code !== undefined && body.code !== 0)) {
    throw new Error('接口返回失败或非预期结构')
  }
  return body
}

/** 仅接受唯一用户，拒绝同名或历史 UUID 歧义。 */
export function uniqueUserId(ids: unknown[]): string {
  const unique = [...new Set(ids.flatMap((id) => typeof id === 'string' && id.trim() ? [id.trim()] : []))]
  if (unique.length !== 1) throw new Error(`匹配到 ${unique.length} 个 userid，请核对后使用 --userid 指定`)
  return unique[0]
}

/** 解析历史 CSV，支持引号、转义引号和字段内换行。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++ }
      else quoted = !quoted
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(field.replace(/\r$/, ''))
      field = ''
      if (char === '\n') { rows.push(row); row = [] }
    } else field += char
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  if (field || row.length) rows.push([...row, field.replace(/\r$/, '')])
  return rows
}

/** 默认精确查询 soulforge；显式选择本地映射可查已离职用户。 */
export async function resolveUser(args: Options): Promise<string> {
  if (args.userid) return args.userid.trim()
  const username = args.username!.trim()
  if (args.localMapping) {
    const [header, ...rows] = parseCsv((await readFile(args.mapping, 'utf8')).replace(/^\uFEFF/, ''))
    const uuid = header?.indexOf('uuid') ?? -1
    const name = header?.indexOf('showname') ?? -1
    if (uuid < 0 || name < 0) throw new Error('CSV 缺少 uuid / showname 列')
    return uniqueUserId(rows.filter((row) => row[name]?.trim() === username).map((row) => row[uuid]))
  }
  const url = new URL(process.env.SOULFORGE_USERS_URL || 'https://test.sheepwall.com/soulforge/newusers/getAllUserByCompany')
  url.searchParams.set('company', 'pinefield')
  const body = await requestJson(url.toString(), requiredEnv('SOULFORGE_TOKEN'))
  if (!Array.isArray(body.list) || !body.list.every(isRecord)) throw new Error('soulforge 用户列表结构异常')
  return uniqueUserId(body.list.flatMap((user) => {
    const phone = String(user.phone || '').trim()
    let name = String(user.showname || user.userName || '').trim()
    if (phone && name.endsWith(`-${phone}`)) name = name.slice(0, -(phone.length + 1)).trim()
    return [name, String(user.userName || '').trim()].includes(username) ? [user.userid] : []
  }))
}

/** 显式开启管理员子串搜索，分页收集并再次核对 user_id。 */
export async function ownedKeys(userid: string, gateway: Gateway): Promise<Map<string, Json>> {
  const keys = new Map<string, Json>()
  for (let page = 1; ; page++) {
    const body = await gateway(`/key/list?${new URLSearchParams({ user_id: userid, substring_matching: 'true', page: String(page), size: '100', return_full_object: 'true' })}`)
    const items = body.keys, pages = body.total_pages
    if (!Array.isArray(items) || typeof pages !== 'number' || !Number.isInteger(pages) || pages < 0 || (!pages && items.length)) {
      throw new Error('PineRouter 列表或分页结构异常')
    }
    for (const item of items) {
      if (!isRecord(item)) throw new Error('PineRouter 未返回完整 Key 对象')
      if (typeof item.user_id !== 'string' || !item.user_id.toLowerCase().includes(userid.toLowerCase())) continue
      if (typeof item.token !== 'string' || !item.token) throw new Error('归属 Key 缺少 token，停止操作')
      keys.set(item.token, item)
    }
    if (page >= pages) return keys
  }
}

/** 先完整收集再删除，最后重新查询确认；不输出凭据或 Key 内容。 */
export async function offboard(userid: string, gateway: Gateway, execute = false): Promise<void> {
  const keys = await ownedKeys(userid, gateway)
  console.log(`userid=${userid}；待删除 Key 数=${keys.size}；模式=${execute ? '执行' : '预览'}`)
  if (!execute || !keys.size) return
  const tokens = [...keys.keys()]
  for (let start = 0; start < tokens.length; start += 100) {
    await gateway('/key/delete', { keys: tokens.slice(start, start + 100) })
  }
  const remaining = await ownedKeys(userid, gateway)
  if (remaining.size) throw new Error(`删除后仍有 ${remaining.size} 个 Key，请排查并重跑`)
  console.log(`删除完成，重新查询确认无残留（本次收集 ${keys.size} 个 Key）`)
}

/** 解析离职目标和显式执行开关，不修改用户、预算或团队。 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    username: { type: 'string' }, userid: { type: 'string' }, mapping: { type: 'string', default: DEFAULT_MAPPING },
    'local-mapping': { type: 'boolean' }, execute: { type: 'boolean' }, help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('tsx "$SKILL_DIR/scripts/pinerouter/offboard-user.ts" (--username <姓名或登录名> | --userid <id>) [--local-mapping] [--mapping <csv>] [--execute]')
    return
  }
  if (!!values.username === !!values.userid || !(values.username || values.userid)?.trim()) {
    throw new Error('请指定非空 --username 或 --userid，二者只能选一个')
  }
  const userid = await resolveUser({ ...values, mapping: values.mapping, localMapping: values['local-mapping'] })
  const base = requiredEnv('PINE_ROUTER_BASE_URL').replace(/\/+$/, '')
  const token = requiredEnv('PINE_ROUTER_ADMIN_KEY')
  values.execute && requiredEnv('PINE_ROUTER_OPERATOR')
  await offboard(userid, (route, data) => requestJson(base + route, token, data), values.execute)
}

if (import.meta.filename === process?.argv?.[1]) {
  main().catch((error: unknown) => {
    console.error(`失败：${error instanceof Error ? error.message : '未知错误'}`)
    process.exitCode = 1
  })
}
