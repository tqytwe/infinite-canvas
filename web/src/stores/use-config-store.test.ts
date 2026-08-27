import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import {
    channelIdForActiveModel,
    defaultConfig,
    forcePlatformManagedImageAPI,
    isPlatformManagedImageConfig,
    modelMatchesCapability,
    normalizeLocalChannels,
    platformManagedImageCapabilitiesForConfig,
    platformManagedVideoCapabilitiesForConfig,
    useConfigStore,
    type AiConfig,
} from "./use-config-store";

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

test("explicit video selection does not reuse a multi-modal image channel", () => {
    const config: AiConfig = {
        ...defaultConfig,
        model: "multi-modal",
        imageModel: "multi-modal",
        videoModel: "multi-modal",
        imageChannelId: "platform-managed:image:17",
        videoChannelId: "platform-managed:video:23",
        localChannels: [
            {
                id: "platform-managed:image:17",
                protocol: "openai",
                name: "图片",
                baseUrl: "/api",
                apiKey: "canvas-token",
                models: ["multi-modal"],
                modelCapabilities: { "multi-modal": ["image"] },
                declaredModelIds: ["multi-modal"],
            },
            {
                id: "platform-managed:video:23",
                protocol: "openai",
                name: "视频",
                baseUrl: "/api",
                apiKey: "canvas-token",
                models: ["multi-modal"],
                modelCapabilities: { "multi-modal": ["video"] },
                declaredModelIds: ["multi-modal"],
            },
        ],
    };

    assert.equal(channelIdForActiveModel(config, "image"), "platform-managed:image:17");
    assert.equal(channelIdForActiveModel(config, "video"), "platform-managed:video:23");
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

test("selected managed purpose returns only that group's per-model media contract", () => {
    const config: AiConfig = {
        ...defaultConfig,
        model: "shared",
        imageModel: "shared",
        videoModel: "shared",
        imageChannelId: "platform-managed:image:17",
        videoChannelId: "platform-managed:video:23",
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

    assert.deepEqual(platformManagedImageCapabilitiesForConfig(config, "shared"), {
        operations: ["create", "edit"],
        supportedSizes: ["1024x1024"],
        supportedRatios: ["1:1"],
        supportedFormats: ["png"],
        maxReferenceImages: 2,
    });
    assert.deepEqual(platformManagedVideoCapabilitiesForConfig(config, "shared"), {
        operations: ["generate"],
        supportedResolutions: ["720p"],
        supportedRatios: ["16:9"],
        supportedDurations: [5],
    });
});

test("a persisted Responses mode is normalized only for the selected managed image channel", () => {
    const managed: AiConfig = {
        ...defaultConfig,
        model: "sensenova-u1-fast",
        imageModel: "sensenova-u1-fast",
        imageChannelId: "platform-managed:image:17",
        apiMode: "responses",
        localChannels: [
            {
                id: "platform-managed:image:17",
                protocol: "openai",
                name: "图片",
                baseUrl: "/api",
                apiKey: "",
                models: ["sensenova-u1-fast"],
                modelCapabilities: { "sensenova-u1-fast": ["image"] },
                modelMediaCapabilities: {
                    "sensenova-u1-fast": {
                        adapter: "sensenova",
                        capabilityVersion: "v1",
                        modalities: ["image"],
                        image: { operations: ["create"], supportedSizes: ["1024x1024"], supportedRatios: ["1:1"], supportedFormats: ["png"] },
                    },
                },
                declaredModelIds: ["sensenova-u1-fast"],
                managedPlatform: true,
                platformPurpose: "image",
                platformGroupID: "17",
            },
        ],
    };

    assert.equal(isPlatformManagedImageConfig(managed), true);
    assert.equal(forcePlatformManagedImageAPI(managed).apiMode, "images");

    const local = { ...managed, imageChannelId: "local-image", localChannels: [{ ...managed.localChannels[0], id: "local-image", managedPlatform: false, platformPurpose: undefined }] };
    assert.equal(isPlatformManagedImageConfig(local), false);
    assert.equal(forcePlatformManagedImageAPI(local).apiMode, "responses");
});

test("a newer managed bootstrap token cannot retain an older session response", async () => {
    const originalRequest = axios.request;
    const pending: Array<{ resolve: (value: unknown) => void }> = [];
    const request = () => new Promise<unknown>((resolve) => pending.push({ resolve }));
    (axios as unknown as { request: typeof axios.request }).request = request as unknown as typeof axios.request;
    useConfigStore.setState({ platformBootstrap: null, platformBootstrapError: "", isPlatformBootstrapLoading: false, platformBootstrapToken: "" });

    try {
        const older = useConfigStore.getState().loadPlatformBootstrap("old-token");
        const newer = useConfigStore.getState().loadPlatformBootstrap("new-token");
        assert.equal(pending.length, 2);

        pending[0].resolve({ status: 200, data: { code: 0, data: { workspaces: { image: { groups: [{ id: 1, models: [{ id: "old-model" }] }] } } }, msg: "" } });
        await older;
        assert.equal(useConfigStore.getState().platformBootstrap, null);

        const newerBootstrap = { workspaces: { image: { groups: [{ id: 2, models: [{ id: "new-model" }] }] } } };
        pending[1].resolve({ status: 200, data: { code: 0, data: newerBootstrap, msg: "" } });
        await newer;
        assert.deepEqual(useConfigStore.getState().platformBootstrap, newerBootstrap);
    } finally {
        (axios as unknown as { request: typeof axios.request }).request = originalRequest;
        useConfigStore.setState({ platformBootstrap: null, platformBootstrapError: "", isPlatformBootstrapLoading: false, platformBootstrapToken: "" });
    }
});
