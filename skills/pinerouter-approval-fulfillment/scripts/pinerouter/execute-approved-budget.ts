/**
 * 人工执行已通过 PineRouter 预算审批：创建 LiteLLM Project / Key 并更新飞书 Base。
 * 默认仅预览；只有显式传入 --execute 才会进行外部写入。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE_SCHEMA = {
  appToken: 'CfDDbYZBQahhCjs7lB3c6raWnwg',
  tableId: 'tblW0Ym27fukV0Xh',
  fields: {
    project: 'fld8XJqZwR',
    projectType: 'fldD5HREjX',
    description: 'fldMaoWUrS',
    budget: 'flddw2ENuf',
    budgetStartAt: 'fldkzHAuST',
    budgetEndAt: 'fldc2SKuuC',
    budgetResetCycle: 'fldMiQq8li',
    models: 'fldFJR9M3C',
    overflowPolicy: 'fldB00Cckh',
    tpm: 'fld3RPMDwp',
    rpm: 'fldLUh2nrt',
    technicalOwner: 'fld9UBOnpA',
    businessOwner: 'fldKPZxVt9',
    approvalInstanceId: 'fldOZm4N90',
    approvalLink: 'fldJvHWBsj',
    keyAlias: 'fldiydfjFD',
    parent: 'fldqCFAsUJ',
  },
} as const

type ReviewedBudget = {
  project?: string
  projectId?: string
  teamId?: string
  projectType?: string
  description?: string
  budget?: number
  gatewayBudgetUsd?: number
  budgetStartAt?: string
  budgetEndAt?: string
  budgetResetCycle?: string
  models?: string[]
  overflowPolicy?: string
  tpm?: number
  rpm?: number
  technicalOwnerOpenId?: string
  businessOwnerOpenId?: string
  keyAliases?: string[]
}

type ExecutionInput = Required<Omit<ReviewedBudget, 'projectId' | 'description' | 'tpm' | 'rpm'>> &
  Pick<ReviewedBudget, 'projectId' | 'description' | 'tpm' | 'rpm'>

type CliOptions = { approvalId: string; inputPath: string; execute: boolean }
type Json = Record<string, unknown>

/** 从命令行读取审批实例 ID、人工核对的数据文件与执行开关。 */
function parseArgs(args: string[]): CliOptions {
  const option = (name: string) => {
    const index = args.indexOf(name)
    return index < 0 ? undefined : args[index + 1]
  }
  const approvalId = option('--approval-id')
  const inputPath = option('--input')
  if (!approvalId || !inputPath) {
    throw new Error('Usage: tsx execute-approved-budget.ts --approval-id <id> --input <json> [--execute]')
  }
  return { approvalId, inputPath, execute: args.includes('--execute') }
}

/** 校验字符串，防止把未经人工 review 的空值写入外部系统。 */
function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

