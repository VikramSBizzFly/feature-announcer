#!/usr/bin/env node
// Finds shipped features that have not been announced yet.
//
//   node detect.mjs hook   — run by the plugin's hooks. Reads the hook event
//                            on stdin and, if there is something to announce,
//                            tells Claude to run /feature-announcer:announce.
//                            Silent otherwise: no config, no token, offline,
//                            or a Bash command that was not a merge or push.
//   node detect.mjs list   — prints the pending features as JSON, for the skill.
//
// Cheap on purpose: git and one GET, no model tokens.
import { loadConfig, pendingFeatures, projectRoot, readToken } from "./lib.mjs";

const mode = process.argv[2] ?? "list";

/** A Bash command after which a feature may have just landed. */
const SHIPPING = /\bgh\s+pr\s+merge\b|\bgit\s+(push|merge|pull)\b/;

async function readStdin() {
  if (process.stdin.isTTY) return {};
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function main() {
  const event = mode === "hook" ? await readStdin() : {};
  const eventName = event.hook_event_name ?? "SessionStart";

  if (eventName === "PostToolUse") {
    const command = event.tool_input?.command ?? "";
    if (!SHIPPING.test(command)) return;
  }

  const root = projectRoot(event.cwd);
  const config = loadConfig(root);
  if (!config) {
    if (mode === "list") {
      console.error(
        "No .claude/announcer.json here, or no API address set for it.",
      );
      process.exitCode = 1;
    }
    return;
  }

  const token = readToken(root, config);
  if (!token) {
    if (mode === "list") {
      console.error(
        `${config.tokenEnv} is not set (environment or ${config.envFile}).`,
      );
      process.exitCode = 1;
    }
    return;
  }

  const pending = await pendingFeatures(root, config, token);

  if (mode === "list") {
    console.log(JSON.stringify(pending, null, 2));
    return;
  }
  if (pending.length === 0) return;

  const names = pending.map((pr) => `#${pr.number} "${pr.title}"`).join(", ");
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext:
          `Shipped features not announced to users yet: ${names}. ` +
          "Run the /feature-announcer:announce skill now to write and send " +
          "(or skip) each one, then continue with the user's request.",
      },
    }),
  );
}

main().catch((error) => {
  // A hook must never break the session: report in list mode only.
  if (mode === "list") {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
});
