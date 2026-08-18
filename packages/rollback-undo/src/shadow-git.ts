/** Private shadow-Git snapshots for one supported workspace. */

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { z } from 'zod'
import type { ConversationUndoTree } from './types.ts'

/** Paths above this many keep the command line inside the Windows limit; larger change sets fall back to a full checkout. */
const MAX_RESTORE_PATHS = 400

/** Execute Git with the journal-owned directory and index, never the user's index. */async function git(
  workspace: string,
  shadowGit: string,
  args: readonly string[],
  options: { readonly shadow?: boolean } = {},
): Promise<string> {
  return await new Promise<string>((resolveResult, reject) => {
    const child = spawn('git', [...args], {
      cwd: workspace,
      windowsHide: true,
      env: options.shadow === false
        ? process.env
        : {
            ...process.env,
            GIT_DIR: shadowGit,
            GIT_WORK_TREE: workspace,
            GIT_INDEX_FILE: `${shadowGit}/index`,
          },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk) })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveResult(Buffer.concat(stdout).toString('utf8'))
        return
      }
      reject(new Error(`conversation-undo: git ${args.join(' ')} failed (${signal ?? code}): ${Buffer.concat(stderr).toString('utf8').trim()}`))
    })
  })
}

/** Ensure a candidate path stays below the workspace root. */
function workspacePath(workspace: string, path: string): string {
  const root = resolve(workspace)
  const target = resolve(root, path)
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`conversation-undo: Git returned a path outside the workspace: ${path}`)
  }
  return target
}

/** Reject non-worktree paths before an operation can restore files.
 * @param workspace - Candidate worktree root.
 * @returns Resolution only for a supported non-bare, submodule-free worktree.
 */
export async function assertSupportedWorkspace(workspace: string): Promise<void> {
  const result = await new Promise<string>((resolveResult, reject) => {
    const child = spawn('git', ['rev-parse', '--is-inside-work-tree', '--is-bare-repository'], {
      cwd: workspace,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const out: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => { out.push(chunk) })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolveResult(Buffer.concat(out).toString('utf8').trim())
      : reject(new Error(`conversation-undo: '${workspace}' is not a Git worktree`)))
  })
  if (result !== 'true\nfalse') {
    throw new Error(`conversation-undo: '${workspace}' is not a normal Git worktree`)
  }
  const entries = await git(workspace, '', ['ls-files', '--stage'], { shadow: false })
  if (entries.split('\n').some(entry => entry.startsWith('160000 '))) {
    throw new Error(`conversation-undo: '${workspace}' contains submodules`)
  }
}

/** Per-journal Git repository holding trees without touching user refs, commits, or index. */
export class ShadowGit {
  constructor(
    private readonly workspace: string,
    private readonly shadowGit: string,
  ) {}  /** Create a tree from all Git-supported workspace paths.
   * @returns Private Git tree id for all supported workspace paths.
   */
  async capture(): Promise<ConversationUndoTree> {
    await this.ensure()
    await git(this.workspace, this.shadowGit, ['add', '--all', '--', '.'])
    const tree = (await git(this.workspace, this.shadowGit, ['write-tree'])).trim()
    if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error('conversation-undo: Git returned an invalid tree id')
    return tree as ConversationUndoTree
  }