/** 校验数值预算与速率限制。 */
function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`)
  }
  return value
}

/** 把人工复核 JSON 转为命令可安全执行的数据。 */
function validateInput(raw: unknown, approvalId: string): ExecutionInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Input must be a JSON object')
  const data = raw as ReviewedBudget
  const models = data.models?.map((model) => requiredText(model, 'models[]')) ?? []
  const keyAliases = [...new Set(data.keyAliases?.map((alias) => requiredText(alias, 'keyAliases[]')) ?? [])]
  if (!models.length) throw new Error('models must contain at least one model')
  if (!keyAliases.length) throw new Error('keyAliases must contain at least one alias')

  const resetCycle = requiredText(data.budgetResetCycle, 'budgetResetCycle')
  if (!['天', '周', '月'].includes(resetCycle)) throw new Error('budgetResetCycle must be 天、周 or 月')
  const overflowPolicy = requiredText(data.overflowPolicy, 'overflowPolicy')
  if (overflowPolicy !== '禁止调用') {
    throw new Error(
      'Only 禁止调用 is enforceable by LiteLLM project budgets; do not execute 提示升级 or 降级到免费模型'
    )
  }

  return {
    project: requiredText(data.project, 'project'),
    projectId: data.projectId?.trim() || `pinerouter-${approvalId}`,
    teamId: requiredText(data.teamId, 'teamId'),
    projectType: requiredText(data.projectType, 'projectType'),
    description: data.description?.trim() || undefined,
    budget: requiredNumber(data.budget, 'budget'),
    gatewayBudgetUsd: requiredNumber(data.gatewayBudgetUsd, 'gatewayBudgetUsd'),
    budgetStartAt: requiredText(data.budgetStartAt, 'budgetStartAt'),
    budgetEndAt: requiredText(data.budgetEndAt, 'budgetEndAt'),
    budgetResetCycle: resetCycle,
    models,
    overflowPolicy,
    tpm: data.tpm === undefined ? undefined : requiredNumber(data.tpm, 'tpm'),
    rpm: data.rpm === undefined ? undefined : requiredNumber(data.rpm, 'rpm'),
    technicalOwnerOpenId: requiredText(data.technicalOwnerOpenId, 'technicalOwnerOpenId'),
    businessOwnerOpenId: requiredText(data.businessOwnerOpenId, 'businessOwnerOpenId'),
    keyAliases,
  }
}

/** 读取运行密钥；仅在实际写入前调用。 */
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

/** LiteLLM 支持的固定周期表达。月度是 30 天滚动周期，并非自然月。 */
function toBudgetDuration(cycle: string): string {
  return ({ 天: '1d', 周: '7d', 月: '30d' } as Record<string, string>)[cycle]
}

/** 防止未来生效的审批被提前创建 Key，并确保 Key 在结束日后失效。 */
function keyDurationUntil(budgetStartAt: string, budgetEndAt: string): string {
  const today = new Date().toISOString().slice(0, 10)
  if (budgetStartAt > today) throw new Error(`Budget starts on ${budgetStartAt}; execute on or after that date`)
  if (budgetEndAt < today) throw new Error(`Budget ended on ${budgetEndAt}; refusing to create an expired key`)
  const end = new Date(`${budgetEndAt}T23:59:59Z`).getTime()
  return `${Math.max(1, Math.ceil((end - Date.now()) / 86_400_000))}d`
}

/** 拼接网关 URL，避免环境变量末尾斜杠改变请求路径。 */
function gatewayUrl(path: string): string {
  return `${requiredEnv('PINE_ROUTER_BASE_URL').replace(/\/+$/, '')}${path}`
}

/** 请求 JSON API，并把远端失败转换为不含密钥的明确错误。 */
async function requestJson(url: string, init: RequestInit): Promise<Json> {
  const response = await fetch(url, init)
  const body = (await response.json().catch(() => ({}))) as Json
  if (!response.ok || (typeof body.code === 'number' && body.code !== 0)) {
    throw new Error(`Request failed (${response.status}): ${JSON.stringify(body).slice(0, 500)}`)
  }
  return body
}

/** 调用 PineRouter 管理 API，不把 admin key 写入日志或错误。 */
async function gatewayRequest(path: string, method: string, data?: Json): Promise<Json> {
  return requestJson(gatewayUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${requiredEnv('PINE_ROUTER_ADMIN_KEY')}`,
      'Content-Type': 'application/json',
      'litellm-changed-by': process.env.PINE_ROUTER_OPERATOR?.trim() || 'manual-approval-executor',
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
}

/** 读取项目；404 代表可以创建，其他错误必须中止。 */
async function getProject(projectId: string): Promise<Json | undefined> {
  const response = await fetch(`${gatewayUrl('/project/info')}?project_id=${encodeURIComponent(projectId)}`, {
    headers: { Authorization: `Bearer ${requiredEnv('PINE_ROUTER_ADMIN_KEY')}` },
  })
  if (response.status === 404) return undefined
  const body = (await response.json().catch(() => ({}))) as Json
  if (!response.ok) throw new Error(`Project lookup failed (${response.status}): ${JSON.stringify(body).slice(0, 500)}`)
  return body
}

/** 校验已存在项目仍与本次审批一致，避免同一审批 ID 覆盖其他项目。 */
function assertMatchingProject(existing: Json, input: ExecutionInput, approvalId: string): void {
  const project = (existing.data && typeof existing.data === 'object' ? existing.data : existing) as Json
  const metadata = project.metadata && typeof project.metadata === 'object' ? (project.metadata as Json) : {}
  const models = Array.isArray(project.models) ? project.models : []
  const budget = project.litellm_budget_table as Json | undefined
  const sameModels = models.length === input.models.length && input.models.every((model) => models.includes(model))
  if (project.team_id !== input.teamId || !sameModels || metadata.approval_id !== approvalId) {
    throw new Error(`Existing project ${input.projectId} does not match this approved budget`)
  }
  if (budget?.max_budget !== undefined && budget.max_budget !== input.gatewayBudgetUsd) {
    throw new Error(`Existing project ${input.projectId} has a different gatewayBudgetUsd`)
  }
}

