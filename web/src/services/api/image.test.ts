import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasImageTask, requestGeneration } from "./image";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

function managedSenseNovaConfig(): AiConfig {
    return {
        ...defaultConfig,
        channelMode: "remote",
        model: "sensenova-u1-fast",
        imageModel: "sensenova-u1-fast",
        imageChannelId: "platform-managed:image:17",
        activeChannelId: "platform-managed:image:17",
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
}

test("managed image requests normalize stale Responses mode at both execution boundaries", async () => {
    const originalFetch = globalThis.fetch;
    const runtime = globalThis as unknown as { window?: Pick<Window, "setTimeout" | "clearTimeout"> };
    const originalWindow = runtime.window;
    const originalState = useUserStore.getState();
    const requests: Array<{ url: string; body: unknown }> = [];
    useUserStore.setState({ token: "managed-session", hydrateUser: async () => undefined });
    runtime.window = {
        setTimeout: ((handler: TimerHandler, timeout?: number) => globalThis.setTimeout(handler, timeout) as unknown as number) as Window["setTimeout"],
        clearTimeout: ((id?: number) => globalThis.clearTimeout(id)) as Window["clearTimeout"],
    };
    globalThis.fetch = (async (input, init) => {
        const url = String(input);
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
        requests.push({ url, body });
        if (url === "/api/v1/canvas/image-tasks") {
            return new Response(JSON.stringify({ code: 0, data: { id: "image-task-1", status: "queued" } }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
        const config = managedSenseNovaConfig();
        await requestGeneration(config, "a lighthouse at dusk");
        await createCanvasImageTask(config, "a lighthouse at dusk", []);

        assert.equal(requests[0]?.url, "/api/v1/images/generations");
        assert.equal((requests[0]?.body as { model?: string }).model, "sensenova-u1-fast");
        assert.equal(requests[1]?.url, "/api/v1/canvas/image-tasks");
        assert.equal((requests[1]?.body as { endpoint?: string }).endpoint, "/images/generations");
        assert.equal(
            requests.some((request) => request.url.includes("/responses") || (request.body as { endpoint?: string })?.endpoint === "/responses"),
            false,
        );
    } finally {
        globalThis.fetch = originalFetch;
        useUserStore.setState(originalState, true);
        if (originalWindow) runtime.window = originalWindow;
        else Reflect.deleteProperty(runtime, "window");
    }
});
