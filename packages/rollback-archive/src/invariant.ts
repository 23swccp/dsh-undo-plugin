/**
 * Package-owned invariant companion for `@dsh-rollback/rollback-archive`.
 * @module @dsh-rollback/rollback-archive/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-rollback/rollback-archive'

/** Cordis companion plugin name. */
export const name = 'rollback-archive-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the archive set is Host-owned and the tombstone list is plugin-private. */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['sessionArchive'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
