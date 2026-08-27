import assert from "node:assert/strict";
import test from "node:test";

import { platformImageRequestIssue, platformManagedCapabilityIssue, platformManagedChannels, platformVideoRequestIssue } from "./platform-managed-models";

test("managed Canvas keeps SenseNova image models in their declared group", () => {
    const bootstrap = {
        workspaces: {
            image: {
                groups: [
                    {
                        id: 17,
                        name: "图片",
                        is_current: true,
                        models: [
                            { id: "sensenova-u1.5-lite", modalities: ["image"], adapter: "sensenova", capability_version: "v1", image_capabilities: { operations: ["create", "edit"] } },
                            { id: "sensenova-u1-fast", modalities: ["image"], adapter: "sensenova", capability_version: "v1", image_capabilities: { operations: ["create"] } },
                        ],
                    },
                ],
            },
            video: {
                groups: [{ id: 23, name: "video视频", models: [{ id: "grok-video", modalities: ["video"], adapter: "video-adapter", capability_version: "v1", video_capabilities: { operations: ["generate"] } }] }],
            },
        },
    };

    const channels = platformManagedChannels(bootstrap);
    const image = channels.find((channel) => channel.id === "platform-managed:image:17");
    const video = channels.find((channel) => channel.id === "platform-managed:video:23");
    assert.deepEqual(image?.models, ["sensenova-u1.5-lite", "sensenova-u1-fast"]);
    assert.deepEqual(image?.modelCapabilities["sensenova-u1-fast"], ["image"]);
    assert.deepEqual(video?.models, ["grok-video"]);
    assert.equal(platformManagedCapabilityIssue(bootstrap, "image"), "");
});

test("managed Canvas fails closed when the platform marks a video group unavailable", () => {
    const bootstrap = {
        workspaces: {
            video: {
                groups: [
                    {
                        id: 23,
                        name: "视频",
                        video_available: false,
                        video_unavailable_code: "no_schedulable_account",
                        models: [{ id: "grok-video", modalities: ["video"], adapter: "video-adapter", capability_version: "v1", video_capabilities: { operations: ["generate"] } }],
                    },
                ],
            },
        },
    };

    assert.deepEqual(platformManagedChannels(bootstrap), []);
    const issue = platformManagedCapabilityIssue(bootstrap, "video");
    assert.match(issue, /暂时没有可用账号/);
    assert.doesNotMatch(issue, /no_schedulable_account/);
});

test("managed Canvas remains compatible when older video groups omit availability", () => {
    const bootstrap = {
        workspaces: {
            video: {
                groups: [
                    {
                        id: 23,
                        name: "视频",
                        models: [{ id: "grok-video", modalities: ["video"], adapter: "video-adapter", capability_version: "v1", video_capabilities: { operations: ["generate"] } }],
                    },
                ],
            },
        },
    };

    assert.deepEqual(platformManagedChannels(bootstrap).map((channel) => channel.id), ["platform-managed:video:23"]);
    assert.equal(platformManagedCapabilityIssue(bootstrap, "video"), "");
});

test("managed Canvas keeps unknown video availability diagnostics localized", () => {
    const bootstrap = {
        workspaces: {
            video: {
                groups: [
                    {
                        id: 23,
                        name: "视频",
                        video_available: false,
                        video_unavailable_code: "future_platform_code",
                        models: [{ id: "grok-video", modalities: ["video"], adapter: "video-adapter", capability_version: "v1", video_capabilities: { operations: ["generate"] } }],
                    },
                ],
            },
        },
    };

    const issue = platformManagedCapabilityIssue(bootstrap, "video");
    assert.match(issue, /视频分组暂不可用/);
    assert.doesNotMatch(issue, /future_platform_code/);
});

