import type { UserConfig } from 'tsdown'

/** Bundle-only package: no compiled artifacts; the patch ships as YAML. */
export default (): UserConfig[] => [{ entry: '' }]
