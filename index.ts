/**
 * pi-reasoning-tool
 *
 * A single-parameter `deep_reasoning` tool whose tool-call argument carries the
 * model's reasoning, plus `/reasoning-tool` to adjust the tool description that
 * asks the model to use it.
 *
 * This entry point only wires the user-level state path into the extension.
 */

import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { STATE_FILE_NAME } from "./src/description.ts";
import { createExtension } from "./src/extension.ts";
import { createFileDescriptionStore } from "./src/store.ts";

export default function piReasoningTool(pi: ExtensionAPI): void {
  createExtension(pi, {
    store: createFileDescriptionStore(join(getAgentDir(), STATE_FILE_NAME)),
  });
}

export { createExtension } from "./src/extension.ts";
