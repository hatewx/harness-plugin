/** 从飞书姓名定位 Cursor 邮箱，移除团队成员并回写离职状态。 */
import { execFile } from 'node:child_process'
import { parseArgs, promisify } from 'node:util'
import { loadLocalEnvFile } from './env.ts'

type Json = Record<string, unknown>
export type Lark = (args: string[]) => Promise<Json>
export type Cursor = (route: string, data?: Json) => Promise<Json>
export type Employee = { recordId: string; name: string; email: string; status: string }
const execFileAsync = promisify(execFile)
const BASE = ['--base-token', 'NOP6bDopDaAQCusL3S1cuTbmnxg', '--table-id', 'tbl1kVfdruWYbyeC']
const FIELDS = { name: 'fldL9KauoN', email: 'fld1wK0tf1', status: 'fldUyKVDhr' }
const PROJECTION = Object.values(FIELDS).flatMap((id) => ['--field-id', id])

/** 判断接口返回值是否是 JSON 对象。 */
function isRecord(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 用参数数组调用飞书 CLI，避免姓名被作为 shell 语法解释。 */
export async function lark(args: string[]): Promise<Json> {
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync('lark-cli', ['base', ...args, '--as', 'user', '--format', 'json'], {
      timeout: 60_000, maxBuffer: 2_000_000,
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
    }))
  } catch {
    throw new Error('飞书请求失败，请检查 lark-cli 用户授权；未自动切换身份或跳过确认')
  }
  const envelope: unknown = JSON.parse(stdout)
  if (!isRecord(envelope) || envelope.ok !== true || !isRecord(envelope.data)) throw new Error('飞书返回失败或非预期结构')
  return envelope.data
}

/** 读取已验证字段，确保状态选项存在且可写。 */
export async function validateFields(call: Lark): Promise<void> {
  const body = await call(['+field-list', ...BASE])
  if (!Array.isArray(body.fields)) throw new Error('飞书字段结构异常')
  for (const [name, id] of Object.entries(FIELDS)) {
    const field = body.fields.find((item) => isRecord(item) && item.id === id)
    if (!isRecord(field) || field.name !== ({ name: 'Name', email: 'Email', status: '状态' }[name])) {
      throw new Error('飞书字段已变更，请重新核对')
    }
    if (name !== 'status' && field.type !== 'text') throw new Error('姓名或邮箱字段类型已变更')
    if (name === 'status' && (field.type !== 'select' || field.multiple !== false || !Array.isArray(field.options) ||
      !field.options.some((option) => isRecord(option) && option.name === '已离职'))) {
      throw new Error('状态字段必须为包含已离职选项的单选字段')
    }
  }
}

/** 解开 CLI 对 URL 风格邮箱的 Markdown 展示，保留邮箱原值。 */
export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new Error('员工邮箱为空或结构异常')
  const email = (value.match(/^\[([^\]]+)\]\([^\n]+\)$/)?.[1] || value).trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('员工邮箱格式异常')
  return email
}

/** 按真实字段 ID 解析记录矩阵；无记录表示未开通 Cursor，多条或异常结构仍拒绝。 */
export function employeeFromResponse(body: Json): Employee | undefined {
  const ids = body.record_id_list, fields = body.field_id_list, rows = body.data
  if (body.has_more || !Array.isArray(ids) || !Array.isArray(fields) || !Array.isArray(rows)) {
    throw new Error('飞书记录不唯一或结构异常，请核对姓名')
  }
  if (!ids.length && !rows.length) return undefined
  if (ids.length !== 1 || typeof ids[0] !== 'string' || rows.length !== 1 || !Array.isArray(rows[0])) {
    throw new Error('飞书记录不唯一或结构异常，请核对姓名')
  }
  const cell = (id: string): unknown => rows[0][fields.indexOf(id)]
  const name = cell(FIELDS.name), rawStatus = cell(FIELDS.status)
  const status = Array.isArray(rawStatus) && rawStatus.length === 1 ? rawStatus[0] : rawStatus
  if (typeof name !== 'string' || !name.trim() || typeof status !== 'string') throw new Error('姓名或状态结构异常')
  return { recordId: ids[0], name: name.trim(), email: normalizeEmail(cell(FIELDS.email)), status }
}

/** 在指定视图内云端搜索姓名，并要求精确唯一匹配。 */
export async function findEmployee(name: string, call: Lark): Promise<Employee | undefined> {
  await validateFields(call)
  const body = await call(['+record-search', ...BASE, '--view-id', 'vew2eOxWI0',
    '--keyword', name, '--search-field', FIELDS.name, ...PROJECTION, '--limit', '2'])
  const employee = employeeFromResponse(body)
  if (employee && employee.name !== name.trim()) throw new Error('飞书姓名不是精确匹配')
  return employee
}