test("managed Canvas reports an old platform contract instead of guessing by model name", () => {
    const bootstrap = {
        workspaces: {
            image: {
                groups: [{ id: 17, name: "图片", models: [{ id: "sensenova-u1-fast" }] }],
            },
        },
    };

    assert.deepEqual(platformManagedChannels(bootstrap), []);
    assert.match(platformManagedCapabilityIssue(bootstrap, "image"), /未声明模型图片能力/);
    assert.match(platformManagedCapabilityIssue(bootstrap, "video"), /没有返回可用的视频分组/);
});

test("managed Canvas rejects legacy operation aliases instead of exposing a false media choice", () => {
    const bootstrap = {
        workspaces: {
            image: {
                groups: [
                    {
                        id: 17,
                        name: "图片",
                        models: [{ id: "sensenova-u1-fast", modalities: ["image"], image_capabilities: { operations: ["generation"] } }],
                    },
                ],
            },
            video: {
                groups: [
                    {
                        id: 23,
                        name: "视频",
                        models: [{ id: "opaque-video", modalities: ["video"], video_capabilities: { operations: ["generation"] } }],
                    },
                ],
            },
        },
    };

    assert.deepEqual(platformManagedChannels(bootstrap), []);
    assert.match(platformManagedCapabilityIssue(bootstrap, "image"), /可执行操作/);
    assert.match(platformManagedCapabilityIssue(bootstrap, "video"), /可执行操作/);
});

test("managed Canvas requires both an explicit modality and canonical operation", () => {
    const bootstrap = {
        workspaces: {
            image: {
                groups: [
                    {
                        id: 17,
                        name: "图片",
                        models: [{ id: "missing-modality", image_capabilities: { operations: ["create"] } }],
                    },
                ],
            },
        },
    };

    assert.deepEqual(platformManagedChannels(bootstrap), []);
    assert.match(platformManagedCapabilityIssue(bootstrap, "image"), /可执行操作/);
});

test("managed Canvas does not expose media models until the platform declares an executable adapter", () => {
    const bootstrap = {
        workspaces: {
            image: {
                groups: [{ id: 17, name: "图片", models: [{ id: "sensenova-u1-fast", modalities: ["image"], image_capabilities: { operations: ["create"] } }] }],
            },
        },
    };

    assert.deepEqual(platformManagedChannels(bootstrap), []);
    assert.match(platformManagedCapabilityIssue(bootstrap, "image"), /可执行适配器/);
});

test("managed Canvas preserves a legacy chat workspace without granting legacy media capabilities", () => {
    const bootstrap = {
        workspaces: {
            chat: { groups: [{ id: 7, name: "对话", models: [{ id: "legacy-chat" }] }] },
            image: { groups: [{ id: 8, name: "图片", models: [{ id: "legacy-image" }] }] },
        },
    };

    const channels = platformManagedChannels(bootstrap);
    assert.deepEqual(channels.find((channel) => channel.id === "platform-managed:chat:7")?.models, ["legacy-chat"]);
    assert.deepEqual(channels.find((channel) => channel.id === "platform-managed:chat:7")?.modelCapabilities["legacy-chat"], ["text"]);
    assert.equal(
        channels.some((channel) => channel.id === "platform-managed:image:8"),
        false,
    );
});

test("managed Canvas preserves group isolation when one model identifier appears in two purposes", () => {
    const bootstrap = {
        workspaces: {
            image: { groups: [{ id: 17, name: "图片", models: [{ id: "shared", modalities: ["image"], adapter: "image-adapter", capability_version: "v1", image_capabilities: { operations: ["create"] } }] }] },
            video: { groups: [{ id: 23, name: "视频", models: [{ id: "shared", modalities: ["video"], adapter: "video-adapter", capability_version: "v1", video_capabilities: { operations: ["generate"] } }] }] },
        },
    };

    const channels = platformManagedChannels(bootstrap);
    assert.deepEqual(channels.find((channel) => channel.id === "platform-managed:image:17")?.modelCapabilities.shared, ["image"]);
    assert.deepEqual(channels.find((channel) => channel.id === "platform-managed:video:23")?.modelCapabilities.shared, ["video"]);
});

