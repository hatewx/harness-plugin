/** 离职 Key 清理回归测试，全程使用内存模拟接口。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { offboard, ownedKeys, parseCsv, uniqueUserId, type Gateway } from './offboard-user.ts'

test('分页搜索覆盖所有包含 userid 的归属字段', async () => {
  const pages = [
    { keys: [{ token: 'a', user_id: 'u' }, { token: 'b', user_id: 'ss:u' }], total_pages: 2 },
    { keys: [{ token: 'c', user_id: 'u-other' }, { token: 'd', user_id: 'other' }], total_pages: 2 },
  ]
  assert.deepEqual([...(await ownedKeys('u', async () => pages.shift()!)).keys()], ['a', 'b', 'c'])
})

test('默认预览只有读请求', async () => {
  const calls: unknown[] = []
  const gateway: Gateway = async (_, data) => {
    calls.push(data)
    return { keys: [{ token: 'a', user_id: 'u' }], total_pages: 1 }
  }
  await offboard('u', gateway)
  assert.deepEqual(calls, [undefined])
})

test('删除后重新查询', async () => {
  const calls: unknown[][] = []
  const gateway: Gateway = async (route, data) => {
    calls.push([route, data])
    return { keys: calls.length === 1 ? [{ token: 'a', user_id: 'u' }] : [], total_pages: 1 }
  }
  await offboard('u', gateway, true)
  assert.deepEqual(calls[1], ['/key/delete', { keys: ['a'] }])
  assert.equal(calls.length, 3)
})

test('HTTP 成功但有残留时失败', async () => {
  await assert.rejects(offboard('u', async () => ({ keys: [{ token: 'a', user_id: 'u' }], total_pages: 1 }), true), /仍有/)
})

test('不按 metadata 单独推测归属', async () => {
  const keys = await ownedKeys('u', async () => ({
    keys: [{ token: 'a', user_id: 'v', metadata: { owner_user_id: 'u' } }], total_pages: 1,
  }))
  assert.equal(keys.size, 0)
})

test('查不到或同名多 UUID 时失败', () => {
  for (const ids of [[], ['u', 'v']]) assert.throws(() => uniqueUserId(ids), /匹配到/)
})

test('拒绝异常分页及非完整对象', async () => {
  for (const response of [{ keys: [] }, { keys: ['secret'], total_pages: 1 }]) {
    await assert.rejects(ownedKeys('u', async () => response))
  }
})

test('CSV 支持中文、转义引号及换行', () => {
  assert.deepEqual(parseCsv('"uuid","showname","phone"\r\n"u","张""三\n姓名","123"\r\n'), [
    ['uuid', 'showname', 'phone'], ['u', '张"三\n姓名', '123'],
  ])
  assert.throws(() => parseCsv('"未闭合'), /未闭合/)
})

test('超过一批时全部删除并复查', async () => {
  const batches: number[] = []
  let deleted = false
  const gateway: Gateway = async (route, data) => {
    if (data) {
      batches.push((data.keys as string[]).length)
      deleted = batches.length === 2
      return {}
    }
    const page = new URL(route, 'https://example.invalid').searchParams.get('page')
    return {
      keys: deleted ? [] : Array.from({ length: page === '1' ? 100 : 1 }, (_, index) => ({ token: `${page}-${index}`, user_id: 'u' })),
      total_pages: deleted ? 0 : 2,
    }
  }
  await offboard('u', gateway, true)
  assert.deepEqual(batches, [100, 1])
})

test('显式开启子串搜索，避免默认精确匹配漏掉 ss 前缀', async () => {
  const gateway: Gateway = async (route) => {
    const query = new URL(route, 'https://example.invalid').searchParams
    assert.equal(query.get('user_id'), 'userid')
    assert.equal(query.get('substring_matching'), 'true')
    return { keys: [{ token: 'a', user_id: 'ss:userid' }], total_pages: 1 }
  }
  assert.equal((await ownedKeys('userid', gateway)).size, 1)
})
