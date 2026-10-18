/** Replaces every occurrence of each non-empty secret with `***`; longest first so a secret that contains another is fully masked. */
export function redact(text: string, secrets: string[]): string {
  let out = text
  const ordered = [...new Set(secrets)]
    .filter((s) => s.length > 0)
    .sort((a, b) => b.length - a.length)
  for (const s of ordered) out = out.split(s).join('***')
  return out
}
