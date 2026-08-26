import assert from "node:assert/strict";
import test from "node:test";

import { platformManagedCapabilityIssue, platformManagedChannels } from "./platform-managed-models";

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
