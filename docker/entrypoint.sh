#!/bin/sh
# Container start: update the knowledge repo, sync the index, serve MCP over HTTP.
# A restart repeats all three, so restarting the container is how the knowledge base gets updated.
set -eu

log() { echo "[start] $*" >&2; }
die() { echo "[start] error: $*" >&2; exit 1; }

# Started as root: fix ownership of the data volume, then run the rest as `node`.
# No manual chown on the host, whoever created the files.
if [ "$(id -u)" = 0 ]; then
  chown -R node:node /data
  [ -f /data/deploy_key ] && chmod 600 /data/deploy_key
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

[ -f "$MARIAN_KNOWS_CONFIG" ] || die "missing config $MARIAN_KNOWS_CONFIG (see docs/docker.md)"

# Runs git; on a changed host key prints one actionable line instead of ssh's banner.
git_quiet() {
  if out=$(git "$@" 2>&1); then
    [ -n "$out" ] && echo "$out" >&2
    return 0
  fi
  if echo "$out" | grep -q "REMOTE HOST IDENTIFICATION HAS CHANGED"; then
    log "! warning: the git host key has changed. If that is expected (e.g. the git server moved):"
    log "!   rm data/known_hosts && docker compose restart"
  else
    echo "$out" >&2
  fi
  return 1
}

# Knowledge repo. Without KNOWLEDGE_REPO the directory is used as it is (e.g. a bind mount).
if [ -n "${KNOWLEDGE_REPO:-}" ]; then
  if [ -f /data/deploy_key ]; then
    export GIT_SSH_COMMAND="ssh -i /data/deploy_key -o IdentitiesOnly=yes \
-o UserKnownHostsFile=/data/known_hosts -o StrictHostKeyChecking=accept-new"
  fi

  if [ -d "$KNOWLEDGE_DIR/.git" ]; then
    log "updating $KNOWLEDGE_REPO ($KNOWLEDGE_BRANCH)"
    git -C "$KNOWLEDGE_DIR" remote set-url origin "$KNOWLEDGE_REPO"
    # A failed fetch (network, git host down) keeps the last known content: a stale base beats no server.
    if git_quiet -C "$KNOWLEDGE_DIR" fetch --depth 1 origin "$KNOWLEDGE_BRANCH"; then
      git -C "$KNOWLEDGE_DIR" reset -q --hard FETCH_HEAD
      git -C "$KNOWLEDGE_DIR" clean -fdq
    else
      log "! warning: fetch failed, serving the previous content"
    fi
  else
    log "cloning $KNOWLEDGE_REPO ($KNOWLEDGE_BRANCH)"
    rm -rf "$KNOWLEDGE_DIR"
    git_quiet clone -q --depth 1 --branch "$KNOWLEDGE_BRANCH" "$KNOWLEDGE_REPO" "$KNOWLEDGE_DIR" \
      || die "cannot clone $KNOWLEDGE_REPO"
  fi
  log "knowledge at $(git -C "$KNOWLEDGE_DIR" log -1 --format='%h %cd' --date=iso)"
fi

# Nothing else runs in the container yet, so any index lock is left over from a killed start.
# The lock stores a bare pid, and pids repeat across container starts, so it could look alive forever.
rm -f /data/.marian-knows/*/index.lock

log "syncing index"
marian-knows index

log "serving MCP on port $PORT"
exec marian-knows serve --http --host 0.0.0.0 --port "$PORT"
