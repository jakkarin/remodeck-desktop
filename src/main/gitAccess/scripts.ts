import { randomBytes } from 'node:crypto'
import { isValidTokenValue, normalizeScopePath, validateScope } from '../../shared/gitAccess'
import type { CliSpec } from './providers'

export const WRAPPER_VERSION = 1
export const ROOT = '$HOME/.config/remodeck/git-access'

export type InstallInput = {
  tokens: { host: string; path: string; token: string }[]
  providers: { host: string; gitUsername: string }[]
  wrappers: { cli: CliSpec; defaultHost: string }[]
  /** Only with the user's consent: put ~/.local/bin first in PATH from the top of ~/.bashrc. */
  pathBlock?: boolean
}

export const PATH_BLOCK_BEGIN = '# >>> remodeck git-access >>>'
export const PATH_BLOCK_END = '# <<< remodeck git-access <<<'
const PATH_BLOCK_LINE =
  'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH"; export PATH ;; esac'

/** Sets RCSTATE to symlink, present (both markers), partial (begin marker only) or absent. */
const RC_STATE_SNIPPET = [
  'RC="$HOME/.bashrc"',
  'if [ -L "$RC" ]; then RCSTATE=symlink',
  `elif [ -f "$RC" ] && grep -Fxq ${shQuote(PATH_BLOCK_BEGIN)} "$RC"; then`,
  `  if grep -Fxq ${shQuote(PATH_BLOCK_END)} "$RC"; then RCSTATE=present; else RCSTATE=partial; fi`,
  'else RCSTATE=absent',
  'fi'
].join('\n')

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

/**
 * sh that sets `wv` to N when line 2 of `file` is exactly `# remodeck-cli-wrapper <cmd> v<N>` (digits only), else empty.
 * Status and remove share it so both agree on what counts as our wrapper.
 */
function markerVersionSnippet(cmd: string, file: string): string {
  const marker = `# remodeck-cli-wrapper ${cmd} v`
  return `  wv=
  line2=$(sed -n 2p ${file} 2>/dev/null)
  case "$line2" in
    "${marker}"[0-9]*)
      n=\${line2#"${marker}"}
      case "$n" in *[!0-9]*) ;; *) wv=$n ;; esac ;;
  esac`
}

