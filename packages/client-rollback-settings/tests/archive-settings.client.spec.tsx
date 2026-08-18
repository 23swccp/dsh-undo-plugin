// @vitest-environment jsdom
/** User-visible archive actions: read-only view, restore, and permanent delete. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveSettingsSection } from '../src/client/ArchiveSettingsSection.tsx'
import type { ArchiveSettingsProps } from '../src/client/ArchiveSettingsSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const item = {
  sessionId: 'session-1',
  title: 'Archived title',
  archivedAt: '2026-08-15T01:00:00.000Z',
  createdAt: '2026-08-15T00:00:00.000Z',
  cwd: 'C:/workspace',
}

function renderArchive(action: 'archived' | 'cleanup-pending' | 'recovery-required' = 'archived') {
  const erase = vi.fn(async () => ({ ok: true as const }))
  const deleteAll = vi.fn(async () => ({ ok: true as const, deleted: 1, failed: 0 }))
  const restore = vi.fn(async () => ({ ok: true as const }))
  const read = vi.fn(async () => ({
    ok: true as const,
    value: { sessionId: item.sessionId, title: item.title, messages: [{ role: 'user' as const, text: 'preserved prompt' }] },
  }))
  const props = {
    t: (key: keyof typeof en, params?: Record<string, unknown>) => {
      const template = en[key]
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]))
    },
    list: vi.fn(async () => ({ items: [item] })),
    read,
    restore,
    delete: erase,
    deleteAll,
    archiveAction: vi.fn(async () => ({ action })),
  } as unknown as ArchiveSettingsProps
  render(<ArchiveSettingsSection {...props} />)
  return { erase, deleteAll, restore, read }
}

describe('ArchiveSettingsSection', () => {
  it('confirms permanent deletion before erasing the task', async () => {
    const { erase } = renderArchive()

    await screen.findByRole('button', { name: en.view })
    fireEvent.click(screen.getByRole('button', { name: en.delete }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmDelete }))
    await waitFor(() => { expect(erase).toHaveBeenCalledWith(item.sessionId) })
  })

  it('restores the archived conversation without a confirmation', async () => {
    const { restore } = renderArchive()

    await screen.findByRole('button', { name: en.restore })
    fireEvent.click(screen.getByRole('button', { name: en.restore }))
    await waitFor(() => { expect(restore).toHaveBeenCalledWith(item.sessionId) })
  })

  it('confirms before bulk-deleting every archived task', async () => {
    const { deleteAll } = renderArchive()

    await screen.findByRole('button', { name: en.deleteAll })
    fireEvent.click(screen.getByRole('button', { name: en.deleteAll }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmDeleteAll }))
    await waitFor(() => { expect(deleteAll).toHaveBeenCalledTimes(1) })
  })

  it('withholds nothing while automatic cleanup is pending but surfaces the state', async () => {
    renderArchive('cleanup-pending')

    await screen.findByText(en.cleanupPending)
  })

  it('surfaces a recovery-required journal without offering destructive actions', async () => {
    const { erase } = renderArchive('recovery-required')

    await screen.findByText(en.recoveryRequired)
    expect(erase).not.toHaveBeenCalled()
  })

  it('views archived messages without deleting or restoring the session', async () => {
    const { read, erase, restore } = renderArchive()

    const view = await screen.findByRole('button', { name: en.view })
    fireEvent.click(view)

    await waitFor(() => { expect(read).toHaveBeenCalledWith(item.sessionId) })
    expect(await screen.findByRole('dialog', { name: en.viewerTitle })).toBeTruthy()
    expect(screen.getByText('preserved prompt')).toBeTruthy()
    expect(erase).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
  })
})
