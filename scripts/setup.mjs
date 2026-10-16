#!/usr/bin/env node
// Adopts the plugin in the current project, for the setup skill.
//
//   node setup.mjs --product "Standup" --audience "Team leads who …"
//                  [--origin http://localhost:3000] [--start-from 2026-10-16]
//                  [--branch main] [--no-token] [--dry-run]
//   node setup.mjs verify   — checks the app's endpoint against the contract
//
// Writes, without touching anything it does not own:
//   .claude/settings.json   — adds the BizzFly marketplace and enables the
//                             plugin, keeping every other setting as it is
//   .claude/announcer.json  — created only if absent; never overwritten
//   .gitignore              — adds the env file and .claude/tmp/ if not ignored
//   the env file            — adds a generated publish token and --origin,
//                             each only if not already set
// and prints a JSON report of what it changed and what is still missing.
//
// 🔴 The generated token goes to the git-ignored env file only. It is never
// printed, and verify only ever sends it in the Authorization header.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { api, loadConfig, projectRoot, readToken } from "./lib.mjs";

const MARKETPLACE = "BizzFly";
const MARKETPLACE_SOURCE = {
  source: { source: "github", repo: "VikramSBizzFly/bizzfly-marketplace" },
};
const PLUGIN = `feature-announcer@${MARKETPLACE}`;

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);
const dryRun = flag("dry-run");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}
const git = (root, args) => run("git", args, root);

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${path} is not valid JSON. Fix it by hand, then run setup again.`);
  }
}

function write(path, text) {
  if (dryRun) return;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** `text` with `lines` added at the end, on lines of their own. */
function append(text, lines) {
  const prefix = text && !text.endsWith("\n") ? "\n" : "";
  return `${text}${prefix}${lines.join("\n")}\n`;
}

/** The default branch the remote reports, e.g. "main"; null if unknown. */
function remoteBranch(root, remote) {
  const ref = git(root, ["symbolic-ref", `refs/remotes/${remote}/HEAD`]);
  return ref ? ref.replace(`refs/remotes/${remote}/`, "") : null;
}

function checkTools(root, report) {
  const node = Number(process.versions.node.split(".")[0]);
  report.tools = {
    node: process.versions.node,
    git: git(root, ["--version"])?.replace(/^git version /, "") ?? null,
    gh: run("gh", ["--version"])?.split("\n")[0].replace(/^gh version /, "") ?? null,
  };
  if (node < 18) fail(`Node ${process.versions.node} is too old; the plugin needs Node 18+.`);
  if (!report.tools.gh)
    report.warnings.push(
      "gh is not installed: the announcer still works, reading pull requests from git alone.",
    );
}

function enablePlugin(root, report) {
  const path = join(root, ".claude", "settings.json");
  const settings = readJson(path) ?? {};
  let changed = false;

  settings.extraKnownMarketplaces ??= {};
  const existing = settings.extraKnownMarketplaces[MARKETPLACE];
  if (!existing) {
    settings.extraKnownMarketplaces[MARKETPLACE] = MARKETPLACE_SOURCE;
    changed = true;
  } else if (JSON.stringify(existing) !== JSON.stringify(MARKETPLACE_SOURCE)) {
    report.warnings.push(
      `.claude/settings.json already defines a "${MARKETPLACE}" marketplace with a different source; left as it is.`,
    );
  }

  settings.enabledPlugins ??= {};
  if (settings.enabledPlugins[PLUGIN] !== true) {
    settings.enabledPlugins[PLUGIN] = true;
    changed = true;
  }

  if (changed) {
    write(path, `${JSON.stringify(settings, null, 2)}\n`);
    report.changed.push(".claude/settings.json");
  } else report.unchanged.push(".claude/settings.json");
}

function writeConfig(root, report) {
  const path = join(root, ".claude", "announcer.json");
  if (existsSync(path)) {
    report.unchanged.push(".claude/announcer.json (already exists, not overwritten)");
    return readJson(path);
  }

  const productName = arg("product").trim();
  const audience = arg("audience").trim();
  const startFrom = arg("start-from") ?? new Date().toISOString().slice(0, 10);
  const config = { productName, audience, startFrom };
  const branch = arg("branch") ?? remoteBranch(root, "origin");
  if (branch && branch !== "main") config.branch = branch;

  write(path, `${JSON.stringify(config, null, 2)}\n`);
  report.changed.push(".claude/announcer.json");
  return config;
}

/** True if git already ignores `entry`. */
function isIgnored(root, entry) {
  const probe = entry.endsWith("/") ? `${entry}probe` : entry;
  return git(root, ["check-ignore", "-q", "--no-index", probe]) !== null;
}

function ignoreLocalFiles(root, envFile, report) {
  const path = join(root, ".gitignore");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const missing = [envFile, ".claude/tmp/"].filter(
    (entry) => !isIgnored(root, entry),
  );
  if (missing.length === 0) {
    report.unchanged.push(".gitignore");
    return;
  }
  write(path, append(text, missing));
  report.changed.push(`.gitignore (+ ${missing.join(", ")})`);
}

/**
 * Adds the token and the origin to the env file, each only when neither the
 * environment nor the file has it. The app reads the same file, so locally
 * the announcer and the endpoint agree on the token with nothing to copy.
 */
function writeEnv(root, { envFile, originEnv, tokenEnv, endpoint }, report) {
  // readToken looks a name up in the environment, then in the env file.
  const has = (name) => Boolean(readToken(root, { tokenEnv: name, envFile }));
  const lines = [];
  const added = [];

  if (!has(tokenEnv) && !flag("no-token")) {
    lines.push(`${tokenEnv}=${randomBytes(32).toString("base64url")}`);
    added.push(`${tokenEnv} (generated)`);
  }
  const origin = arg("origin");
  if (!endpoint && origin && !has(originEnv)) {
    lines.push(`${originEnv}=${origin.replace(/\/+$/, "")}`);
    added.push(originEnv);
  }

  if (lines.length) {
    const path = join(root, envFile);
    write(path, append(existsSync(path) ? readFileSync(path, "utf8") : "", lines));
    report.changed.push(`${envFile} (+ ${added.join(", ")})`);
  }

  if (!endpoint && !has(originEnv) && !origin)
    report.todo.push(`Set ${originEnv} (your API's origin) in the environment or ${envFile}.`);
  if (!has(tokenEnv) && flag("no-token"))
    report.todo.push(`Set ${tokenEnv} (the publish token) in the environment or ${envFile}.`);
}

