# feature-announcer

A Claude Code plugin that announces shipped features to your users with no
publish button. When a feature lands on your main branch, Claude reads it,
decides whether users would notice it, writes a plain-language "What's new"
note and posts it to your app. Your app then sends it (push, email, in-app —
whatever it supports) after a short wait in which an admin can cancel it.

## Install

From the BizzFly marketplace:

```
/plugin marketplace add VikramSBizzFly/bizzfly-marketplace
/plugin install feature-announcer@BizzFly
```

Restart Claude Code. It does nothing in a project until that project has a
`.claude/announcer.json`. Needs Node.js on `PATH`.

## How it triggers

- **On session start**, and **after a Bash `gh pr merge`, `git push`, `git merge`
  or `git pull`**, a hook runs `scripts/detect.mjs`: `git fetch`, read the
  merges on the main branch, keep the ones whose PR title matches
  `featurePattern`, and ask your server which it has already seen. This costs
  no model tokens.
- If any are left, the hook tells Claude to run `/feature-announcer:announce`.
  Otherwise it is silent — and it is also silent with no config, no token or
  no network, so it never gets in the way.

The trigger needs a Claude Code session to be open in the project. A feature
merged while nobody has Claude open is announced at the next session start.
For an unattended machine, `claude -p "/feature-announcer:announce"` on a timer
does the same job.

## Adopting it in a project

The quick way: run `/feature-announcer:setup` in the app's repo. It does all
four steps below for local development:

- Claude proposes the product name, audience and local API address, and you
  confirm them.
- The setup script enables the plugin and writes `announcer.json`. It keeps
  your other settings and never overwrites an existing `announcer.json`.
- It git-ignores `.env.local`, then writes a generated publish token and the
  API address there. It never prints the token.
- If the app has no endpoint yet, Claude builds one from
  [`skills/setup/backend-contract.md`](skills/setup/backend-contract.md): the
  routes, a table, a sender that waits `delayMinutes`, and an admin cancel. It
  sends through the app's existing notification code, or through a stub it
  tells you about.
- `node scripts/setup.mjs verify` then tests the running endpoint.

Production still needs the token set as a secret and the API address, which
setup lists at the end. Commit everything except `.env.local`. Teammates are
then prompted to install the plugin when they trust the folder.

By hand:

1. **Enable it** in the project's `.claude/settings.json` (or install it
   once for yourself, as above):

   ```json
   {
     "extraKnownMarketplaces": {
       "BizzFly": { "source": { "source": "github", "repo": "VikramSBizzFly/bizzfly-marketplace" } }
     },
     "enabledPlugins": { "feature-announcer@BizzFly": true }
   }
   ```

2. **Configure it** in `.claude/announcer.json` (committed, no secrets):

   | Field            | Default                   | Meaning                                               |
   | ---------------- | ------------------------- | ----------------------------------------------------- |
   | `productName`    | —                         | The product's name, as users know it                  |
   | `audience`       | —                         | One line on who reads the notes                       |
   | `branch`         | `main`                    | The branch a feature has shipped on                   |
   | `remote`         | `origin`                  |                                                       |
   | `featurePattern` | `^feat`                   | Regex on the PR title (case-insensitive)              |
   | `startFrom`      | —                         | ISO date: nothing merged before it is ever offered    |
   | `lookbackDays`   | `14`                      | How far back to look                                  |
   | `delayMinutes`   | `30`                      | The wait before a note goes out                       |
   | `originEnv`      | `ANNOUNCE_API_URL`        | Env var holding your API's origin                     |
   | `path`           | `/platform/announcements` | Added to the origin                                   |
   | `endpoint`       | —                         | A full URL instead of `originEnv` + `path`            |
   | `tokenEnv`       | `ANNOUNCE_PUBLISH_TOKEN`  | Env var holding the bearer token                      |
   | `envFile`        | `.env.local`              | Read for `originEnv` / `tokenEnv` when not in the env |

   Set `startFrom` to the day you adopt it, or the first run offers every
   feature from the last `lookbackDays`.

3. **Give the machines that should announce** the API origin and a token, in
   the environment or in `envFile` (which must be git-ignored). A machine
   without them announces nothing.

4. **Implement the endpoint** in your app:

   | Request                                                               | Answer                                           |
   | --------------------------------------------------------------------- | ------------------------------------------------ |
   | `POST {endpoint}` `{ key, title, summary, body, url?, delayMinutes }` | `201` with `{ sendAt }`; `409` if `key` was used |
   | `POST {endpoint}` `{ key, skip: true, reason }`                       | `201`; `409` if `key` was used                   |
   | `GET {endpoint}/keys?since=<iso>`                                     | `200` `{ keys: string[] }` — every key seen      |

   Authenticate with `Authorization: Bearer <token>`, and let that token do
   nothing else. Limits: title 120, summary 300, body 4000, reason 300
   characters. `key` is `pr-<number>`.

## Running it by hand

```bash
# from the project's root, with <plugin> = where this plugin is checked out
node <plugin>/scripts/detect.mjs list      # what is pending
node <plugin>/scripts/send.mjs --file note.json --dry-run
```

The token is only ever sent in the `Authorization` header. It is never
printed, logged, put in a URL or written to a file.
