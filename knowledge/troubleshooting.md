---
title: Troubleshooting
tags: [troubleshooting, git, docker, http, index, config]
---

# Troubleshooting

Messages as MarianKnows prints them, what they mean, and what to do.

## Index and config

| Message                                           | Cause and fix                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `No index. Run: marian-knows index`               | No index for this config yet. Run `marian-knows index`.                       |
| `index is already running (pid N)`                | Another `index` or a running `serve` refresh holds the lock. Wait; in Docker use `docker compose exec`, never `run`. |
| `! warning: index refresh skipped: …`             | `serve` found the lock busy (a manual `index`). The next run tries again.     |
| `no indexed files under /x/`                      | The `--path` scope matches nothing. Check the path with `list`.               |
| Unknown anchor error                              | The anchor is not in the file. The message lists the valid anchors; the file may have changed since the search. |
| Skipped file warnings                             | Over 1 MB, a name with `#` or `?`, or a case collision. Rename or split the file. |
| Broken frontmatter warning                        | The file is indexed without title and tags. Check the `---` lines and the YAML. |
| Search finds nothing for a known page             | The query shares no word with the page. Add synonyms to the page; see [How search works](concepts/how-search-works.md#what-it-cannot-do). |

## Git source

| Message                                           | Cause and fix                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `git not found; install git or remove the git block` | Install git, or index a local directory.                                  |
| `error: created the deploy key …`                 | Normal on the first run: add the printed public key to the repo as a read-only deploy key, run `index` again. |
| `error: cannot clone …`                           | The first clone failed: wrong `git.url`, the key not added, or a wrong `git.branch`. Fix the config and retry. |
| `Permission denied (publickey)`                   | The deploy key is not added, or does not match `deployKey`. The message repeats the key to add. |
| `… is a clone of …, config says …`                | `git.url` does not match the clone in `path`. If you changed the URL on purpose, delete the directory to re-clone. |
| `path exists and is not a git repository`         | `path` holds files that are not a clone. MarianKnows writes nothing there: remove the directory or change `path`. |
| `! warning: fetch failed, indexing the previous content: …` | The git server is unreachable or the key was removed. The previous content stays indexed. |
| `the git host key has changed; if expected, delete <deployKey>.known_hosts` | The git server has a new host key. Confirm with its admin first; it is the only protection against a spoofed server. |
| `! warning: local changes in …, not updating`     | Someone edited the working copy. Commit, stash or discard the changes. In a container: delete the clone and restart. |
| `! warning: cannot fast-forward …`                | The history was rewritten (force push). Delete the clone to re-clone.         |
| `! warning: not indexing: … does not exist; the previous index stays` | `git.path` is wrong or the directory was removed from the repo. |

## Docker

| Symptom                                           | Cause and fix                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Container restarts in a loop                      | A new deploy key waits to be added, or the first clone fails. Read `docker compose logs`. |
| `error: missing config /data/marian-knows.yml`    | Create `data/marian-knows.yml`; see [Docker](guides/docker.md#3-knowledge-base-config). |
| `! warning: KNOWLEDGE_REPO is ignored`            | Old setup. See [Migrate from KNOWLEDGE_REPO](guides/docker.md#migrate-from-knowledge_repo). |
| `no tokens` warning                               | No HTTP tokens yet. `docker compose exec marian-knows marian-knows token add <name>`. |

## HTTP

| Symptom                                           | Cause and fix                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Agent gets 401                                    | Missing token, a typo, or a revoked token. Check `token list` and `.marian-knows/<config name>/logs/access-*.jsonl` for the reason (`missing`, `malformed`, `unknown`). |
| Agent gets 404 on a session                       | The session expired (30 minutes idle) or belongs to another token. The client opens a new one. |
| Every request rejected, warning about the tokens file | The tokens file is damaged or has an unknown version. Fix or restore it from backup. |

## Agent does not use the base

The agent decides from the config's `description`. Without one it only knows a base exists. Write what the base
holds, in which language, and when to check it, then restart the server. See
[Connect an agent](getting-started/connect-an-agent.md#make-the-agent-use-it).