test("managed Canvas projects a multi-modal model to its workspace purpose", () => {
    const shared = {
        id: "multi-modal",
        modalities: ["image", "video"],
        adapter: "shared-adapter",
        capability_version: "v1",
        image_capabilities: { operations: ["create"] },
        video_capabilities: { operations: ["generate"] },
    };
    const channels = platformManagedChannels({
        workspaces: {
            image: { groups: [{ id: 17, name: "图片", models: [shared] }] },
            video: { groups: [{ id: 23, name: "视频", models: [shared] }] },
        },
    });

    assert.deepEqual(channels.find((channel) => channel.id === "platform-managed:image:17")?.modelCapabilities["multi-modal"], ["image"]);
    assert.deepEqual(channels.find((channel) => channel.id === "platform-managed:video:23")?.modelCapabilities["multi-modal"], ["video"]);
});

test("managed Canvas reports a missing adapter for the requested media purpose", () => {
    const bootstrap = {
        workspaces: {
            video: {
                groups: [
                    {
                        id: 23,
                        name: "视频",
                        models: [
                            { id: "image-with-adapter", modalities: ["image"], adapter: "image-adapter", capability_version: "v1", image_capabilities: { operations: ["create"] } },
                            { id: "video-without-adapter", modalities: ["video"], video_capabilities: { operations: ["generate"] } },
                        ],
                    },
                ],
            },
        },
    };

    assert.deepEqual(platformManagedChannels(bootstrap), []);
    assert.match(platformManagedCapabilityIssue(bootstrap, "video"), /可执行适配器/);
});

test("managed Canvas preserves the exact SenseNova U1 Fast image contract", () => {
    const [channel] = platformManagedChannels({
        workspaces: {
            image: {
                groups: [
                    {
                        id: 17,
                        name: "图片",
                        models: [
                            {
                                id: "sensenova-u1-fast",
                                modalities: ["image"],
                                adapter: "sensenova",
                                capability_version: "2026-08-26.1",
                                image_capabilities: {
                                    operations: ["create"],
                                    sizing_kind: "fixed",
                                    supported_sizes: ["1024x1024", "1280x720"],
                                    supported_ratios: ["1:1", "16:9"],
                                    supported_formats: ["png", "jpeg"],
                                    max_reference_images: 0,
                                },
                            },
                        ],
                    },
                ],
            },
        },
    });

    assert.deepEqual(channel.modelMediaCapabilities["sensenova-u1-fast"], {
        adapter: "sensenova",
        capabilityVersion: "2026-08-26.1",
        modalities: ["image"],
        image: {
            operations: ["create"],
            sizingKind: "fixed",
            supportedSizes: ["1024x1024", "1280x720"],
            supportedRatios: ["1:1", "16:9"],
            supportedFormats: ["png", "jpeg"],
            maxReferenceImages: 0,
        },
    });
});

test("managed image contract allows create but rejects edit and references for a create-only model", () => {
    const [channel] = platformManagedChannels({
        workspaces: {
            image: {
                groups: [
                    {
                        id: 17,
                        name: "图片",
                        models: [
                            {
                                id: "sensenova-u1-fast",
                                modalities: ["image"],
                                adapter: "sensenova",
                                capability_version: "v1",
                                image_capabilities: { operations: ["create"], supported_sizes: ["1024x1024"], max_reference_images: 0 },
                            },
                        ],
                    },
                ],
            },
        },
    });
    const capabilities = channel.modelMediaCapabilities["sensenova-u1-fast"].image;

    assert.equal(platformImageRequestIssue(capabilities, { operation: "create", size: "1024x1024", referenceImages: 0 }), "");
    assert.match(platformImageRequestIssue(capabilities, { operation: "edit", size: "1024x1024", referenceImages: 1 }), /编辑能力/);
});

