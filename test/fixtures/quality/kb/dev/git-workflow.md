---
title: Git workflow
tags: [dev, git]
---
# Git workflow

We use trunk-based development with short-lived branches. `main` is always deployable.

## Branches

Name branches `<type>/<ticket>-<short-description>`, for example `feat/KMP-142-invoice-export` or `fix/KMP-201-login-redirect`. A branch should live for days, not weeks. If it grows, split the work and hide unfinished parts behind a feature flag.

## Pull requests

Open a pull request early as a draft. A PR needs one approval and a green CI run before merging. Keep PRs under roughly 400 changed lines; bigger ones get worse reviews. Describe what changed and why, and how you tested it.

## Merging

We squash merge. The squash commit message is the PR title, written in imperative mood ("Add invoice export"), followed by the ticket number. Delete the branch after merging. Never force-push to `main`.

## Commit messages on branches

Commits on your branch are for you; they disappear in the squash. Still, avoid committing secrets or large binaries — they stay in history even after squashing if the branch was pushed.
