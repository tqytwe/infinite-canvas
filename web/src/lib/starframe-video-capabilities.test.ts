import assert from "node:assert/strict";
import test from "node:test";
import { supportsVideoFrameReferences } from "./video-model-capabilities";

test("StarFrame exposes protocol frame parameters independently of model name", () => {
    const names = [
        "ch0101-sd-2.0-1080p", "ch0101-sd-2.0-480p", "ch0101-sd-2.0-720p",
        "ch0102-sd-2.0-1080p", "ch0102-sd-2.0-720p", "ch0104-sd-2.0-720p",
        "ch0107-sd-2.5-480p", "ch0107-sd-2.5-720p", "ch0108-sd-2.5-720p",
        "ch1101-sd-2.0-720p", "ch1306-sd-2.0-480p", "ch1306-sd-2.0-720p",
        "ch1307-sd-2.5-720p", "ch1308-sd-2.0-720p", "ch1309-sd-2.0-480p",
        "ch1309-sd-2.0-720p", "ch1310-sd-2.5-720p", "ch1401-sd-2.5-720p",
        "custom-video-alias",
    ];
    for (const name of names) assert.equal(supportsVideoFrameReferences(name, "starframe"), true, name);
});

test("unknown OpenAI models keep their existing frame capability behavior", () => {
    assert.equal(supportsVideoFrameReferences("custom-video-alias", "openai"), false);
});
