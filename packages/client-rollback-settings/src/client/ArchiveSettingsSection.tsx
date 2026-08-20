/** Archive Tasks Settings page (standalone plugin edition). */

import { useEffect, useState, type ReactNode } from 'react'
import type {
  ArchivedSessionItem,
  ArchivedSessionReadValue,
  SessionArchiveListValue,
} from '@dsh-undo/rollback-archive/types'
import type { ConversationArchiveActionValue } from '@dsh-undo/rollback-undo/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArchiveSettingsKey } from './locales.ts'
import css from './ArchiveSettingsSection.module.css'

/** Remote actions used by the Archive Tasks page. */
export interface ArchiveSettingsInjected {
  /** Read every archived Session currently hidden from ordinary navigation. */
  list: () => Promise<SessionArchiveListValue>
  /** Load one archived conversation for an in-place read-only viewer. */
  read: (sessionId: ArchivedSessionItem['sessionId']) => Promise<ArchiveTaskReadResult>
  /** Restore one archived conversation as a new visible Session. */
  restore: (sessionId: ArchivedSessionItem['sessionId']) => Promise<ArchiveTaskResult>
  /** Permanently delete one archived Session's log files and hide it from this list. */
  delete: (sessionId: ArchivedSessionItem['sessionId']) => Promise<ArchiveTaskResult>
  /** Permanently delete every archived Session, reporting per-Session outcomes. */
  deleteAll: () => Promise<ArchiveDeleteAllResult>
  /** Select the recovery state for one archived Session. */
  archiveAction: (sessionId: ArchivedSessionItem['sessionId']) => Promise<ConversationArchiveActionValue>
}

/** One browser-normalized completion from the archive capability. */
export type ArchiveTaskResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/** Bulk-deletion completion with per-Session outcome counts. */
export type ArchiveDeleteAllResult =
  | { readonly ok: true; readonly deleted: number; readonly failed: number }
  | { readonly ok: false; readonly message: string }

/** Browser-normalized archived conversation response. */
export type ArchiveTaskReadResult =
  | { readonly ok: true; readonly value: ArchivedSessionReadValue }
  | { readonly ok: false; readonly message: string }

/** Full page props assembled by the Settings slot renderer. */
export type ArchiveSettingsProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.archive'>
  & InjectFace<ArchiveSettingsInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | {
    readonly status: 'ready'
    readonly items: readonly ArchivedSessionItem[]
    readonly actions: ReadonlyMap<ArchivedSessionItem['sessionId'], ConversationArchiveActionValue['action']>
  }

/** Render the archive list, its read-only viewer, and restore/permanent-delete actions. */
export function ArchiveSettingsSection(props: Partial<ArchiveSettingsProps>): ReactNode {
  const { list, read, restore, delete: erase, deleteAll, archiveAction, t } = props
  if (list === undefined || read === undefined || restore === undefined
    || erase === undefined || deleteAll === undefined
    || archiveAction === undefined || t === undefined) return null
  return <Loaded list={list} read={read} restore={restore} delete={erase} deleteAll={deleteAll} archiveAction={archiveAction} t={t} />
}

