/** Archived Session management registered into Web Settings. */

import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import TYPERT_ARCHIVE_REMOTE from '@dsh-rollback/rollback-archive/remote'
import type {} from '@dsh-rollback/rollback-archive/remote'
import TYPERT_UNDO_REMOTE from '@dsh-rollback/rollback-undo/remote'
import type {} from '@dsh-rollback/rollback-undo/remote'
import { ArchiveSettingsSection, type ArchiveSettingsInjected } from './ArchiveSettingsSection.tsx'
import { mountArchiveNavIconPatch } from './navIconPatch.tsx'
import { en, zh, type ArchiveSettingsKey } from './locales.ts'

export type { ArchiveSettingsInjected, ArchiveSettingsProps } from './ArchiveSettingsSection.tsx'
export type { ArchiveSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Archive Tasks copy. */
    'settings.archive': ArchiveSettingsKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.archive'

/** Services required by the Settings registration; the Remote namespaces are mounted by this apply. */
export const inject = ['slots', 'locale', 'remote', 'sessions']

/**
 * Mount one generated contribution at most once across sibling client plugins.
 * The rollback button package also mounts the conversationUndo contribution;
 * the typert registry rejects a duplicate endpoint, so the later apply must
 * observe the earlier mount and skip.
 * @param ctx - client Cordis context.
 * @param contribution - generated Remote contribution.
 * @param probe - one endpoint the contribution declares, used to test the registry.
 * @returns the contribution disposer (a no-op when a sibling already mounted it).
 */
async function mountOnce(
  ctx: ClientContext,
  contribution: TypertRemoteContribution,
  probe: string,
): Promise<() => Promise<void>> {
  if (ctx.get('typert')?.remotes.get(probe) !== undefined) return async () => {}
  return await ctx.remote.$mount(contribution)
}

/** Mount the plugin Remotes and register the Archive Tasks section. */
export async function apply(ctx: ClientContext): Promise<() => void> {
  // Probe the plugin-exclusive tombstone endpoint: the base api-remotes
  // contribution already claims sessionArchive/list and read, so probing
  // those would skip this contribution and leave tombstone unmounted.
  const disposeArchive = await mountOnce(ctx, TYPERT_ARCHIVE_REMOTE, 'sessionArchive/tombstone')
  const disposeUndo = await mountOnce(ctx, TYPERT_UNDO_REMOTE, 'conversationUndo/current')
  const disposeLocale = ctx.locale.register(NS, { zh, en })
  const archive = ctx.get('remote.sessionArchive')
  const undo = ctx.get('remote.conversationUndo')
  const sessions = ctx.get('sessions') as unknown as Pick<ISessions, 'open'>
  const t = ctx.locale.bind(NS)

  const injected = (): ArchiveSettingsInjected => ({
    list: async () => {
      const result = await archive.list()
      if (!result.ok) throw new Error(`sessionArchive.list failed: ${result.error.code}: ${result.error.message}`)
      return result.value
    },
    read: async (sessionId) => {
      const carried = await archive.read({ sessionId })
      if (!carried.ok) throw new Error(`sessionArchive.read failed: ${carried.error.code}: ${carried.error.message}`)
      return carried.value.ok
        ? { ok: true, value: carried.value.value }
        : { ok: false, message: carried.value.error.message }
    },
    restore: async (sessionId) => {
      const carried = await archive.restore({ sessionId })
      if (!carried.ok) throw new Error(`sessionArchive.restore failed: ${carried.error.code}: ${carried.error.message}`)
      if (!carried.value.ok) return { ok: false, message: carried.value.error.message }
      if (carried.value.value.sessionId !== undefined) sessions.open(carried.value.value.sessionId)
      return { ok: true }
    },
    delete: async (sessionId) => {
      const carried = await archive.delete({ sessionId })
      if (!carried.ok) throw new Error(`sessionArchive.delete failed: ${carried.error.code}: ${carried.error.message}`)
      return carried.value.ok ? { ok: true } : { ok: false, message: carried.value.error.message }
    },
    deleteAll: async () => {
      const carried = await archive.deleteAll()
      if (!carried.ok) throw new Error(`sessionArchive.deleteAll failed: ${carried.error.code}: ${carried.error.message}`)
      return {
        ok: true,
        deleted: carried.value.deleted.length,
        failed: carried.value.failed.length,
      }
    },
    archiveAction: async (sessionId) => {
      const carried = await undo.archiveAction({ sessionId })
      if (!carried.ok) throw new Error(`conversationUndo.archiveAction failed: ${carried.error.code}: ${carried.error.message}`)
      return carried.value
    },
  })
  // The shell hardcodes nav glyphs by section id; patch ours after the
  // registration below supplies the label the nav row will carry.
  const disposeNavIcon = mountArchiveNavIconPatch(() => t('nav'))
  const disposeRegistration = ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'archive',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, ArchiveSettingsSection))

  return () => {
    disposeNavIcon()
    disposeRegistration()
    disposeLocale()
    void disposeArchive()
    void disposeUndo()
  }
}
