import { randomBytes } from 'node:crypto'
import { isValidTokenValue, normalizeScopePath, validateScope } from '../../shared/gitAccess'
import type { CliSpec } from './providers'

export const WRAPPER_VERSION = 1
export const ROOT = '$HOME/.config/remodeck/git-access'

export type InstallInput = {
  tokens: { host: string; path: string; token: string }[]
  providers: { host: string; gitUsername: string }[]
  wrappers: { cli: CliSpec; defaultHost: string }[]
}

const USERNAME_RE = /^[A-Za-z0-9._-]+$/

/** Content of git-credential-remodeck (POSIX sh). Answers `get` only; `--token-for` serves the CLI wrappers. */
export function helperScript(): string {
  return `#!/bin/sh
# remodeck git credential helper: longest-prefix token lookup under the git-access root
root="$HOME/.config/remodeck/git-access"

# lookup <host> <path>: sets username and token, returns 1 when there is no match
lookup() {
  host=$(printf %s "$1" | tr '[:upper:]' '[:lower:]')
  path=$(printf %s "$2" | tr '[:upper:]' '[:lower:]')
  username=
  token=
  while read -r h u _; do
    if [ "$h" = "$host" ]; then username=$u; break; fi
  done < "$root/providers.conf" 2>/dev/null
  [ -n "$username" ] || return 1
  while :; do
    case "$path" in
      */) path=\${path%/} ;;
      /*) path=\${path#/} ;;
      *.git) path=\${path%.git} ;;
      *) break ;;
    esac
  done
  [ -n "$path" ] || return 1
  case "$path" in *[!a-z0-9._/-]*) return 1 ;; esac
  case "/$path/" in */../*|*/./*|*//*) return 1 ;; esac
  while [ -n "$path" ]; do
    if [ -f "$root/tokens/$host/$path/@token" ]; then
      token=$(cat "$root/tokens/$host/$path/@token")
      [ -n "$token" ] && return 0
    fi
    case "$path" in
      */*) path=\${path%/*} ;;
      *) path= ;;
    esac
  done
  return 1
}

if [ "\${1:-}" = "--token-for" ]; then
  target=\${2:-}
  if lookup "\${target%%/*}" "\${target#*/}"; then printf %s "$token"; fi
  exit 0
fi

[ "\${1:-}" = "get" ] || exit 0

protocol=
host=
path=
while IFS= read -r line; do
  [ -n "$line" ] || break
  case "$line" in
    protocol=*) protocol=\${line#protocol=} ;;
    host=*) host=\${line#host=} ;;
    path=*) path=\${line#path=} ;;
  esac
done
[ "$protocol" = "https" ] && [ -n "$host" ] && [ -n "$path" ] || exit 0
lookup "$host" "$path" || exit 0
printf 'username=%s\\npassword=%s\\n' "$username" "$token"
`
}

/** Single-quotes a value for sh. */
function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function assertValid(input: InstallInput): void {
  for (const t of input.tokens) {
    const err = validateScope(t.host, t.path)
    if (err) throw new Error(err)
    if (t.host !== t.host.toLowerCase() || t.path !== normalizeScopePath(t.path))
      throw new Error(`Scope ${t.host}/${t.path} is not normalized`)
    if (!isValidTokenValue(t.token)) throw new Error(`Invalid token value for ${t.host}/${t.path}`)
  }
  for (const p of input.providers) {
    if (validateScope(p.host, 'x')) throw new Error(`Invalid host "${p.host}"`)
    if (!USERNAME_RE.test(p.gitUsername)) throw new Error(`Invalid git username for ${p.host}`)
  }
}

/**
 * Builds the sh script that makes the target match `input`: writes the helper, providers.conf, the included
 * gitconfig and one @token per scope, then prunes stale tokens. Secrets only sit inside quoted heredocs, so
 * nothing in them is expanded. Wrapper files are appended after the git include by Task 6; until then
 * `input.wrappers` is unused and the script prints no `wrapper=` lines.
 */
export function buildInstallScript(input: InstallInput): string {
  assertValid(input)
  const helper = helperScript()
  const secrets = input.tokens.map((t) => t.token)
  let delim: string
  do {
    delim = `REMODECK_${randomBytes(8).toString('hex')}`
  } while (secrets.some((s) => s.includes(delim)) || helper.includes(delim))

  const out: string[] = [
    'set -eu',
    'umask 077',
    `ROOT="${ROOT}"`,
    'mkdir -p "$ROOT/tokens"',
    'chmod 700 "$ROOT" "$ROOT/tokens"',
    '',
    '# helper',
    `cat > "$ROOT/git-credential-remodeck.tmp" <<'${delim}'`,
    helper.replace(/\n$/, ''),
    delim,
    'chmod 700 "$ROOT/git-credential-remodeck.tmp"',
    'mv "$ROOT/git-credential-remodeck.tmp" "$ROOT/git-credential-remodeck"',
    '',
    '# providers.conf and the included gitconfig',
    ': > "$ROOT/providers.conf.tmp"',
    ': > "$ROOT/gitconfig.tmp"'
  ]
  for (const p of input.providers) {
    out.push(
      `printf '%s %s\\n' ${shQuote(p.host)} ${shQuote(p.gitUsername)} >> "$ROOT/providers.conf.tmp"`,
      `printf '[credential "https://%s"]\\n\\thelper = %s\\n\\tuseHttpPath = true\\n' ${shQuote(p.host)} "$ROOT/git-credential-remodeck" >> "$ROOT/gitconfig.tmp"`
    )
  }
  out.push(
    'mv "$ROOT/providers.conf.tmp" "$ROOT/providers.conf"',
    'mv "$ROOT/gitconfig.tmp" "$ROOT/gitconfig"',
    '',
    '# tokens'
  )
  for (const t of input.tokens) {
    const dir = `"$ROOT/tokens/${t.host}/${t.path}"`
    out.push(
      `mkdir -p ${dir}`,
      `printf %s "$(cat <<'${delim}'`,
      t.token,
      delim,
      `)" > ${dir}/@token.tmp`,
      `mv ${dir}/@token.tmp ${dir}/@token`
    )
  }
  const keep = input.tokens.map((t) => `"$ROOT/tokens/${t.host}/${t.path}/@token"`)
  out.push(
    'find "$ROOT/tokens" -type f -name @token | while IFS= read -r f; do',
    '  case "$f" in',
    ...(keep.length ? [`    ${keep.join('|')}) ;;`] : []),
    '    *) rm -f "$f" ;;',
    '  esac',
    'done',
    'find "$ROOT/tokens" -mindepth 1 -type d -empty -delete',
    '',
    '# git include',
    'INC="$ROOT/gitconfig"',
    'if ! git config --global --get-all include.path </dev/null | grep -Fxq -- "$INC"; then',
    '  git config --global --add include.path "$INC" </dev/null',
    'fi',
    ''
  )
  return out.join('\n')
}
