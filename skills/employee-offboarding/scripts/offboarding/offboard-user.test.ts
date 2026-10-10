/** 总离职与 Cursor 回归测试，全程模拟接口，不修改真实账号或表格。 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { activeMember, employeeFromResponse, normalizeEmail, removeCursorMember, type Cursor, type Lark } from './cursor.ts'
import { loadLocalEnvFile } from './env.ts'
import { findPineRouterUserId, resolveOffboardingUser, runOffboarding } from './offboard-user.ts'
import type { Gateway } from '../pinerouter/offboard-user.ts'

/** 构造飞书 CLI 的真实矩阵格式，覆盖字段顺序变化。 */
function record(status = '有效', name = '测试员工') {
  return { field_id_list: ['fld1wK0tf1', 'fldUyKVDhr', 'fldL9KauoN'],
    record_id_list: ['rec-test'], data: [['[User@Example.com](http://User@Example.com)', [status], name]], has_more: false }
}

/** 创建记录所有写入步骤的内存接口。 */
function fixture(options: { cursorFails?: boolean; removalFails?: boolean; pineFails?: boolean; statusFails?: boolean;
  missingEmployee?: boolean } = {}) {
  const writes: string[] = []
  let status = '有效', removed = false, keyDeleted = false
  const lark: Lark = async (args) => {
    if (args[0] === '+field-list') return { fields: [
      { id: 'fldL9KauoN', name: 'Name', type: 'text' }, { id: 'fld1wK0tf1', name: 'Email', type: 'text' },
      { id: 'fldUyKVDhr', name: '状态', type: 'select', multiple: false, options: [{ name: '已离职' }] },
    ] }
    if (args[0] === '+record-upsert') {
      writes.push('status')
      assert.deepEqual(JSON.parse(args[args.indexOf('--json') + 1]), { fldUyKVDhr: '已离职' })
      if (!options.statusFails) status = '已离职'
      return { updated: true }
    }
    if (options.missingEmployee && args[0] === '+record-search') {
      return { field_id_list: ['fld1wK0tf1', 'fldUyKVDhr', 'fldL9KauoN'], record_id_list: [], data: [], has_more: false }
    }
    return record(status)
  }
  const cursor: Cursor = async (route, data) => {
    if (options.cursorFails) throw new Error('Cursor HTTP 401')
    if (route === '/teams/remove-member') {
      assert.deepEqual(data, { email: 'user@example.com' })
      writes.push('cursor')
      removed = !options.removalFails
      return { success: true }
    }
    return { teamMembers: [{ id: 'user-test', email: 'user@example.com', isRemoved: removed }] }
  }
  const gateway: Gateway = async (_, data) => {
    if (_.startsWith('/user/list')) return { users: [], total_pages: 1 }
    if (data) {
      writes.push('pine')
      if (options.pineFails) throw new Error('PineRouter 失败')
      keyDeleted = true
      return {}
    }
    return { keys: keyDeleted ? [] : [{ token: 'hash', user_id: 'ss:uuid-test' }], total_pages: 1 }
  }
  return { writes, deps: { lark, cursor, gateway, resolveUser: async () => 'uuid-test' } }
}

test('邮箱解析保留地址并规范化大小写', () => {
  assert.equal(normalizeEmail('[User@Example.com](http://User@Example.com)'), 'user@example.com')
  assert.throws(() => normalizeEmail('错误邮箱'))
  const employee = employeeFromResponse(record())
  assert.ok(employee)
  assert.equal(employee.name, '测试员工')
})

test('.env.local 覆盖终端中的同名环境变量', () => {
  const directory = mkdtempSync(join(tmpdir(), 'offboarding-env-'))
  const path = join(directory, '.env.local')
  const original = process.env.OFFBOARD_ENV_PRIORITY_TEST
  try {
    process.env.OFFBOARD_ENV_PRIORITY_TEST = 'shell-value'
    writeFileSync(path, 'OFFBOARD_ENV_PRIORITY_TEST=local-value\n')
    loadLocalEnvFile(path)
    assert.equal(process.env.OFFBOARD_ENV_PRIORITY_TEST, 'local-value')
  } finally {
    original === undefined ? delete process.env.OFFBOARD_ENV_PRIORITY_TEST : process.env.OFFBOARD_ENV_PRIORITY_TEST = original
    rmSync(directory, { recursive: true, force: true })
  }
})

