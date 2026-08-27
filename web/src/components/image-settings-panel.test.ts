import assert from "node:assert/strict";
import test from "node:test";

import { imageSizeOptionsForConfig } from "./image-settings-panel";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";

test("direct image settings retain a stable generic size list without a managed model session", () => {
    const config: AiConfig = {
        ...defaultConfig,
        channelMode: "local",
        model: "chat-model",
        textModel: "chat-model",
        imageModel: "sensenova-u1-fast",
        imageChannelId: "jisudeng-api",
        localChannels: [
            {
                id: "jisudeng-api",
                protocol: "openai",
                name: "极速蹬 API",
                baseUrl: "https://api.jisudeng.com",
                apiKey: "user-api-key",
                models: ["chat-model", "sensenova-u1-fast"],
                modelCapabilities: { "chat-model": ["text"], "sensenova-u1-fast": ["image"] },
                declaredModelIds: ["chat-model", "sensenova-u1-fast"],
            },
        ],
    };

    const sizes = imageSizeOptionsForConfig(config);
    assert.equal(sizes[0]?.value, "1:1");
    assert.equal(
        sizes.some((size) => size.value === "auto"),
        true,
    );
    assert.equal(
        sizes.some((size) => size.value === "1024x1024"),
        false,
    );
});