function setup() {
  const root = projectRoot();
  if (git(root, ["rev-parse", "--git-dir"]) === null)
    fail("This is not a git repository; the announcer reads merges from git.");

  // Fail before writing anything, so a bad run leaves the project untouched.
  if (
    !existsSync(join(root, ".claude", "announcer.json")) &&
    !(arg("product")?.trim() && arg("audience")?.trim())
  )
    fail("Pass --product and --audience to create .claude/announcer.json.");
  const startFrom = arg("start-from");
  if (
    startFrom !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(startFrom) || isNaN(new Date(startFrom)))
  )
    fail("--start-from must be a date like 2026-10-16.");
  const origin = arg("origin");
  if (origin !== undefined && !/^https?:\/\/[^/\s]+\/?$/.test(origin))
    fail("--origin must be an origin like http://localhost:3000, with no path.");
  readJson(join(root, ".claude", "settings.json"));

  const report = { dryRun, changed: [], unchanged: [], warnings: [], todo: [] };
  checkTools(root, report);
  enablePlugin(root, report);
  const config = writeConfig(root, report);

  const names = {
    envFile: config.envFile ?? ".env.local",
    originEnv: config.originEnv ?? "ANNOUNCE_API_URL",
    tokenEnv: config.tokenEnv ?? "ANNOUNCE_PUBLISH_TOKEN",
    endpoint: config.endpoint,
  };
  // Ignore the env file before anything is written to it.
  ignoreLocalFiles(root, names.envFile, report);
  writeEnv(root, names, report);

  report.todo.push(
    "Make sure the app implements the announcements endpoint, then run: setup.mjs verify",
    `Commit .claude/settings.json, .claude/announcer.json and .gitignore — never ${names.envFile}.`,
  );
  console.log(JSON.stringify(report, null, 2));
}

/**
 * Exercises the endpoint the way the plugin will. Leaves one skip record
 * behind (`setup-check-…`), which is never sent to anyone.
 */
async function verify() {
  const root = projectRoot();
  const config = loadConfig(root);
  if (!config)
    fail("No .claude/announcer.json here, or no API address set for it.");
  const token = readToken(root, config);
  if (!token) fail(`No ${config.tokenEnv} in the environment or ${config.envFile}.`);

  const steps = [];
  async function step(name, request, passes) {
    try {
      const { status, json } = await request();
      steps.push({ step: name, ok: passes(status, json), status });
    } catch (error) {
      steps.push({ step: name, ok: false, error: error.cause?.code ?? error.name });
    }
  }

  const key = `setup-check-${Date.now()}`;
  const since = encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString());
  const keys = () => api(config, token, "GET", `/keys?since=${since}`);
  const record = () =>
    api(config, token, "POST", "", { key, skip: true, reason: "Setup check" });

  await step("GET /keys answers 200 with a keys list", keys, (s, j) =>
    s === 200 && Array.isArray(j?.keys));
  await step("POST a skip answers 201", record, (s) => s === 201);
  await step("the new key is listed by /keys", keys, (s, j) =>
    s === 200 && Array.isArray(j?.keys) && j.keys.includes(key));
  await step("POST the same key again answers 409", record, (s) => s === 409);
  await step(
    "a wrong token is refused with 401 or 403",
    () => api(config, `wrong-${randomBytes(8).toString("hex")}`, "GET", `/keys?since=${since}`),
    (s) => s === 401 || s === 403,
  );

  const ok = steps.every((s) => s.ok);
  console.log(JSON.stringify({ endpoint: config.endpoint, ok, steps }, null, 2));
  // exitCode, not exit(): exiting while fetch's sockets close aborts Node on Windows.
  if (!ok) process.exitCode = 1;
}

if (process.argv[2] === "verify") await verify();
else setup();