test("managed video contract rejects unsupported settings locally", () => {
    const [channel] = platformManagedChannels({
        workspaces: {
            video: {
                groups: [
                    {
                        id: 23,
                        name: "视频",
                        models: [
                            {
                                id: "declared-video",
                                modalities: ["video"],
                                adapter: "video-adapter",
                                capability_version: "v1",
                                video_capabilities: {
                                    operations: ["generate"],
                                    supported_resolutions: ["720p"],
                                    supported_ratios: ["16:9"],
                                    supported_durations: [5],
                                    max_reference_assets: 1,
                                    max_reference_images: 0,
                                    max_reference_videos: 1,
                                    max_reference_audios: 0,
                                    generate_audio: false,
                                    watermark: false,
                                },
                            },
                        ],
                    },
                ],
            },
        },
    });
    const capabilities = channel.modelMediaCapabilities["declared-video"].video;
    const request = {
        resolution: "720",
        ratio: "16:9",
        duration: 5,
        imageReferences: 0,
        videoReferences: 0,
        audioReferences: 0,
        generateAudio: false,
        watermark: false,
    };

    assert.equal(platformVideoRequestIssue(capabilities, request), "");
    assert.match(platformVideoRequestIssue(capabilities, { ...request, resolution: "1080" }), /分辨率/);
    assert.match(platformVideoRequestIssue(capabilities, { ...request, ratio: "1:1" }), /宽高比/);
    assert.match(platformVideoRequestIssue(capabilities, { ...request, duration: 10 }), /时长/);
    assert.match(platformVideoRequestIssue(capabilities, { ...request, imageReferences: 1 }), /参考图/);
    assert.match(platformVideoRequestIssue(capabilities, { ...request, videoReferences: 2 }), /参考视频/);
    assert.match(platformVideoRequestIssue(capabilities, { ...request, audioReferences: 1 }), /参考音频/);
    assert.match(platformVideoRequestIssue(capabilities, { ...request, generateAudio: true }), /生成音频/);
    assert.match(platformVideoRequestIssue(capabilities, { ...request, watermark: true }), /水印/);
});

test("managed channels retain per-purpose capability details when a model ID is shared", () => {
    const channels = platformManagedChannels({
        workspaces: {
            image: {
                groups: [
                    {
                        id: 17,
                        name: "图片",
                        models: [
                            {
                                id: "shared",
                                modalities: ["image"],
                                adapter: "image-adapter",
                                capability_version: "image-v1",
                                image_capabilities: { operations: ["create", "edit"], max_reference_images: 2 },
                            },
                        ],
                    },
                ],
            },
            video: {
                groups: [
                    {
                        id: 23,
                        name: "视频",
                        models: [
                            {
                                id: "shared",
                                modalities: ["video"],
                                adapter: "video-adapter",
                                capability_version: "video-v1",
                                video_capabilities: { operations: ["generate"], supported_resolutions: ["1080p"], supported_durations: [10] },
                            },
                        ],
                    },
                ],
            },
        },
    });

    assert.deepEqual(channels.find((channel) => channel.id === "platform-managed:image:17")?.modelMediaCapabilities.shared, {
        adapter: "image-adapter",
        capabilityVersion: "image-v1",
        modalities: ["image"],
        image: {
            operations: ["create", "edit"],
            supportedSizes: [],
            supportedRatios: [],
            supportedFormats: [],
            maxReferenceImages: 2,
        },
    });
    assert.deepEqual(channels.find((channel) => channel.id === "platform-managed:video:23")?.modelMediaCapabilities.shared, {
        adapter: "video-adapter",
        capabilityVersion: "video-v1",
        modalities: ["video"],
        video: {
            operations: ["generate"],
            supportedResolutions: ["1080p"],
            supportedRatios: [],
            supportedDurations: [10],
        },
    });
});
