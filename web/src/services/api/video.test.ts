import assert from "node:assert/strict";
import test from "node:test";

import { videoRequestProfile } from "@/lib/video-model-capabilities";
import { createVideoRequestBody } from "./video";
import { defaultConfig } from "@/stores/use-config-store";

const emptyInput = { references: [], videoReferences: [], audioReferences: [], firstFrame: null, lastFrame: null };

test("the configured video models select an audited request profile", () => {
    const expected = {
        "agnes-video-v2.0": "agnes-v20",
        "agnes-video-2.5": "agnes-v25",
        "agnes-video-2.5-flash": "agnes-v25",
        "manxue2.5": "documented-json",
        minimax_h3: "documented-json",
        "minimax_h3-10s": "documented-json",
        "sd2.5": "documented-json",
        "seedance2.5": "documented-json",
        "veo-3.1": "documented-json",
        "veo-3.1-fast": "documented-json",
        "veo-3.1-i2v": "documented-json",
    } as const;

    for (const [model, profile] of Object.entries(expected)) {
        assert.equal(videoRequestProfile(model), profile, model);
    }
    assert.equal(videoRequestProfile("unreviewed-video-model"), "generic-form");
});

test("Agnes Video V2.0 retains its legacy frame contract", async () => {
    const body = await createVideoRequestBody({ ...defaultConfig, videoSeconds: "6", size: "1280x720" }, "agnes-video-v2.0", "a lighthouse at dusk", emptyInput);

    assert.deepEqual(body, {
        model: "agnes-video-v2.0",
        prompt: "a lighthouse at dusk",
        num_frames: 145,
        frame_rate: 24,
        width: 1280,
        height: 720,
    });
});

test("Agnes Video 2.5 requests do not inherit V2.0 frame fields", async () => {
    const standard = await createVideoRequestBody({ ...defaultConfig, videoSeconds: "6", vquality: "2k", size: "720x1280" }, "agnes-video-2.5", "a lighthouse at dusk", emptyInput);
    assert.deepEqual(standard, {
        model: "agnes-video-2.5",
        prompt: "a lighthouse at dusk",
        seconds: "6",
        size: "2K",
        aspect_ratio: "9:16",
        n: 1,
        mode: "text",
    });

    const flash = await createVideoRequestBody({ ...defaultConfig, videoSeconds: "15", vquality: "2k", size: "1280x720" }, "agnes-video-2.5-flash", "a lighthouse at dusk", emptyInput);
    assert.deepEqual(flash, {
        model: "agnes-video-2.5-flash",
        prompt: "a lighthouse at dusk",
        seconds: "12",
        size: "720P",
        aspect_ratio: "16:9",
        n: 1,
        mode: "text",
    });
    for (const field of ["num_frames", "frame_rate", "width", "height"]) {
        assert.equal(Object.hasOwn(flash, field), false, field);
    }
});

test("Agnes Video 2.5 Flash enforces its documented reference limits", async () => {
    const references = Array.from({ length: 6 }, (_, index) => ({ id: String(index), name: `${index}.png`, type: "image/png", dataUrl: "data:image/png;base64,AA==" }));
    await assert.rejects(() => createVideoRequestBody({ ...defaultConfig }, "agnes-video-2.5-flash", "a lighthouse at dusk", { ...emptyInput, references }), /最多支持 5 张图片参考/);
    await assert.rejects(
        () => createVideoRequestBody({ ...defaultConfig }, "agnes-video-2.5-flash", "a lighthouse at dusk", { ...emptyInput, videoReferences: [{ id: "v", name: "v.mp4", type: "video/mp4", url: "https://example.test/v.mp4" }] }),
        /不支持参考视频/,
    );
});

test("documented JSON aliases retain their individual request shapes", async () => {
    for (const model of ["manxue2.5", "minimax_h3", "minimax_h3-10s", "veo-3.1", "veo-3.1-fast", "veo-3.1-i2v"]) {
        const body = await createVideoRequestBody({ ...defaultConfig, videoSeconds: "6", size: "1280x720" }, model, "a lighthouse at dusk", emptyInput);
        assert.deepEqual(body, {
            model,
            prompt: "a lighthouse at dusk",
            size: "1280x720",
            duration: 6,
        });
    }

    for (const model of ["seedance2.5", "sd2.5"]) {
        const body = await createVideoRequestBody({ ...defaultConfig, videoSeconds: "6", size: "1280x720" }, model, "a lighthouse at dusk", emptyInput);
        assert.deepEqual(body, {
            model,
            prompt: "a lighthouse at dusk",
            size: "1280x720",
            seconds: "6",
            resolution: "720p",
            generate_audio: false,
        });
    }
});

test("generic video requests do not receive an Agnes protocol by name similarity", async () => {
    const body = await createVideoRequestBody({ ...defaultConfig, videoSeconds: "6", size: "1280x720" }, "generic-video", "a lighthouse at dusk", emptyInput);
    assert.ok(body instanceof FormData);
    assert.equal(body.get("model"), "generic-video");
    assert.equal(body.get("seconds"), "6");
    assert.equal(body.get("frame_rate"), null);
    assert.equal(body.get("num_frames"), null);
});
