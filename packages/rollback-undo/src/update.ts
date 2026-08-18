/** Self-update orchestration for the plugin workspace (pull, install, rebuild). */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Wall-clock ceilings per step; a hung step aborts the update instead of blocking the host. */
const REV_TIMEOUT_MS = 30_000
const PULL_TIMEOUT_MS = 120_000
const INSTALL_TIMEOUT_MS = 300_000
const BUILD_TIMEOUT_MS = 600_000

/** Locate the plugin workspace root: this module sits at
 * `<root>/packages/rollback-undo/<src|lib>/update.<ts|js>`, three levels below
 * the root under both the source and built layouts.
 * @returns Absolute path of the installable plugin workspace.
 * @throws When the expected marker file is absent (unexpected install layout).
 */
export function pluginWorkspaceRoot(): string {
  const candidate = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  if (!existsSync(resolve(candidate, 'pnpm-workspace.yaml'))) {
    throw new Error(`无法定位插件工作区根目录(期望 ${candidate} 含 pnpm-workspace.yaml)。`)
  }
  return candidate
}

/** Run one update step through the shell (pnpm resolves to pnpm.cmd on Windows).
 * @param cwd - Directory the command runs in.
 * @param command - Executable name without shell metacharacters.
 * @param args - Argument list without shell metacharacters.
 * @param timeoutMs - Kill the child after this long.
 * @returns The command's stdout.
 */
function run(cwd: string, command: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise<string>((resolveResult, reject) => {
    const child = spawn(command, [...args], { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => { child.kill() }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) {
        resolveResult(Buffer.concat(stdout).toString('utf8'))
        return
      }
      reject(new Error(`${command} ${args.join(' ')} 失败(${signal ?? code}):${Buffer.concat(stderr).toString('utf8').trim()}`))
    })
  })
}

/** Outcome of one fast-forward pull. */
export interface PullOutcome {
  readonly before: string
  readonly after: string
  readonly changed: boolean
}

/** Fast-forward the workspace and report whether HEAD moved.
 * @param root - Plugin workspace root (a git checkout).
 * @returns HEAD ids before and after the pull.
 * @throws With git's stderr when the pull is rejected or the directory is not a checkout.
 */
export async function pullFastForward(root: string): Promise<PullOutcome> {
  const before = (await run(root, 'git', ['rev-parse', 'HEAD'], REV_TIMEOUT_MS)).trim()
  await run(root, 'git', ['pull', '--ff-only'], PULL_TIMEOUT_MS)
  const after = (await run(root, 'git', ['rev-parse', 'HEAD'], REV_TIMEOUT_MS)).trim()
  return { before, after, changed: after !== before }
}

/** Pull, install, and rebuild the plugin workspace in one transaction-shaped pass.
 * @param root - Plugin workspace root (a git checkout).
 * @returns User-facing summary text (already up to date, or updated and rebuilt).
 * @throws With a user-facing message at the first failing step.
 */
export async function performPluginUpdate(root: string): Promise<string> {
  let outcome: PullOutcome
  try {
    outcome = await pullFastForward(root)
  } catch (error) {
    throw new Error(`更新失败:拉取最新代码未成功(${root})。${error instanceof Error ? error.message : String(error)}`)
  }
  const range = `${outcome.before.slice(0, 7)}→${outcome.after.slice(0, 7)}`
  if (!outcome.changed) return `已是最新版本(${outcome.after.slice(0, 7)}),无需更新。`
  try {
    await run(root, 'pnpm', ['install'], INSTALL_TIMEOUT_MS)
  } catch (error) {
    throw new Error(`已拉取 ${range},但依赖安装失败,请手动执行 pnpm install。${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    await run(root, 'pnpm', ['run', 'build'], BUILD_TIMEOUT_MS)
  } catch (error) {
    throw new Error(`已拉取 ${range},但构建失败,请手动执行 pnpm run build。${error instanceof Error ? error.message : String(error)}`)
  }
  return `已更新 ${range} 并重新构建。请重启 dsh 使新版本生效。`
}
