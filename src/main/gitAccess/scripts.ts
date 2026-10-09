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

/**
 * Content of ~/.local/bin/<cli.command> (POSIX sh). Line 2 is the marker the installer and status use to recognise it.
 * It never edits "$@": the repo flags are only read, then the real binary gets the original arguments.
 */
export function cliWrapperScript(cli: CliSpec, defaultHost: string, version: number): string {
  const cmd = cli.command
  const flagCases = cli.repoFlags.map((f) =>
    f.startsWith('--') ? `    ${f}=*) repo=\${arg#${f}=}; break ;;` : `    ${f}?*) repo=\${arg#${f}}; break ;;`
  )
  // gh also honours GITHUB_TOKEN; other CLIs only their own variable
  const alreadySet = [cli.tokenEnv, ...(cli.tokenEnv === 'GH_TOKEN' ? ['GITHUB_TOKEN'] : [])]
    .map((v) => `[ -n "\${${v}:-}" ]`)
    .join(' || ')
  return `#!/bin/sh
# remodeck-cli-wrapper ${cmd} v${version}
# Picks the token for the repo this call targets, then hands over to the real ${cmd}.
helper="${ROOT}/git-credential-remodeck"

# 1. the real binary: first PATH entry that is not this file
real=
oldifs=$IFS
IFS=:
set -f
for dir in $PATH; do
  [ -n "$dir" ] || dir=.
  cand="$dir/${cmd}"
  if [ -f "$cand" ] && [ -x "$cand" ] && ! [ "$cand" -ef "$0" ]; then real=$cand; break; fi
done
set +f
IFS=$oldifs
if [ -z "$real" ]; then
  echo "${cmd}: ${cmd} not found on PATH (remodeck wrapper)" >&2
  exit 127
fi

# 2. the caller already chose a token
if ${alreadySet}; then exec "$real" "$@"; fi

# 3. which repo: flag, then env, then the origin remote
repo=
want=
for arg in "$@"; do
  if [ -n "$want" ]; then repo=$arg; break; fi
  case "$arg" in
    ${cli.repoFlags.join('|')}) want=1 ;;
${flagCases.join('\n')}
  esac
done
${cli.repoEnv ? `[ -n "$repo" ] || repo=\${${cli.repoEnv}:-}` : ''}
host=
path=
if [ -n "$repo" ]; then
  case "$repo" in
    */*/*) host=\${repo%%/*}; path=\${repo#*/} ;;
    */*) host=${shQuote(defaultHost)}; path=$repo ;;
  esac
else
  url=$(git remote get-url origin 2>/dev/null </dev/null) || url=
  case "$url" in
    *://*)
      rest=\${url#*://}
      host=\${rest%%/*}; host=\${host#*@}; host=\${host%%:*}
      path=\${rest#*/}
      ;;
    *:*)
      host=\${url%%:*}; host=\${host#*@}
      path=\${url#*:}
      ;;
  esac
fi

# 4. same longest-prefix lookup git uses
if [ -n "$host" ] && [ -n "$path" ] && [ -f "$helper" ]; then
  token=$(sh "$helper" --token-for "$host/$path" 2>/dev/null) || token=
  if [ -n "$token" ]; then ${cli.tokenEnv}=$token; export ${cli.tokenEnv}; fi
fi

# 5. original arguments, untouched
exec "$real" "$@"
`
}

/** A heredoc delimiter that occurs in none of `texts`. */
function freshDelimiter(...texts: string[]): string {
  let delim: string
  do {
    delim = `REMODECK_${randomBytes(8).toString('hex')}`
  } while (texts.some((t) => t.includes(delim)))
  return delim
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
 * gitconfig and one @token per scope, then prunes stale tokens. Secrets only appear as single-quoted
 * printf arguments, so nothing in them is expanded. Each CLI wrapper is written last and reported as
 * `wrapper=<cli>:installed` or `wrapper=<cli>:skipped` (a file without our marker is never touched).
 */
export function buildInstallScript(input: InstallInput): string {
  assertValid(input)
  const helper = helperScript()
  const delim = freshDelimiter(helper)

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
      // printf is a builtin and the single-quoted literal is never expanded, so the token stays off exec argv
      `printf %s ${shQuote(t.token)} > ${dir}/@token.tmp`,
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
    '# stray *.tmp files (a secret may sit in one if an earlier run died before mv)',
    'find "$ROOT" -type f -name \'*.tmp\' -exec rm -f {} +',
    'find "$ROOT/tokens" -mindepth 1 -type d -empty -delete',
    '',
    '# git include',
    'INC="$ROOT/gitconfig"',
    'if ! git config --global --get-all include.path </dev/null | grep -Fxq -- "$INC"; then',
    '  git config --global --add include.path "$INC" </dev/null',
    'fi',
    ''
  )
  for (const { cli, defaultHost } of input.wrappers) {
    const body = cliWrapperScript(cli, defaultHost, WRAPPER_VERSION)
    const wdelim = freshDelimiter(body)
    const file = `"$HOME/.local/bin/${cli.command}"`
    const marker = `# remodeck-cli-wrapper ${cli.command} v`
    out.push(
      `# ${cli.command} wrapper: only ours (marker on line 2) is replaced, anything else is left alone`,
      `if [ -e ${file} ] || [ -L ${file} ]; then`,
      `  case "$(sed -n 2p ${file} 2>/dev/null)" in`,
      `    "${marker}"*) WRAP=1 ;;`,
      '    *) WRAP= ;;',
      '  esac',
      'else',
      '  WRAP=1',
      'fi',
      'if [ -n "$WRAP" ]; then',
      // dir gets 0755 whatever the install umask (077) is
      '  (umask 022; mkdir -p "$HOME/.local/bin")',
      `  cat > ${file}.tmp <<'${wdelim}'`,
      body.replace(/\n$/, ''),
      wdelim,
      `  chmod 755 ${file}.tmp`,
      `  mv ${file}.tmp ${file}`,
      `  echo wrapper=${cli.command}:installed`,
      'else',
      `  echo wrapper=${cli.command}:skipped`,
      'fi',
      ''
    )
  }
  return out.join('\n')
}
