#!/bin/sh
# Container start: update the knowledge repo and sync the index (both done by `marian-knows index`), serve MCP over HTTP.
# A restart repeats all of it, so restarting the container is how the knowledge base gets updated.
set -eu

log() { echo "[start] $*" >&2; }
die() { echo "[start] error: $*" >&2; exit 1; }

# Started as root: fix ownership of the data volume, then run the rest as `node`.
# No manual chown on the host, whoever created the files.
if [ "$(id -u)" = 0 ]; then
  chown -R node:node /data
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

[ -f "$MARIAN_KNOWS_CONFIG" ] || die "missing config $MARIAN_KNOWS_CONFIG (see poc/docker/guide.md)"
if [ -n "${KNOWLEDGE_REPO:-}" ]; then
  log "! warning: KNOWLEDGE_REPO is ignored; move the repo to git: in marian-knows.yml (see poc/docker/guide.md)"
fi

# Nothing else runs in the container yet, so any index lock is left over from a killed start.
# The lock stores a bare pid, and pids repeat across container starts, so it could look alive forever.
rm -f /data/.marian-knows/*/index.lock

log "syncing index"
marian-knows index

log "serving MCP on port $PORT"
exec marian-knows serve --http --host 0.0.0.0 --port "$PORT"
