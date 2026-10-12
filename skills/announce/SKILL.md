---
name: announce
description: Write and send a "What's new" announcement for each shipped feature that has not been announced yet, or record that it is not worth one. Use when the feature-announcer hook reports unannounced features, or when the user asks to announce a feature.
---

# Announce shipped features

Every user of the product will receive what you write here: a push notification,
an email, and a desktop popup. There is no human review step before it goes out,
only a short wait during which an admin can cancel it. Write accordingly.

## 1. Find what is pending

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs" list
```

It prints a JSON list of merged pull requests whose title matches the project's
feature pattern and that the server has not seen: `key`, `number`, `title`, `sha`.
An empty list means there is nothing to do — say so in one line and stop.
If it fails (no config, no token, endpoint down), report the one-line error and
stop. Never try to work around a missing token.

## 2. For each pending feature

1. Read what actually shipped:
   - `gh pr view <number> --json title,body,files` if `gh` works, otherwise
     `git show --stat <sha>` and `git log -1 --format=%B <sha>`.
   - Look at the diff only as far as needed to understand what a user now sees
     or can do. Do not dump it.
2. Decide: **would a user see, feel or use this?**
   - New screen, new option, new behaviour, a visible improvement → announce.
   - Refactor, internal tooling, CI, dependency bump, a fix to something users
     never noticed, an admin-only or developer-only change → skip.
   - When unsure, skip. A missed announcement costs nothing; a confusing one
     reaches everyone.
3. To skip:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/send.mjs" --skip --key <key> --reason "<one short sentence>"
   ```
4. To announce, write `.claude/tmp/announce-<key>.json` (create `.claude/tmp/`
   if needed):
   ```json
   {
     "key": "pr-161",
     "title": "Approve your day from your phone",
     "summary": "You can now review and send your day from the Standup phone app.",
     "body": "You can now review your day on your phone and send it from there.\n\n- Open the phone app when your day is ready\n- Untick anything you do not want sent\n- Tap Send",
     "url": "https://optional.link/to/help"
   }
   ```
   Then send it and delete the file:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/send.mjs" --file .claude/tmp/announce-<key>.json
   ```
   Use `--dry-run` first if you want the script to check the lengths.

## How to write it

Read `.claude/announcer.json` for `productName` and `audience`, and write for
that audience.

- **title** (≤ 120 chars): what the person can now do, in plain words. Not the PR title.
- **summary** (≤ 300 chars): one or two sentences. This is the push notification.
- **body** (≤ 4000 chars, usually far less): what changed, where to find it, and
  how to use it. Short sentences. Up to five `- ` bullets. Plain text only — no
  markdown headings, no HTML, no emoji.
- **url**: only a real, public help or release page. Never a PR, a commit, a
  repository or a staging link. Leave it out when there is none.

Never include: file, function, class, table or variable names; ticket or PR
numbers; internal team or customer names; anything from `.env` files, tokens,
URLs of internal systems, or personal data. Do not promise anything the change
does not do, and do not mention what is coming next.

## When done

Report one line per feature: announced (with the time it goes out) or skipped
(with the reason). Then continue with whatever the user was doing.
