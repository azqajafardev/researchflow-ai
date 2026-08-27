/** Only provider APIs fetch pages; never fetch arbitrary URLs from the app server. */
export function isReadableUrl(value: string) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}
