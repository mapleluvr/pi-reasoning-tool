/**
 * pi-reasoning-tool extension logic.
 *
 * The experiment: can a model use a tool call's *argument* as the carrier for
 * its reasoning? The tool therefore has exactly one parameter, and it answers
 * with a short receipt rather than an echo: the argument itself already lands in
 * the conversation as the tool call, where it can be compressed and observed by
 * extensions.
 *
 * The tool description is the experiment's control surface, and `/reasoning-tool`
 * adjusts it at runtime. Re-registering a tool with the same name from the same
 * extension replaces its definition (the loader keeps tools in a Map) and
 * `refreshTools()` rebuilds the active tool set plus the system prompt, so a
 * description change takes effect on the next model request.
 */

import { Type, type Static } from "typebox";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  COMMAND_NAME,
  COMMAND_SUBCOMMANDS,
  DEFAULT_DESCRIPTION,
  PARAM_DESCRIPTION,
  PARAM_NAME,
  RECEIPT_TEXT,
  TOOL_LABEL,
  TOOL_NAME,
  normalizeDescription,
  parseCommandArgs,
  resolveDescription,
  usageText,
} from "./description.ts";
import type { DescriptionStore } from "./store.ts";

const ReasoningParameters = Type.Object({
  [PARAM_NAME]: Type.String({ description: PARAM_DESCRIPTION }),
});

type ReasoningParams = Static<typeof ReasoningParameters>;

export interface ReasoningToolDeps {
  /** Persistence for the adjustable tool description. */
  store: DescriptionStore;
}

function preview(description: string, maxLength = 160): string {
  const oneLine = description.replace(/\s+/g, " ").trim();
  return oneLine.length <= maxLength ? oneLine : `${oneLine.slice(0, maxLength - 1)}…`;
}

export function createExtension(pi: ExtensionAPI, deps: ReasoningToolDeps): void {
  const store = deps.store;
  let currentDescription = resolveDescription(store.read());

  const registerTool = (description: string): void => {
    pi.registerTool({
      name: TOOL_NAME,
      label: TOOL_LABEL,
      description,
      parameters: ReasoningParameters,
      async execute(_toolCallId, _params: ReasoningParams) {
        // The reasoning already reached the conversation as this tool call's
        // argument, so the result is a short receipt instead of an echo: the
        // text is in context either way, and repeating it would only double the
        // tokens spent on it.
        return {
          content: [{ type: "text" as const, text: RECEIPT_TEXT }],
          details: undefined,
        };
      },
    });
  };

  registerTool(currentDescription);

  const activeNote = (): string =>
    pi.getActiveTools().includes(TOOL_NAME) ? "" : ` Note: ${TOOL_NAME} is not active in this session.`;

  const apply = (description: string): void => {
    currentDescription = description;
    registerTool(description);
  };

  const commitCustom = (raw: string, ctx: ExtensionCommandContext): void => {
    const next = normalizeDescription(raw);
    if (next === undefined) {
      ctx.ui.notify("Description unchanged: input is empty.", "warning");
      return;
    }
    store.write(next);
    apply(next);
    ctx.ui.notify(`Updated ${TOOL_NAME} description (${next.length} chars, custom).${activeNote()}`, "info");
  };

  pi.registerCommand(COMMAND_NAME, {
    description: `Show or adjust the ${TOOL_NAME} tool description`,

    getArgumentCompletions(argumentPrefix: string) {
      const matches = COMMAND_SUBCOMMANDS.filter((name) => name.startsWith(argumentPrefix.trim()));
      return matches.length > 0 ? matches.map((name) => ({ value: name, label: name })) : null;
    },

    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const command = parseCommandArgs(args);

      switch (command.kind) {
        case "usage": {
          ctx.ui.notify(usageText(), "warning");
          return;
        }

        case "show": {
          // Report the live registered description, which is what the model
          // actually sees, but take the source from the store: a stored value
          // that happens to equal the default text is still a custom value.
          const source = store.read() === undefined ? "default" : "custom";
          ctx.ui.notify(
            `${TOOL_NAME} description (${source}, ${currentDescription.length} chars): ${preview(currentDescription)}${activeNote()}`,
            "info",
          );
          return;
        }

        case "edit": {
          if (!ctx.hasUI) {
            ctx.ui.notify(usageText(), "warning");
            return;
          }
          const edited = await ctx.ui.editor(`${TOOL_NAME} tool description`, currentDescription);
          // undefined means the user cancelled the editor.
          if (edited === undefined) return;
          commitCustom(edited, ctx);
          return;
        }

        case "set": {
          commitCustom(command.description, ctx);
          return;
        }

        case "reset": {
          store.clear();
          apply(DEFAULT_DESCRIPTION);
          ctx.ui.notify(
            `Restored the default ${TOOL_NAME} description (${DEFAULT_DESCRIPTION.length} chars).${activeNote()}`,
            "info",
          );
          return;
        }
      }
    },
  });
}
