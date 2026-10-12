// Shared by detect.mjs and send.mjs. No dependencies: Node 18+ only.
//
// 🔴 The token is read here and used in an Authorization header. It is never
// printed, never put in a URL and never written to a file.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const LIMITS = { title: 120, summary: 300, body: 4000, reason: 300 };

const DEFAULTS = {
  branch: "main",
  remote: "origin",
  featurePattern: "^feat",
  tokenEnv: "ANNOUNCE_PUBLISH_TOKEN",
  /** The API origin to announce to; the path below is added to it. */
  originEnv: "ANNOUNCE_API_URL",
  path: "/platform/announcements",
  envFile: ".env.local",
  delayMinutes: 30,
  lookbackDays: 14,
};

/** The project being worked on: Claude Code's project dir, else cwd. */
export function projectRoot(hint) {
  return process.env.CLAUDE_PROJECT_DIR || hint || process.cwd();
}

/**
 * `.claude/announcer.json`, merged over the defaults; null if absent, or if
 * no endpoint is known on this machine. The endpoint is `endpoint` when the
 * config spells it out, else `<originEnv><path>`, read like the token — so
 * the committed config never names a server, and a machine without the
 * value simply announces nothing.
 */
export function loadConfig(root) {
  const path = join(root, ".claude", "announcer.json");
  if (!existsSync(path)) return null;
  const config = { ...DEFAULTS, ...JSON.parse(readFileSync(path, "utf8")) };
  const origin = config.endpoint
    ? null
    : process.env[config.originEnv] ||
      readEnvFile(join(root, config.envFile), config.originEnv);
  const endpoint =
    config.endpoint ??
    (origin ? `${origin.replace(/\/+$/, "")}${config.path}` : null);
  if (!endpoint) return null;
  config.endpoint = endpoint.replace(/\/+$/, "");
  return config;
}

/** A bare KEY=VALUE reader — enough for a .env file, no expansion. */
function readEnvFile(path, key) {
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match || match[1] !== key) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    return value || undefined;
  }
  return undefined;
}

/** The token from the environment, else from the project's env file. */
export function readToken(root, config) {
  return (
    process.env[config.tokenEnv] ||
    readEnvFile(join(root, config.envFile), config.tokenEnv)
  );
}

export async function api(config, token, method, path, body) {
  const response = await fetch(`${config.endpoint}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (a proxy's error page): keep the status only.
  }
  return { status: response.status, json };
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 20_000,
  });
}

/**
 * Pull requests merged into the branch since `since`, from git alone — no
 * GitHub login needed. Understands GitHub's merge commits ("Merge pull
 * request #12 from …", title on the next line) and squash merges
 * ("feat: thing (#12)").
 */
export function mergedPullRequests(root, config, since) {
  try {
    git(root, ["fetch", config.remote, config.branch, "--quiet"]);
  } catch {
    // Offline: read what we already have.
  }
  const ref = `${config.remote}/${config.branch}`;
  const log = git(root, [
    "log",
    ref,
    "--first-parent",
    `--since=${since.toISOString()}`,
    "--format=%H%x1f%cI%x1f%s%x1f%b%x1e",
  ]);

  const found = [];
  for (const record of log.split("\x1e")) {
    const [sha, date, subject = "", body = ""] = record
      .replace(/^\s+/, "")
      .split("\x1f");
    if (!sha) continue;
    const merge = /^Merge pull request #(\d+)/.exec(subject);
    const squash = /\(#(\d+)\)\s*$/.exec(subject);
    const number = merge?.[1] ?? squash?.[1];
    if (!number) continue;
    const title = merge
      ? (body.split(/\r?\n/).find((line) => line.trim()) ?? "").trim()
      : subject.replace(/\s*\(#\d+\)\s*$/, "").trim();
    found.push({
      key: `pr-${number}`,
      number: Number(number),
      title,
      sha,
      mergedAt: date,
    });
  }
  return found;
}

/** Features merged since the plugin was adopted that the server has not seen. */
export async function pendingFeatures(root, config, token) {
  const lookback = new Date(Date.now() - config.lookbackDays * 86_400_000);
  const startFrom = config.startFrom ? new Date(config.startFrom) : lookback;
  const since = startFrom > lookback ? startFrom : lookback;

  const pattern = new RegExp(config.featurePattern, "i");
  const features = mergedPullRequests(root, config, since).filter((pr) =>
    pattern.test(pr.title),
  );
  if (features.length === 0) return [];

  const { status, json } = await api(
    config,
    token,
    "GET",
    `/keys?since=${encodeURIComponent(since.toISOString())}`,
  );
  if (status !== 200 || !Array.isArray(json?.keys)) {
    throw new Error(`The announcements endpoint answered ${status}.`);
  }
  const known = new Set(json.keys);
  return features.filter((pr) => !known.has(pr.key));
}