test('多条记录或未读完时拒绝定位', () => {
  assert.equal(employeeFromResponse({ ...record(), record_id_list: [], data: [] }), undefined)
  assert.throws(() => employeeFromResponse({ ...record(), has_more: true }))
  assert.throws(() => employeeFromResponse({ ...record(), record_id_list: ['a', 'b'] }))
})

test('Cursor 账号表无记录时只处理 PineRouter', async () => {
  const { writes, deps } = fixture({ missingEmployee: true })
  await runOffboarding('未开通员工', true, deps)
  assert.deepEqual(writes, ['pine'])
})

test('Soulforge 无在职记录时改用唯一历史映射', async () => {
  const calls: boolean[] = []
  const userid = await resolveOffboardingUser({ username: '离职员工', mapping: 'mapping.csv' }, async (args) => {
    calls.push(!!args.localMapping)
    if (!args.localMapping) throw new Error('匹配到 0 个 userid，请核对后使用 --userid 指定')
    return 'historical-userid'
  })
  assert.equal(userid, 'historical-userid')
  assert.deepEqual(calls, [false, true])
})

test('所有身份源均无记录时视为未开通 PineRouter', async () => {
  const { writes, deps } = fixture({ missingEmployee: true })
  deps.resolveUser = async () => { throw new Error('匹配到 0 个 userid，请核对后使用 --userid 指定') }
  await runOffboarding('未开通员工', true, deps)
  assert.deepEqual(writes, [])
})

test('PineRouter 用户表身份反查要求唯一精确匹配', async () => {
  const gateway: Gateway = async () => ({ users: [
    { user_id: 'matched', user_alias: '目标员工', user_email: 'target@example.com' },
    { user_id: 'ignored', user_alias: '其他员工', user_email: 'other@example.com' },
  ], total_pages: 1 })
  assert.equal(await findPineRouterUserId('目标员工', undefined, gateway), 'matched')
  assert.equal(await findPineRouterUserId('不存在', undefined, gateway), undefined)
})

test('默认预览不执行任何写入', async () => {
  const { writes, deps } = fixture()
  await runOffboarding('测试员工', false, deps)
  assert.deepEqual(writes, [])
})

test('总流程按 PineRouter、Cursor、飞书状态顺序执行', async () => {
  const { writes, deps } = fixture()
  await runOffboarding('测试员工', true, deps)
  assert.deepEqual(writes, ['pine', 'cursor', 'status'])
})

test('Cursor 认证失败在所有写入之前终止', async () => {
  const { writes, deps } = fixture({ cursorFails: true })
  await assert.rejects(runOffboarding('测试员工', true, deps), /401/)
  assert.deepEqual(writes, [])
})

test('PineRouter 删除失败不继续操作 Cursor 或表格', async () => {
  const { writes, deps } = fixture({ pineFails: true })
  await assert.rejects(runOffboarding('测试员工', true, deps), /PineRouter/)
  assert.deepEqual(writes, ['pine'])
})

test('Cursor 移除后仍有效时不回写状态', async () => {
  const { writes, deps } = fixture({ removalFails: true })
  await assert.rejects(runOffboarding('测试员工', true, deps), /仍然有效/)
  assert.deepEqual(writes, ['pine', 'cursor'])
})

test('状态写入未生效不能报告成功', async () => {
  const { deps } = fixture({ statusFails: true })
  await assert.rejects(runOffboarding('测试员工', true, deps), /未生效/)
})

test('已经移除的成员不再发送移除请求', async () => {
  const routes: string[] = []
  const cursor: Cursor = async (route) => {
    routes.push(route)
    return { teamMembers: [{ email: 'user@example.com', isRemoved: true }] }
  }
  await removeCursorMember('user@example.com', cursor)
  assert.deepEqual(routes, ['/teams/members'])
})

test('相同邮箱的多个有效成员阻止操作', async () => {
  await assert.rejects(activeMember('user@example.com', async () => ({
    teamMembers: [{ email: 'user@example.com' }, { email: 'user@example.com' }],
  })), /多个/)
})

test('员工身份在执行前改变时停止写入', async () => {
  const { writes, deps } = fixture()
  const original = deps.lark
  deps.lark = async (args) => args[0] === '+record-get' ? record('有效', '其他员工') : original(args)
  await assert.rejects(runOffboarding('测试员工', true, deps), /已变更/)
  assert.deepEqual(writes, [])
})
