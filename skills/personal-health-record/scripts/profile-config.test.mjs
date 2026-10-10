/**
 * Verifies user-level personal health record configuration behavior.
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  readStatus,
  saveProfilePath,
} from './profile-config.mjs'


/** Creates an isolated temporary directory for one test. */
async function createFixture() {
  return mkdtemp(path.join(os.tmpdir(), 'personal-health-record-test-'))
}


test('rejects a missing profile unless creation is explicit', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture, { recursive: true, force: true }))

  await assert.rejects(
    saveProfilePath(path.join(fixture, 'config.json'), path.join(fixture, 'missing'), false),
    /健康档案目录不存在/,
  )
})


test('creates and stores a profile only when requested', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture, { recursive: true, force: true }))
  const configFile = path.join(fixture, 'config', 'config.json')
  const profilePath = path.join(fixture, '健康档案')

  const storedPath = await saveProfilePath(configFile, profilePath, true)
  const config = JSON.parse(await readFile(configFile, 'utf8'))

  assert.equal(storedPath, profilePath)
  assert.equal(config.profile_path, profilePath)
  assert.equal((await readStatus(configFile)).status, 'ready')
})


test('reports a configured profile that later disappears', async (context) => {
  const fixture = await createFixture()
  context.after(() => rm(fixture, { recursive: true, force: true }))
  const configFile = path.join(fixture, 'config.json')
  const profilePath = path.join(fixture, '健康档案')
  await saveProfilePath(configFile, profilePath, true)
  await rmdir(profilePath)

  const result = await readStatus(configFile)

  assert.equal(result.status, 'missing-profile')
  assert.equal(result.profile_path, profilePath)
})
