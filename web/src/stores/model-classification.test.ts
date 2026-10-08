import assert from "node:assert/strict";
import test from "node:test";
import type { AiConfig, LocalModelChannel } from "./use-config-store";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
} });
Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: globalThis.localStorage } });
const { assignModelCapabilities, channelIdForActiveModel, defaultConfig, filterChannelModelsByCapability, modelMatchesCapability, normalizeLocalChannels, resolveEffectiveConfig, resolveModelForCapability, selectableModelsByCapability, useConfigStore } = await import("./use-config-store");

const channels: LocalModelChannel[] = [
    { id: "video", protocol: "openai" as const, name: "Video", baseUrl: "https://example.invalid", apiKey: "", models: ["custom-name", "gpt-image-2"], modelCapabilities: { "custom-name": "video" as const, "gpt-image-2": "video" as const } },
    { id: "text", protocol: "openai" as const, name: "Text", baseUrl: "https://example.invalid", apiKey: "", models: ["custom-name"], modelCapabilities: { "custom-name": "text" as const } },
];

test("explicit classification wins over name and protocol, auto remains unchanged", () => {
    for (const protocol of ["openai", "gemini", "autodl"]) {
        assert.equal(modelMatchesCapability("gpt-image-2", "video", protocol, { "gpt-image-2": "video" }), true);
        assert.equal(modelMatchesCapability("gpt-image-2", "image", protocol, { "gpt-image-2": "video" }), false);
    }
    assert.equal(modelMatchesCapability("custom-name", "video"), false);
    assert.equal(modelMatchesCapability("custom-name", "text"), true);
    assert.equal(modelMatchesCapability("grok-imagine-video", "video"), true);
});

test("channel-scoped overrides respect allowed models and workflow exclusion", () => {
    assert.deepEqual(filterChannelModelsByCapability(channels, "video"), ["custom-name", "gpt-image-2"]);
    assert.deepEqual(filterChannelModelsByCapability([channels[1]], "video"), []);
    assert.deepEqual(filterChannelModelsByCapability(channels, "image"), []);
    assert.deepEqual(filterChannelModelsByCapability(channels, "video", ["custom-name"]), ["custom-name"]);
    assert.deepEqual(filterChannelModelsByCapability([{ ...channels[0], protocol: "runninghub" }], "video"), []);
});

test("normalization and JSON reload preserve per-channel classification", () => {
    const reloaded = JSON.parse(JSON.stringify({ ...defaultConfig, localChannels: channels }));
    const normalized = normalizeLocalChannels(reloaded);
    assert.deepEqual(normalized[0].modelCapabilities, channels[0].modelCapabilities);
    assert.deepEqual(normalized[1].modelCapabilities, channels[1].modelCapabilities);
    assert.deepEqual(filterChannelModelsByCapability(normalized, "video"), ["custom-name", "gpt-image-2"]);
});

test("remote selection keeps classification without allowing hidden models", () => {
    const config = { ...defaultConfig, channelMode: "remote", publicChannels: channels, models: ["custom-name"] } as AiConfig;
    assert.deepEqual(selectableModelsByCapability(config, "video"), ["custom-name"]);
    assert.deepEqual(selectableModelsByCapability(config, "image"), []);
});

test("explicit video model routes to its channel instead of same-name text channel", () => {
    const config = { ...defaultConfig, models: ["custom-name", "gpt-image-2"], localChannels: channels, model: "custom-name", videoModel: "custom-name", videoChannelId: "video", textChannelId: "text" } as AiConfig;
    assert.equal(channelIdForActiveModel(config), "video");
    assert.equal(resolveModelForCapability(config, "gpt-image-2", "video"), "gpt-image-2");
});