/** 创建一次 Project；重跑时只复用与同一审批一致的 project_id，避免重复项目。 */
async function ensureProject(input: ExecutionInput, approvalId: string): Promise<'created' | 'existing'> {
  const existing = await getProject(input.projectId!)
  if (existing) {
    assertMatchingProject(existing, input, approvalId)
    return 'existing'
  }
  await gatewayRequest('/project/new', 'POST', {
    project_id: input.projectId!,
    project_alias: input.project,
    team_id: input.teamId,
    description: input.description,
    models: input.models,
    max_budget: input.gatewayBudgetUsd,
    budget_duration: toBudgetDuration(input.budgetResetCycle),
    ...(input.tpm === undefined ? {} : { tpm_limit: input.tpm }),
    ...(input.rpm === undefined ? {} : { rpm_limit: input.rpm }),
    metadata: { approval_id: approvalId, approval_budget: input.budget },
  })
  return 'created'
}

/** 列出项目现有 Key；真实 Key 值不会出现在该 API 或 Base 写入中。 */
async function listProjectKeyAliases(projectId: string): Promise<Set<string>> {
  const result = await gatewayRequest(
    `/key/list?project_id=${encodeURIComponent(projectId)}&size=100&return_full_object=true`,
    'GET'
  )
  const keys = Array.isArray(result.keys) ? result.keys : []
  return new Set(
    keys
      .map((key) => (key && typeof key === 'object' ? (key as Json).key_alias : undefined))
      .filter((alias): alias is string => typeof alias === 'string')
  )
}

/** 为缺失 alias 创建绑定 Project 的 Virtual Key，并返回只在本次显示的真实 Key。 */
async function ensureKeys(input: ExecutionInput): Promise<Array<{ alias: string; key?: string }>> {
  const existingAliases = await listProjectKeyAliases(input.projectId!)
  const duration = keyDurationUntil(input.budgetStartAt, input.budgetEndAt)
  const created: Array<{ alias: string; key?: string }> = []
  for (const alias of input.keyAliases) {
    if (existingAliases.has(alias)) {
      created.push({ alias })
      continue
    }
    const response = await gatewayRequest('/key/generate', 'POST', {
      key_alias: alias,
      project_id: input.projectId!,
      models: input.models,
      duration,
      ...(input.tpm === undefined ? {} : { tpm_limit: input.tpm }),
      ...(input.rpm === undefined ? {} : { rpm_limit: input.rpm }),
    })
    created.push({ alias, key: typeof response.key === 'string' ? response.key : undefined })
  }
  return created
}

/** 使用 SS Claw 应用身份取得可写目标 Base 的 tenant access token。 */
async function getTenantAccessToken(): Promise<string> {
  const response = await requestJson('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: requiredEnv('SS_CLAW_APP_ID'), app_secret: requiredEnv('SS_CLAW_APP_SECRET') }),
  })
  return requiredText(response.tenant_access_token, 'tenant_access_token')
}

