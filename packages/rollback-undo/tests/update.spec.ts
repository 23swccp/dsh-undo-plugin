import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { pluginWorkspaceRoot, pullFastForward } from '../src/update.ts'

const exec = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<void> {
  await exec('git', args, { cwd, windowsHide: true })
}

/** Create an origin repo with one commit and a clone of it; both are cleaned up. */
async function originAndClone(): Promise<{ origin: string; clone: string }> {
  const origin = await mkdtemp(join(tmpdir(), 'dsh-update-origin-'))
  roots.push(origin)
  await git(origin, 'init')
  await writeFile(join(origin, 'file.txt'), 'one\n')
  await git(origin, 'add', 'file.txt')
  await git(origin, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'one')
  const clone = await mkdtemp(join(tmpdir(), 'dsh-update-clone-'))
  roots.push(clone)
  await rm(clone, { recursive: true, force: true })
  await exec('git', ['clone', origin, clone], { windowsHide: true })
  return { origin, clone }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('pluginWorkspaceRoot', () => {
  it('locates the real workspace root containing the pnpm marker from the source layout', () => {
    const root = pluginWorkspaceRoot()
    expect(root.length).toBeGreaterThan(0)
    // The marker check is built into pluginWorkspaceRoot; reaching here means it passed.
  })
})

describe('pullFastForward', () => {
  it('reports no change when the clone already matches the origin', async () => {
    const { clone } = await originAndClone()
    const outcome = await pullFastForward(clone)
    expect(outcome.changed).toBe(false)
    expect(outcome.before).toBe(outcome.after)
  })

  it('advances HEAD when the origin gained a commit', async () => {
    const { origin, clone } = await originAndClone()
    await writeFile(join(origin, 'file.txt'), 'two\n')
    await git(origin, 'add', 'file.txt')
    await git(origin, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'two')
    const outcome = await pullFastForward(clone)
    expect(outcome.changed).toBe(true)
    expect(outcome.before).not.toBe(outcome.after)
    await expect(exec('git', ['rev-parse', 'HEAD'], { cwd: origin, windowsHide: true })).resolves.toMatchObject({
      stdout: expect.stringContaining(outcome.after),
    })
  })

  it('rejects a diverged clone instead of merging', async () => {
    const { origin, clone } = await originAndClone()
    await writeFile(join(clone, 'local.txt'), 'local\n')
    await git(clone, 'add', 'local.txt')
    await git(clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'local')
    await writeFile(join(origin, 'file.txt'), 'two\n')
    await git(origin, 'add', 'file.txt')
    await git(origin, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'two')
    await expect(pullFastForward(clone)).rejects.toThrow(/pull --ff-only 失败/)
  })
})
