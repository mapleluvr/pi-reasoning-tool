import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMAND_NAME,
  DEFAULT_DESCRIPTION,
  PARAM_NAME,
  STATE_FILE_NAME,
  STATE_VERSION,
  TOOL_NAME,
  normalizeDescription,
  parseCommandArgs,
  resolveDescription,
  usageText,
} from "../src/description.ts";

test("default description is the exact requested text", () => {
  assert.equal(
    DEFAULT_DESCRIPTION,
    "This tool is appearing due to compatibility issues, you need to use this tool for reasoning whether deep or shallow, so the reasoning content can be fully passed back, and compressed, and executed by the extensions living in pi. Make full use of this tool for maximized convenience.",
  );
});

test("tool surface constants are stable", () => {
  assert.equal(TOOL_NAME, "deep_reasoning");
  assert.equal(PARAM_NAME, "deep_reasoning");
  assert.equal(COMMAND_NAME, "reasoning-tool");
  assert.equal(STATE_FILE_NAME, "pi-reasoning-tool-state.json");
  assert.equal(STATE_VERSION, 1);
});

test("normalizeDescription trims and rejects empty input", () => {
  assert.equal(normalizeDescription("  hello  "), "hello");
  assert.equal(normalizeDescription("   "), undefined);
  assert.equal(normalizeDescription(""), undefined);
  assert.equal(normalizeDescription(undefined), undefined);
});

test("resolveDescription falls back to the default", () => {
  assert.equal(resolveDescription(undefined), DEFAULT_DESCRIPTION);
  assert.equal(resolveDescription("   "), DEFAULT_DESCRIPTION);
  assert.equal(resolveDescription(" custom "), "custom");
});

test("no arguments opens the editor", () => {
  assert.deepEqual(parseCommandArgs(""), { kind: "edit" });
  assert.deepEqual(parseCommandArgs("   "), { kind: "edit" });
  assert.deepEqual(parseCommandArgs("edit"), { kind: "edit" });
  assert.deepEqual(parseCommandArgs("  EDIT  "), { kind: "edit" });
});

test("show and reset are exact subcommands", () => {
  assert.deepEqual(parseCommandArgs("show"), { kind: "show" });
  assert.deepEqual(parseCommandArgs("reset"), { kind: "reset" });
  assert.deepEqual(parseCommandArgs("SHOW"), { kind: "show" });
});

test("set takes the rest of the line verbatim, trimmed", () => {
  assert.deepEqual(parseCommandArgs("set hello world"), { kind: "set", description: "hello world" });
  assert.deepEqual(parseCommandArgs("  set   spaced   text  "), { kind: "set", description: "spaced   text" });
  assert.deepEqual(parseCommandArgs("set set the stage"), { kind: "set", description: "set the stage" });
  // Multi-line descriptions survive a set.
  assert.deepEqual(parseCommandArgs("set line one\nline two"), { kind: "set", description: "line one\nline two" });
});

test("set without a value and unknown subcommands return usage", () => {
  assert.equal(parseCommandArgs("set").kind, "usage");
  assert.equal(parseCommandArgs("set   ").kind, "usage");
  assert.equal(parseCommandArgs("settings").kind, "usage");
  assert.equal(parseCommandArgs("show extra").kind, "usage");
  assert.equal(parseCommandArgs("bogus").kind, "usage");
});

test("usage text mentions every subcommand", () => {
  const usage = usageText();
  for (const fragment of ["/reasoning-tool", "edit", "show", "set", "reset"]) {
    assert.ok(usage.includes(fragment), `usage should mention ${fragment}`);
  }
});
