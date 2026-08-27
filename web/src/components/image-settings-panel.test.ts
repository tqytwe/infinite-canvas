import assert from "node:assert/strict";
import test from "node:test";

import { imageSizeOptionsForConfig } from "./image-settings-panel";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";

test("image settings use the selected image model rather than the chat model", () => {
    const config: AiConfig = {
        ...defaultConfig,
        model: "chat-model",
        textModel: "chat-model",
        imageModel: "sensenova-u1-fast",
        imageChannelId: "platform-managed:image:17",
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

    assert.deepEqual(imageSizeOptionsForConfig(config), [{ value: "1024x1024", label: "1024x1024" }]);
});
