import assert from "node:assert/strict";
import test from "node:test";

import { createVideoRequestBody } from "./video";
import { defaultConfig } from "@/stores/use-config-store";

const emptyInput = { references: [], videoReferences: [], audioReferences: [], firstFrame: null, lastFrame: null };

test("Agnes video requests omit unsupported frame_rate", async () => {
    const body = await createVideoRequestBody({ ...defaultConfig, videoSeconds: "6", size: "1280x720" }, "agnes-video-v2.0", "a lighthouse at dusk", emptyInput);

    assert.deepEqual(body, {
        model: "agnes-video-v2.0",
        prompt: "a lighthouse at dusk",
        num_frames: 145,
        width: 1280,
        height: 720,
    });
    assert.equal(Object.hasOwn(body as object, "frame_rate"), false);
});

test("documented JSON and generic video requests retain their own contracts", async () => {
    const documented = await createVideoRequestBody({ ...defaultConfig, videoSeconds: "6", size: "1280x720" }, "seedance2.5", "a lighthouse at dusk", emptyInput);
    assert.deepEqual(documented, {
        model: "seedance2.5",
        prompt: "a lighthouse at dusk",
        size: "1280x720",
        seconds: "6",
        resolution: "720p",
        generate_audio: false,
    });

    const generic = await createVideoRequestBody({ ...defaultConfig, videoSeconds: "6", size: "1280x720" }, "generic-video", "a lighthouse at dusk", emptyInput);
    assert.ok(generic instanceof FormData);
    assert.equal(generic.get("model"), "generic-video");
    assert.equal(generic.get("seconds"), "6");
    assert.equal(generic.get("frame_rate"), null);
});