test("batch classification changes selected models only and auto restores recognition", () => {
    const original = { keep: "image" as const, plain: "text" as const };
    const assigned = assignModelCapabilities(original, ["plain", "gpt-image-2"], "video");
    assert.deepEqual(assigned, { keep: "image", plain: "video", "gpt-image-2": "video" });
    assert.deepEqual(original, { keep: "image", plain: "text" });
    const auto = assignModelCapabilities(assigned, ["gpt-image-2"], "auto");
    assert.deepEqual(auto, { keep: "image", plain: "video" });
    assert.equal(modelMatchesCapability("gpt-image-2", "image", "openai", auto), true);
    assert.equal(modelMatchesCapability("gpt-image-2", "image", "openai", { "gpt-image-2": "invalid" } as never), true);
});

test("empty remote allowed models never recover a name-recognized forbidden model", () => {
    const config = { ...defaultConfig, channelMode: "remote", publicChannels: channels, models: [] } as AiConfig;
    assert.equal(resolveModelForCapability(config, "grok-imagine-video", "video"), "");
    const unavailable = { ...config, models: ["custom-name"], publicChannels: [channels[1]] };
    assert.equal(resolveModelForCapability(unavailable, "grok-imagine-video", "video"), "");
});

test("refresh and store rehydration retain explicit classification and selected video", () => {
    const config = { ...defaultConfig, videoModel: "custom-name", videoChannelId: "video", localChannels: channels } as AiConfig;
    const refreshed = { ...config, localChannels: channels.map((channel) => ({ ...channel, models: [...channel.models, "new-model"] })) };
    const merged = useConfigStore.persist.getOptions().merge!(JSON.parse(JSON.stringify({ config: refreshed })), useConfigStore.getState());
    assert.equal(merged.config.videoModel, "custom-name");
    assert.equal(merged.config.videoChannelId, "video");
    assert.deepEqual(merged.config.videoModels, ["custom-name", "gpt-image-2"]);
    assert.equal(merged.config.localChannels[0].modelCapabilities?.["custom-name"], "video");
});

test("effective remote defaults select explicitly classified custom models but respect remote authorization", () => {
    const modelChannel: NonNullable<Parameters<typeof resolveEffectiveConfig>[1]> = {
        channels: channels.map((channel) => ({ ...channel, weight: 1, timeout: 600, enabled: true, remark: "" })),
        availableModels: ["custom-name"], allowCustomChannel: true, allowUserRemoteChannel: true,
        availableWorkflows: [], modelCosts: [], systemPrompts: defaultConfig.systemPrompts,
        defaultVideoModel: "", defaultImageModel: "", defaultTextModel: "", defaultModel: "",
        systemPrompt: "",
    };
    const config = { ...defaultConfig, channelMode: "remote" } as AiConfig;
    const remote = resolveEffectiveConfig(config, modelChannel, true);
    assert.equal(remote.videoModel, "custom-name");
    assert.deepEqual(remote.videoModels, ["custom-name"]);
    const unauthorized = resolveEffectiveConfig(config, modelChannel, false);
    assert.equal(unauthorized.channelMode, "local");
});

test("one channel can save and reload mixed explicitly classified models", () => {
    const modelCapabilities = assignModelCapabilities({ clip: "text", chat: "text" }, ["clip"], "video");
    const mixed = { ...channels[0], id: "mixed", models: ["clip", "chat"], modelCapabilities };
    const config = { ...defaultConfig, localChannels: [mixed], videoModel: "clip", videoChannelId: "mixed", textModel: "chat", textChannelId: "mixed" };
    const merged = useConfigStore.persist.getOptions().merge!(JSON.parse(JSON.stringify({ config })), useConfigStore.getState());
    assert.deepEqual(merged.config.videoModels, ["clip"]);
    assert.deepEqual(merged.config.textModels, ["chat"]);
    assert.deepEqual(merged.config.localChannels[0].modelCapabilities, { clip: "video", chat: "text" });
    assert.equal(merged.config.videoModel, "clip");
    assert.equal(merged.config.textModel, "chat");
});
