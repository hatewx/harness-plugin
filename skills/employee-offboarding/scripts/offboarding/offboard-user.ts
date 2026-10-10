/** 总离职入口：先核对全部身份，再清理 PineRouter、Cursor，最后回写飞书状态。 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { offboard, ownedKeys, requiredEnv, requestJson, resolveUser, type Gateway } from '../pinerouter/offboard-user.ts'
import { activeMember, createCursor, findEmployee, lark, markDeparted, recheckEmployee, removeCursorMember,
  type Cursor, type Lark } from './cursor.ts'
import { loadLocalEnvFile } from './env.ts'

type Dependencies = { lark: Lark; cursor: Cursor; gateway: Gateway; resolveUser: (name: string) => Promise<string> }
type ResolveOffboardingUserArgs = { username: string; userid?: string; mapping: string; localMapping?: boolean }

/** 优先查询在职用户；查无结果时以唯一历史映射兜底，歧义仍由解析器拒绝。 */
export async function resolveOffboardingUser(
  args: ResolveOffboardingUserArgs,
  resolver = resolveUser
): Promise<string> {
  if (args.userid || args.localMapping) return resolver(args)
  try {
    return await resolver(args)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('匹配到 0 个 userid')) throw error
    console.log(`Soulforge 无 ${args.username} 的在职记录，改用本地历史映射`)
    return resolver({ ...args, localMapping: true })
  }
}

/** 从 PineRouter 用户表按姓名或邮箱精确反查唯一 userid；零结果表示未开通。 */
export async function findPineRouterUserId(
  name: string,
  email: string | undefined,
  gateway: Gateway
): Promise<string | undefined> {
  const matches = new Set<string>()
  for (let page = 1, pages = 1; page <= pages; page++) {
    const body = await gateway(`/user/list?${new URLSearchParams({ page: String(page), page_size: '100' })}`)
    if (!Array.isArray(body.users) || typeof body.total_pages !== 'number' || !Number.isInteger(body.total_pages)) {
      throw new Error('PineRouter 用户列表或分页结构异常')
    }
    pages = body.total_pages
    for (const user of body.users) {
      if (!user || typeof user !== 'object' || Array.isArray(user)) throw new Error('PineRouter 用户记录结构异常')
      const item = user as Record<string, unknown>
      const alias = typeof item.user_alias === 'string' ? item.user_alias.trim() : ''
      const userEmail = typeof item.user_email === 'string' ? item.user_email.trim().toLowerCase() : ''
      if (alias !== name && (!email || userEmail !== email.toLowerCase())) continue
      if (typeof item.user_id !== 'string' || !item.user_id.trim()) throw new Error('PineRouter 用户缺少 userid')
      matches.add(item.user_id.trim())
    }
  }
  if (matches.size > 1) throw new Error('PineRouter 身份匹配多个 userid，请人工核对')
  return [...matches][0]
}

/** 总流程预检先于所有写入；失败保留当前进度，支持核对后重跑。 */
export async function runOffboarding(name: string, execute: boolean, deps: Dependencies): Promise<void> {
  const employee = await findEmployee(name, deps.lark)
  const username = employee?.name || name.trim()
  const member = employee ? await activeMember(employee.email, deps.cursor) : undefined
  let userid: string | undefined
  try {
    userid = await deps.resolveUser(username)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('匹配到 0 个 userid')) throw error
    userid = await findPineRouterUserId(username, employee?.email, deps.gateway)
  }
  const keys = userid ? await ownedKeys(userid, deps.gateway) : new Map()
  console.log(JSON.stringify({ name: username, email: employee?.email, userid, recordId: employee?.recordId,
    status: employee?.status || '未开通 Cursor', pineRouterStatus: userid ? '已开通' : '未开通',
    pineRouterKeys: keys.size, cursorMember: !!member, execute }, undefined, 2))
  if (!execute) return
  employee && await recheckEmployee(employee, deps.lark)
  userid && await offboard(userid, deps.gateway, true)
  employee && await removeCursorMember(employee.email, deps.cursor)
  if (userid && (await ownedKeys(userid, deps.gateway)).size) {
    throw new Error('PineRouter 出现残留或重新生成的 Key，停止回写状态')
  }
  if (!employee) {
    console.log(`离职处理完成：${username}；${userid ? 'PineRouter 无 Key' : '未开通 PineRouter'}，未开通 Cursor 权限`)
    return
  }
  await markDeparted(employee, deps.lark)
  console.log(`离职处理完成：${employee.name}；${userid ? 'PineRouter 无 Key' : '未开通 PineRouter'}，Cursor 已移除，飞书状态已离职`)
}

/** 读取本地配置，默认只预览；userid 覆盖用于离职后 soulforge 查不到的情况。 */
async function main(): Promise<void> {
  loadLocalEnvFile()
  const { values } = parseArgs({ options: {
    username: { type: 'string' }, userid: { type: 'string' }, execute: { type: 'boolean' },
    'local-mapping': { type: 'boolean' }, mapping: { type: 'string', default: join(homedir(), 'Work/noesis/02-工作/pf/local.uuid-mapping.csv') },
    help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('tsx "$SKILL_DIR/scripts/offboarding/offboard-user.ts" --username <飞书姓名> [--userid <已核对的id>] [--local-mapping] [--mapping <csv>] [--execute]')
    return
  }
  if (!values.username?.trim() || (values.userid !== undefined && !values.userid.trim())) throw new Error('请指定非空 --username；--userid 不能留空')
  const base = requiredEnv('PINE_ROUTER_BASE_URL').replace(/\/+$/, '')
  const token = requiredEnv('PINE_ROUTER_ADMIN_KEY')
  values.execute && requiredEnv('PINE_ROUTER_OPERATOR')
  await runOffboarding(values.username.trim(), !!values.execute, {
    lark, cursor: createCursor(requiredEnv('CURSOR_API_KEY')),
    gateway: (route, data) => requestJson(base + route, token, data),
    resolveUser: (username) => resolveOffboardingUser({
      username, userid: values.userid, mapping: values.mapping, localMapping: values['local-mapping'],
    }),
  })
}

if (import.meta.filename === process?.argv?.[1]) {
  main().catch((error: unknown) => {
    console.error(`离职流程失败：${error instanceof Error ? error.message : '未知错误'}；请核对已完成步骤后重跑`)
    process.exitCode = 1
  })
}
