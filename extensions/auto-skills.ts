/**
 * Auto-Skills Extension
 *
 * Automatically injects relevant skills based on:
 * 1. File types mentioned in user's prompt
 * 2. Files the agent reads/edits/writes (detected via tool calls)
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SKILLS_BASE = join(homedir(), ".pi", "agent", "skills", "pi-skills");

const SKILL_TRIGGERS: Record<string, { patterns: RegExp[]; skill: string }> = {
  python: {
    patterns: [/\.py\b/, /\bpython\b/i, /\bpytest\b/i, /\bpip\b/i, /\bpoetry\b/i],
    skill: "python-dev-guidelines",
  },
  shell: {
    patterns: [/\.sh\b/, /\bbash\b/i, /\bshell\s+script/i, /\bzsh\b/i],
    skill: "shell-script-guidelines",
  },
  search: {
    patterns: [/\bsearch\s+(the\s+)?(web|internet|online)\b/i, /\bgoogle\b/i, /\bbrave\s+search\b/i],
    skill: "brave-search",
  },
};

function loadSkillContent(skillName: string): string | null {
  const skillPath = join(SKILLS_BASE, skillName, "SKILL.md");
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf-8");
}

function detectSkillFromPath(path: string): string | null {
  for (const [name, { patterns }] of Object.entries(SKILL_TRIGGERS)) {
    if (patterns.some((p) => p.test(path))) return name;
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  const injectedSkills = new Set<string>();

  pi.on("session_start", () => {
    injectedSkills.clear();
  });

  // Detect from user prompt
  pi.on("before_agent_start", async (event) => {
    const prompt = event.prompt;
    const toInject: string[] = [];

    for (const [name, { patterns, skill }] of Object.entries(SKILL_TRIGGERS)) {
      if (injectedSkills.has(name)) continue;
      if (patterns.some((p) => p.test(prompt))) {
        const content = loadSkillContent(skill);
        if (content) {
          toInject.push(content);
          injectedSkills.add(name);
        }
      }
    }

    if (toInject.length > 0) {
      return { systemPromptAppend: "\n\n" + toInject.join("\n\n---\n\n") };
    }
  });

  // Detect from file operations (read, edit, write)
  pi.on("tool_call", async (event, ctx) => {
    const path = event.input.path as string | undefined;
    if (!path) return;

    const skillName = detectSkillFromPath(path);
    if (!skillName || injectedSkills.has(skillName)) return;

    const skill = SKILL_TRIGGERS[skillName];
    const content = loadSkillContent(skill.skill);
    if (!content) return;

    injectedSkills.add(skillName);

    // Inject skill as a message for the current turn
    pi.sendMessage({
      customType: "auto-skill",
      content: `[Auto-loaded ${skill.skill} guidelines]\n\n${content}`,
      display: false,
    }, { deliverAs: "nextTurn" });

    ctx.ui.notify(`Loaded ${skill.skill} skill`, "info");
  });
}
