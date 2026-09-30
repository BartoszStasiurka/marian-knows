---
title: Logging guidelines
tags: [dev, observability]
---
# Logging guidelines

Applications write structured logs as JSON lines to stdout. The cluster ships them to Loki, where you can search them in Grafana.

## Log format

Every entry has `timestamp`, `level`, `message`, `service` and, inside a request, `request_id`. Add context as fields, not by concatenating strings: `logger.info({ orderId }, "order paid")`, not `logger.info("order " + id + " paid")`.

## Log levels

- `error`: something failed and a person should look at it.
- `warn`: unexpected but handled, for example a retry that succeeded.
- `info`: business events worth counting (user signed up, invoice issued).
- `debug`: disabled in production.

## What never goes into logs

Passwords, tokens, full card numbers, and personal data beyond user IDs. The logger redacts fields named `password`, `token` and `authorization`, but do not rely on it.

## Retention

Logs are kept for 14 days in Loki. Anything needed longer, such as audit events, goes to the audit table in the database instead.
