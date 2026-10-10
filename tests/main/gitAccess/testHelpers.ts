// R1: NOSYSTEM keeps the machine's system credential helper (e.g. Git Credential Manager) out of every run;
// the unset keeps an askpass program from answering where the helper stays silent.
export const GIT_PREFIX = 'export GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0\nunset GIT_ASKPASS SSH_ASKPASS\n'
