import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertSupportedWorkspace, ShadowGit } from '../src/shadow-git.ts'

const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile('git', args, { cwd, windowsHide: true }, error => {
      if (error === null) resolve()
      else reject(error)
    })
    child.once('error', reject)
  })
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-conversation-undo-'))
  roots.push(root)
  await git(root, 'init')
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('ShadowGit', () => {
  it('restores captured paths while leaving ignored paths outside the snapshot', async () => {
    const root = await workspace()
    await writeFile(join(root, '.gitignore'), 'private/\n')
    await writeFile(join(root, 'tracked.txt'), 'before\n')
    await writeFile(join(root, 'removed.txt'), 'keep\n')
    await mkdir(join(root, 'private'))
    await writeFile(join(root, 'private', 'state.txt'), 'outside-before\n')

    await assertSupportedWorkspace(root)
    const journal = await mkdtemp(join(tmpdir(), 'dsh-conversation-undo-shadow-'))
    roots.push(journal)
    const shadow = new ShadowGit(root, journal)
    const before = await shadow.capture()

    await writeFile(join(root, 'tracked.txt'), 'redo\n')
    await rm(join(root, 'removed.txt'))
    await writeFile(join(root, 'created.txt'), 'redo-only\n')
    await writeFile(join(root, 'private', 'state.txt'), 'outside-redo\n')
    const redo = await shadow.capture()

    await shadow.restore(before, redo)
    await expect(readFile(join(root, 'tracked.txt'), 'utf8')).resolves.toBe('before\n')
    await expect(readFile(join(root, 'removed.txt'), 'utf8')).resolves.toBe('keep\n')
    await expect(readFile(join(root, 'created.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'private', 'state.txt'), 'utf8')).resolves.toBe('outside-redo\n')

    await shadow.restore(redo, before)
    await expect(readFile(join(root, 'tracked.txt'), 'utf8')).resolves.toBe('redo\n')
    await expect(readFile(join(root, 'removed.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'created.txt'), 'utf8')).resolves.toBe('redo-only\n')
  })

  it('verifies exact tree matches without modifying the worktree', async () => {
    const root = await workspace()
    await writeFile(join(root, 'tracked.txt'), 'before\n')
    await assertSupportedWorkspace(root)
    const journal = await mkdtemp(join(tmpdir(), 'dsh-conversation-undo-shadow-'))
    roots.push(journal)
    const shadow = new ShadowGit(root, journal)
    const before = await shadow.capture()

    await expect(shadow.verifyMatches(before)).resolves.toBe(true)

    await writeFile(join(root, 'tracked.txt'), 'changed\n')
    await expect(shadow.verifyMatches(before)).resolves.toBe(false)

    await writeFile(join(root, 'tracked.txt'), 'before\n')
    await writeFile(join(root, 'created.txt'), 'new\n')
    await expect(shadow.verifyMatches(before)).resolves.toBe(false)

    await rm(join(root, 'created.txt'))
    await expect(shadow.verifyMatches(before)).resolves.toBe(true)
    await expect(readFile(join(root, 'tracked.txt'), 'utf8')).resolves.toBe('before\n')
  })

  it('refuses worktrees that track a submodule gitlink', async () => {
    const root = await workspace()
    await writeFile(join(root, 'submodule-entry'), '')
    await git(root, 'add', 'submodule-entry')
    await git(root, 'update-index', '--cacheinfo', '160000', 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', 'submodule-entry')

    await expect(assertSupportedWorkspace(root)).rejects.toThrow(/contains submodules/)
  })
})
