---
name: setup
description: Adopt feature-announcer in the current project, end to end - enable the plugin for everyone, create .claude/announcer.json, generate the local publish token, build the app's announcements endpoint and delayed sender if missing, and verify it. Use when the user asks to set up, install, enable or adopt the feature announcer in a project.
---

# Set up feature-announcer in this project

This assumes the project is the app that will announce, with its backend in
the same repo. The setup script makes the config, token and git changes.
You find the values it cannot guess, build the backend if it is missing,
and prove it works.

## 1. Check what is already there

- If `.claude/announcer.json` exists, setup will not overwrite it. Show its
  contents and ask whether the user wants to change anything. Edit it by hand
  only if they say yes. You do not need `--product` or `--audience`.
- Search the code for the announcements `path` (default
  `/platform/announcements`). If the endpoint exists, skip building it in
  step 4 and only verify it.
- If the repo has no backend at all (a static site, or a front end whose API
  lives elsewhere), say so. Run steps 2 to 3 only, then hand the user
  `backend-contract.md` for the repo that holds the API.

## 2. Work out the values

- **productName**: the product's name as users know it, not the repo or package
  name. Look in `package.json`, the README title and the app's page titles.
- **audience**: one line on who reads the notes, e.g. "Team leads who review
  their team's daily standups". Use the README to propose it.
- **origin**: where the app listens locally, e.g. `http://localhost:3000`.
  Look in the dev script, the framework config or `.env*` files.
- **startFrom**: today's date, unless the user wants earlier features to be
  offered too.

Use AskUserQuestion to confirm `productName`, `audience` and `origin`. Offer
your guesses as the options. Never invent an audience the code does not
support.

## 3. Run the setup script

Preview first:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" --product "<name>" --audience "<one line>" --origin "<origin>" --dry-run
```

Show the user the `changed` list, then run it again without `--dry-run`. Add
`--start-from <YYYY-MM-DD>` or `--branch <name>` only if the user asked for
them. The script reads the branch from `origin` by itself.

It generates the publish token into the git-ignored env file (`.env.local`
by default), unless the token is already set. Never read the token, print it,
copy it elsewhere or put it in the chat.

If it fails (for example, invalid JSON in `.claude/settings.json`), report the
one-line error and stop. Do not rewrite the user's settings by hand.

## 4. Build the backend (only if it is missing)

Read `${CLAUDE_PLUGIN_ROOT}/skills/setup/backend-contract.md`. It is the spec.

1. Learn the stack: framework and router, database and migration tool, how
   secrets are loaded, auth and admin checks, job queue or scheduler, and
   any existing notification, mail or push code.
2. List the files you will add or change and how each part maps to the
   contract. Say whether `deliver` will use existing notification code or be
   a stub. Get a yes before writing.
3. Write it in the app's own style. Reuse its helpers and keep it small. Add
   no new dependency unless the app has nothing that can do the job, and if
   you need one, ask first.
4. Create the migration. Run it only against a local or development
   database, never against one whose URL looks shared or production.
5. Run the app's tests, plus the ones you added.

## 5. Verify

Start the app (ask the user to, if it needs something you cannot run), then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" verify
```

It checks the routes, the 409 on a repeated key and that a wrong token is
refused. It leaves one `setup-check-…` skip record, which is never sent.
Fix any failing step, then run it again. If the app cannot be started here,
say that verify did not run. Never call setup done without saying whether
verify passed.

## 6. Report

In a few lines:

- the files changed, by the script and by you;
- every warning, word for word;
- the verify result;
- whether `deliver` really sends, or is a stub that sends to no one yet;
- what production still needs: the token set as a server secret and on the
  machines that announce (the same value, from a secret store, not from this
  chat), `ANNOUNCE_API_URL` pointing at the deployed API, the migration run,
  and the sender scheduled where the app runs.

Do not commit unless the user asks. Commit the config, the code and the
migration, never the env file. Once the files are committed, teammates are
prompted to install the plugin when they trust the project folder.
