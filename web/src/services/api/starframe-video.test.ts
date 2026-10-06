import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStarframeVideoBody, normalizeStarframeVideoResult, starframeRetryClientTaskId, starframePollExpired, assertStarframeVideoContent, carryStarframeClientTaskId } from "./starframe-video";

const models = [
    "ch0101-sd-2.0-1080p", "ch0101-sd-2.0-480p", "ch0101-sd-2.0-720p",
    "ch0102-sd-2.0-1080p", "ch0102-sd-2.0-720p", "ch0104-sd-2.0-720p",
    "ch0107-sd-2.5-480p", "ch0107-sd-2.5-720p", "ch0108-sd-2.5-720p",
    "ch1101-sd-2.0-720p", "ch1306-sd-2.0-480p", "ch1306-sd-2.0-720p",
    "ch1307-sd-2.5-720p", "ch1308-sd-2.0-720p", "ch1309-sd-2.0-480p",
    "ch1309-sd-2.0-720p", "ch1310-sd-2.5-720p", "ch1401-sd-2.5-720p",
];

test("all user video IDs and custom aliases are preserved without name inference", () => {
    for (const model of [...models, "custom-name-not-in-catalog"]) {
        assert.deepEqual(buildStarframeVideoBody({ model, prompt: "Scene", clientTaskId: "order-001" }), {
            model, prompt: "Scene", client_task_id: "order-001", mode: "references",
        });
    }
});

test("duration is numeric and not clamped and resolution comes only from selection", () => {
    const body = buildStarframeVideoBody({ model: models[0], prompt: "Scene", clientTaskId: "order-001", duration: 20, resolution: "720p", aspectRatio: "9:16" });
    assert.equal(body.duration, 20);
    assert.equal(body.resolution, "720p");
    assert.equal(body.aspect_ratio, "9:16");
});

test("references use singular fields for one and plural for multiple URLs", () => {
    const body = buildStarframeVideoBody({ model: models[0], prompt: "Scene", clientTaskId: "order-001", images: ["https://media.example/1.png", "https://media.example/2.png"], videos: ["https://media.example/1.mp4"] });
    assert.deepEqual(body.references, { images: ["https://media.example/1.png", "https://media.example/2.png"], video: "https://media.example/1.mp4" });
});

test("frames require both URLs and cannot be mixed with references", () => {
    const base = { model: models[0], prompt: "Scene", clientTaskId: "order-001" };
    assert.throws(() => buildStarframeVideoBody({ ...base, firstFrame: "https://media.example/1.png" }));
    assert.throws(() => buildStarframeVideoBody({ ...base, firstFrame: "https://media.example/1.png", lastFrame: "https://media.example/2.png", images: ["https://media.example/ref.png"] }));
    assert.deepEqual(buildStarframeVideoBody({ ...base, firstFrame: "https://media.example/1.png", lastFrame: "https://media.example/2.png" }).frames, { first_frame: "https://media.example/1.png", last_frame: "https://media.example/2.png" });
});

test("invalid required fields and nonpublic reference literals are rejected", () => {
    const base = { model: models[0], prompt: "Scene", clientTaskId: "order-001" };
    for (const clientTaskId of ["", "bad id", "x".repeat(129)]) assert.throws(() => buildStarframeVideoBody({ ...base, clientTaskId }));
    assert.throws(() => buildStarframeVideoBody({ ...base, model: "" }));
    assert.throws(() => buildStarframeVideoBody({ ...base, prompt: " " }));
    assert.throws(() => buildStarframeVideoBody({ ...base, duration: -1 }));
    for (const url of ["data:image/png;base64,AA", "blob:example", "http://localhost/ref.png", "https://127.0.0.1/ref.png", "https://10.0.0.1/ref.png", "https://user:password@media.example/ref.png"]) assert.throws(() => buildStarframeVideoBody({ ...base, images: [url] }));
});

test("completed metadata uses only canonical authenticated content paths", () => {
    const result = normalizeStarframeVideoResult({ id: "sfv_123", status: "completed", progress: 100, metadata: { url: "/v1/videos/sfv_123/content" } });
    assert.equal(result.video_url, "/v1/videos/sfv_123/content");
    assert.throws(() => normalizeStarframeVideoResult({ id: "sfv_123", status: "completed", metadata: { url: "https://evil.example/content" } }));
    assert.throws(() => normalizeStarframeVideoResult({ id: "sfv_123", status: "completed", metadata: { url: "/v1/videos/another/content" } }));
});

