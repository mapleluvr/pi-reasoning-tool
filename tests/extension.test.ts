import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_DESCRIPTION, PARAM_NAME, TOOL_NAME } from "../src/description.ts";
import { createExtension } from "../src/extension.ts";
import { createFileDescriptionStore } from "../src/store.ts";

interface Notification {
  message: string;
  level: string | undefined;
}

interface FakeContext {
  hasUI: boolean;
  notifications: Notification[];
  editorResult: string | undefined;
  editorCalls: Array<{ title: string; prefill: string | undefined }>;
  ui: {
    notify(message: string, level?: string): void;
    editor(title: string, prefill?: string): Promise<string | undefined>;
  };
}

function fakeContext(options: { hasUI?: boolean; editorResult?: string } = {}): FakeContext {
  const notifications: Notification[] = [];
  const editorCalls: Array<{ title: string; prefill: string | undefined }> = [];
  const ctx: FakeContext = {
    hasUI: options.hasUI ?? false,
    notifications,
    editorResult: options.editorResult,
    editorCalls,
    ui: {
      notify(message, level) {
        notifications.push({ message, level });
      },
      async editor(title, prefill) {
        editorCalls.push({ title, prefill });
        return ctx.editorResult;
      },
    },
  };
  return ctx;
}

function fakePi(activeTools: string[] = [TOOL_NAME]) {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  return {
    tools,
    commands,
    activeTools,
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    registerCommand(name: string, options: any) {
      commands.set(name, options);
    },
    getActiveTools() {
      return [...this.activeTools];
    },
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "pi-reasoning-tool-ext-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function setup(dir: string, options: { activeTools?: string[] } = {}) {
  const pi = fakePi(options.activeTools);
  const store = createFileDescriptionStore(join(dir, "state.json"));
  createExtension(pi as any, { store });
  return { pi, store };
}

async function runCommand(pi: ReturnType<typeof fakePi>, ctx: FakeContext, args: string) {
  const command = pi.commands.get("reasoning-tool");
  assert.ok(command, "reasoning-tool command should be registered");
  await command.handler(args, ctx as any);
}

test("registers the deep_reasoning tool with the default description", async () => {
  await withTempDir(async (dir) => {
    const { pi } = setup(dir);
    const tool = pi.tools.get(TOOL_NAME);
    assert.ok(tool, "deep_reasoning tool should be registered");
    assert.equal(tool.description, DEFAULT_DESCRIPTION);
    assert.deepEqual(tool.parameters.required, [PARAM_NAME]);
    assert.deepEqual(Object.keys(tool.parameters.properties), [PARAM_NAME]);
    assert.equal(tool.parameters.properties[PARAM_NAME].type, "string");
    assert.equal(typeof tool.execute, "function");
  });
});

test("a stored custom description wins at load time", async () => {
  await withTempDir(async (dir) => {
    const store = createFileDescriptionStore(join(dir, "state.json"));
    store.write("stored description");

    const pi = fakePi();
    createExtension(pi as any, { store });
    assert.equal(pi.tools.get(TOOL_NAME).description, "stored description");
  });
});

test("the tool returns the reasoning argument verbatim", async () => {
  await withTempDir(async (dir) => {
    const { pi } = setup(dir);
    const reasoning = "step 1\nstep 2\nconclusion";
    const result = await pi.tools.get(TOOL_NAME).execute("call-1", { [PARAM_NAME]: reasoning });
    assert.deepEqual(result.content, [{ type: "text", text: reasoning }]);
    assert.equal(result.details, undefined);
  });
});

test("/reasoning-tool set updates the registered description and persists it", async () => {
  await withTempDir(async (dir) => {
    const { pi, store } = setup(dir);
    const ctx = fakeContext();

    await runCommand(pi, ctx, "set brand new description");

    assert.equal(pi.tools.get(TOOL_NAME).description, "brand new description");
    assert.equal(store.read(), "brand new description");
    assert.equal(ctx.notifications.at(-1)?.level, "info");
    assert.match(ctx.notifications.at(-1)?.message ?? "", /brand new description|31 chars|updated/i);
  });
});

test("/reasoning-tool set warns instead of clearing when the value is empty", async () => {
  await withTempDir(async (dir) => {
    const { pi, store } = setup(dir);
    store.write("keep me");
    const ctx = fakeContext();

    await runCommand(pi, ctx, "set   ");

    assert.equal(pi.tools.get(TOOL_NAME).description, DEFAULT_DESCRIPTION);
    assert.equal(store.read(), "keep me");
    assert.equal(ctx.notifications.at(-1)?.level, "warning");
  });
});

test("/reasoning-tool reset restores the default and drops the stored value", async () => {
  await withTempDir(async (dir) => {
    const { pi, store } = setup(dir);
    const ctx = fakeContext();
    await runCommand(pi, ctx, "set custom value");
    assert.equal(store.read(), "custom value");

    await runCommand(pi, ctx, "reset");

    assert.equal(pi.tools.get(TOOL_NAME).description, DEFAULT_DESCRIPTION);
    assert.equal(store.read(), undefined);
    assert.equal(ctx.notifications.at(-1)?.level, "info");
  });
});

test("/reasoning-tool with no arguments opens an editor prefilled with the current description", async () => {
  await withTempDir(async (dir) => {
    const { pi, store } = setup(dir);
    const ctx = fakeContext({ hasUI: true, editorResult: "edited in the editor" });

    await runCommand(pi, ctx, "");

    assert.equal(ctx.editorCalls.length, 1);
    assert.equal(ctx.editorCalls[0].prefill, DEFAULT_DESCRIPTION);
    assert.equal(pi.tools.get(TOOL_NAME).description, "edited in the editor");
    assert.equal(store.read(), "edited in the editor");
  });
});

test("cancelling the editor leaves the description untouched", async () => {
  await withTempDir(async (dir) => {
    const { pi, store } = setup(dir);
    const ctx = fakeContext({ hasUI: true, editorResult: undefined });

    await runCommand(pi, ctx, "");

    assert.equal(ctx.editorCalls.length, 1);
    assert.equal(pi.tools.get(TOOL_NAME).description, DEFAULT_DESCRIPTION);
    assert.equal(store.read(), undefined);
  });
});

test("the editor path is refused without a UI, falling back to usage", async () => {
  await withTempDir(async (dir) => {
    const { pi } = setup(dir);
    const ctx = fakeContext({ hasUI: false });

    await runCommand(pi, ctx, "");

    assert.equal(ctx.editorCalls.length, 0);
    assert.equal(ctx.notifications.at(-1)?.level, "warning");
    assert.match(ctx.notifications.at(-1)?.message ?? "", /reasoning-tool/);
  });
});

test("/reasoning-tool show reports the source of the current description", async () => {
  await withTempDir(async (dir) => {
    const { pi } = setup(dir);
    const ctx = fakeContext();

    await runCommand(pi, ctx, "show");
    assert.match(ctx.notifications.at(-1)?.message ?? "", /default/i);

    await runCommand(pi, ctx, "set custom value");
    await runCommand(pi, ctx, "show");
    assert.match(ctx.notifications.at(-1)?.message ?? "", /custom/i);
    assert.match(ctx.notifications.at(-1)?.message ?? "", /custom value/);
  });
});

test("unknown subcommands report usage as a warning", async () => {
  await withTempDir(async (dir) => {
    const { pi } = setup(dir);
    const ctx = fakeContext();

    await runCommand(pi, ctx, "bogus");

    assert.equal(ctx.notifications.at(-1)?.level, "warning");
    assert.match(ctx.notifications.at(-1)?.message ?? "", /Usage/i);
  });
});

test("an inactive tool is called out after a description change", async () => {
  await withTempDir(async (dir) => {
    const { pi } = setup(dir, { activeTools: ["read", "bash"] });
    const ctx = fakeContext();

    await runCommand(pi, ctx, "set something");

    assert.match(ctx.notifications.at(-1)?.message ?? "", /not active/i);
  });
});

test("re-registering keeps the tool name stable and the command registered once", async () => {
  await withTempDir(async (dir) => {
    const { pi } = setup(dir);
    const ctx = fakeContext();

    await runCommand(pi, ctx, "set one");
    await runCommand(pi, ctx, "set two");

    assert.deepEqual([...pi.tools.keys()], [TOOL_NAME]);
    assert.deepEqual([...pi.commands.keys()], ["reasoning-tool"]);
    assert.equal(pi.tools.get(TOOL_NAME).description, "two");
  });
});