/** 请求飞书 Base API。 */
async function baseRequest(path: string, method: string, token: string, data?: Json): Promise<Json> {
  return requestJson(`https://open.feishu.cn/open-apis/bitable/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
}

/** 读取所有 Base 记录，确保审批实例 ID 查重不受分页影响。 */
async function listBaseRecords(token: string): Promise<Array<{ record_id?: string; fields?: Json }>> {
  const records: Array<{ record_id?: string; fields?: Json }> = []
  let pageToken: string | undefined
  do {
    const query = new URLSearchParams({ page_size: '500', ...(pageToken ? { page_token: pageToken } : {}) })
    const result = await baseRequest(
      `/apps/${BASE_SCHEMA.appToken}/tables/${BASE_SCHEMA.tableId}/records?${query}`,
      'GET',
      token
    )
    const data = (result.data ?? {}) as Json
    records.push(...((Array.isArray(data.items) ? data.items : []) as Array<{ record_id?: string; fields?: Json }>))
    pageToken = data.has_more === true && typeof data.page_token === 'string' ? data.page_token : undefined
  } while (pageToken)
  return records
}

/** 转换为 Base 人员字段的 Open ID 形式。 */
function toUser(openId: string) {
  return [{ id: openId }]
}

/** 创建或更新审批的父记录，再补齐缺失的 Key 子记录。 */
async function upsertBase(input: ExecutionInput, approvalId: string): Promise<string> {
  const token = await getTenantAccessToken()
  const records = await listBaseRecords(token)
  const fields = BASE_SCHEMA.fields
  const parent = records.find((record) => record.fields?.[fields.approvalInstanceId] === approvalId)
  const parentFields: Json = {
    [fields.project]: input.project,
    [fields.projectType]: input.projectType,
    [fields.description]: input.description ?? '',
    [fields.budget]: input.budget,
    [fields.budgetStartAt]: `${input.budgetStartAt} 00:00:00`,
    [fields.budgetEndAt]: `${input.budgetEndAt} 00:00:00`,
    [fields.budgetResetCycle]: input.budgetResetCycle,
    [fields.models]: input.models.join('; '),
    [fields.overflowPolicy]: input.overflowPolicy,
    [fields.technicalOwner]: toUser(input.technicalOwnerOpenId),
    [fields.businessOwner]: toUser(input.businessOwnerOpenId),
    [fields.approvalInstanceId]: approvalId,
    [fields.approvalLink]: `https://www.feishu.cn/approval/approval?instance_code=${encodeURIComponent(approvalId)}`,
    ...(input.tpm === undefined ? {} : { [fields.tpm]: input.tpm }),
    ...(input.rpm === undefined ? {} : { [fields.rpm]: input.rpm }),
  }
  let parentId = parent?.record_id
  if (parentId) {
    await baseRequest(`/apps/${BASE_SCHEMA.appToken}/tables/${BASE_SCHEMA.tableId}/records/${parentId}`, 'PUT', token, {
      fields: parentFields,
    })
  } else {
    const created = await baseRequest(
      `/apps/${BASE_SCHEMA.appToken}/tables/${BASE_SCHEMA.tableId}/records`,
      'POST',
      token,
      { fields: parentFields }
    )
    parentId = ((created.data as Json | undefined)?.record as Json | undefined)?.record_id as string | undefined
    if (!parentId) throw new Error('Base create response does not contain record_id')
  }

  const aliases = new Set(
    records
      .filter(
        (record) =>
          Array.isArray(record.fields?.[fields.parent]) &&
          (record.fields?.[fields.parent] as unknown[]).some(
            (parent) => parent === parentId || (parent as Json)?.record_id === parentId
          )
      )
      .map((record) => record.fields?.[fields.keyAlias])
      .filter((alias): alias is string => typeof alias === 'string')
  )
  for (const alias of input.keyAliases) {
    if (aliases.has(alias)) continue
    await baseRequest(`/apps/${BASE_SCHEMA.appToken}/tables/${BASE_SCHEMA.tableId}/records`, 'POST', token, {
      fields: { [fields.keyAlias]: alias, [fields.parent]: [parentId] },
    })
  }
  return parentId
}

/** 运行人工执行流程：预览，或按 Project → Key → Base 的顺序写入。 */
export async function executeApprovedBudget(options: CliOptions): Promise<void> {
  const source = JSON.parse(await readFile(resolve(options.inputPath), 'utf8')) as unknown
  const input = validateInput(source, options.approvalId)
  const preview = {
    approvalId: options.approvalId,
    projectId: input.projectId,
    teamId: input.teamId,
    projectBudgetUsd: input.gatewayBudgetUsd,
    budgetDuration: toBudgetDuration(input.budgetResetCycle),
    keyDuration: options.execute ? keyDurationUntil(input.budgetStartAt, input.budgetEndAt) : 'calculated at execution',
    keyAliases: input.keyAliases,
    base: 'PineRouter 项目 Key 申请表',
  }
  if (!options.execute) {
    console.log(JSON.stringify({ dryRun: true, ...preview }, null, 2))
    return
  }

  const project = await ensureProject(input, options.approvalId)
  const keys = await ensureKeys(input)
  const baseRecordId = await upsertBase(input, options.approvalId)
  console.log(JSON.stringify({ ...preview, project, baseRecordId, keys }, null, 2))
}

const runsAsScript =
  import.meta.filename === process?.argv?.[1] ||
  (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)

if (runsAsScript) {
  executeApprovedBudget(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
