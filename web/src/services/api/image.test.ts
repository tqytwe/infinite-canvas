import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasImageTask, requestGeneration } from "./image";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

function directSenseNovaConfig(): AiConfig {
    return {
        ...defaultConfig,
        channelMode: "local",
        model: "sensenova-u1-fast",
        imageModel: "sensenova-u1-fast",
        imageChannelId: "jisudeng-api",
        activeChannelId: "jisudeng-api",
        apiMode: "images",
        localChannels: [
            {
                id: "jisudeng-api",
                protocol: "openai",
                name: "极速蹬 API",
                baseUrl: "https://api.jisudeng.com",
                apiKey: "user-api-key",
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
            },
        ],
    };
}

function directSenseNovaU15Config(): AiConfig {
    const config = directSenseNovaConfig();
    config.model = "sensenova-u1.5-lite";
    config.imageModel = "sensenova-u1.5-lite";
    config.localChannels[0] = {
        ...config.localChannels[0],
        models: ["sensenova-u1.5-lite"],
        modelCapabilities: { "sensenova-u1.5-lite": ["image"] },
        modelMediaCapabilities: {
            "sensenova-u1.5-lite": {
                adapter: "sensenova",
                capabilityVersion: "v1",
                modalities: ["image"],
                image: { operations: ["create", "edit"], supportedSizes: ["1024x1024"], supportedRatios: ["1:1"], supportedFormats: ["png"] },
            },
        },
    };
    return config;
}

test("direct image requests use the fixed API endpoint without Canvas session authorization", async () => {
    const originalFetch = globalThis.fetch;
    const runtime = globalThis as unknown as { window?: Pick<Window, "setTimeout" | "clearTimeout"> };
    const originalWindow = runtime.window;
    const originalState = useUserStore.getState();
    const requests: Array<{ url: string; body: unknown; authorization: string | null }> = [];
    useUserStore.setState({ token: "canvas-admin-session", hydrateUser: async () => undefined });
    runtime.window = {
        setTimeout: ((handler: TimerHandler, timeout?: number) => globalThis.setTimeout(handler, timeout) as unknown as number) as Window["setTimeout"],
        clearTimeout: ((id?: number) => globalThis.clearTimeout(id)) as Window["clearTimeout"],
    };
    globalThis.fetch = (async (input, init) => {
        const url = String(input);
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
        requests.push({ url, body, authorization: new Headers(init?.headers).get("Authorization") });
        return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
        const config = directSenseNovaConfig();
        await requestGeneration(config, "a lighthouse at dusk");
        await createCanvasImageTask(config, "a lighthouse at dusk", []);
        const directRequests = requests.filter((request) => request.url.startsWith("https://api.jisudeng.com/"));

        assert.equal(directRequests.length, 2);
        assert.equal(directRequests[0]?.url, "https://api.jisudeng.com/v1/images/generations");
        assert.equal((directRequests[0]?.body as { model?: string }).model, "sensenova-u1-fast");
        assert.equal(directRequests[0]?.authorization, "Bearer user-api-key");
        assert.equal(Object.hasOwn(directRequests[0]?.body as object, "watermark"), false);
        assert.equal(directRequests[1]?.url, "https://api.jisudeng.com/v1/images/generations");
        assert.equal(directRequests[1]?.authorization, "Bearer user-api-key");
        assert.equal(
            requests.some((request) => request.url.includes("/api/v1/images") || request.url.includes("/api/v1/canvas") || request.url.includes("/responses")),
            false,
        );
    } finally {
        globalThis.fetch = originalFetch;
        useUserStore.setState(originalState, true);
        if (originalWindow) runtime.window = originalWindow;
        else Reflect.deleteProperty(runtime, "window");
    }
});

test("SenseNova U1.5 Lite sends the user's explicit watermark choice", async () => {
    const originalFetch = globalThis.fetch;
    const runtime = globalThis as unknown as { window?: Pick<Window, "setTimeout" | "clearTimeout"> };
    const originalWindow = runtime.window;
    const originalState = useUserStore.getState();
    const requests: Array<Record<string, unknown>> = [];
    useUserStore.setState({ token: "canvas-admin-session", hydrateUser: async () => undefined });
    runtime.window = {
        setTimeout: ((handler: TimerHandler, timeout?: number) => globalThis.setTimeout(handler, timeout) as unknown as number) as Window["setTimeout"],
        clearTimeout: ((id?: number) => globalThis.clearTimeout(id)) as Window["clearTimeout"],
    };
    globalThis.fetch = (async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
        const config = { ...directSenseNovaU15Config(), imageWatermark: "false" };
        await requestGeneration(config, "a lighthouse at dusk");
        assert.equal(requests[0]?.watermark as boolean | undefined, false);
    } finally {
        globalThis.fetch = originalFetch;
        useUserStore.setState(originalState, true);
        if (originalWindow) runtime.window = originalWindow;
        else Reflect.deleteProperty(runtime, "window");
    }
});
