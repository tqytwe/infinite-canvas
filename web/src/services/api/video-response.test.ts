import assert from "node:assert/strict";
import test from "node:test";
import { isVideoEnvelope, videoResponseFormatError } from "./video-response";

test("video response parsing rejects an HTML document without throwing a TypeError", () => {
    const html = "<!doctype html><html><body>Canvas</body></html>";

    assert.equal(isVideoEnvelope(html), false);
    assert.match(videoResponseFormatError(html), /非 JSON/);
});

test("video response parsing treats null as an invalid response", () => {
    assert.equal(isVideoEnvelope(null), false);
    assert.equal(videoResponseFormatError(null), "视频接口返回格式错误");
});

test("video response parsing preserves the standard task envelope", () => {
    assert.equal(isVideoEnvelope({ code: 0, data: { id: "video-task-1" } }), true);
    assert.equal(isVideoEnvelope({ code: "0", data: { id: "video-task-1" } }), false);
});
