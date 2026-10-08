import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { navigationTools } from "./navigation-tools";

test("every visible creation tool has an implemented page", () => {
    for (const tool of navigationTools) {
        assert.ok(existsSync(fileURLToPath(new URL(`../app/(user)/${tool.slug}/page.tsx`, import.meta.url))), `${tool.slug} has no page`);
    }
});

test("existing available creation tools remain reachable", () => {
    assert.deepEqual(
        navigationTools.map((tool) => tool.slug),
        ["canvas", "image", "video", "prompts", "assets"],
    );
});
