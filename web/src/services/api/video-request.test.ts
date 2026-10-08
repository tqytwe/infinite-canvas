import assert from "node:assert/strict";
import { test } from "node:test";

import { isMissingVideoModelError, postVideoWithModelFallback, videoFormDataToJson, videoPollParams } from "./video-request";

test("video form fallback preserves the model and repeated fields as JSON", () => {
    const form = new FormData();
    form.append("model", "video-model");
    form.append("prompt", "A short scene");
    form.append("input_reference[]", "https://media.example/one.png");
    form.append("input_reference[]", "https://media.example/two.png");

    assert.deepEqual(videoFormDataToJson(form), {
        model: "video-model",
        prompt: "A short scene",
        "input_reference[]": ["https://media.example/one.png", "https://media.example/two.png"],
    });
});

test("video form fallback is unavailable when the request contains a file", () => {
    const form = new FormData();
    form.append("model", "video-model");
    form.append("input_reference[]", new File(["image"], "reference.png", { type: "image/png" }));

    assert.equal(videoFormDataToJson(form), null);
});

test("only an explicit missing-model API error enables the video JSON fallback", () => {
    assert.equal(isMissingVideoModelError({ error: { message: "model is required", type: "invalid_request_error" } }), true);
    assert.equal(isMissingVideoModelError({ error: { message: "invalid model", type: "invalid_request_error" } }), false);
    assert.equal(isMissingVideoModelError({ msg: "model is required" }), false);
    assert.equal(isMissingVideoModelError("model is required"), false);
});

test("video request retries once as JSON after the explicit missing-model response", async () => {
    const form = new FormData();
    form.append("model", "video-model");
    form.append("prompt", "A short scene");
    const requests: (FormData | Record<string, unknown>)[] = [];

    const result = await postVideoWithModelFallback(form, true, async (body) => {
        requests.push(body);
        if (requests.length === 1) throw { response: { data: { error: { message: "model is required", type: "invalid_request_error" } } } };
        return "created";
    });

    assert.equal(result, "created");
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], { model: "video-model", prompt: "A short scene" });
});

test("video request does not retry unrelated errors or forms with files", async () => {
    const form = new FormData();
    form.append("model", "video-model");
    form.append("input_reference[]", new File(["image"], "reference.png", { type: "image/png" }));
    let requests = 0;

    await assert.rejects(postVideoWithModelFallback(form, true, async () => {
        requests += 1;
        throw { response: { data: { error: { message: "model is required", type: "invalid_request_error" } } } };
    }));
    assert.equal(requests, 1);

    await assert.rejects(postVideoWithModelFallback(new FormData(), true, async () => {
        requests += 1;
        throw { response: { data: { error: { message: "invalid model", type: "invalid_request_error" } } } };
    }));
    assert.equal(requests, 2);
});

test("video polling always sends the selected model", () => {
    assert.deepEqual(videoPollParams("seedance-2-0"), { model: "seedance-2-0" });
});
