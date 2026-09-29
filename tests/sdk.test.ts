/**
 * Real-path verification for pi-reasoning-tool.
 *
 * This drives a real Pi `AgentSession` through Pi's real extension loader and
 * captures the payload Pi hands to the provider, so it proves the whole chain:
 *
 *   /reasoning-tool set  ->  registerTool  ->  refreshTools  ->  provider payload
 *
 * The provider transport is a local HTTP server, so no paid tokens are spent;
 * everything above the socket is the production path.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_DESCRIPTION, PARAM_NAME, RECEIPT_TEXT, STATE_FILE_NAME, TOOL_NAME } from "../src/description.ts";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PROBE_PROVIDER = "ReasoningToolProbe";
const CUSTOM_DESCRIPTION = "Custom probe description: always route reasoning through this tool.";

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("probe server did not bind to a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Find this tool's entry in a provider payload, tolerating both wire shapes. */
function findToolDescription(payload: unknown, toolName: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const tools = (payload as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return undefined;
  for (const entry of tools) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, any>;
    const name = record.name ?? record.function?.name;
    if (name !== toolName) continue;
    return record.description ?? record.function?.description;
  }
  return undefined;
}

test("a description change reaches the provider payload through the real Pi path", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-reasoning-tool-sdk-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const payloads: unknown[] = [];
  const requestBodies: string[] = [];
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let reloaded: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requestBodies.push(Buffer.concat(chunks).toString("utf8"));
      // 4xx keeps Pi from retrying; we only need the outbound request to happen.
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "probe transport refuses requests" } }));
    });
  });

  try {
    const port = await listen(server);
    const modelId = "reasoning-tool-probe";

    // Documented path for a compatible endpoint: a probe provider in models.json
    // pointing at the local transport, with a dummy key so auth resolves.
    await writeFile(
      join(agentDir, "models.json"),
      `${JSON.stringify(
        {
          providers: {
            [PROBE_PROVIDER]: {
              baseUrl: `http://127.0.0.1:${port}/v1`,
              api: "openai-responses",
              apiKey: "probe-key",
              models: [
                {
                  id: modelId,
                  name: "Reasoning tool probe",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 128_000,
                  maxTokens: 4_096,
                },
              ],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
    });
    const model = modelRuntime.getModel(PROBE_PROVIDER, modelId);
    assert.ok(model, "the probe model must resolve from models.json");

    function createResourceLoader(): DefaultResourceLoader {
      return new DefaultResourceLoader({
        cwd: PROJECT_ROOT,
        agentDir,
        additionalExtensionPaths: [join(PROJECT_ROOT, "index.ts")],
        extensionFactories: [
          {
            name: "reasoning-tool-payload-capture",
            hidden: true,
            factory(pi) {
              pi.on("before_provider_request", (event) => {
                payloads.push(event.payload);
              });
            },
          },
        ],
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: "BASE PI SYSTEM PROMPT",
      });
    }

    async function createSession() {
      const resourceLoader = createResourceLoader();
      await resourceLoader.reload();
      const created = await createAgentSession({
        cwd: PROJECT_ROOT,
        agentDir,
        model: model as any,
        modelRuntime,
        resourceLoader,
        sessionManager: SessionManager.inMemory(PROJECT_ROOT),
      });
      await created.session.bindExtensions({
        mode: "print",
        onError(error) {
          throw new Error(`${error.event}: ${error.error}`);
        },
      });
      assert.deepEqual(created.extensionsResult.errors, [], "the extension must load without errors");
      return created.session;
    }

    session = await createSession();

    // 1. Load-time state: registered with the built-in default, and active.
    assert.equal(session.getToolDefinition(TOOL_NAME)?.description, DEFAULT_DESCRIPTION);
    assert.ok(session.getActiveToolNames().includes(TOOL_NAME), "the tool must be active by default");

    // 2. The command re-registers the tool in a live session and persists the value.
    await session.prompt(`/${"reasoning-tool"} set ${CUSTOM_DESCRIPTION}`);
    assert.equal(session.getToolDefinition(TOOL_NAME)?.description, CUSTOM_DESCRIPTION);
    assert.deepEqual(JSON.parse(await readFile(join(agentDir, STATE_FILE_NAME), "utf8")), {
      version: 1,
      description: CUSTOM_DESCRIPTION,
    });

    // 3. A real turn sends the new description to the provider.
    payloads.length = 0;
    requestBodies.length = 0;
    const turnError = await session
      .prompt("trigger one provider request")
      .then(() => undefined, (error: unknown) => error);
    assert.ok(
      payloads.length > 0,
      `the provider request must be attempted (turn error: ${
        turnError instanceof Error ? turnError.message : String(turnError)
      })`,
    );
    assert.equal(findToolDescription(payloads[0], TOOL_NAME), CUSTOM_DESCRIPTION);
    assert.ok(requestBodies.length > 0, "the probe transport must have received the request");
    assert.ok(
      requestBodies[0].includes(CUSTOM_DESCRIPTION),
      "the wire body must carry the adjusted description",
    );

    // 4. reset restores the built-in default and drops the stored value.
    await session.prompt("/reasoning-tool reset");
    assert.equal(session.getToolDefinition(TOOL_NAME)?.description, DEFAULT_DESCRIPTION);
    payloads.length = 0;
    await session.prompt("trigger one provider request").catch(() => undefined);
    assert.equal(findToolDescription(payloads[0], TOOL_NAME), DEFAULT_DESCRIPTION, "reset must reach the wire");

    // 5. A fresh session picks the stored description up at load time.
    await session.prompt(`/reasoning-tool set ${CUSTOM_DESCRIPTION}`);
    reloaded = await createSession();
    assert.equal(reloaded.getToolDefinition(TOOL_NAME)?.description, CUSTOM_DESCRIPTION);
    const parameters = reloaded.getAllTools().find((tool) => tool.name === TOOL_NAME)?.parameters as
      | { required?: string[] }
      | undefined;
    assert.deepEqual(parameters?.required, [PARAM_NAME]);

    // 6. The tool answers with a short receipt. The reasoning itself is already
    //    in the conversation as the tool call's argument, so it is not repeated.
    const result = await session
      .getToolDefinition(TOOL_NAME)!
      .execute("probe-call", { [PARAM_NAME]: "reasoning payload" }, undefined, undefined, undefined as never);
    assert.deepEqual(result.content, [{ type: "text", text: RECEIPT_TEXT }]);
    assert.ok(!JSON.stringify(result.content).includes("reasoning payload"));
  } finally {
    reloaded?.dispose();
    session?.dispose();
    await close(server);
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
});
