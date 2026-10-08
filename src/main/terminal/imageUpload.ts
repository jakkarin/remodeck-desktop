import crypto from 'node:crypto'
import type { SandboxTarget } from '../sandbox/target'

export type ImageExt = 'png' | 'jpg' | 'gif' | 'webp'
export const IMAGE_EXTS: readonly ImageExt[] = ['png', 'jpg', 'gif', 'webp']
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * Uploads an image to `$HOME/.cache/remodeck/paste` on the sandbox (outside any repo) and returns its absolute path.
 * Files older than a day in that directory are removed best-effort.
 */
export async function uploadImage(
  target: SandboxTarget,
  bytes: Uint8Array,
  ext: ImageExt
): Promise<string> {
  if (bytes.length === 0) throw new Error('Image is empty')
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10MB')
  const b64 = Buffer.from(bytes)
    .toString('base64')
    .replace(/(.{76})/g, '$1\n')
    .replace(/\n$/, '')
  const name = `${crypto.randomUUID()}.${ext}`
  const script = [
    'set -e',
    'umask 077',
    'd="$HOME/.cache/remodeck/paste"',
    'mkdir -p "$d"',
    'chmod 700 "$d"',
    'find "$d" -type f -mmin +1440 -delete 2>/dev/null || true',
    `f="$d/${name}"`,
    `base64 -d > "$f" <<'REMODECK_EOF'`,
    b64,
    'REMODECK_EOF',
    'printf \'%s\n\' "$f"',
    ''
  ].join('\n')
  const r = await target.exec(script)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'Image upload failed')
  return r.stdout.trim()
}
