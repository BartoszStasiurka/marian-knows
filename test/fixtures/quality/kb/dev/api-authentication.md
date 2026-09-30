---
title: API authentication
tags: [dev, api, security]
---
# API authentication

The public API uses short-lived JWT access tokens and long-lived refresh tokens.

## Obtaining tokens

`POST /auth/login` with email and password returns an access token (JWT, valid for 15 minutes) and a refresh token (opaque, valid for 30 days). Send the access token in the `Authorization: Bearer <token>` header.

## Refreshing

When the API answers 401 with `token_expired`, call `POST /auth/refresh` with the refresh token. The response contains a new access token and a new refresh token; the old refresh token is invalidated immediately (rotation). Reusing an old refresh token revokes the whole session, because it suggests the token was stolen.

## Service accounts

Integrations use API keys instead of user tokens. Keys are created in the admin panel, scoped to a set of permissions, and shown only once. Rotate keys at least once a year.

## Logout

`POST /auth/logout` revokes the refresh token. Access tokens cannot be revoked; they simply expire after 15 minutes.
