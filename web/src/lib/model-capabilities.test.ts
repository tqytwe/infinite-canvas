import assert from "node:assert/strict";
import test from "node:test";

import { legacyModelCapabilities, modelMatchesCapability, parseModelDiscovery, type ModelCapabilitySource } from "./model-capabilities";

test("parseModelDiscovery prefers declared model capabilities and fails closed", () => {
    const discovery = parseModelDiscovery({
        data: [
            { id: "declared-image", modalities: ["text", "image_generation"] },
            { id: "declared-video", image_capabilities: false, video_capabilities: { generation: true } },
            { id: "nested-declared", capabilities: { modalities: ["video"], image_capabilities: { edit: true } } },
            { id: "sensenova-u1-fast", modalities: ["text"] },
            { id: "sensenova-u1.5-lite" },
        ],
    });

    assert.equal(discovery.mode, "declared");
    assert.deepEqual(discovery.modelCapabilities["declared-image"], ["text", "image"]);
    assert.deepEqual(discovery.modelCapabilities["declared-video"], ["video"]);
    assert.deepEqual(discovery.modelCapabilities["nested-declared"], ["video", "image"]);
    assert.equal(modelMatchesCapability("declared-image", "video", discovery), false);
    assert.equal(modelMatchesCapability("declared-video", "image", discovery), false);
    assert.equal(modelMatchesCapability("sensenova-u1-fast", "image", discovery), false);
    assert.equal(modelMatchesCapability("sensenova-u1.5-lite", "image", discovery), true);
});

test("legacy SenseNova mapping accepts exact IDs only", () => {
    assert.deepEqual(legacyModelCapabilities("sensenova-u1.5-lite"), ["image"]);
    assert.deepEqual(legacyModelCapabilities("sensenova-u1-fast"), ["image"]);
    assert.notDeepEqual(legacyModelCapabilities("sensenova-u1.5-lite-preview"), ["image"]);
    assert.notDeepEqual(legacyModelCapabilities("custom-sensenova-u1-fast"), ["image"]);
});

test("model capabilities remain isolated to their source channel", () => {
    const imageChannel: ModelCapabilitySource = { modelCapabilities: { shared: ["image"] }, declaredModelIds: ["shared"] };
    const videoChannel: ModelCapabilitySource = { modelCapabilities: { shared: ["video"] }, declaredModelIds: ["shared"] };

    assert.equal(modelMatchesCapability("shared", "image", imageChannel), true);
    assert.equal(modelMatchesCapability("shared", "video", imageChannel), false);
    assert.equal(modelMatchesCapability("shared", "video", videoChannel), true);
    assert.equal(modelMatchesCapability("shared", "image", videoChannel), false);
});
