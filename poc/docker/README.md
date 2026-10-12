# Docker (paused)

Proof of concept for running the MCP server over HTTP in a container. Work is on hold: nothing here is built,
tested or published, and the user documentation in `knowledge/` does not mention Docker. Roadmap: stage 14
in `docs/roadmap.md`.

## Initial assumptions

- One disposable container: the MCP server over HTTP (`serve --http --host 0.0.0.0`, port 3000). All state lives
  on the `/data` volume (config, tokens file, deploy key, knowledge clone, `.marian-knows/`), so a rebuild
  replaces code only.
- Image: multi-stage on `node:20-bookworm-slim`, native `better-sqlite3` built in the image, runtime adds only
  `git` and `openssh-client`. Runs as `node` (UID 1000); the entrypoint fixes `/data` ownership as root first.
- Restart = update: on start the entrypoint runs `marian-knows index` (git pull + index sync), then serves.
  The knowledge repo is set in `data/marian-knows.yml` (`git:` block), so `compose.yml` needs no edits.
- CLI in the container goes through `docker compose exec`, never `run` (a new hostname would take over the
  index lock of the running server).
- HTTPS through a reverse proxy; the port is bound to `127.0.0.1`.
- CI publishes `ghcr.io/bartoszstasiurka/marian-knows` after green tests on `main`, tagged `main` and
  `sha-<commit>`; rollback = pin the previous `sha-` tag.
- `/data` must be a local disk: SQLite in WAL mode does not work on NFS or SMB.

Already in the product (independent of Docker): the index lock stores `hostname:pid`, and SIGTERM shuts the
HTTP server down within 8 s.

## Open before resuming

- Healthcheck endpoint.
- Image tags: version + SHA instead of the moving `main` tag.
- Whether the image should be public (no GHCR login on the server).

## Files

| File                       | What it is                                                            |
| -------------------------- | --------------------------------------------------------------------- |
| `Dockerfile`               | Image; build from the repo root: `docker build -f poc/docker/Dockerfile .` |
| `Dockerfile.dockerignore`  | Build context whitelist (picked up next to the Dockerfile by BuildKit) |
| `entrypoint.sh`            | Container start: fix ownership, `index`, `serve --http`               |
| `marian-knows.sh`          | `marian-knows` in the image, drops root to `node`                     |
| `compose.example.yml`      | Server `compose.yml`                                                  |
| `ci-image.yml`             | The GHCR `image` job taken out of `.github/workflows/ci.yml`          |
| `guide.md`                 | Draft user guide (formerly `knowledge/guides/docker.md`)              |
