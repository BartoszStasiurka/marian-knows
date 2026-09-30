---
title: Local development environment
tags: [dev, docker]
---
# Local development environment

The whole stack runs locally with Docker Compose: API, worker, PostgreSQL, Redis and a mail catcher.

## First start

```bash
cp .env.example .env
docker compose up -d
npm run db:migrate
npm run db:seed
```

The API listens on `http://localhost:3000`, Mailpit on `http://localhost:8025`. Seed data creates the user `admin@kompas.local` with the password from `.env.example`.

## Resetting the database

To start from scratch, drop the volume: `docker compose down -v`, then run the first-start steps again. This deletes all local data.

## Common problems

- Port 5432 already in use: a local PostgreSQL is running outside Docker; stop it or change the port in `.env`.
- Slow file watching on macOS: enable VirtioFS in Docker Desktop settings.
- Containers cannot reach the internet behind the office VPN: set DNS to 1.1.1.1 in Docker Desktop.
