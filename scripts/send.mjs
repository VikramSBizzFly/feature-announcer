#!/usr/bin/env node
// Sends one announcement, or records that a feature is not worth one.
//
//   node send.mjs --file <note.json>            note: { key, title, summary, body, url? }
//   node send.mjs --skip --key pr-12 --reason "Internal refactor, nothing visible"
//   add --dry-run to check a note without sending it.
//
// The note waits `delayMinutes` (from .claude/announcer.json) on the server
// before it goes out, and can be cancelled there until then.
import { existsSync, readFileSync } from "node:fs";

import { api, LIMITS, loadConfig, projectRoot, readToken } from "./lib.mjs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function check(note) {
  const problems = [];
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(note.key ?? ""))
    problems.push("key is missing or malformed");
  for (const field of ["title", "summary", "body"]) {
    const value = note[field];
    if (typeof value !== "string" || !value.trim())
      problems.push(`${field} is empty`);
    else if (value.length > LIMITS[field])
      problems.push(
        `${field} is ${value.length} characters (max ${LIMITS[field]})`,
      );
  }
  if (note.url !== undefined && !/^https?:\/\//.test(note.url))
    problems.push("url must start with http:// or https://");
  return problems;
}

async function main() {
  const root = projectRoot();
  const config = loadConfig(root);
  if (!config)
    fail("No .claude/announcer.json here, or no API address set for it.");

  let payload;
  if (flag("skip")) {
    const key = arg("key");
    const reason = arg("reason")?.trim();
    if (!key || !reason) fail("--skip needs --key and --reason.");
    if (reason.length > LIMITS.reason)
      fail(`--reason is longer than ${LIMITS.reason} characters.`);
    payload = { key, skip: true, reason };
  } else {
    const file = arg("file");
    if (!file || !existsSync(file)) fail("Pass --file <note.json>.");
    const note = JSON.parse(readFileSync(file, "utf8"));
    const problems = check(note);
    if (problems.length > 0) fail(`Not sent:\n- ${problems.join("\n- ")}`);
    payload = {
      key: note.key,
      title: note.title.trim(),
      summary: note.summary.trim(),
      body: note.body.trim(),
      ...(note.url ? { url: note.url } : {}),
      delayMinutes: config.delayMinutes,
    };
  }

  if (flag("dry-run")) {
    console.log(`Dry run, nothing sent:\n${JSON.stringify(payload, null, 2)}`);
    return;
  }

  const token = readToken(root, config);
  if (!token)
    fail(`${config.tokenEnv} is not set (environment or ${config.envFile}).`);

  const { status, json } = await api(config, token, "POST", "", payload);
  if (status === 409) {
    console.log(
      `${payload.key} was already announced or skipped. Nothing to do.`,
    );
    return;
  }
  if (status !== 201 && status !== 200) {
    fail(
      `Not sent: the endpoint answered ${status}${json?.message ? ` — ${json.message}` : ""}.`,
    );
  }
  if (payload.skip) {
    console.log(`${payload.key} recorded as not worth announcing.`);
    return;
  }
  console.log(
    `Scheduled "${payload.title}" (${payload.key}) to go out at ${json?.sendAt ?? "the set time"}. ` +
      "It can be cancelled until then from the admin console.",
  );
}

main().catch((error) =>
  fail(error instanceof Error ? error.message : String(error)),
);
