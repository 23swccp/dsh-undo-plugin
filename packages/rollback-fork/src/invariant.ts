/**
 * Package-owned invariant companion for `@dsh-undo/rollback-fork`.
 * @module @dsh-undo/rollback-fork/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-undo/rollback-fork'

/** Cordis companion plugin name. */
export const name = 'rollback-fork-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: an exact prefix cut has no live event relationship after the child is constructed. */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['sessionFork'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