  /** Restore an exact tree, deleting only paths captured in `from` but absent from `target`.
   * @param target - Private tree to materialize.
   * @param from - Prior private tree defining removable captured paths.
   */
  async restore(target: ConversationUndoTree, from: ConversationUndoTree): Promise<void> {
    await this.ensure()
    // One name-status diff names every changed path and its direction: 'D'
    // marks paths the target no longer carries (removed from the worktree),
    // every other status (A/M/T) marks paths present in the target. With
    // --no-renames each entry is a single path, so the -z stream is a flat
    // status/path pair list and no separate full-target tree listing is
    // needed to decide removal versus materialization.
    const changed = await git(this.workspace, this.shadowGit, [
      'diff-tree', '-r', '-z', '--no-renames', '--no-commit-id', '--name-status', String(from), String(target),
    ])
    const tokens = changed.split('\0')
    const deletions: string[] = []
    const updates: string[] = []
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const status = tokens[i]
      const path = tokens[i + 1]
      if (status === undefined || path === undefined || path === '') continue
      if (status === 'D') deletions.push(path)
      else updates.push(path)
    }
    for (const path of deletions) {
      await this.removeCapturedPath(path)
    }
    await git(this.workspace, this.shadowGit, ['read-tree', String(target)])
    // Materialize only the changed paths instead of the whole worktree:
    // checkout-index --all rewrites every tracked file, which dominates the
    // restore cost on large workspaces. Fall back to the full checkout when
    // the change set would exceed the Windows command-line length limit.
    if (updates.length === 0) return
    await git(this.workspace, this.shadowGit, updates.length > MAX_RESTORE_PATHS
      ? ['checkout-index', '--all', '--force']
      : ['checkout-index', '--force', '--', ...updates])
  }

  /** Check whether the worktree exactly matches one private tree, without capturing it.
   * @param tree - Private tree to compare the worktree against.
   * @returns Whether every tracked path matches and no untracked path exists.
   */
  async verifyMatches(tree: ConversationUndoTree): Promise<boolean> {
    await this.ensure()
    try {
      // git diff refreshes the index stat cache internally, so a warm index
      // (previously refreshed) compares in O(changed files) instead of a
      // full-worktree stat pass.
      await git(this.workspace, this.shadowGit, ['diff', '--quiet', String(tree)])
    } catch {
      return false
    }
    const untracked = await git(this.workspace, this.shadowGit, ['ls-files', '-o', '--exclude-standard'])
    return untracked.length === 0
  }

  /** Refresh the index stat cache so a later {@link verifyMatches} skips the full-worktree stat pass. */
  async refreshStats(): Promise<void> {
    await this.ensure()
    await git(this.workspace, this.shadowGit, ['update-index', '--refresh'])
  }

  private async ensure(): Promise<void> {
    await mkdir(dirname(this.shadowGit), { recursive: true })
    try {
      await stat(`${this.shadowGit}/config`)
    } catch {
      await mkdir(this.shadowGit, { recursive: true })
      await git(this.workspace, this.shadowGit, ['init', '--bare', this.shadowGit], { shadow: false })
      await git(this.workspace, this.shadowGit, ['config', 'core.bare', 'false'])
      await git(this.workspace, this.shadowGit, ['config', 'core.autocrlf', 'false'])
      // Cache untracked-directory scans and split the index so repeated
      // captures skip most of the full-worktree stat pass (measured ~6s to
      // ~0.3s on a 7400-file workspace). Both are private to this shadow
      // repository; the user's repo and index are untouched.
      await git(this.workspace, this.shadowGit, ['config', 'core.untrackedCache', 'true'])
      await git(this.workspace, this.shadowGit, ['config', 'core.splitIndex', 'true'])
    }
  }

  private async removeCapturedPath(path: string): Promise<void> {
    const target = workspacePath(this.workspace, path)
    try {
      const info = await lstat(target)
      if (info.isDirectory() && !info.isSymbolicLink()) {
        await rm(target, { recursive: true, force: true })
      } else {
        await rm(target, { force: true })
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/** Atomically replace a JSON record in the plugin-owned data directory.
 * @param path - Plugin-owned JSON target path.
 * @param value - JSON-serializable record to replace atomically.
 */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await renameWithRetry(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/** Retry `rename` on transient Windows locks (Defender, file indexers). */
async function renameWithRetry(from: string, to: string, retries = 5): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt < retries && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        await new Promise<void>(resolve => { setTimeout(resolve, 100 * (attempt + 1)) })
        continue
      }
      throw error
    }
  }
}

/** Read one optional JSON record from the plugin-owned data directory.
 * @param path - Plugin-owned JSON record path.
 * @param schema - Durable-boundary validator.
 * @returns Parsed record, or `undefined` when absent.
 */
export async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Encode one opaque id as one portable data-directory component.
 * @param value - Opaque identifier.
 * @returns Portable data-directory component.
 */
export function dataComponent(value: string): string {
  return encodeURIComponent(value)
}
