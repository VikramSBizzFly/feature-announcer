# The announcements backend

What the app must provide for feature-announcer to work. Build it in the app's
own framework, database and style. This file says what it must do, not how
to write it in any one stack. `setup.mjs verify` checks the HTTP part.

## Configuration it reads

| Env var                  | Meaning                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `ANNOUNCE_PUBLISH_TOKEN` | The bearer token. Setup writes one to `.env.local` for local use |

Read it the way the app reads its other secrets. If the app does not load
`.env.local`, either load it the app's usual way or tell the user to put the
token where the app reads secrets. If the token is unset, the endpoint must
refuse every request. It must never accept an empty token.

## Storage: one table (or collection)

| Column      | Type        | Notes                                             |
| ----------- | ----------- | ------------------------------------------------- |
| `id`        | the app's   |                                                   |
| `key`       | text        | **unique**; e.g. `pr-161`, or `setup-check-…`     |
| `skip`      | boolean     | true = "not worth announcing", never sent         |
| `reason`    | text, null  | for skips                                         |
| `title`     | text, null  | ≤ 120                                             |
| `summary`   | text, null  | ≤ 300                                             |
| `body`      | text, null  | ≤ 4000                                            |
| `url`       | text, null  |                                                   |
| `status`    | text        | `pending` · `sending` · `sent` · `cancelled` · `skipped` · `failed` |
| `sendAt`    | timestamp   | null for skips                                    |
| `sentAt`    | timestamp   | null until sent                                   |
| `createdAt` | timestamp   |                                                   |

Add it as a migration in the app's migration tool. Index `status, sendAt`.

## The routes

All three sit under one base path, `/platform/announcements` by default (the
`path` in `.claude/announcer.json`). Every request needs
`Authorization: Bearer <token>`. Compare the token in constant time, e.g.
`crypto.timingSafeEqual` on equal-length buffers. Anything else gets **401**.
The token does nothing else in the app: it is not a user session and gives
no other access.

1. `POST {base}` with `{ key, title, summary, body, url?, delayMinutes }`
   - Validate: `key` matches `^[a-z0-9][a-z0-9._-]{0,99}$` (case-insensitive);
     title, summary and body are non-empty strings within the limits above;
     `url`, if present, starts with `http://` or `https://`; `delayMinutes`
     is an integer from 0 to 1440 (default 30). Bad input → **400**.
   - `key` already stored (any status) → **409**. Rely on the unique index,
     not on a check before the insert.
   - Store with `status = pending`, `sendAt = now + delayMinutes`.
   - → **201** `{ sendAt }` (ISO 8601).
2. `POST {base}` with `{ key, skip: true, reason }`
   - `reason` is a non-empty string ≤ 300. Store it with `status = skipped`.
   - → **201**; **409** if `key` is already stored.
3. `GET {base}/keys?since=<iso>`
   - → **200** `{ keys: [...] }`: every `key` with `createdAt >= since`, in
     any status, skips included. Missing or bad `since` → **400**.

## Sending after the wait

Something has to send each note when its `sendAt` arrives:

- Use the app's own job queue or scheduler if it has one: a delayed job per
  note, or a recurring job every minute.
- With neither, add the smallest thing that fits how the app runs: a cron
  route, a platform cron (e.g. Vercel or Cloud Scheduler), or a timer started
  with the server. Tell the user which one, and what it needs in production.

Each run: claim due notes **atomically** (one
`UPDATE … SET status = 'sending' WHERE status = 'pending' AND sendAt <= now()`
that returns the rows, or the ORM's equivalent), so two workers never send
the same note. Then call `deliver(note)`. On success, set `sent` and `sentAt`.
On error, set `failed` and log it. Do not retry in a loop.

## deliver(note)

A single function that sends one note to the product's users through whatever
the app already has: in-app notification records, email, web or mobile push.

- Look for existing notification, mailer or push code and call it. Do not add
  a new email or push provider.
- If there is none, write `deliver` as a stub that logs the note and is
  marked `TODO`, and say so plainly in the report. Notes then reach no one
  until it is filled in.
- Send the note's own text. Never add internal data to it.

## Cancel

Admins must be able to stop a pending note: set `status = cancelled` if it is
still `pending`. Expose this behind the app's **existing admin auth**, as an
admin route or an admin-page action. Never use the publish token for it.
If the app has no admin role, add a CLI script or a function, and say so.

## Tests

Follow the app's existing tests if it has any: auth refused, a 201 then a 409
for the same key, skips listed by `/keys`, and the sender claiming a due
note once.
