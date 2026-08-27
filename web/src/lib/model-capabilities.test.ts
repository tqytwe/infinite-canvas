import assert from "node:assert/strict";
import test from "node:test";

import { applyModelDiscovery, legacyModelCapabilities, modelDiscoveryFailure, modelMatchesCapability, parseModelDiscovery, type ModelCapabilitySource, type ModelDiscoveryChannel } from "./model-capabilities";

test("mixed server declarations fail closed for every undeclared model", () => {
    const discovery = parseModelDiscovery({
        data: [
            { id: "declared-image", modalities: ["text", "image_generation"] },
            { id: "declared-video", image_capabilities: false, video_capabilities: { generation: true } },
            { id: "nested-declared", capabilities: { modalities: ["video"], image_capabilities: { edit: true } } },
            { id: "sensenova-u1-fast", modalities: ["text"] },
            { id: "sensenova-u1.5-lite" },
            { id: "legacy-image-name" },
            { id: "explicitly-empty-image", modalities: [] },
        ],
    });

    assert.equal(discovery.mode, "declared");
    assert.deepEqual(discovery.modelCapabilities["declared-image"], ["text", "image"]);
    assert.deepEqual(discovery.modelCapabilities["declared-video"], ["video"]);
    assert.deepEqual(discovery.modelCapabilities["nested-declared"], ["video", "image"]);
    assert.equal(modelMatchesCapability("declared-image", "video", discovery), false);
    assert.equal(modelMatchesCapability("declared-video", "image", discovery), false);
    assert.equal(modelMatchesCapability("sensenova-u1-fast", "image", discovery), false);
    assert.equal(modelMatchesCapability("sensenova-u1.5-lite", "image", discovery), false);
    assert.equal(modelMatchesCapability("legacy-image-name", "image", discovery), false);
    assert.equal(modelMatchesCapability("explicitly-empty-image", "image", discovery), false);
    assert.deepEqual(discovery.modelCapabilities["sensenova-u1.5-lite"], []);
    assert.deepEqual(discovery.modelCapabilities["legacy-image-name"], []);
    assert.deepEqual(discovery.modelCapabilities["explicitly-empty-image"], []);
});

test("legacy discovery is used only when the entire response lacks declarations", () => {
    const discovery = parseModelDiscovery({
        data: [{ id: "sensenova-u1.5-lite" }, { id: "legacy-image-name" }],
    });

    assert.equal(discovery.mode, "legacy");
    assert.equal(modelMatchesCapability("sensenova-u1.5-lite", "image", discovery), true);
    assert.equal(modelMatchesCapability("legacy-image-name", "image", discovery), true);
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

test("model refresh preserves saved models after an error and clears the error on retry", () => {
    const saved: ModelDiscoveryChannel & { id: string } = {
        id: "saved-channel",
        models: ["saved-image"],
        modelCapabilities: { "saved-image": ["image"] },
        declaredModelIds: ["saved-image"],
        modelDiscovery: { state: "declared" as const },
    };

    const failed = modelDiscoveryFailure(saved, "读取模型失败");
    assert.equal(failed.error, true);
    assert.deepEqual(failed.channel.models, ["saved-image"]);
    assert.deepEqual(failed.channel.modelCapabilities, { "saved-image": ["image"] });
    assert.deepEqual(failed.channel.modelDiscovery, { state: "error", message: "读取模型失败" });

    const retried = applyModelDiscovery(saved, parseModelDiscovery({ data: [{ id: "retried-image", image_capabilities: { generation: true } }] }));
    assert.equal(retried.error, false);
    assert.deepEqual(retried.channel.models, ["retried-image"]);
    assert.deepEqual(retried.channel.modelCapabilities, { "retried-image": ["image"] });
    assert.deepEqual(retried.channel.declaredModelIds, ["retried-image"]);
    assert.deepEqual(retried.channel.modelDiscovery, { state: "declared" });
});
