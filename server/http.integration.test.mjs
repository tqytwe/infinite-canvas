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

async function createSession(dataDir, userId, suffix, extra = {}) {
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
            ...extra,
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
    const health = await fetch(`${baseUrl}/health`);
    const healthPayload = await responseJson(health);
    assert.equal(healthPayload.storage.scope, "global");
    assert.equal(healthPayload.storage.max_bytes, 10);

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

    const objectUrl = `${baseUrl}/api/storage/objects/${encodeURIComponent("image:range")}`;
    const full = await fetch(objectUrl, { headers: { cookie: cookie(userToken) } });
    assert.equal(full.status, 200);
    assert.equal(await full.text(), "abcd");
    const cached = await fetch(objectUrl, { headers: { cookie: cookie(userToken), "if-none-match": full.headers.get("etag") } });
    assert.equal(cached.status, 304);

    const ranged = await fetch(objectUrl, {
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
    assert.equal(statePayload.scope, "global");

    const tooLargeFiles = await readdir(join(dataDir, "users", "101"));
    assert.equal(tooLargeFiles.some((name) => name.startsWith(".upload-")), false);

    const lruToken = await createSession(dataDir, 102, "lru");
    const crossUserUpload = await putObject(baseUrl, lruToken, "image:other-user", "5555");
    assert.equal(crossUserUpload.status, 200);
    assert.equal((await responseJson(crossUserUpload)).used_bytes, 10);
    assert.equal("image:range" in JSON.parse(await readFile(join(dataDir, "users", "101", "metadata.json"), "utf8")).objects, true);
    assert.equal((await putObject(baseUrl, lruToken, "image:old", "1111")).status, 200);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    assert.equal((await putObject(baseUrl, lruToken, "image:new", "2222")).status, 200);
    const rolled = await putObject(baseUrl, lruToken, "image:incoming", "333333");
    assert.equal(rolled.status, 200);
    const rolledUsage = await responseJson(rolled);
    assert.equal(rolledUsage.used_bytes, 8);
    assert.equal("image:range" in JSON.parse(await readFile(join(dataDir, "users", "101", "metadata.json"), "utf8")).objects, false);
    const lruMetadata = JSON.parse(await readFile(join(dataDir, "users", "102", "metadata.json"), "utf8"));
    assert.equal("image:old" in lruMetadata.objects, false);
    assert.equal("image:new" in lruMetadata.objects, false);
    assert.equal("image:incoming" in lruMetadata.objects, true);
});

test("HTTP global storage keeps pinned objects during shared LRU cleanup", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "infinite-canvas-http-pinned-"));
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
    let platformAcceptEncoding = "";
    const platform = await startPlatformServer((req, res) => {
        if (req.url === "/v1/images/tasks/imgtask_1") {
            platformAcceptEncoding = String(req.headers["accept-encoding"] || "");
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
                JSON.stringify({
                    task_id: "imgtask_1",
                    status: "completed",
                    poll_url: "/v1/images/tasks/imgtask_1",
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
    assert.equal(platformAcceptEncoding, "identity");
    assert.equal(payload.poll_url, "/api/platform/gateway/v1/images/tasks/imgtask_1");
    assert.equal(payload.image_url, "/api/platform/gateway/v1/images/task-assets/images/imgtask_1-0.png");
    assert.equal(payload.result.data[0].url, "/api/platform/gateway/v1/images/task-assets/images/imgtask_1-0.png");
});

test("HTTP platform gateway rewrites video content URLs to the authenticated local gateway", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "infinite-canvas-http-platform-video-"));
    const platform = await startPlatformServer((req, res) => {
        if (req.url === "/v1/videos/vtask_1") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
                JSON.stringify({
                    id: "vtask_1",
                    status: "completed",
                    content: { url: "/v1/videos/vtask_1/content" },
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
    const token = await createSession(dataDir, 107, "platform-video");
    const response = await fetch(`${baseUrl}/api/platform/gateway/v1/videos/vtask_1`, {
        headers: { cookie: cookie(token), accept: "application/json" },
    });
    assert.equal(response.status, 200);
    const payload = await responseJson(response);
    assert.equal(payload.content.url, "/api/platform/gateway/v1/videos/vtask_1/content");
});

test("HTTP platform gateway signs external async image asset URLs for same-origin proxying", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "infinite-canvas-http-platform-signed-assets-"));
    let assetOrigin = "";
    const assetServer = createServer((req, res) => {
        if (req.url === "/image-task-results/images/imgtask_2-0.png") {
            res.writeHead(200, { "content-type": "image/png" });
            res.end("png-bytes");
            return;
        }
        res.writeHead(404).end();
    });
    await new Promise((resolvePromise) => assetServer.listen(0, "127.0.0.1", resolvePromise));
    const assetAddress = assetServer.address();
    assetOrigin = `http://127.0.0.1:${typeof assetAddress === "object" && assetAddress ? assetAddress.port : 0}`;

    const platform = await startPlatformServer((req, res) => {
        if (req.url === "/v1/images/tasks/imgtask_2") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
                JSON.stringify({
                    task_id: "imgtask_2",
                    status: "completed",
                    result: { data: [{ url: `${assetOrigin}/image-task-results/images/imgtask_2-0.png` }] },
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
        await new Promise((resolvePromise) => assetServer.close(resolvePromise));
        await rm(dataDir, { recursive: true, force: true });
    });

    await waitForHealth(baseUrl);
    const token = await createSession(dataDir, 106, "platform-signed");
    const response = await fetch(`${baseUrl}/api/platform/gateway/v1/images/tasks/imgtask_2`, {
        headers: { cookie: cookie(token), accept: "application/json" },
    });
    assert.equal(response.status, 200);
    const payload = await responseJson(response);
    const proxied = payload.result.data[0].url;
    assert.match(proxied, /^\/api\/platform\/asset-proxy\?url=/);
    assert.match(proxied, /&expires=\d+&sig=/);

    const asset = await fetch(`${baseUrl}${proxied}`, { headers: { cookie: cookie(token) } });
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), "png-bytes");
});

test("HTTP platform gateway uses scoped image and video sessions for their APIs", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "infinite-canvas-http-platform-image-session-"));
    let imageAuth = "";
    let videoAuth = "";
    let videoBody = "";
    let agnesAuth = "";
    let videoGroupAuth = "";
    let videoGroupKeyID = "";
    let videoGroupBody = "";
    let imageGroupAuth = "";
    let imageGroupKeyID = "";
    let imageGroupBody = "";
    const platform = await startPlatformServer((req, res) => {
        if (req.method === "GET" && req.url === "/api/v1/nextchat/bootstrap") {
            const apiKeyId = String(req.headers["x-nextchat-api-key-id"] || "");
            const model = apiKeyId === "209" ? "gpt-image-2" : apiKeyId === "309" ? "agnes-video-v2.0" : "gpt-5.5";
            const useCase = apiKeyId === "209" ? "image_studio" : apiKeyId === "309" ? "video" : "text";
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ code: 0, data: { user: { id: 109 }, models: { source: "/v1/models", groups: [{ id: Number(apiKeyId), name: `group-${apiKeyId}`, models: [{ name: model, use_case: useCase }] }] } } }));
            return;
        }
        if (req.method === "POST" && req.url === "/v1/images/generations/async") {
            imageAuth = req.headers.authorization || "";
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ task_id: "imgtask_scoped" }));
            return;
        }
        if (req.method === "POST" && req.url === "/v1/videos") {
            videoAuth = req.headers.authorization || "";
            req.on("data", (chunk) => {
                videoBody += chunk;
            });
            req.on("end", () => {
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({ id: "videotask_scoped" }));
            });
            return;
        }
        if (req.method === "GET" && req.url === "/v1/agnesapi?video_id=videotask_scoped") {
            agnesAuth = req.headers.authorization || "";
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ status: "processing" }));
            return;
        }
        if (req.method === "POST" && req.url === "/api/v1/nextchat/group") {
            const keyID = String(req.headers["x-nextchat-api-key-id"] || "");
            const target = keyID === "209" ? "image" : "video";
            if (target === "image") {
                imageGroupAuth = req.headers.authorization || "";
                imageGroupKeyID = keyID;
            } else {
                videoGroupAuth = req.headers.authorization || "";
                videoGroupKeyID = keyID;
            }
            req.on("data", (chunk) => {
                if (target === "image") imageGroupBody += chunk;
                else videoGroupBody += chunk;
            });
            req.on("end", () => {
                res.writeHead(200, { "content-type": "application/json" });
                res.end(JSON.stringify({ code: 0, data: { managed_api_key: { id: 309 }, models: { groups: [] } } }));
            });
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
    const token = await createSession(dataDir, 109, "platform-image-session", {
        sessions: {
            chat: { apiKey: "chat-key", apiKeyId: 109, purpose: "chat" },
            image: { apiKey: "image-key", apiKeyId: 209, purpose: "image" },
            video: { apiKey: "video-key", apiKeyId: 309, purpose: "video" },
        },
    });
    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: cookie(token) } });
    const sessionPayload = await responseJson(session);
    const modelNames = sessionPayload.models.groups.flatMap((group) => group.models.map((model) => model.name));
    assert.deepEqual(modelNames.sort(), ["agnes-video-v2.0", "gpt-5.5", "gpt-image-2"]);

    const response = await fetch(`${baseUrl}/api/platform/gateway/v1/images/generations/async`, {
        method: "POST",
        headers: { cookie: cookie(token), "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-2", prompt: "test" }),
    });
    assert.equal(response.status, 200);
    assert.equal(imageAuth, "Bearer image-key");

    const videoResponse = await fetch(`${baseUrl}/api/platform/gateway/v1/videos`, {
        method: "POST",
        headers: { cookie: cookie(token), "content-type": "application/json" },
        body: JSON.stringify({ model: "agnes-video-v2.0", prompt: "test" }),
    });
    assert.equal(videoResponse.status, 200);
    assert.equal(videoAuth, "Bearer video-key");
    assert.equal(JSON.parse(videoBody).model, "agnes-video-v2.0");

    const agnesResponse = await fetch(`${baseUrl}/api/platform/gateway/v1/agnesapi?video_id=videotask_scoped`, {
        headers: { cookie: cookie(token) },
    });
    assert.equal(agnesResponse.status, 200);
    assert.equal(agnesAuth, "Bearer video-key");

    const groupResponse = await fetch(`${baseUrl}/api/platform/video/group`, {
        method: "POST",
        headers: { cookie: cookie(token), "content-type": "application/json" },
        body: JSON.stringify({ group_id: 88 }),
    });
    assert.equal(groupResponse.status, 200);
    assert.equal(videoGroupAuth, "Bearer video-key");
    assert.equal(videoGroupKeyID, "309");
    assert.deepEqual(JSON.parse(videoGroupBody), { group_id: 88 });

    const imageGroup = await fetch(`${baseUrl}/api/platform/image/group`, {
        method: "POST",
        headers: { cookie: cookie(token), "content-type": "application/json" },
        body: JSON.stringify({ group_id: 77 }),
    });
    assert.equal(imageGroup.status, 200);
    assert.equal(imageGroupAuth, "Bearer image-key");
    assert.equal(imageGroupKeyID, "209");
    assert.deepEqual(JSON.parse(imageGroupBody), { group_id: 77 });

    const legacyToken = await createSession(dataDir, 110, "no-video-session");
    const legacyVideo = await fetch(`${baseUrl}/api/platform/gateway/v1/videos`, {
        method: "POST",
        headers: { cookie: cookie(legacyToken), "content-type": "application/json" },
        body: JSON.stringify({ model: "agnes-video-v2.0", prompt: "test" }),
    });
    assert.equal(legacyVideo.status, 409);
    assert.equal((await responseJson(legacyVideo)).error, "VIDEO_SESSION_REQUIRED");

    const legacyGroup = await fetch(`${baseUrl}/api/platform/video/group`, {
        method: "POST",
        headers: { cookie: cookie(legacyToken), "content-type": "application/json" },
        body: JSON.stringify({ group_id: 88 }),
    });
    assert.equal(legacyGroup.status, 409);
    assert.equal((await responseJson(legacyGroup)).error, "VIDEO_SESSION_REQUIRED");

    const legacyImageGroup = await fetch(`${baseUrl}/api/platform/image/group`, {
        method: "POST",
        headers: { cookie: cookie(legacyToken), "content-type": "application/json" },
        body: JSON.stringify({ group_id: 77 }),
    });
    assert.equal(legacyImageGroup.status, 409);
    assert.equal((await responseJson(legacyImageGroup)).error, "IMAGE_SESSION_REQUIRED");
});

