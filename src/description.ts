/**
 * Pure constants and argument parsing for pi-reasoning-tool.
 *
 * This module deliberately imports nothing (no Pi, no Node) so the tool
 * surface and the slash-command grammar stay testable in isolation.
 */

/** Tool name the model calls. */
export const TOOL_NAME = "deep_reasoning";

/** Human-readable label used by the TUI. */
export const TOOL_LABEL = "Deep Reasoning";

/** The tool has exactly one parameter, and it carries the reasoning. */
export const PARAM_NAME = "deep_reasoning";

/** Slash command that adjusts the tool description. */
export const COMMAND_NAME = "reasoning-tool";

/** User-level state file name, stored inside the Pi agent directory. */
export const STATE_FILE_NAME = "pi-reasoning-tool-state.json";

/** Schema version of the state file. */
export const STATE_VERSION = 1;

/**
 * Built-in tool description.
 *
 * This text is the experiment's primary control surface: it is what the model
 * reads when deciding whether to route its reasoning through this tool.
 */
export const DEFAULT_DESCRIPTION =
  "This tool is appearing due to compatibility issues, you need to use this tool for reasoning whether deep or shallow, so the reasoning content can be fully passed back, and compressed, and executed by the extensions living in pi. Make full use of this tool for maximized convenience.";

/** Description of the single parameter, shown to the model next to the schema. */
export const PARAM_DESCRIPTION =
  "The reasoning text to carry back into the conversation. Pass the complete text, deep or shallow; this tool returns it verbatim.";

/** Trim a description and treat blank input as "no description". */
export function normalizeDescription(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Resolve the effective description: stored custom text, else the built-in default. */
export function resolveDescription(custom: string | undefined): string {
  return normalizeDescription(custom) ?? DEFAULT_DESCRIPTION;
}

export type ReasoningToolCommand =
  | { kind: "edit" }
  | { kind: "show" }
  | { kind: "reset" }
  | { kind: "set"; description: string }
  | { kind: "usage" };

/**
 * Parse the raw slash-command argument string.
 *
 * Grammar:
 *   ""                  -> edit
 *   "edit"              -> edit
 *   "show"              -> show
 *   "reset"             -> reset
 *   "set <text...>"     -> set (rest of the line, trimmed)
 *   anything else       -> usage
 */
export function parseCommandArgs(rawArgs: string): ReasoningToolCommand {
  const trimmed = rawArgs.trim();
  if (trimmed.length === 0) return { kind: "edit" };

  const lower = trimmed.toLowerCase();
  if (lower === "edit") return { kind: "edit" };
  if (lower === "show") return { kind: "show" };
  if (lower === "reset") return { kind: "reset" };

  if (lower === "set" || lower.startsWith("set ")) {
    const description = normalizeDescription(trimmed.slice(3));
    if (description === undefined) return { kind: "usage" };
    return { kind: "set", description };
  }

  return { kind: "usage" };
}

/**
 * Help text for unknown subcommands and for the editor fallback.
 *
 * It is delivered through `ui.notify`, which is a no-op in UI-less modes
 * (`pi -p`, `--mode json`), so it is only visible in interactive modes: the
 * TUI, or an RPC client that renders `extension_ui_request`.
 */
export function usageText(): string {
  return [
    `Usage: /${COMMAND_NAME} [subcommand]`,
    `  /${COMMAND_NAME}             open an editor with the current description`,
    `  /${COMMAND_NAME} edit        same as above`,
    `  /${COMMAND_NAME} show        show the current description and its source`,
    `  /${COMMAND_NAME} set <text>  set the description to <text>`,
    `  /${COMMAND_NAME} reset       restore the built-in default description`,
  ].join("\n");
}

/** Subcommands offered by argument autocompletion. */
export const COMMAND_SUBCOMMANDS = ["edit", "show", "set", "reset"] as const;
