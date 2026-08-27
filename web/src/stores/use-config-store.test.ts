import assert from "node:assert/strict";
import test from "node:test";
import { channelIdForActiveModel, defaultConfig, localChannelForActiveModel, localChannelMatchesCapability, localModelsByCapability, modelMatchesCapability, normalizeLocalChannels, type AiConfig, type LocalModelChannel } from "./use-config-store";

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

test("multiple direct channels retain their IDs and model capabilities", () => {
    const config: AiConfig = {
        ...defaultConfig,
        channelMode: "local",
        model: "multi-modal",
        imageModel: "multi-modal",
        videoModel: "multi-modal",
        imageChannelId: "image-channel",
        videoChannelId: "video-channel",
        localChannels: [
            {
                id: "image-channel",
                protocol: "openai",
                name: "Image API",
                baseUrl: "https://image.example.test",
                apiKey: "image-key",
                models: ["multi-modal"],
                purpose: "image",
                modelCapabilities: { "multi-modal": ["image"] },
                declaredModelIds: ["multi-modal"],
            },
            {
                id: "video-channel",
                protocol: "openai",
                name: "Video API",
                baseUrl: "https://video.example.test",
                apiKey: "video-key",
                models: ["multi-modal"],
                purpose: "video",
                modelCapabilities: { "multi-modal": ["video"] },
                declaredModelIds: ["multi-modal"],
            },
        ],
    };

    assert.equal(channelIdForActiveModel(config, "image"), "image-channel");
    assert.equal(channelIdForActiveModel(config, "video"), "video-channel");
    assert.equal(localChannelForActiveModel(config, "image")?.apiKey, "image-key");
    assert.equal(localChannelForActiveModel(config, "video")?.apiKey, "video-key");
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
    assert.equal(channel.purpose, "image");
    assert.equal(modelMatchesCapability("sensenova-u1.5-lite", "image", channel), false);
});

test("direct channels place every returned model in their selected workspace", () => {
    const imageChannel: LocalModelChannel = {
        id: "image-group",
        protocol: "openai",
        name: "图片生成",
        baseUrl: "https://api.jisudeng.com",
        apiKey: "test-key",
        models: ["sensenova-u1-fast", "provider-image-v-next", "future-image-model"],
        purpose: "image",
        modelCapabilities: { "sensenova-u1-fast": ["image"], "provider-image-v-next": [], "future-image-model": [] },
        declaredModelIds: ["sensenova-u1-fast"],
        modelDiscovery: { state: "declared" },
    };

    const videoChannel: LocalModelChannel = {
        ...imageChannel,
        id: "video-group",
        name: "视频生成",
        apiKey: "video-key",
        models: ["future-video-model"],
        purpose: "video",
    };
    const textChannel: LocalModelChannel = { ...imageChannel, id: "text-group", name: "文本生成", models: ["future-text-model"], purpose: "text" };
    const audioChannel: LocalModelChannel = { ...imageChannel, id: "audio-group", name: "音频生成", models: ["future-audio-model"], purpose: "audio" };

    assert.deepEqual(localModelsByCapability([imageChannel, videoChannel, textChannel, audioChannel], "image"), imageChannel.models);
    assert.deepEqual(localModelsByCapability([imageChannel, videoChannel, textChannel, audioChannel], "video"), videoChannel.models);
    assert.deepEqual(localModelsByCapability([imageChannel, videoChannel, textChannel, audioChannel], "text"), textChannel.models);
    assert.deepEqual(localModelsByCapability([imageChannel, videoChannel, textChannel, audioChannel], "audio"), audioChannel.models);
    assert.equal(localChannelMatchesCapability(imageChannel, "future-image-model", "image"), true);
    assert.equal(localChannelMatchesCapability(imageChannel, "future-image-model", "video"), false);
    assert.equal(localChannelMatchesCapability(videoChannel, "future-video-model", "video"), true);

    const config: AiConfig = { ...defaultConfig, channelMode: "local", model: "future-image-model", imageModel: "future-image-model", imageChannelId: "image-group", localChannels: [imageChannel, videoChannel] };
    assert.equal(channelIdForActiveModel(config, "image"), "image-group");
    assert.equal(localChannelForActiveModel(config, "image")?.apiKey, "test-key");
});

test("managed image channels continue to require declared image capability", () => {
    const channel: LocalModelChannel = {
        id: "platform-managed:image:23",
        protocol: "openai",
        name: "受管图片",
        baseUrl: "/api",
        apiKey: "session-token",
        models: ["declared-image", "undeclared"],
        modelCapabilities: { "declared-image": ["image"], undeclared: [] },
        declaredModelIds: ["declared-image", "undeclared"],
        managedPlatform: true,
    };

    assert.deepEqual(localModelsByCapability([channel], "image"), ["declared-image"]);
    assert.equal(localChannelMatchesCapability(channel, "undeclared", "image"), false);
});

test("normalization keeps user channels and removes only old managed channels", () => {
    const config: AiConfig = {
        ...defaultConfig,
        apiKey: "user-api-key",
        localChannels: [
            {
                id: "kept-channel",
                protocol: "openai",
                name: "保留的渠道",
                baseUrl: "https://custom.example.test/v1",
                apiKey: "custom-key",
                models: ["custom-image"],
                purpose: "image",
                modelCapabilities: { "custom-image": ["image"] },
                declaredModelIds: ["custom-image"],
            },
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

    const channels = normalizeLocalChannels(config);
    assert.equal(channels.length, 1);
    assert.deepEqual(channels[0], {
        id: "kept-channel",
        protocol: "openai",
        name: "保留的渠道",
        baseUrl: "https://custom.example.test/v1",
        apiKey: "custom-key",
        models: ["custom-image"],
        purpose: "image",
        modelCapabilities: { "custom-image": ["image"] },
        declaredModelIds: ["custom-image"],
        modelDiscovery: undefined,
    });
});
