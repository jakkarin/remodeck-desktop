FROM node:22-bookworm

# The marker file is checked by tests/docker/container-marker.mjs; keep both in sync.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       bash ca-certificates coreutils git openssh-client python3 build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 tester \
    && mkdir -p /workspace /run/remodeck-e2e \
    && chown tester:tester /workspace /run/remodeck-e2e \
    && printf 'remodeck-integration-v1\n' > /etc/remodeck-test-container \
    && chmod 0444 /etc/remodeck-test-container

WORKDIR /workspace
COPY --chown=tester:tester package.json package-lock.json ./

USER tester
ENV HOME=/home/tester \
    XDG_CONFIG_HOME=/home/tester/.config \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_TERMINAL_PROMPT=0

# Avoid Electron downloads/app-dependency rebuilding; E2E uses node-pty with the container's Node ABI.
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npm rebuild node-pty --ignore-scripts=false

COPY --chown=tester:tester . .

# Docker's Windows build context can report source entries with mode 000.
USER root
RUN chmod -R a+rX src tests \
    && chmod a+r package*.json tsconfig*.json vitest*.config.ts
USER tester

CMD ["sleep", "infinity"]
