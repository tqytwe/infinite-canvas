import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import test from "node:test";

const SERVER_DIR = resolve(new URL(".", import.meta.url).pathname);
const STATIC_DIR = join(SERVER_DIR, "..", "web", "dist");

async function freePort() {
    const probe = createServer();
    await new Promise((resolvePromise) => probe.listen(0, "127.0.0.1", resolvePromise));
    const address = probe.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise((resolvePromise) => probe.close(resolvePromise));
    return port;
}

async function waitForHealth(baseUrl) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/health`);
            if (response.ok) return;
        } catch {}
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    throw new Error("SERVER_START_TIMEOUT");
}

function cookie(token) {
    return `canvas_session=${encodeURIComponent(token)}`;
}

async function responseJson(response) {
    return response.json();
}

async function createSession(dataDir, userId, suffix) {
    const token = `integration-session-${userId}-${suffix}-${"x".repeat(32)}`;
    await mkdir(join(dataDir, "sessions"), { recursive: true });
    await writeFile(
        join(dataDir, "sessions", `${token}.json`),
        JSON.stringify({
            token,
            userId,
            apiKey: `integration-key-${userId}`,
            apiKeyId: userId,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
        { mode: 0o600 },
    );
    return token;
}

async function putObject(baseUrl, token, storageKey, body) {
    return fetch(`${baseUrl}/api/storage/objects/${encodeURIComponent(storageKey)}`, {
        method: "PUT",
        headers: { cookie: cookie(token), "content-type": "application/octet-stream" },
        body,
    });
}

function startPlatformServer(handler) {
    const server = createServer(handler);
    return new Promise((resolvePromise) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            resolvePromise({ server, baseUrl: `http://127.0.0.1:${address.port}` });
        });
    });
}

test("HTTP storage enforces auth, persistence, range reads, quota, LRU, and pinned objects", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "infinite-canvas-http-"));
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ["index.mjs"], {
        cwd: SERVER_DIR,
        env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: String(port),
            STATIC_DIR,
            CANVAS_DATA_DIR: dataDir,
            CANVAS_MAX_STORAGE_BYTES: "10b",
            CANVAS_MAX_UPLOAD_BYTES: "8b",
            CANVAS_MAX_STATE_BYTES: "1kb",
            CANVAS_MIN_FREE_BYTES: "1b",
            CANVAS_PLATFORM_API_BASE_URL: "",
            CANVAS_PLATFORM_WEB_URL: "http://platform.test",
            CANVAS_EXCHANGE_SECRET: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });

    t.after(async () => {
        child.kill("SIGTERM");
        await new Promise((resolvePromise) => child.once("exit", resolvePromise));
        await rm(dataDir, { recursive: true, force: true });
    });

    await waitForHealth(baseUrl);

    const anonymousUpload = await fetch(`${baseUrl}/api/storage/objects/image%3Aanonymous`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: "abc",
    });
    assert.equal(anonymousUpload.status, 401);
    assert.equal((await responseJson(anonymousUpload)).error, "AUTH_REQUIRED");

    const userToken = await createSession(dataDir, 101, "primary");
    const uploaded = await putObject(baseUrl, userToken, "image:range", "abcdefghij");
    assert.equal(uploaded.status, 413);
    assert.equal((await responseJson(uploaded)).error, "UPLOAD_TOO_LARGE");

    const smallUpload = await putObject(baseUrl, userToken, "image:range", "abcd");
    assert.equal(smallUpload.status, 200);
    assert.equal((await responseJson(smallUpload)).used_bytes, 4);

    const ranged = await fetch(`${baseUrl}/api/storage/objects/${encodeURIComponent("image:range")}`, {
        headers: { cookie: cookie(userToken), range: "bytes=1-2" },
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), "bytes 1-2/4");
    assert.equal(await ranged.text(), "bc");

    const state = await fetch(`${baseUrl}/api/storage/state/canvas`, {
        method: "PUT",
        headers: { cookie: cookie(userToken), "content-type": "application/json" },
        body: "{}",
    });
    assert.equal(state.status, 200);
    const statePayload = await responseJson(state);
    assert.equal(statePayload.state_count, 1);
    assert.equal(statePayload.object_count, 1);

    const tooLargeFiles = await readdir(join(dataDir, "users", "101"));
    assert.equal(tooLargeFiles.some((name) => name.startsWith(".upload-")), false);

    const lruToken = await createSession(dataDir, 102, "lru");
    assert.equal((await putObject(baseUrl, lruToken, "image:old", "1111")).status, 200);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    assert.equal((await putObject(baseUrl, lruToken, "image:new", "2222")).status, 200);
    const rolled = await putObject(baseUrl, lruToken, "image:incoming", "333333");
    assert.equal(rolled.status, 200);
    const rolledUsage = await responseJson(rolled);
    assert.equal(rolledUsage.used_bytes, 10);
    const lruMetadata = JSON.parse(await readFile(join(dataDir, "users", "102", "metadata.json"), "utf8"));
    assert.equal("image:old" in lruMetadata.objects, false);
    assert.equal("image:new" in lruMetadata.objects, true);
    assert.equal("image:incoming" in lruMetadata.objects, true);

    const pinnedToken = await createSession(dataDir, 103, "pinned");
    assert.equal((await putObject(baseUrl, pinnedToken, "image:pinned", "4444")).status, 200);
    const pin = await fetch(`${baseUrl}/api/storage/objects/${encodeURIComponent("image:pinned")}/pin`, {
        method: "PUT",
        headers: { cookie: cookie(pinnedToken), "content-type": "application/json" },
        body: JSON.stringify({ pinned: true }),
    });
    assert.equal(pin.status, 200);
    assert.equal((await putObject(baseUrl, pinnedToken, "image:evictable", "5555")).status, 200);
    const evicted = await putObject(baseUrl, pinnedToken, "image:replacement", "6666");
    assert.equal(evicted.status, 200);
    const pinnedMetadata = JSON.parse(await readFile(join(dataDir, "users", "103", "metadata.json"), "utf8"));
    assert.equal("image:pinned" in pinnedMetadata.objects, true);
    assert.equal("image:evictable" in pinnedMetadata.objects, false);
    assert.equal("image:replacement" in pinnedMetadata.objects, true);
});

