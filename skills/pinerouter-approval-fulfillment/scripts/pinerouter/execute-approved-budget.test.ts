/** 验证人工审批执行命令的无写入预览与输入安全边界。 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { executeApprovedBudget } from './execute-approved-budget'

const input = {
  project: '模型评测',
  teamId: 'existing-team',
  projectType: '技术项目',
  budget: 3000,
  gatewayBudgetUsd: 420,
  budgetStartAt: '2026-08-01',
  budgetEndAt: '2026-08-31',
  budgetResetCycle: '月',
  models: ['gpt-5.5'],
  overflowPolicy: '禁止调用',
  technicalOwnerOpenId: 'ou_tech',
  businessOwnerOpenId: 'ou_tech',
  keyAliases: ['eval-api'],
}

/** 在临时文件中运行预览，确保它不依赖外部密钥。 */
async function runDryRun(data: object): Promise<Record<string, unknown>> {
  const directory = await mkdtemp(join(tmpdir(), 'pinerouter-budget-'))
  const file = join(directory, 'budget.json')
  const output: string[] = []
  const log = console.log
  try {
    await writeFile(file, JSON.stringify(data))
    console.log = (message: string) => output.push(message)
    await executeApprovedBudget({ approvalId: 'approval-1', inputPath: file, execute: false })
    return JSON.parse(output.join('\n')) as Record<string, unknown>
  } finally {
    console.log = log
    await rm(directory, { recursive: true, force: true })
  }
}

test('previews a reviewed budget without writing external resources', async () => {
  const preview = await runDryRun(input)
  assert.equal(preview.dryRun, true)
  assert.equal(preview.projectId, 'pinerouter-approval-1')
  assert.deepEqual(preview.keyAliases, ['eval-api'])
})

test('rejects an overflow policy that LiteLLM cannot enforce', async () => {
  await assert.rejects(runDryRun({ ...input, overflowPolicy: '降级到免费模型' }), /Only 禁止调用 is enforceable/)
})

test('creates a Project and Key, then writes Base parent and children', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pinerouter-budget-'))
  const file = join(directory, 'budget.json')
  const originalFetch = globalThis.fetch
  const originalEnv = { ...process.env }
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = []
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const log = console.log
  const output: string[] = []
  try {
    await writeFile(file, JSON.stringify({ ...input, budgetStartAt: today, budgetEndAt: tomorrow }))
    Object.assign(process.env, {
      PINE_ROUTER_BASE_URL: 'https://gateway.test',
      PINE_ROUTER_ADMIN_KEY: 'admin-key',
      SS_CLAW_APP_ID: 'app-id',
      SS_CLAW_APP_SECRET: 'app-secret',
    })
    globalThis.fetch = async (url, init) => {
      const requestUrl = String(url)
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
      requests.push({ url: requestUrl, body })
      if (requestUrl.includes('/project/info')) return new Response('{}', { status: 404 })
      if (requestUrl.endsWith('/project/new')) return new Response('{}')
      if (requestUrl.includes('/key/list')) return Response.json({ keys: [] })
      if (requestUrl.endsWith('/key/generate')) return Response.json({ key: 'sk-test-key' })
      if (requestUrl.endsWith('/tenant_access_token/internal')) {
        return Response.json({ code: 0, tenant_access_token: 'tenant-token' })
      }
      if (requestUrl.includes('/records?page_size=500')) {
        return Response.json({ code: 0, data: { items: [], has_more: false } })
      }
      if (requestUrl.endsWith('/records')) {
        const creates = requests.filter((request) => request.url.endsWith('/records'))
        return Response.json({ code: 0, data: { record: { record_id: `record-${creates.length}` } } })
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    }
    console.log = (message: string) => output.push(message)
    await executeApprovedBudget({ approvalId: 'approval-1', inputPath: file, execute: true })

    const project = requests.find((request) => request.url.endsWith('/project/new'))
    assert.equal(project?.body?.project_id, 'pinerouter-approval-1')
    assert.equal(project?.body?.max_budget, 420)
    assert.deepEqual(project?.body?.models, ['gpt-5.5'])
    assert.deepEqual(project?.body?.metadata, { approval_id: 'approval-1', approval_budget: 3000 })
    const key = requests.find((request) => request.url.endsWith('/key/generate'))
    assert.equal(key?.body?.project_id, 'pinerouter-approval-1')
    assert.equal(key?.body?.key_alias, 'eval-api')
    const baseCreates = requests.filter((request) => request.url.endsWith('/records'))
    assert.equal(baseCreates.length, 2)
    assert.equal(JSON.parse(output.join('\n')).keys[0].key, 'sk-test-key')
  } finally {
    globalThis.fetch = originalFetch
    console.log = log
    for (const key of Object.keys(process.env)) delete process.env[key]
    Object.assign(process.env, originalEnv)
    await rm(directory, { recursive: true, force: true })
  }
})