/** 重新读取目标行，阻止预览后姓名或邮箱变化导致错删。 */
export async function recheckEmployee(employee: Employee, call: Lark): Promise<Employee> {
  const current = employeeFromResponse(await call(['+record-get', ...BASE, '--record-id', employee.recordId, ...PROJECTION]))
  if (!current || current.recordId !== employee.recordId || current.name !== employee.name || current.email !== employee.email) {
    throw new Error('员工记录已变更，停止操作，请重新预览')
  }
  return current
}

/** 创建 Cursor 管理请求，凭据仅进入 Basic Auth 请求头。 */
export function createCursor(apiKey: string): Cursor {
  if (!apiKey.trim()) throw new Error('缺少 CURSOR_API_KEY')
  return async (route, data) => {
    let response: Response
    try {
      response = await fetch(`https://api.cursor.com${route}`, {
        method: data ? 'POST' : 'GET',
        headers: { Authorization: `Basic ${Buffer.from(`${apiKey.trim()}:`).toString('base64')}`, 'Content-Type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(30_000),
      })
    } catch { throw new Error('Cursor 连接失败或超时') }
    if (!response.ok) throw new Error(`Cursor HTTP ${response.status}，请检查管理 API Key、权限及 Enterprise 套餐`)
    const body: unknown = await response.json().catch(() => undefined)
    if (!isRecord(body) || body.error) throw new Error('Cursor 返回失败或非预期结构')
    return body
  }
}

/** 精确查找有效邮箱成员；isRemoved=true 表示已移除。 */
export async function activeMember(email: string, call: Cursor): Promise<Json | undefined> {
  const body = await call('/teams/members')
  if (!Array.isArray(body.teamMembers) || !body.teamMembers.every(isRecord)) throw new Error('Cursor 成员列表结构异常')
  const members = body.teamMembers.filter((member) => typeof member.email === 'string' &&
    member.email.trim().toLowerCase() === email && member.isRemoved !== true)
  if (members.length > 1) throw new Error('Cursor 邮箱匹配多个有效成员')
  return members[0]
}

/** 已移除时可重跑；成功响应之后仍需查询确认成员不再有效。 */
export async function removeCursorMember(email: string, call: Cursor): Promise<void> {
  if (!(await activeMember(email, call))) return
  const response = await call('/teams/remove-member', { email })
  if (response.success !== true) throw new Error('Cursor 未确认移除成功')
  if (await activeMember(email, call)) throw new Error('Cursor 成员仍然有效，停止回写状态')
}

/** 仅在成员移除确认后调用，回写已离职并再次读取验证。 */
export async function markDeparted(employee: Employee, call: Lark): Promise<void> {
  const current = await recheckEmployee(employee, call)
  if (current.status !== '已离职') {
    const result = await call(['+record-upsert', ...BASE, '--record-id', employee.recordId, '--json', JSON.stringify({ [FIELDS.status]: '已离职' })])
    if (result.ignored_fields) throw new Error('飞书忽略了状态写入，请检查字段')
  }
  if ((await recheckEmployee(employee, call)).status !== '已离职') throw new Error('飞书状态回写未生效')
}

/** Cursor 单项离职入口，默认预览，移除确认后才回写此表状态。 */
async function main(): Promise<void> {
  loadLocalEnvFile()
  const { values } = parseArgs({ options: {
    username: { type: 'string' }, execute: { type: 'boolean' }, help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('tsx "$SKILL_DIR/scripts/offboarding/cursor.ts" --username <飞书姓名> [--execute]')
    return
  }
  if (!values.username?.trim()) throw new Error('请指定非空 --username')
  const employee = await findEmployee(values.username.trim(), lark)
  if (!employee) {
    console.log(`未在 Cursor 账号表中找到 ${values.username.trim()}，视为未开通 Cursor 权限，无需处理`)
    return
  }
  const cursor = createCursor(process.env.CURSOR_API_KEY || '')
  const member = await activeMember(employee.email, cursor)
  console.log(JSON.stringify({ ...employee, cursorMember: !!member, execute: !!values.execute }, undefined, 2))
  if (!values.execute) return
  await recheckEmployee(employee, lark)
  await removeCursorMember(employee.email, cursor)
  await markDeparted(employee, lark)
  console.log(`Cursor 离职处理完成：${employee.name}`)
}

if (import.meta.filename === process?.argv?.[1]) {
  main().catch((error: unknown) => {
    console.error(`Cursor 离职失败：${error instanceof Error ? error.message : '未知错误'}`)
    process.exitCode = 1
  })
}