test("HTTP managed prompt handoff requires a Canvas session and uses the platform BFF", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "infinite-canvas-http-prompt-handoff-"));
    let receivedHeaders;
    const platform = await startPlatformServer((req, res) => {
        if (req.method === "POST" && req.url === "/api/v1/nextchat/image-prompts/42/use") {
            receivedHeaders = req.headers;
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ code: 0, data: { prompt_id: 42, version: 3, title: "海报", prompt_text: "a studio poster", models: ["gpt-image-1"], sizes: ["1024x1024"] } }));
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
    const anonymous = await fetch(`${baseUrl}/api/platform/image-prompts/42/use`, { method: "POST" });
    assert.equal(anonymous.status, 401);

    const token = await createSession(dataDir, 106, "prompt-handoff");
    const response = await fetch(`${baseUrl}/api/platform/image-prompts/42/use`, { method: "POST", headers: { cookie: cookie(token) } });
    assert.equal(response.status, 200);
    assert.equal((await responseJson(response)).data.prompt_text, "a studio poster");
    assert.equal(receivedHeaders["x-nextchat-secret"], "secret");
    assert.equal(receivedHeaders["x-nextchat-user-id"], "106");
    assert.equal(receivedHeaders["x-nextchat-api-key-id"], "106");
});

test("HTTP admin documentation requires an authenticated administrator", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "infinite-canvas-http-admin-docs-"));
    const platform = await startPlatformServer((req, res) => {
        if (req.method === "GET" && req.url === "/api/v1/nextchat/bootstrap") {
            const userId = String(req.headers["x-nextchat-user-id"] || "");
            const isAdmin = userId === "108";
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ code: 0, data: { user: { id: Number(userId), role: isAdmin ? "admin" : "user", is_admin: isAdmin } } }));
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
    const anonymous = await fetch(`${baseUrl}/api/admin/docs`);
    const anonymousBody = await anonymous.text();
    assert.equal(anonymous.status, 401);
    assert.equal(JSON.parse(anonymousBody).error, "AUTH_REQUIRED");
    assert.equal(anonymousBody.includes("CANVAS_DATA_DIR"), false);

    const userToken = await createSession(dataDir, 107, "admin-docs-user");
    const forbidden = await fetch(`${baseUrl}/api/admin/docs`, { headers: { cookie: cookie(userToken) } });
    const forbiddenBody = await forbidden.text();
    assert.equal(forbidden.status, 403);
    assert.equal(JSON.parse(forbiddenBody).error, "ADMIN_REQUIRED");
    assert.equal(forbiddenBody.includes("CANVAS_DATA_DIR"), false);

    const adminToken = await createSession(dataDir, 108, "admin-docs-admin");
    const response = await fetch(`${baseUrl}/api/admin/docs`, { headers: { cookie: cookie(adminToken) } });
    assert.equal(response.status, 200);
    const payload = await responseJson(response);
    assert.equal(payload.title, "管理员与部署文档");
    assert.equal(payload.metrics[0].value, "全站共 30GB");
    assert.equal(payload.sections.some((section) => section.title === "部署配置"), true);
    assert.equal(JSON.stringify(payload).includes("CANVAS_DATA_DIR"), true);
});
