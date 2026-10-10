/** 离职脚本的本地环境配置加载器，确保仓库配置覆盖终端残留变量。 */
import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

/** 加载本地环境文件，并以文件内配置覆盖当前进程中的同名变量。 */
export function loadLocalEnvFile(path = '.env.local'): void {
  existsSync(path) && Object.assign(process.env, parseEnv(readFileSync(path, 'utf8')))
}
