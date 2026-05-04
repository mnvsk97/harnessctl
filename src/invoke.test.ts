import { describe, expect, test } from "bun:test";
import { extractStatusHint } from "./invoke.ts";

describe("extractStatusHint", () => {
  test("keeps multiline command executions on one status line", () => {
    const hint = extractStatusHint(JSON.stringify({
      type: "item.started",
      item: {
        type: "command_execution",
        command: "apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: src/main.rs\n",
      },
    }));

    expect(hint).toBe("running: apply_patch <<'PATCH' *** Begin Patch *** Update F");
  });

  test("collapses escaped newline sequences in command executions", () => {
    const hint = extractStatusHint(JSON.stringify({
      type: "item.started",
      item: {
        type: "command_execution",
        command: String.raw`apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: src/main.rs`,
      },
    }));

    expect(hint).toBe("running: apply_patch <<'PATCH' *** Begin Patch *** Add File");
  });
});
