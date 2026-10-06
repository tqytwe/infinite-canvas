import assert from "node:assert/strict";
import { test } from "node:test";
import axios from "axios";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { pollVideoGenerationTaskStatus, type VideoResponse } from "./video";

const model = "ch0101-sd-2.0-720p";
const baseUrl = "https://starframe.example.invalid";
const config: AiConfig = {
    ...defaultConfig,
    channelMode: "local",
    baseUrl,
    apiKey: "",
    model,
    videoModel: model,
    activeChannelId: "starframe-test",
    videoChannelId: "starframe-test",
    localChannels: [{ id: "starframe-test", protocol: "starframe", name: "StarFrame test", baseUrl, apiKey: "", models: [model] }],
};
const originalTask = { id: "client_video_task_original", task_id: "sfv_123", client_task_id: "order-original" };
const canonicalUrl = "/v1/videos/sfv_123/content";
const contentUrl = `${baseUrl}${canonicalUrl}?model=${model}`;

async function withStubbedPoll(
    payload: unknown,
    check: (poll: () => Promise<VideoResponse>, fetchCalls: string[]) => Promise<void>,
    contentFailure?: number | TypeError,
) {
    const originalGet = axios.get;
    const originalFetch = globalThis.fetch;
    const originalToken = useUserStore.getState().token;
    const fetchCalls: string[] = [];
    let getCalls = 0;
    try {
        useUserStore.setState({ token: "" });
        axios.get = (async (url: string) => {
            getCalls++;
            assert.equal(url, `${baseUrl}/v1/videos/${originalTask.id}`);
            return { data: payload };
        }) as typeof axios.get;
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            fetchCalls.push(String(input));
            if (contentFailure !== undefined) {
                assert.equal(String(input), contentUrl);
                if (typeof contentFailure === "number") return new Response(null, { status: contentFailure });
                throw contentFailure;
            }
            throw new Error("Unexpected fetch: integration tests prohibit network access");
        }) as typeof fetch;
        await check(() => pollVideoGenerationTaskStatus(config, originalTask), fetchCalls);
        assert.equal(getCalls, 1);
    } finally {
        axios.get = originalGet;
        globalThis.fetch = originalFetch;
        useUserStore.setState({ token: originalToken });
    }
}

async function withPolledPayload(payload: unknown, check: (result: VideoResponse, fetchCalls: string[]) => void) {
    await withStubbedPoll(payload, async (poll, fetchCalls) => {
        check(await poll(), fetchCalls);
    });
}

for (const wrapped of [false, true]) {
    const shape = wrapped ? "wrapped" : "bare";
    const wrap = (data: unknown) => wrapped ? { code: 0, data } : data;

    for (const status of ["queued", "in_progress", "unknown"]) {
        test(`public StarFrame poll keeps ${shape} ${status} metadata URL nonterminal`, async () => {
            const payload = wrap({
                id: originalTask.id,
                task_id: originalTask.task_id,
                status,
                metadata: { url: "https://media.example.invalid/premature.mp4" },
            });
            await withPolledPayload(payload, (result, fetchCalls) => {
                assert.equal(result.status, status);
                assert.equal(result.video_url, "", "generic normalization must not restore a nonterminal metadata URL");
                assert.equal(result.url, "");
                assert.equal(result.id, originalTask.id);
                assert.equal(result.task_id, originalTask.task_id);
                assert.equal((result as Record<string, unknown>).client_task_id, originalTask.client_task_id);
                assert.deepEqual(fetchCalls, [], "nonterminal polling must not fetch content or trigger storage synchronization");
            });
        });
    }

    test(`public StarFrame poll preserves ${shape} failed reason and original client identity`, async () => {
        await withPolledPayload(wrap({
            id: originalTask.id,
            task_id: originalTask.task_id,
            status: "failed",
            metadata: { fail_reason: "unsupported duration" },
        }), (result, fetchCalls) => {
            assert.equal(result.status, "failed");
            assert.deepEqual(result.error, { message: "unsupported duration" });
            assert.equal(result.video_url, "");
            assert.equal(result.url, "");
            assert.equal(result.id, originalTask.id);
            assert.equal(result.task_id, originalTask.task_id);
            assert.equal((result as Record<string, unknown>).client_task_id, originalTask.client_task_id);
            assert.deepEqual(fetchCalls, []);
        });
    });

    test(`public StarFrame poll preserves ${shape} completed canonical URL and both task identities`, async () => {
        await withPolledPayload(wrap({
            id: originalTask.id,
            task_id: originalTask.task_id,
            status: "completed",
            metadata: { url: canonicalUrl },
            storageKey: "video:already-cached-test-fixture",
        }), (result, fetchCalls) => {
            assert.equal(result.status, "completed");
            assert.equal(result.video_url, canonicalUrl);
            assert.equal(result.url, canonicalUrl);
            assert.equal(result.id, originalTask.id);
            assert.equal(result.task_id, originalTask.task_id);
            assert.equal((result as Record<string, unknown>).client_task_id, originalTask.client_task_id);
            assert.equal(result.storageKey, "video:already-cached-test-fixture");
            assert.deepEqual(fetchCalls, []);
        });
    });
}

for (const contentFailure of [408, 425, 429, 500, 503, new TypeError("simulated content network failure")]) {
    const label = typeof contentFailure === "number" ? `HTTP ${contentFailure}` : "network TypeError";
    test(`public StarFrame poll marks content ${label} retryable without losing task identity`, async () => {
        await withStubbedPoll({
            id: originalTask.id,
            task_id: originalTask.task_id,
            status: "completed",
            metadata: { url: canonicalUrl },
        }, async (poll, fetchCalls) => {
            await assert.rejects(poll, (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.equal(error.name, "VideoContentRetryError");
                const retry = error as Error & { task: VideoResponse & { client_task_id?: string }; status?: number };
                assert.equal(retry.task.id, originalTask.id);
                assert.equal(retry.task.task_id, originalTask.task_id);
                assert.equal(retry.task.client_task_id, originalTask.client_task_id);
                assert.equal(retry.task.status, "completed");
                assert.equal(retry.task.video_url, canonicalUrl);
                assert.equal(retry.status, typeof contentFailure === "number" ? contentFailure : undefined);
                return true;
            });
            assert.deepEqual(fetchCalls, [contentUrl]);
        }, contentFailure);
    });
}

for (const status of [401, 404]) {
    test(`public StarFrame poll does not classify content HTTP ${status} as retryable`, async () => {
        await withStubbedPoll({
            id: originalTask.id,
            task_id: originalTask.task_id,
            status: "completed",
            metadata: { url: canonicalUrl },
        }, async (poll, fetchCalls) => {
            await assert.rejects(poll, (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.equal(error.name, "VideoRequestError");
                assert.match(error.message, new RegExp(String(status)));
                return true;
            });
            assert.deepEqual(fetchCalls, [contentUrl]);
        }, status);
    });
}
