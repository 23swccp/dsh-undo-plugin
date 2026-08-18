/** Package-owned invariant companion for rollback-undo. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-rollback/rollback-undo'

/** Cordis companion plugin name. */
export const name = 'rollback-undo-invariant'
/** Service required before this companion registers its ownership record. */
export const inject = ['invariants']

/** No runtime invariant: JSON journals and private Git trees have no authoritative live relation to compare. */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['conversationUndo'] })

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
