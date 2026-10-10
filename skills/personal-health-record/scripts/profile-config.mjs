/**
 * Manages the user-level path for a local personal health record.
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'


const CONFIG_VERSION = 1


/** Expands a leading home marker and returns an absolute path. */
function resolveUserPath(value) {
  const expanded = value === '~'
    ? os.homedir()
    : value.startsWith('~/')
      ? path.join(os.homedir(), value.slice(2))
      : value
  return path.resolve(expanded)
}


/** Returns whether a path exists and is a directory. */
async function isDirectory(targetPath) {
  try {
    return (await stat(targetPath)).isDirectory()
  } catch {
    return false
  }
}


/** Returns the per-user configuration file without creating it. */
export function defaultConfigFile() {
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(configRoot, 'personal-health-record', 'config.json')
}


/** Describes whether configuration and the selected profile are usable. */
export async function readStatus(configFile) {
  let payload
  try {
    payload = JSON.parse(await readFile(configFile, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { status: 'no-config', config_file: configFile }
    }
    return {
      status: 'invalid-config',
      config_file: configFile,
      error: error.message,
    }
  }

  if (typeof payload.profile_path !== 'string') {
    return {
      status: 'invalid-config',
      config_file: configFile,
      error: '缺少 profile_path',
    }
  }

  const profilePath = resolveUserPath(payload.profile_path)
  return {
    status: await isDirectory(profilePath) ? 'ready' : 'missing-profile',
    config_file: configFile,
    profile_path: profilePath,
  }
}


/** Validates and persists an absolute profile path after explicit selection. */
export async function saveProfilePath(configFile, profilePath, create) {
  const resolvedPath = resolveUserPath(profilePath)
  create && await mkdir(resolvedPath, { recursive: true })

  if (!await isDirectory(resolvedPath)) {
    throw new Error(`健康档案目录不存在：${resolvedPath}`)
  }

  await mkdir(path.dirname(configFile), { recursive: true })
  const temporaryFile = `${configFile}.tmp`
  const payload = {
    version: CONFIG_VERSION,
    profile_path: resolvedPath,
  }
  await writeFile(temporaryFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(temporaryFile, configFile)
  return resolvedPath
}


/** Parses the intentionally small dependency-free command-line interface. */
function parseArguments(argv) {
  const args = [...argv]
  let configFile = defaultConfigFile()
  const configIndex = args.indexOf('--config-file')
  if (configIndex >= 0) {
    const configuredFile = args[configIndex + 1]
    if (!configuredFile) throw new Error('--config-file 缺少路径')
    configFile = resolveUserPath(configuredFile)
    args.splice(configIndex, 2)
  }

  const [command, profilePath, ...options] = args
  if (!['status', 'set'].includes(command)) {
    throw new Error('用法：profile-config.mjs [--config-file 路径] status | set <档案路径> [--create]')
  }
  if (command === 'set' && !profilePath) throw new Error('set 命令缺少档案路径')
  if (options.some((option) => option !== '--create')) throw new Error('存在未知参数')

  return {
    command,
    configFile,
    profilePath,
    create: options.includes('--create'),
  }
}


/** Runs the selected configuration command and returns a stable exit code. */
async function main() {
  try {
    const args = parseArguments(process.argv.slice(2))
    if (args.command === 'set') {
      const profilePath = await saveProfilePath(args.configFile, args.profilePath, args.create)
      console.log(JSON.stringify({ status: 'ready', profile_path: profilePath }))
      return 0
    }

    const result = await readStatus(args.configFile)
    console.log(JSON.stringify(result))
    return {
      ready: 0,
      'no-config': 1,
      'missing-profile': 2,
      'invalid-config': 3,
    }[result.status]
  } catch (error) {
    console.error(JSON.stringify({ status: 'error', error: error.message }))
    return 2
  }
}


if (import.meta.filename === process?.argv?.[1]) {
  process.exitCode = await main()
}
