/**
 * Browser half of the toolcards plugin.
 *
 * The whole feature is one stylesheet: importing it is the injection. The
 * client bundler compiles `*.module.css` into an inline <style> tag stamped
 * with this plugin's id (data-plugin="@dsh-rollback/client-rollback-toolcards")
 * appended at module-load time, and the loader removes the tag on unload.
 * Because every rule keys off stable data attributes the stock renderer
 * already emits, React re-renders need no observation — the cascade re-applies
 * the colors to whatever the rows remount.
 */

import './toolcards.module.css'

/** No services required: nothing but the load-time stylesheet injection. */
export const inject: readonly string[] = []

/**
 * No runtime behavior beyond the stylesheet injected at module load.
 * @returns a no-op disposer (the loader owns the style tag's lifecycle).
 */
export async function apply(): Promise<() => void> {
  return () => {}
}
