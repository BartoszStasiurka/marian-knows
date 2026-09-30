---
title: Deploying to Kubernetes
tags: [ops, kubernetes, deploy]
---
# Deploying to Kubernetes

The API and the worker run on a managed Kubernetes cluster. Deployments go through Argo CD; nobody runs `kubectl apply` against production by hand.

## How a deploy works

Merging to `main` builds a container image tagged with the commit SHA and pushes it to the registry. The CI job then bumps the image tag in the `deploy` repository. Argo CD notices the change and syncs the cluster, rolling pods one by one. A deploy usually takes about four minutes.

## Rolling back a release

If a release misbehaves, roll back in Argo CD: open the application, pick the previous healthy revision in History and click Rollback. Then revert the tag bump in the `deploy` repository, otherwise the next sync puts the broken version back.

For an emergency without Argo CD access:

```bash
kubectl -n api rollout undo deployment/api
```

## Secrets and config

Secrets live in Vault and are injected by the External Secrets operator. Plain configuration goes into ConfigMaps in the `deploy` repository. Never commit secrets to Git, not even base64-encoded.

## Health checks

Every deployment needs a readiness probe on `/health/ready` and a liveness probe on `/health/live`. Pods that fail readiness do not receive traffic, which is what makes rolling updates safe.