test("HTTP storage preserves state-referenced objects during LRU cleanup", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "infinite-canvas-http-protected-"));
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ["index.mjs"], {
        cwd: SERVER_DIR,
        env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: String(port),
            STATIC_DIR,
            CANVAS_DATA_DIR: dataDir,
            CANVAS_MAX_STORAGE_BYTES: "100b",
            CANVAS_MAX_UPLOAD_BYTES: "32b",
            CANVAS_MAX_STATE_BYTES: "1kb",
            CANVAS_MIN_FREE_BYTES: "1b",
            CANVAS_PLATFORM_API_BASE_URL: "",
            CANVAS_PLATFORM_WEB_URL: "http://platform.test",
            CANVAS_EXCHANGE_SECRET: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });

    t.after(async () => {
        child.kill("SIGTERM");
        await new Promise((resolvePromise) => child.once("exit", resolvePromise));
        await rm(dataDir, { recursive: true, force: true });
    });

    await waitForHealth(baseUrl);
    const token = await createSession(dataDir, 104, "protected");
    assert.equal((await putObject(baseUrl, token, "image:used", "1".repeat(20))).status, 200);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    assert.equal((await putObject(baseUrl, token, "image:unused", "2".repeat(20))).status, 200);
    const state = await fetch(`${baseUrl}/api/storage/state/canvas`, {
        method: "PUT",
        headers: { cookie: cookie(token), "content-type": "application/json" },
        body: JSON.stringify({ nodes: [{ metadata: { storageKey: "image:used" } }] }),
    });
    assert.equal(state.status, 200);
    const incoming = await putObject(baseUrl, token, "image:incoming", "3".repeat(20));
    assert.equal(incoming.status, 200);
    const metadata = JSON.parse(await readFile(join(dataDir, "users", "104", "metadata.json"), "utf8"));
    assert.equal("image:used" in metadata.objects, true);
    assert.equal("image:unused" in metadata.objects, false);
    assert.equal("image:incoming" in metadata.objects, true);
    const usage = await fetch(`${baseUrl}/api/storage/usage`, { headers: { cookie: cookie(token) } });
    assert.equal((await responseJson(usage)).protected_object_count, 1);
});

test("HTTP platform gateway rewrites async image asset URLs to local proxies", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "infinite-canvas-http-platform-"));
    const platform = await startPlatformServer((req, res) => {
        if (req.url === "/v1/images/tasks/imgtask_1") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
                JSON.stringify({
                    task_id: "imgtask_1",
                    status: "completed",
                    image_url: "/v1/images/task-assets/images/imgtask_1-0.png",
                    result: { data: [{ url: "/v1/images/task-assets/images/imgtask_1-0.png" }] },
                }),
            );
            return;
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end("{}");
    });
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ["index.mjs"], {
        cwd: SERVER_DIR,
        env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: String(port),
            STATIC_DIR,
            CANVAS_DATA_DIR: dataDir,
            CANVAS_PLATFORM_API_BASE_URL: platform.baseUrl,
            CANVAS_PLATFORM_WEB_URL: "http://platform.test",
            CANVAS_EXCHANGE_SECRET: "secret",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });

    t.after(async () => {
        child.kill("SIGTERM");
        await new Promise((resolvePromise) => child.once("exit", resolvePromise));
        await new Promise((resolvePromise) => platform.server.close(resolvePromise));
        await rm(dataDir, { recursive: true, force: true });
    });

    await waitForHealth(baseUrl);
    const token = await createSession(dataDir, 105, "platform");
    const response = await fetch(`${baseUrl}/api/platform/gateway/v1/images/tasks/imgtask_1`, {
        headers: { cookie: cookie(token), accept: "application/json" },
    });
    assert.equal(response.status, 200);
    const payload = await responseJson(response);
    assert.equal(payload.image_url, "/api/platform/gateway/v1/images/task-assets/images/imgtask_1-0.png");
    assert.equal(payload.result.data[0].url, "/api/platform/gateway/v1/images/task-assets/images/imgtask_1-0.png");
});
