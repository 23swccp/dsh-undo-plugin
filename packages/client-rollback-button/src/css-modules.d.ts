/** CSS Modules type shim for this browser package. */

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
