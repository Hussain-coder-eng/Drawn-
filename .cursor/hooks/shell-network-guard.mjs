#!/usr/bin/env node
/**
 * Cursor beforeShellExecution hook: ask before likely outbound network shell commands.
 * Reads hook JSON from stdin; prints permission JSON on stdout.
 */
import fs from "node:fs";

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const command = String(input.command ?? "");

const networkish =
  /\bcurl\b/i.test(command) ||
  /\bwget\b/i.test(command) ||
  /(^|\s)nc(\s|$)/i.test(command);

if (networkish) {
  console.log(
    JSON.stringify({
      permission: "ask",
      user_message:
        "This command may perform a network request. Review it before continuing.",
      agent_message:
        "Project hook (.cursor/hooks) flagged a possible network shell command.",
    })
  );
} else {
  console.log(JSON.stringify({ permission: "allow" }));
}
