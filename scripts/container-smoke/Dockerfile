# LaunchClip as a host app's CPU-only worker runs it: Node 22 on Debian
# trixie-slim, ffmpeg, the checkout installed with npm ci, the Remotion kit
# built and Remotion's headless Chrome fetched at build time, so a job
# downloads nothing. That worker image checks out the pinned commit and does
# the same. No Python, Whisper, Ollama or model weights: the worker has none.
#
# Built by scripts/container-smoke.mjs from the checkout's tracked and
# unignored files (what a pinned git checkout holds); see docs/CONTAINER_SMOKE.md.
FROM node:22-trixie-slim

# The worker image installs Debian's chromium for exactly the shared
# libraries Remotion's headless Chrome needs, plus fonts-liberation.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    ffmpeg \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# The worker runs the CLI as a non-root user (appuser, uid 1001, HOME /app).
RUN groupadd --system --gid 1001 appgroup \
    && useradd --system --uid 1001 --gid appgroup --home /app --create-home appuser

# Dependencies first, so a code change reuses the npm ci and browser layers.
WORKDIR /opt/launchclip
RUN chown appuser:appgroup /opt/launchclip
USER appuser
COPY --chown=appuser:appgroup package.json package-lock.json ./
COPY --chown=appuser:appgroup kit/core/package.json kit/core/
COPY --chown=appuser:appgroup kit/remotion/package.json kit/remotion/
COPY --chown=appuser:appgroup packages/engine/package.json packages/engine/
RUN npm ci --no-audit --no-fund \
    && npx --no-install remotion browser ensure \
    && rm -rf /app/.npm

COPY --chown=appuser:appgroup . /opt/launchclip
RUN cd kit/remotion && node scripts/build.mjs

# Whisper and Ollama are tripwires here (forbidden-command.sh).
RUN mkdir -p scripts/container-smoke/bin \
    && for name in whisper whisper-cli whisper-cpp faster-whisper ollama; do \
         ln -sf ../forbidden-command.sh "scripts/container-smoke/bin/$name"; \
       done \
    && chmod +x scripts/container-smoke/forbidden-command.sh

ENV HOME=/app \
    LAUNCHCLIP_HOME=/opt/launchclip \
    LAUNCHCLIP_TELEMETRY=off

CMD ["node", "scripts/container-smoke/run.mjs"]
