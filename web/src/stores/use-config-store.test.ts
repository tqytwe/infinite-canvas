import assert from "node:assert/strict";
import test from "node:test";

import { channelIdForActiveModel, defaultConfig, modelMatchesCapability, normalizeLocalChannels, type AiConfig } from "./use-config-store";

test("remote model selection does not reuse a matching local channel", () => {
    const config: AiConfig = {
        ...defaultConfig,
        channelMode: "remote",
        model: "shared-model",
        imageModel: "shared-model",
        imageChannelId: "remote-image",
        localChannels: [
            {
                id: "local-text",
                protocol: "openai",
                name: "Local text",
                baseUrl: "https://local.example.test",
                apiKey: "test-key",
                models: ["shared-model"],
                modelCapabilities: { "shared-model": ["text"] },
            },
        ],
        publicChannels: [
            { id: "remote-image", models: ["shared-model"], modelCapabilities: { "shared-model": ["image"] } },
            { id: "remote-text", models: ["shared-model"], modelCapabilities: { "shared-model": ["text"] } },
        ],
    };

    assert.equal(channelIdForActiveModel(config), "remote-image");
});

test("persisted mixed declarations do not retain legacy classifications", () => {
    const [channel] = normalizeLocalChannels({
        localChannels: [
            {
                id: "persisted-channel",
                protocol: "openai",
                name: "Persisted channel",
                baseUrl: "https://api.example.test",
                apiKey: "test-key",
                models: ["declared-text", "sensenova-u1.5-lite"],
                declaredModelIds: ["declared-text"],
                modelCapabilities: {
                    "declared-text": ["text"],
                    "sensenova-u1.5-lite": ["image"],
                },
            },
        ],
    });

    assert.deepEqual(channel.modelCapabilities, {
        "declared-text": ["text"],
        "sensenova-u1.5-lite": [],
    });
    assert.equal(modelMatchesCapability("sensenova-u1.5-lite", "image", channel), false);
});