function Loaded({
  list, read, restore, delete: erase, deleteAll, archiveAction, t,
}: ArchiveSettingsInjected & { readonly t: (key: ArchiveSettingsKey, params?: Record<string, unknown>) => string }): ReactNode {
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [pending, setPending] = useState<ArchivedSessionItem['sessionId'] | undefined>(undefined)
  const [confirming, setConfirming] = useState<ArchivedSessionItem['sessionId'] | undefined>(undefined)
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [viewer, setViewer] = useState<ArchivedSessionReadValue | undefined>(undefined)

  useEffect(() => {
    let current = true
    void list().then(async ({ items }) => {
      const actions = new Map<ArchivedSessionItem['sessionId'], ConversationArchiveActionValue['action']>()
      for (const item of items) actions.set(item.sessionId, (await archiveAction(item.sessionId)).action)
      if (current) setState({ status: 'ready', items, actions })
    }).then(
      () => {},
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [archiveAction, list, request])

  const reload = (): void => {
    setFailure(undefined)
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }
  const run = (sessionId: ArchivedSessionItem['sessionId'], action: () => Promise<ArchiveTaskResult>): void => {
    if (pending !== undefined) return
    setPending(sessionId)
    setFailure(undefined)
    void action().then(
      result => {
        if (!result.ok) {
          setFailure(result.message)
          return
        }
        setConfirming(undefined)
        reload()
      },
      () => { setFailure(t('mutationFailed')) },
    ).finally(() => { setPending(undefined) })
  }
  const view = (sessionId: ArchivedSessionItem['sessionId']): void => {
    if (pending !== undefined) return
    setPending(sessionId)
    setFailure(undefined)
    void read(sessionId).then(
      result => {
        if (!result.ok) setFailure(result.message)
        else setViewer(result.value)
      },
      () => { setFailure(t('mutationFailed')) },
    ).finally(() => { setPending(undefined) })
  }

  return (
    <section className={css.section} aria-busy={state.status === 'loading'}>
      <h2>{t('title')}</h2>
      <p className={css.description}>{t('description')}</p>
      {failure === undefined ? null : <p className={css.failure} role="alert">{failure}</p>}
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.retry}>
          <p role="alert">{t('loadFailed')}</p>
          <button type="button" onClick={reload}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' && state.items.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
      {state.status === 'ready' && state.items.length > 0 ? (
        <div className={css.bulk}>
          {confirmingAll ? (
            <span className={css.confirm}>
              <span>{t('deleteAllPrompt')}</span>
              <button type="button" className={css.danger} disabled={pending !== undefined} onClick={() => {
                setPending('*all*' as ArchivedSessionItem['sessionId'])
                setFailure(undefined)
                void deleteAll().then(
                  result => {
                    if (!result.ok) {
                      setFailure(result.message)
                      setConfirmingAll(false)
                      reload()
                      return
                    }
                    setConfirmingAll(false)
                    reload()
                    if (result.failed > 0) setFailure(t('deleteAllPartial', { deleted: result.deleted, failed: result.failed }))
                  },
                  () => { setFailure(t('mutationFailed')) },
                ).finally(() => { setPending(undefined) })
              }}>
                {pending !== undefined ? t('deleting') : t('confirmDeleteAll')}
              </button>
              <button type="button" disabled={pending !== undefined} onClick={() => { setConfirmingAll(false) }}>{t('cancel')}</button>
            </span>
          ) : (
            <button type="button" className={css.danger} disabled={pending !== undefined} onClick={() => { setConfirmingAll(true) }}>
              {t('deleteAll')}
            </button>
          )}
        </div>
      ) : null}
      {state.status === 'ready' && state.items.length > 0 ? (
        <ul className={css.list}>
          {state.items.map(item => {
            const busy = pending === item.sessionId
            const confirm = confirming === item.sessionId
            const actionKind = state.actions.get(item.sessionId) ?? 'archived'
            return (
              <li className={css.item} key={item.sessionId}>
                <div className={css.identity}>
                  <code>{item.sessionId}</code>
                  <span>{`${t('titleLabel')}: ${item.title ?? t('untitled')}`}</span>
                  <span>{`${t('archivedAt')}: ${new Date(item.archivedAt).toLocaleString()}`}</span>
                  <span>{`${t('createdAt')}: ${new Date(item.createdAt).toLocaleString()}`}</span>
                  {item.cwd === undefined ? null : <span>{`${t('workspace')}: ${item.cwd}`}</span>}
                </div>
                <div className={css.actions}>
                  <button type="button" disabled={busy} onClick={() => { view(item.sessionId) }}>{t('view')}</button>
                  <button type="button" disabled={busy} onClick={() => {
                    run(item.sessionId, () => restore(item.sessionId))
                  }}>{t('restore')}</button>
                  {actionKind === 'cleanup-pending' ? <span className={css.pending}>{t('cleanupPending')}</span> : null}
                  {actionKind === 'recovery-required' ? <span className={css.pending} role="alert">{t('recoveryRequired')}</span> : null}
                  {confirm ? (
                    <span className={css.confirm}>
                      <span>{t('deletePrompt')}</span>
                      <button type="button" className={css.danger} disabled={busy} onClick={() => {
                        run(item.sessionId, () => erase(item.sessionId))
                      }}>
                        {busy ? t('deleting') : t('confirmDelete')}
                      </button>
                      <button type="button" disabled={busy} onClick={() => { setConfirming(undefined) }}>{t('cancel')}</button>
                    </span>
                  ) : (
                    <button type="button" className={css.danger} disabled={busy} onClick={() => { setConfirming(item.sessionId) }}>
                      {t('delete')}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
      {viewer === undefined ? null : (
        <div className={css.viewer} role="dialog" aria-modal="true" aria-label={t('viewerTitle')}>
          <div className={css.viewerHeader}>
            <h3>{viewer.title ?? t('untitled')}</h3>
            <button type="button" onClick={() => { setViewer(undefined) }}>{t('close')}</button>
          </div>
          {viewer.messages.length === 0 ? <p className={css.status}>{t('noMessages')}</p> : (
            <ol className={css.transcript}>
              {viewer.messages.map((message, index) => <li key={index} data-role={message.role}>{message.text}</li>)}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}