test("failed reason is shown and queued or unknown results never become ready", () => {
    assert.deepEqual(normalizeStarframeVideoResult({ id: "task_1", status: "failed", metadata: { fail_reason: "unsupported duration" } }).error, { message: "unsupported duration" });
    for (const status of ["queued", "in_progress", "unknown"]) assert.equal(normalizeStarframeVideoResult({ id: "task_1", status, metadata: { url: "/v1/videos/task_1/content" } }).video_url, "");
});

test("Canvas proxy task IDs retain the upstream poll identity and failure message", () => {
    const result = normalizeStarframeVideoResult({ id: "client_video_1", task_id: "sfv_123", status: "completed" });
    assert.equal(result.id, "client_video_1");
    assert.equal(result.task_id, "sfv_123");
    assert.equal(result.video_url, "/v1/videos/sfv_123/content");
    assert.deepEqual(normalizeStarframeVideoResult({ id: "client_video_1", status: "failed", error: { message: "original failure" } }).error, { message: "original failure" });
});

test("wrapped StarFrame responses use the same strict normalization", () => {
    const result = normalizeStarframeVideoResult({ code: 0, data: { id: "sfv_123", status: "failed", metadata: { fail_reason: "invalid duration" } } });
    assert.deepEqual(result.error, { message: "invalid duration" });
    assert.throws(() => normalizeStarframeVideoResult({ code: 0, data: { id: "sfv_123", status: "completed", metadata: { url: "https://evil.example/video" } } }));
});

test("same order retry retains its original idempotency ID", () => {
    assert.equal(starframeRetryClientTaskId({ id: "client_video_task_original" }), "client_video_task_original");
    assert.equal(starframeRetryClientTaskId({ id: "sfv_123", client_task_id: "order-1" }), "order-1");
    assert.equal(starframeRetryClientTaskId({ id: "sfv_123", request_body: '{"client_task_id":"order-1"}' }), "order-1");
    assert.throws(() => starframeRetryClientTaskId({ id: "sfv_123" }));
});

test("poll timeout does not reject completed or failed tasks", () => {
    assert.equal(starframePollExpired("completed", 0, 3_600_001), false);
    assert.equal(starframePollExpired("failed", 0, 3_600_001), false);
    assert.equal(starframePollExpired("queued", 0, 3_600_001), true);
});

test("public IPv6 reference literals are allowed while private ones are not", () => {
    const base = { model: models[0], prompt: "Scene", clientTaskId: "order-1" };
    assert.doesNotThrow(() => buildStarframeVideoBody({ ...base, images: ["https://[2606:4700:4700::1111]/image.png"] }));
    assert.throws(() => buildStarframeVideoBody({ ...base, images: ["https://[::1]/image.png"] }));
});

test("successful HTTP responses still reject empty or JSON video content", async () => {
    assert.throws(() => assertStarframeVideoContent(new Blob([], { type: "video/mp4" })));
    assert.throws(() => assertStarframeVideoContent(new Blob(['{}'], { type: "application/json" })));
    assert.doesNotThrow(() => assertStarframeVideoContent(new Blob(["video"], { type: "video/mp4" })));
});

test("raw upstream polling retains the original client ID across response replacement", () => {
    const polled = carryStarframeClientTaskId({ id: "sfv_123", client_task_id: "order-1" }, { id: "sfv_123", status: "in_progress" });
    assert.equal(starframeRetryClientTaskId(polled), "order-1");
    assert.deepEqual(carryStarframeClientTaskId({ id: "sfv_123" }, { id: "sfv_123", status: "queued" }), { id: "sfv_123", status: "queued" });
});

test("undocumented terminal aliases cannot mark a StarFrame task ready", () => {
    for (const status of ["done", "success", "COMPLETED"]) {
        const result = normalizeStarframeVideoResult({ id: "sfv_123", status });
        assert.equal(result.status, "unknown");
        assert.equal(result.video_url, "");
    }
});
