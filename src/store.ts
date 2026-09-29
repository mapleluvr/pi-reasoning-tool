/**
 * Description persistence.
 *
 * The adjusted tool description must survive across sessions and Pi processes,
 * so it lives in a small JSON file outside the conversation (see the Pi
 * extension guidance: "Data outside one session" -> external storage).
 *
 * The store takes an explicit path so it stays testable without a Pi runtime.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { STATE_VERSION, normalizeDescription } from "./description.ts";

export interface DescriptionStore {
  /** Absolute path backing this store. */
  readonly path: string;
  /** Stored custom description, or undefined when the default is in effect. */
  read(): string | undefined;
  /** Persist a custom description. */
  write(description: string): void;
  /** Drop the custom description so the built-in default applies again. */
  clear(): void;
}

type StateFile = {
  version: number;
  description: string;
};

function parseStateFile(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as Partial<StateFile>;
  if (data.version !== STATE_VERSION) return undefined;
  return normalizeDescription(data.description);
}

export function createFileDescriptionStore(filePath: string): DescriptionStore {
  return {
    path: filePath,

    read(): string | undefined {
      try {
        return parseStateFile(JSON.parse(readFileSync(filePath, "utf8")));
      } catch {
        // A missing, unreadable, or malformed file simply means "no custom
        // description"; the caller falls back to the built-in default.
        return undefined;
      }
    },

    write(description: string): void {
      const normalized = normalizeDescription(description);
      if (normalized === undefined) {
        throw new Error("Refusing to persist an empty tool description.");
      }

      const payload = `${JSON.stringify({ version: STATE_VERSION, description: normalized } satisfies StateFile)}\n`;
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

      const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        writeFileSync(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
        try {
          renameSync(temporaryPath, filePath);
        } catch {
          // Node's replacement rename varies across Windows filesystems.
          rmSync(filePath, { force: true });
          renameSync(temporaryPath, filePath);
        }
      } finally {
        rmSync(temporaryPath, { force: true });
      }
    },

    clear(): void {
      rmSync(filePath, { force: true });
    },
  };
}
