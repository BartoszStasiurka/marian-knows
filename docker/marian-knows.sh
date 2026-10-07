#!/bin/sh
# `marian-knows` in the image. Run as root (e.g. `docker compose exec`), it switches to `node` first, so files it
# writes in /data (tokens, index, logs) stay readable by the server.
if [ "$(id -u)" = 0 ]; then
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups node /app/dist/cli.js "$@"
fi
exec node /app/dist/cli.js "$@"
