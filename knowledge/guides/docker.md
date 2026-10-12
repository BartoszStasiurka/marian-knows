---
title: Run in Docker
tags: [guide, docker, http, git]
---

# Run in Docker

The MCP server over HTTP in one container. The knowledge base is a separate git repository that
`marian-knows index` clones and updates by itself. The repository address lives in `marian-knows.yml`, so
`compose.yml` is copied without edits.

**Restart = update.** On every start the container:

1. pulls the latest knowledge repo (clones it the first time),
2. syncs the index (changed files only),
3. serves MCP on port 3000.

The code updates by pulling a new image. GitHub Actions builds one after every green push to `main`.

## Requirements

- A server with Docker and the `docker compose` plugin (Linux, amd64).
- Access to the knowledge repo's settings (GitHub, Gitea, GitLab…) to add a deploy key. Not needed for a public
  repo over https.
- A domain and a reverse proxy if the server faces the internet.

## 1. Directory

```bash
sudo -i
mkdir -p /srv/marian-knows/data
cd /srv/marian-knows
```

Install as root. Files in `data/` can belong to anyone: on every start the container fixes their owner, then
runs as the `node` user (UID 1000). All state lives in `/srv/marian-knows`; the container can be removed and
recreated at any time.

## 2. compose.yml

Copy [`docker/compose.example.yml`](https://github.com/BartoszStasiurka/marian-knows/blob/main/docker/compose.example.yml)
to `/srv/marian-knows/compose.yml`. No edits needed. `TZ` sets the time zone of `docker compose logs`; query
logs are always in UTC.

## 3. Knowledge base config

`data/marian-knows.yml`:

```yaml
name: Team knowledge base
description: >
  Operating procedures and server documentation, in English.
  Check here before answering about deploys, backups and access.
path: ./knowledge
git:
  url: git@git.example.com:team/knowledge.git
  deployKey: ./deploy_key
```

- `path`: where the knowledge repo is cloned (here `data/knowledge`). You can browse it on the host like any repo.
- `git.url`: the knowledge repo. Optional `git.branch` (default `main`) and `git.path` when the docs sit in a
  subdirectory of the repo; then only that directory is fetched.
- `git.deployKey`: do not create the file yourself, the container generates it on the first start (step 5).
  Remove the line for a public repo over https.
- `description` is what the agent reads to decide whether to use the base at all.
- Add `exclude` globs (e.g. `"**/draft/**"`) for files you do not want indexed.

More on the git block: [Git source](git-source.md).

## 4. Log in to GHCR (private image only)

```bash
docker login ghcr.io -u <github-login>
```

The password is a **classic** GitHub token with only `read:packages` (Settings → Developer settings → Personal
access tokens → Tokens (classic)). Fine-grained tokens lack that scope and GHCR rejects them. Skip this step for
a public image.

## 5. Start and add the deploy key

```bash
docker compose up -d
docker compose logs
```

The first time, the container creates `data/deploy_key` and stops with the public key in the log:

```
[start] syncing index
error: created the deploy key /data/deploy_key
ssh-ed25519 AAAAC3Nza… marian-knows
add this key to the repository as a read-only deploy key, then run index again
```

Add the `ssh-ed25519 …` line to the knowledge repo as a **read-only deploy key**. It opens only that one repo
and cannot change anything in it. The public key is also in `data/deploy_key.pub`. Until you add it the
container keeps restarting; that breaks nothing. Then:

```bash
docker compose restart
docker compose logs -f
```

A good start looks like this:

```
[start] syncing index
git: cloning git@git.example.com:team/knowledge.git (main)
git: git@git.example.com:team/knowledge.git (main) at 92be13a 2026-10-07T16:32:17+02:00
Files: 412
+ 412 added, ~ 0 changed, - 0 removed (1.8 s)
[start] serving MCP on port 3000
MCP over HTTP: http://0.0.0.0:3000/mcp
```

On the first connection the container stores the git server's host key in `data/deploy_key.known_hosts`. A
`no tokens` warning is normal at this point.

## 6. Tokens

```bash
docker compose exec marian-knows marian-knows token add anna
```

The token is shown **once**. The server accepts it at once, no restart. Run CLI commands in the container with
`docker compose exec`, never `docker compose run`: a new container has another hostname and would take over the
running server's index lock.

## 7. HTTPS

Port 3000 listens on `127.0.0.1` only, so outside traffic goes through a reverse proxy; see
[Serve over HTTP](serve-over-http.md#put-https-in-front). In a closed company network without a proxy, change
the port mapping in `compose.yml` to `"3000:3000"`.

## 8. Connect agents

Each person runs:

```bash
claude mcp add --transport http kb https://kb.example.com/mcp --header "Authorization: Bearer mk_…"
```

## Without git

If the docs reach the server another way (rsync, another process), leave out the `git` block and the key step.
Put the files in `data/knowledge` and set `path: ./knowledge`, so `compose.yml` stays as it is. Or mount a host
directory read-only:

```yaml
    volumes:
      - ./data:/data
      - /srv/docs:/knowledge:ro
```

and set `path: /knowledge`. The index lives in `data/.marian-knows/`, so the mount can be read-only. Either
way, the server picks up changed files on its next refresh (every `sync` minutes).

## Maintenance

| What changed                          | What you do                                                         |
| ------------------------------------- | ------------------------------------------------------------------- |
| Knowledge (push to the knowledge repo) | Nothing: the server pulls every `sync` minutes (default 15); `docker compose restart` pulls at once |
| Code (push to `main` in marian-knows) | `docker compose pull && docker compose up -d` (updates knowledge too) |
| `marian-knows.yml`                    | `docker compose restart`                                            |
| `compose.yml`                         | `docker compose up -d`                                              |

A restart takes a few seconds; agents get a connection error meanwhile and reconnect after.

### Versions and rollback

The `main` tag always points to the latest image that passed the tests. Every build also has a `sha-<commit>`
tag. To roll back, set `:sha-<previous commit>` in `compose.yml` and run `docker compose up -d`. Return to
`:main` once the fix lands.

### Logs and status

```bash
docker compose logs --tail 50                                  # start, warnings
docker compose exec marian-knows marian-knows log              # who asked what
docker compose exec marian-knows marian-knows log --zero       # no-result queries = knowledge gaps
docker compose exec marian-knows marian-knows status           # file count, index age
```

### Backup

Back up what cannot be rebuilt: `data/marian-knows.tokens.json` (without it everyone needs a new token). The
config, `compose.yml` and `data/deploy_key` are small and easy to recreate, but a copy saves time. The index and
the knowledge clone rebuild themselves on start.

### Move to another server

```bash
# old server
docker compose down
sudo tar czf marian-knows.tgz -C /srv marian-knows
# new server
sudo tar xzf marian-knows.tgz -C /srv
cd /srv/marian-knows && docker compose up -d
```

Tokens, key and config move with the directory. Set up the reverse proxy on the new server.

### Migrate from KNOWLEDGE_REPO

Older images took the repo from `KNOWLEDGE_REPO` and `KNOWLEDGE_BRANCH` in `compose.yml`. The current image
ignores them and warns.

1. In `data/marian-knows.yml` replace `path: knowledge` with:
   ```yaml
   path: ./knowledge
   git:
     url: <old KNOWLEDGE_REPO>
     branch: <old KNOWLEDGE_BRANCH, if not main>
     deployKey: ./deploy_key
   ```
2. Remove `KNOWLEDGE_REPO` and `KNOWLEDGE_BRANCH` from `compose.yml`.
3. `docker compose pull && docker compose up -d`.

The existing clone in `data/knowledge` is reused, since its origin matches `git.url`. The old `data/known_hosts`
can be deleted.

## Container errors

Errors and warnings in `docker compose logs`, with fixes, are in [Troubleshooting](../troubleshooting.md). Rule
of thumb: a missing knowledge repo on the first start stops the container; once a clone exists, every git
problem is a warning and the server keeps serving the last known content.
