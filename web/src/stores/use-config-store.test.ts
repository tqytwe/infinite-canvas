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

test("the fixed direct channel keeps image and video capabilities on the same configured API key", () => {
    const config: AiConfig = {
        ...defaultConfig,
        channelMode: "local",
        model: "multi-modal",
        imageModel: "multi-modal",
        videoModel: "multi-modal",
        imageChannelId: "jisudeng-api",
        videoChannelId: "jisudeng-api",
        localChannels: [
            {
                id: "obsolete-channel-id",
                protocol: "openai",
                name: "极速蹬 API",
                baseUrl: "https://api.jisudeng.com",
                apiKey: "user-api-key",
                models: ["multi-modal"],
                modelCapabilities: { "multi-modal": ["image", "video"] },
                declaredModelIds: ["multi-modal"],
            },
        ],
    };

    assert.equal(channelIdForActiveModel(config, "image"), "jisudeng-api");
    assert.equal(channelIdForActiveModel(config, "video"), "jisudeng-api");
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

test("normalization replaces obsolete managed channels with one fixed direct channel", () => {
    const config: AiConfig = {
        ...defaultConfig,
        apiKey: "user-api-key",
        localChannels: [
            {
                id: "platform-managed:image:17",
                protocol: "openai",
                name: "图片",
                baseUrl: "/api",
                apiKey: "",
                models: ["shared"],
                modelCapabilities: { shared: ["image"] },
                modelMediaCapabilities: {
                    shared: {
                        adapter: "image-adapter",
                        capabilityVersion: "image-v1",
                        modalities: ["image"],
                        image: {
                            operations: ["create", "edit"],
                            supportedSizes: ["1024x1024"],
                            supportedRatios: ["1:1"],
                            supportedFormats: ["png"],
                            maxReferenceImages: 2,
                        },
                    },
                },
                declaredModelIds: ["shared"],
                managedPlatform: true,
                platformPurpose: "image",
                platformGroupID: "17",
            },
            {
                id: "platform-managed:video:23",
                protocol: "openai",
                name: "视频",
                baseUrl: "/api",
                apiKey: "",
                models: ["shared"],
                modelCapabilities: { shared: ["video"] },
                modelMediaCapabilities: {
                    shared: {
                        adapter: "video-adapter",
                        capabilityVersion: "video-v1",
                        modalities: ["video"],
                        video: {
                            operations: ["generate"],
                            supportedResolutions: ["720p"],
                            supportedRatios: ["16:9"],
                            supportedDurations: [5],
                        },
                    },
                },
                declaredModelIds: ["shared"],
                managedPlatform: true,
                platformPurpose: "video",
                platformGroupID: "23",
            },
        ],
    };

    const [channel] = normalizeLocalChannels(config);
    assert.deepEqual(channel, {
        id: "jisudeng-api",
        protocol: "openai",
        name: "极速蹬 API",
        baseUrl: "https://api.jisudeng.com",
        apiKey: "user-api-key",
        models: ["shared"],
        modelCapabilities: { shared: ["image"] },
        declaredModelIds: ["shared"],
        modelDiscovery: undefined,
    });
});