/** Single-quotes a value for sh. */
/** Escapes a literal for a sed BRE address (our markers contain no '/' but may contain '.' or '*'). */
function sedEscape(value: string): string {
  return value.replace(/[\\/.*[\]^$]/g, '\\$&')
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** sh that sets `real` to the first PATH entry for `cmd` that is not the file `self` (a quoted sh expression). */
function findRealSnippet(cmd: string, self: string): string {
  return `real=
oldifs=$IFS
IFS=:
set -f
for dir in $PATH; do
  [ -n "$dir" ] || dir=.
  cand="$dir/${cmd}"
  if [ -f "$cand" ] && [ -x "$cand" ] && ! [ "$cand" -ef ${self} ]; then real=$cand; break; fi
done
set +f
IFS=$oldifs`
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
${findRealSnippet(cmd, '"$0"')}
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
  # the raw configured value: \`git remote get-url\` would apply the bridge insteadOf rewrite of remodeck terminals
  url=$(git config --get remote.origin.url 2>/dev/null </dev/null) || url=
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
    out.push(
      `# ${cli.command} wrapper: only ours (marker on line 2) is replaced, anything else is left alone`,
      `if [ -e ${file} ] || [ -L ${file} ]; then`,
      markerVersionSnippet(cli.command, file),
      '  if [ -n "$wv" ]; then WRAP=1; else WRAP=; fi',
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
  if (input.pathBlock) {
    const bdelim = freshDelimiter(PATH_BLOCK_LINE)
    out.push(
      '# PATH block at the top of ~/.bashrc, before any non-interactive guard; a symlinked rc is never edited',
      RC_STATE_SNIPPET,
      'if [ "$RCSTATE" = absent ]; then',
      `  { cat <<'${bdelim}'`,
      PATH_BLOCK_BEGIN,
      PATH_BLOCK_LINE,
      PATH_BLOCK_END,
      bdelim,
      '    if [ -f "$RC" ]; then cat "$RC"; fi',
      '  } > "$RC.remodeck.tmp"',
      // rewriting in place keeps the file's mode and owner
      '  cat "$RC.remodeck.tmp" > "$RC"',
      '  rm -f "$RC.remodeck.tmp"',
      '  echo path_block=added',
      'else',
      '  echo "path_block=$RCSTATE"',
      'fi',
      ''
    )
  }
  return out.join('\n')
}

/**
 * Builds the read-only sh script that reports the target's state as `key=value` lines (see parseStatusOutput).
 * The per-CLI lines (cli_*, wrapper, resolve_*) repeat for each CLI; the parser keeps the first.
 * It only reads: nothing is created, changed or deleted.
 */
export function buildStatusScript(clis: CliSpec[], hosts: string[]): string {
  for (const h of hosts) {
    if (validateScope(h, 'x')) throw new Error(`Invalid host "${h}"`)
  }
  const helperKeys = ['credential.helper', ...hosts.map((h) => `credential.https://${h}.helper`)]
  const out: string[] = [
    `ROOT="${ROOT}"`,
    'if [ -f "$ROOT/git-credential-remodeck" ]; then echo helper=1; else echo helper=0; fi',
    // --global without --includes: our own included gitconfig is not read here
    'INC="$ROOT/gitconfig"',
    'if git config --global --get-all include.path </dev/null 2>/dev/null | grep -Fxq -- "$INC"; then echo include=1; else echo include=0; fi',
    'if [ -d "$ROOT/tokens" ]; then',
    '  find "$ROOT/tokens" -type f -name @token 2>/dev/null | sort | while IFS= read -r f; do',
    '    f=${f#"$ROOT/tokens/"}',
    '    echo "scope=${f%/@token}"',
    '  done',
    'fi',
    '{',
    ...helperKeys.map((k) => `  git config --global --get-all ${shQuote(k)}`),
    '} </dev/null 2>/dev/null | sort -u | while IFS= read -r h; do',
    '  [ -n "$h" ] || continue',
    '  [ "$h" = "$ROOT/git-credential-remodeck" ] && continue',
    // only a label leaves the host: helper values can carry secrets (inline shell, --file=..., URLs)
    // gh's own helper (gh auth setup-git) gets its name; any other inline text stays hidden
    '  case "$h" in "!"*"gh auth git-credential"*) echo gh; continue ;; "!"*) echo inline; continue ;; esac',
    '  set -f',
    '  set -- $h',
    '  set +f',
    '  [ -n "${1:-}" ] || continue',
    '  echo "${1##*/}"',
    'done | sort -u | while IFS= read -r label; do echo "other_helper=$label"; done',
    '',
    'echo "home=$HOME"',
    RC_STATE_SNIPPET,
    'echo "path_block=$RCSTATE"',
    // each probe: stdin from /dev/null, bounded by timeout when available, reported only as an absolute path
    'probe() {',
    '  tmo=',
    '  if command -v timeout >/dev/null 2>&1; then tmo="timeout ${REMODECK_PROBE_TIMEOUT:-10}"; fi',
    '  if out=$($tmo bash "$1" "$3" </dev/null 2>/dev/null); then',
    `    r=$(printf '%s\\n' "$out" | tail -n 1)`,
    '    case "$r" in /*) echo "resolve_$2=$r"; return ;; esac',
    '  fi',
    '  echo "resolve_$2=?"',
    '}'
  ]
  for (const { command: cmd } of clis) {
    const file = `"$HOME/.local/bin/${cmd}"`
    out.push(
      '',
      `# ${cmd}`,
      findRealSnippet(cmd, file),
      'echo "cli_path=$real"',
      'ver=',
      `[ -z "$real" ] || ver=$("$real" --version </dev/null 2>/dev/null | head -n 1 | grep -Eo '[0-9]+\\.[0-9]+(\\.[0-9]+)?' | head -n 1)`,
      'echo "cli_version=$ver"',
      `if [ -f ${file} ] && ! [ -L ${file} ]; then`,
      markerVersionSnippet(cmd, file),
      '  if [ -n "$wv" ]; then echo "wrapper=ours:$wv"; else echo wrapper=foreign; fi',
      `elif [ -e ${file} ] || [ -L ${file} ]; then`,
      '  echo wrapper=foreign',
      'else',
      '  echo wrapper=none',
      'fi',
      `probe -lc login ${shQuote(`command -v ${cmd}`)}`,
      `probe -c nonlogin ${shQuote(`command -v ${cmd}`)}`
    )
  }
  out.push('exit 0', '')
  return out.join('\n')
}

/**
 * Builds the sh script that undoes the install. It deletes exactly three things: our include line in
 * ~/.gitconfig, the ~/.local/bin/<cmd> files whose line 2 is our marker (never symlinks), and $ROOT.
 * Exits 0 whether or not anything was installed.
 */
export function buildRemoveScript(clis: CliSpec[]): string {
  const out: string[] = [
    `ROOT="${ROOT}"`,
    // never let an unset HOME turn $ROOT into a path at the filesystem root
    'case "${HOME:-}" in /?*) ;; *) echo "HOME is not set" >&2; exit 1 ;; esac',
    'INC="$ROOT/gitconfig"',
    '',
    '# git include: exact value match; git older than 2.30 has no --fixed-value (exit 129), so use an escaped regex',
    'git config --global --fixed-value --unset-all include.path "$INC" </dev/null >/dev/null 2>&1',
    'if [ $? -eq 129 ]; then',
    `  esc=$(printf %s "$INC" | sed 's/[][\\.*^$+?(){}|]/\\\\&/g')`,
    '  git config --global --unset-all include.path "^$esc\\$" </dev/null >/dev/null 2>&1',
    'fi'
  ]
  for (const { command: cmd } of clis) {
    const file = `"$HOME/.local/bin/${cmd}"`
    out.push(
      '',
      `# ${cmd} wrapper: only ours (marker on line 2, regular file) is deleted`,
      `if [ -f ${file} ] && ! [ -L ${file} ]; then`,
      markerVersionSnippet(cmd, file),
      `  if [ -n "$wv" ]; then rm -f ${file}; echo wrapper=${cmd}:removed; else echo wrapper=${cmd}:foreign; fi`,
      `elif [ -e ${file} ] || [ -L ${file} ]; then`,
      `  echo wrapper=${cmd}:foreign`,
      'else',
      `  echo wrapper=${cmd}:none`,
      'fi'
    )
  }
  out.push(
    '',
    '# PATH block: only lines between both of our markers are deleted; a partial block is left alone',
    RC_STATE_SNIPPET,
    'if [ "$RCSTATE" = present ]; then',
    `  sed '/^${sedEscape(PATH_BLOCK_BEGIN)}$/,/^${sedEscape(PATH_BLOCK_END)}$/d' "$RC" > "$RC.remodeck.tmp" &&`,
    '    cat "$RC.remodeck.tmp" > "$RC" && echo path_block=removed',
    '  rm -f "$RC.remodeck.tmp"',
    'fi',
    '',
    'rm -rf "$ROOT"',
    'exit 0',
    ''
  )
  return out.join('\n')
}
