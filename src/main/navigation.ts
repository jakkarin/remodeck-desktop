/** True only for navigations to the app's own renderer (the dev server origin); everything else is blocked. */
export function isAppNavigation(url: string, devUrl: string | undefined): boolean {
  if (!devUrl) return false
  try {
    return new URL(url).origin === new URL(devUrl).origin
  } catch {
    return false
  }
}
