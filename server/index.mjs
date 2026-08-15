import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import { promisify } from "node:util";

const ROOT_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const STATIC_DIR = resolve(process.env.STATIC_DIR || join(ROOT_DIR, "web-dist"));
const DATA_DIR = resolve(process.env.CANVAS_DATA_DIR || "/data/infinite-canvas");
const USERS_DIR = join(DATA_DIR, "users");
const SESSIONS_DIR = join(DATA_DIR, "sessions");
const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const MAX_STORAGE_BYTES = parseBytes(process.env.CANVAS_MAX_STORAGE_BYTES, 30 * 1024 * 1024 * 1024);
const MAX_UPLOAD_BYTES = parseBytes(process.env.CANVAS_MAX_UPLOAD_BYTES, 1024 * 1024 * 1024);
const MAX_STATE_BYTES = parseBytes(process.env.CANVAS_MAX_STATE_BYTES, 256 * 1024 * 1024);
const MIN_FREE_BYTES = parseBytes(process.env.CANVAS_MIN_FREE_BYTES, 512 * 1024 * 1024);
const ASSET_PROXY_TTL_SECONDS = Number.parseInt(process.env.CANVAS_ASSET_PROXY_TTL_SECONDS || "86400", 10);
const ASSET_CACHE_DIR = join(DATA_DIR, "asset-cache");
const ASSET_CACHE_MAX_BYTES = parseBytes(process.env.CANVAS_ASSET_CACHE_MAX_BYTES, 512 * 1024 * 1024);
const SESSION_TTL_SECONDS = Number.parseInt(process.env.CANVAS_SESSION_TTL_SECONDS || "604800", 10);
const PLATFORM_API_BASE_URL = normalizeOrigin(process.env.CANVAS_PLATFORM_API_BASE_URL || process.env.PLATFORM_API_BASE_URL || "https://api.jisudeng.com");
const PLATFORM_WEB_URL = normalizeOrigin(process.env.CANVAS_PLATFORM_WEB_URL || process.env.PLATFORM_WEB_URL || "https://www.jisudeng.com");
const PLATFORM_ENTRY_PATH = process.env.CANVAS_PLATFORM_ENTRY_PATH || "/ai-creation-space";
const PLATFORM_LOGIN_PATH = process.env.CANVAS_PLATFORM_LOGIN_PATH || "/login";
const PLATFORM_REGISTER_PATH = process.env.CANVAS_PLATFORM_REGISTER_PATH || "/register";
const EXCHANGE_SECRET = process.env.CANVAS_EXCHANGE_SECRET || process.env.SUB2API_NEXTCHAT_SECRET || "";
const PLATFORM_ASSET_PROXY_ORIGINS = parseAllowedOrigins(process.env.CANVAS_PLATFORM_ASSET_PROXY_ORIGINS, [PLATFORM_API_BASE_URL, "https://jisu.zeabur.app"]);
const ADMIN_USER_IDS = parseIdSet(process.env.CANVAS_ADMIN_USER_IDS);
const IS_PRODUCTION = process.env.NODE_ENV === "production" || Boolean(process.env.ZEABUR);
const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
const staticCompressionCache = new Map();
let staticCompressionCacheBytes = 0;
const STATIC_COMPRESSION_CACHE_LIMIT = 64 * 1024 * 1024;
const SMALL_OBJECT_BUFFER_BYTES = 8 * 1024 * 1024;
const OBJECT_STREAM_HIGH_WATER_MARK = 1024 * 1024;
const userLocks = new Map();
let storageLock = Promise.resolve();

await mkdir(USERS_DIR, { recursive: true, mode: 0o700 });
await mkdir(SESSIONS_DIR, { recursive: true, mode: 0o700 });
await mkdir(ASSET_CACHE_DIR, { recursive: true, mode: 0o700 });

const server = createServer(async (req, res) => {
    try {
        await handleRequest(req, res);
    } catch (error) {
        console.error("[canvas-server]", error);
        const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
        const errorCode = error?.message && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "INTERNAL_SERVER_ERROR";
        sendJson(res, statusCode, { ok: false, error: errorCode });
    }
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`[canvas-server] listening on ${PORT}`);
    console.log(`[canvas-server] data directory: ${DATA_DIR}`);
    console.log(`[canvas-server] global storage limit: ${formatBytes(MAX_STORAGE_BYTES)}`);
});
// Keep TCP connections alive past typical load-balancer idle timeouts (60 s).
// headersTimeout must exceed keepAliveTimeout to prevent a response/close race.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

async function handleRequest(req, res) {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const method = req.method || "GET";
    const requestId = randomBytes(8).toString("hex");
    const startedAt = Date.now();
    res.setHeader("x-canvas-request-id", requestId);
    res.once("finish", () => {
        if (url.pathname.startsWith("/api/")) {
            console.log(`[canvas-request] ${requestId} ${method} ${url.pathname} ${res.statusCode} ${Date.now() - startedAt}ms`);
        }
    });

    if (url.pathname === "/health" || url.pathname === "/api/health") {
        await handleHealth(res);
        return;
    }
    if (url.pathname === "/config.js" && method === "GET") {
        handleRuntimeConfig(res);
        return;
    }
    if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url, method);
        return;
    }
    await serveStatic(req, res, url.pathname);
}

async function handleApi(req, res, url, method) {
    if (url.pathname === "/api/auth/session" && method === "GET") {
        await handleSession(req, res);
        return;
    }
    if (url.pathname === "/api/auth/exchange" && method === "POST") {
        await handleExchange(req, res);
        return;
    }
    if (url.pathname === "/api/auth/logout" && (method === "POST" || method === "DELETE")) {
        await handleLogout(req, res);
        return;
    }
    if (url.pathname === "/api/platform/bootstrap" && method === "GET") {
        await handlePlatformBootstrap(req, res);
        return;
    }
    if (url.pathname.startsWith("/api/platform/gateway/") || url.pathname === "/api/platform/gateway") {
        await proxyPlatformGateway(req, res, url);
        return;
    }
    if (url.pathname.startsWith("/api/platform/image-studio/")) {
        await proxyPlatformImageStudio(req, res, url);
        return;
    }
    const imagePromptUseMatch = url.pathname.match(/^\/api\/platform\/image-prompts\/(\d+)\/use$/);
    if (imagePromptUseMatch && method === "POST") {
        await proxyPlatformImagePromptUse(req, res, imagePromptUseMatch[1]);
        return;
    }
    if (url.pathname === "/api/platform/asset-proxy" && (method === "GET" || method === "HEAD")) {
        await handlePlatformAssetProxy(req, res, url, method);
        return;
    }
    if (url.pathname === "/api/admin/docs" && method === "GET") {
        await handleAdminDocs(req, res);
        return;
    }

    const session = await readSessionFromRequest(req);
    if (!session) {
        sendJson(res, 401, { ok: false, error: "AUTH_REQUIRED", login_url: buildAuthUrl(PLATFORM_LOGIN_PATH) });
        return;
    }

    const objectMatch = url.pathname.match(/^\/api\/storage\/objects\/([^/]+)$/);
    if (objectMatch) {
        await handleObject(req, res, decodeURIComponent(objectMatch[1]), method, session);
        return;
    }
    const pinMatch = url.pathname.match(/^\/api\/storage\/objects\/([^/]+)\/pin$/);
    if (pinMatch && (method === "PUT" || method === "POST")) {
        await handlePin(req, res, decodeURIComponent(pinMatch[1]), session);
        return;
    }
    if (url.pathname === "/api/storage/usage" && method === "GET") {
        await withStorageLock(async () => sendJson(res, 200, { ok: true, ...(await getUsage(session.userId)) }));
        return;
    }
    const stateMatch = url.pathname.match(/^\/api\/storage\/state\/([^/]+)$/);
    if (stateMatch && (method === "GET" || method === "PUT")) {
        await handleState(req, res, decodeURIComponent(stateMatch[1]), method, session);
        return;
    }
    sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
}

async function handleHealth(res) {
    let freeBytes = null;
    try {
        const fs = await statfs(DATA_DIR);
        freeBytes = Number(fs.bavail) * Number(fs.bsize);
    } catch {}
    sendJson(res, 200, {
        ok: true,
        status: "ok",
        storage: {
            data_dir: DATA_DIR,
            scope: "global",
            max_bytes: MAX_STORAGE_BYTES,
            min_free_bytes: MIN_FREE_BYTES,
            free_bytes: freeBytes,
        },
    });
}

function handleRuntimeConfig(res) {
    const payload = {
        ANALYTICS_GA4_ID: sanitizeRuntimeValue(process.env.ANALYTICS_GA4_ID),
        ANALYTICS_BAIDU_ID: sanitizeRuntimeValue(process.env.ANALYTICS_BAIDU_ID),
        CANVAS_PLATFORM_WEB_URL: PLATFORM_WEB_URL,
        CANVAS_MANAGED_MODE: Boolean(PLATFORM_API_BASE_URL && EXCHANGE_SECRET),
    };
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
    res.end(`window.__RUNTIME_CONFIG__ = ${JSON.stringify(payload)};`);
}

async function handleExchange(req, res) {
    const body = await readJson(req, 64 * 1024);
    const launchToken = typeof body?.launch_token === "string" ? body.launch_token.trim() : "";
    if (!launchToken) {
        sendJson(res, 400, { ok: false, error: "LAUNCH_TOKEN_REQUIRED" });
        return;
    }
    if (!PLATFORM_API_BASE_URL || !EXCHANGE_SECRET) {
        sendJson(res, 503, { ok: false, error: "PLATFORM_AUTH_NOT_CONFIGURED" });
        return;
    }

    const upstream = await fetch(`${PLATFORM_API_BASE_URL}/api/v1/nextchat/session`, {
        method: "POST",
        headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-nextchat-secret": EXCHANGE_SECRET,
        },
        body: JSON.stringify({ launch_token: launchToken }),
        signal: AbortSignal.timeout(15_000),
    });
    const payload = await safeJson(upstream);
    const data = payload?.data || payload;
    const chatData = data?.sessions?.chat && typeof data.sessions.chat === "object" ? data.sessions.chat : data;
    const imageData = data?.sessions?.image && typeof data.sessions.image === "object" ? data.sessions.image : null;
    const userId = Number(chatData?.user_id || data?.user_id);
    const chatSession = parsePlatformGatewaySession(chatData, "chat");
    const imageSession = parsePlatformGatewaySession(imageData, "image");
    if (!upstream.ok || !chatSession || !Number.isSafeInteger(userId) || userId <= 0) {
        sendJson(res, upstream.status || 502, { ok: false, error: payload?.message || payload?.msg || "PLATFORM_AUTH_EXCHANGE_FAILED" });
        return;
    }

    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(data.expires_at || now.getTime() + SESSION_TTL_SECONDS * 1000);
    const session = {
        token,
        userId,
        apiKey: chatSession.apiKey,
        apiKeyId: chatSession.apiKeyId,
        sessions: {
            chat: chatSession,
            ...(imageSession ? { image: imageSession } : {}),
        },
        isAdmin: isAdminPayload(data?.user) || isAdminPayload(data) || ADMIN_USER_IDS.has(userId),
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
    };
    await writePrivateJson(join(SESSIONS_DIR, `${token}.json`), session);
    setCookie(res, "canvas_session", token, Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    sendJson(res, 200, { ok: true, user_id: session.userId, expires_at: session.expiresAt });
}

async function handleSession(req, res) {
    const session = await readSessionFromRequest(req);
    if (!session) {
        sendJson(res, 200, {
            ok: true,
            authenticated: false,
            login_url: buildAuthUrl(PLATFORM_LOGIN_PATH),
            register_url: buildAuthUrl(PLATFORM_REGISTER_PATH),
        });
        return;
    }
    const imageSession = gatewaySessionForPurpose(session, "image");
    const [bootstrap, imageBootstrap] = await Promise.all([
        fetchPlatformBootstrap(session),
        imageSession !== session ? fetchPlatformBootstrap(session, imageSession) : Promise.resolve(null),
    ]);
    const user = bootstrap?.user || { id: session.userId };
    sendJson(res, 200, {
        ok: true,
        authenticated: true,
        user: { ...user, ...(session.isAdmin ? { is_admin: true, role: "admin" } : {}) },
        models: mergeWorkspaceModels(bootstrap?.models, imageBootstrap?.models),
        api_key_id: session.apiKeyId,
        expires_at: session.expiresAt,
    });
}

async function handleLogout(req, res) {
    const token = parseCookies(req.headers.cookie || "").canvas_session;
    if (token) await rm(join(SESSIONS_DIR, `${token}.json`), { force: true });
    setCookie(res, "canvas_session", "", 0);
    sendJson(res, 200, { ok: true });
}

async function handlePlatformBootstrap(req, res) {
    const session = await readSessionFromRequest(req);
    if (!session) {
        sendJson(res, 401, { ok: false, error: "AUTH_REQUIRED" });
        return;
    }
    const bootstrap = await fetchPlatformBootstrap(session);
    if (!bootstrap) {
        sendJson(res, 502, { ok: false, error: "PLATFORM_BOOTSTRAP_FAILED" });
        return;
    }
    sendJson(res, 200, { ok: true, ...bootstrap });
}

async function proxyPlatformGateway(req, res, url) {
    const session = await readSessionFromRequest(req);
    if (!session) {
        sendJson(res, 401, { ok: false, error: "AUTH_REQUIRED" });
        return;
    }
    const suffix = url.pathname.replace(/^\/api\/platform\/gateway/, "") || "/";
    const gatewaySession = gatewaySessionForPath(session, suffix);
    await proxyRequest(req, res, `${PLATFORM_API_BASE_URL}${suffix}${url.search}`, {
        authorization: `Bearer ${gatewaySession.apiKey}`,
    }, { rewriteJson: true });
}

async function proxyPlatformImageStudio(req, res, url) {
    const session = await readSessionFromRequest(req);
    if (!session) {
        sendJson(res, 401, { ok: false, error: "AUTH_REQUIRED" });
        return;
    }
    if (!EXCHANGE_SECRET || !PLATFORM_API_BASE_URL) {
        sendJson(res, 503, { ok: false, error: "PLATFORM_PROXY_NOT_CONFIGURED" });
        return;
    }
    const suffix = url.pathname.replace(/^\/api\/platform\/image-studio/, "") || "/";
    const imageSession = gatewaySessionForPurpose(session, "image");
    await proxyRequest(req, res, `${PLATFORM_API_BASE_URL}/api/v1/nextchat/image-studio${suffix}${url.search}`, {
        "x-nextchat-secret": EXCHANGE_SECRET,
        "x-nextchat-user-id": String(session.userId),
        "x-nextchat-api-key-id": String(imageSession.apiKeyId),
        authorization: `Bearer ${imageSession.apiKey}`,
    }, { rewriteJson: true });
}

async function proxyPlatformImagePromptUse(req, res, promptId) {
    const session = await readSessionFromRequest(req);
    if (!session) {
        sendJson(res, 401, { ok: false, error: "AUTH_REQUIRED" });
        return;
    }
    if (!EXCHANGE_SECRET || !PLATFORM_API_BASE_URL) {
        sendJson(res, 503, { ok: false, error: "PLATFORM_PROXY_NOT_CONFIGURED" });
        return;
    }
    await proxyRequest(req, res, `${PLATFORM_API_BASE_URL}/api/v1/nextchat/image-prompts/${promptId}/use`, {
        "x-nextchat-secret": EXCHANGE_SECRET,
        "x-nextchat-user-id": String(session.userId),
        "x-nextchat-api-key-id": String(session.apiKeyId),
        authorization: `Bearer ${session.apiKey}`,
    }, { rewriteJson: true });
}

// ---------------------------------------------------------------------------
// Asset proxy disk cache — avoids hitting upstream CDN on every canvas load.
// ---------------------------------------------------------------------------
async function readAssetCache(urlHash) {
    try {
        const metaPath = join(ASSET_CACHE_DIR, `${urlHash}.meta.json`);
        const meta = JSON.parse(await readFile(metaPath, "utf8"));
        if (Date.now() > meta.expiresAt) {
            void rm(metaPath, { force: true });
            void rm(join(ASSET_CACHE_DIR, `${urlHash}.bin`), { force: true });
            return null;
        }
        return { dataPath: join(ASSET_CACHE_DIR, `${urlHash}.bin`), mimeType: meta.mimeType };
    } catch {
        return null;
    }
}

async function writeAssetCache(urlHash, mimeType, data) {
    try {
        await writeFile(join(ASSET_CACHE_DIR, `${urlHash}.bin`), data, { mode: 0o600 });
        await writeFile(
            join(ASSET_CACHE_DIR, `${urlHash}.meta.json`),
            JSON.stringify({
                mimeType,
                size: data.length,
                cachedAt: Date.now(),
                expiresAt: Date.now() + ASSET_PROXY_TTL_SECONDS * 1000,
            }),
            { encoding: "utf8", mode: 0o600 },
        );
        void evictAssetCacheIfNeeded();
    } catch (err) {
        console.warn("[asset-cache] write failed", err.message);
    }
}

async function evictAssetCacheIfNeeded() {
    try {
        const entries = await readdir(ASSET_CACHE_DIR).catch(() => []);
        const metaFiles = entries.filter((f) => f.endsWith(".meta.json"));
        let total = 0;
        const items = [];
        for (const f of metaFiles) {
            try {
                const raw = JSON.parse(await readFile(join(ASSET_CACHE_DIR, f), "utf8"));
                total += raw.size || 0;
                items.push({ key: f.slice(0, -".meta.json".length), cachedAt: raw.cachedAt || 0, size: raw.size || 0 });
            } catch { /* skip corrupt entries */ }
        }
        if (total <= ASSET_CACHE_MAX_BYTES) return;
        items.sort((a, b) => a.cachedAt - b.cachedAt);
        for (const item of items) {
            if (total <= ASSET_CACHE_MAX_BYTES * 0.75) break;
            void rm(join(ASSET_CACHE_DIR, `${item.key}.meta.json`), { force: true });
            void rm(join(ASSET_CACHE_DIR, `${item.key}.bin`), { force: true });
            total -= item.size;
        }
    } catch (err) {
        console.warn("[asset-cache] eviction failed", err.message);
    }
}

async function handlePlatformAssetProxy(req, res, url, method) {
    const session = await readSessionFromRequest(req);
    if (!session) {
        sendJson(res, 401, { ok: false, error: "AUTH_REQUIRED" });
        return;
    }
    const target = url.searchParams.get("url") || "";
    const parsed = parseProxyableAssetUrl(target, verifyAssetProxyRequest(target, url.searchParams));
    if (!parsed) {
        sendJson(res, 400, { ok: false, error: "INVALID_ASSET_PROXY_URL" });
        return;
    }
    // Cache-first: serve from disk for GET requests without range headers.
    const urlHash = sha256(target);
    if (method === "GET" && !req.headers.range) {
        const hit = await readAssetCache(urlHash);
        if (hit) {
            try {
                const data = await readFile(hit.dataPath);
                res.writeHead(200, {
                    "content-type": hit.mimeType || "application/octet-stream",
                    "content-length": String(data.length),
                    "cache-control": `public, max-age=${ASSET_PROXY_TTL_SECONDS}, immutable`,
                    "x-cache": "HIT",
                });
                res.end(data);
                return;
            } catch { /* cache file gone, fall through to upstream */ }
        }
    }
    const headers = {
        accept: String(req.headers.accept || "*/*"),
        ...(req.headers.range ? { range: String(req.headers.range) } : {}),
    };
    const upstream = await fetch(parsed.toString(), {
        method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    res.writeHead(upstream.status, filteredProxyHeaders(upstream.headers));
    if (method === "HEAD" || !upstream.body) {
        res.end();
        return;
    }
    // Buffer successful non-range GET responses to populate the disk cache,
    // then flush to the client in one shot.
    if (method === "GET" && upstream.ok && !req.headers.range) {
        const chunks = [];
        for await (const chunk of upstream.body) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        res.end(body);
        const mime = (upstream.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
        void writeAssetCache(urlHash, mime, body);
        return;
    }
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
}

async function handleAdminDocs(req, res) {
    const session = await readSessionFromRequest(req);
    if (!session) {
        sendJson(res, 401, { ok: false, error: "AUTH_REQUIRED", login_url: buildAuthUrl(PLATFORM_LOGIN_PATH) });
        return;
    }
    if (session.isAdmin || ADMIN_USER_IDS.has(Number(session.userId))) {
        sendJson(res, 200, { ok: true, ...adminDocsPayload() });
        return;
    }
    const bootstrap = await fetchPlatformBootstrap(session);
    if (!isAdminPayload(bootstrap?.user)) {
        sendJson(res, 403, { ok: false, error: "ADMIN_REQUIRED" });
        return;
    }
    sendJson(res, 200, { ok: true, ...adminDocsPayload() });
}

function adminDocsPayload() {
    return {
        title: "管理员与部署文档",
        subtitle: "仅面向极速蹬运营、部署和管理员，说明 AI创作空间与主平台之间的职责边界。",
        metrics: [
            { label: "空间上限", value: "全站共 30GB" },
            { label: "访问策略", value: "管理员可见" },
            { label: "管理归属", value: "主平台统一管理" },
        ],
        sections: [
            {
                id: "boundary",
                title: "管理边界",
                icon: "userRoundCog",
                body: [
                    "当前 AI创作空间本身没有独立管理员后台，也没有内置用户管理、套餐管理、封禁、充值、模型授权等管理页面。",
                    "管理员登录、用户管理、模型权限、消费统计和账号治理都由极速蹬主平台负责。Canvas 只消费平台会话、模型权限和网关能力，并保存当前用户的创作文件。",
                ],
            },
            {
                id: "deployment",
                title: "部署配置",
                icon: "database",
                body: [
                    "Zeabur 必须在 infinite-canvas 服务的「硬盘」页挂载持久卷；硬盘 ID 建议使用 data，挂载目录必须设置为 /data/infinite-canvas。不要只依赖容器临时层，否则每次重建都会丢失画布、素材和工作台历史。",
                    "容器环境变量保持 CANVAS_DATA_DIR=/data/infinite-canvas。用户文件按 users/<userId> 分目录存放，生成结果保存后会写入该目录下的 objects，不以主平台旧图像工作室对象存储作为最终记录。",
                    "CANVAS_MAX_STORAGE_BYTES=30GB 表示全站共享空间上限；健康检查中的 storage.scope=global、storage.max_bytes 表示当前全站容量池。PORT 使用 8080，对外域名为当前 Canvas 域名。",
                ],
            },
            {
                id: "platform",
                title: "主平台接入",
                icon: "shieldCheck",
                body: [
                    "CANVAS_PLATFORM_API_BASE_URL 指向极速蹬 API，CANVAS_PLATFORM_WEB_URL 指向极速蹬网页主站。CANVAS_EXCHANGE_SECRET 必须与主平台的 NextChat/Canvas 会话交换密钥一致。",
                    "用户直访 Canvas 域名时，登录和注册按钮必须跳回主平台；主平台再通过 /ai-creation-space 入口把用户带回 Canvas，保证极速蹬仍是账号与权限中枢。",
                ],
            },
            {
                id: "queue",
                title: "队列与生成",
                icon: "sparkles",
                body: [
                    "图片生成和图片编辑的异步排队仍由主平台接口承担，Canvas 不在本项目内重建全局任务队列，避免把计费、限流、重试和模型权限拆成两套。",
                    "视频、文本、音频请求通过主平台会话网关读取用户可用模型。后续如果要做跨用户任务后台、管理员查看任务、失败重试审计，应优先放在主平台管理端实现。",
                ],
            },
        ],
    };
}

async function handleObject(req, res, storageKey, method, session) {
    validateStorageKey(storageKey);
    const userId = session.userId;
    if (method === "GET" || method === "HEAD") {
        await withUserLock(userId, async () => serveObject(req, res, storageKey, userId, method));
        return;
    }
    if (method === "DELETE") {
        await withStorageLock(async () => {
            const metadata = await readMetadata(userId);
            const item = metadata.objects[storageKey];
            if (item?.kind === "file") {
                await rm(join(userDir(userId), item.path), { force: true });
                delete metadata.objects[storageKey];
                await writeMetadata(userId, metadata);
            }
            sendJson(res, 200, { ok: true });
        });
        return;
    }
    if (method !== "PUT" && method !== "POST") {
        sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
        return;
    }
    await withStorageLock(async () => {
        const contentType = sanitizeMimeType(req.headers["content-type"]);
        const tempName = `.upload-${randomBytes(12).toString("hex")}`;
        const tempPath = join(userDir(userId), tempName);
        try {
            const bytes = await streamToFile(req, tempPath, MAX_UPLOAD_BYTES);
            const metadata = await readMetadata(userId);
            const existing = metadata.objects[storageKey];
            const fileName = existing?.path || join("objects", `${sha256(storageKey)}${extensionForMime(contentType)}`);
            const next = {
                storageKey,
                path: fileName,
                kind: "file",
                bytes,
                mimeType: contentType,
                createdAt: existing?.createdAt || new Date().toISOString(),
                lastAccessedAt: new Date().toISOString(),
                pinned: existing?.pinned === true,
            };
            const delta = bytes - (existing?.bytes || 0);
            await ensureCapacity(userId, metadata, delta, storageKey);
            await mkdir(join(userDir(userId), "objects"), { recursive: true, mode: 0o700 });
            await rename(tempPath, join(userDir(userId), fileName));
            metadata.objects[storageKey] = next;
            await writeMetadata(userId, metadata);
            sendJson(res, 200, { ok: true, storage_key: storageKey, bytes, mime_type: contentType, ...(await getUsage(userId)) });
        } finally {
            await rm(tempPath, { force: true });
        }
    });
}

async function handlePin(req, res, storageKey, session) {
    validateStorageKey(storageKey);
    const body = await readJson(req, 16 * 1024);
    await withStorageLock(async () => {
        const metadata = await readMetadata(session.userId);
        const item = metadata.objects[storageKey];
        if (!item) {
            sendJson(res, 404, { ok: false, error: "OBJECT_NOT_FOUND" });
            return;
        }
        item.pinned = body?.pinned !== false;
        await writeMetadata(session.userId, metadata);
        sendJson(res, 200, { ok: true, storage_key: storageKey, pinned: item.pinned });
    });
}

async function handleState(req, res, domain, method, session) {
    validateDomain(domain);
    const storageKey = `state:${domain}`;
    const statePath = join("state", `${domain}.json`);
    await withStorageLock(async () => {
        const metadata = await readMetadata(session.userId);
        const item = metadata.objects[storageKey];
        const absolutePath = join(userDir(session.userId), statePath);
        if (method === "GET") {
            if (!item) {
                sendJson(res, 200, { ok: true, state: null });
                return;
            }
            const state = await readFile(absolutePath, "utf8");
            item.lastAccessedAt = new Date().toISOString();
            await writeMetadata(session.userId, metadata);
            sendJson(res, 200, { ok: true, state });
            return;
        }
        const raw = await readRequestText(req, MAX_STATE_BYTES);
        let parsedState;
        try {
            parsedState = JSON.parse(raw);
        } catch {
            sendJson(res, 400, { ok: false, error: "INVALID_STATE_JSON" });
            return;
        }
        const bytes = Buffer.byteLength(raw);
        const delta = bytes - (item?.bytes || 0);
        const incomingReferences = collectStorageKeysFromJson(parsedState, new Set());
        await ensureCapacity(session.userId, metadata, delta, storageKey, incomingReferences);
        await mkdir(join(userDir(session.userId), "state"), { recursive: true, mode: 0o700 });
        await writePrivateText(absolutePath, raw);
        metadata.objects[storageKey] = {
            storageKey,
            path: statePath,
            kind: "state",
            bytes,
            mimeType: "application/json",
            createdAt: item?.createdAt || new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
            pinned: true,
        };
        await writeMetadata(session.userId, metadata);
        sendJson(res, 200, { ok: true, domain, bytes, ...(await getUsage(session.userId)) });
    });
}

async function serveObject(req, res, storageKey, userId, method) {
    const metadata = await readMetadata(userId);
    const item = metadata.objects[storageKey];
    if (!item || item.kind !== "file") {
        sendJson(res, 404, { ok: false, error: "OBJECT_NOT_FOUND" });
        return;
    }
    const filePath = join(userDir(userId), item.path);
    try {
        const info = await stat(filePath);
        item.lastAccessedAt = new Date().toISOString();
        void writeMetadata(userId, metadata);
        const headers = {
            "content-type": item.mimeType || "application/octet-stream",
            "content-length": String(info.size),
            "cache-control": "private, max-age=86400",
            etag: `"${sha256(`${storageKey}:${info.size}:${info.mtimeMs}`)}"`,
            "accept-ranges": "bytes",
        };
        if (!req.headers.range && req.headers["if-none-match"] === headers.etag) {
            res.writeHead(304, { etag: headers.etag, "cache-control": headers["cache-control"] });
            res.end();
            return;
        }
        if (method === "HEAD") {
            res.writeHead(200, headers);
            res.end();
            return;
        }
        const range = parseRangeHeader(String(req.headers.range || ""), info.size);
        if (!range) {
            if (info.size <= SMALL_OBJECT_BUFFER_BYTES) {
                const body = await readFile(filePath);
                res.writeHead(200, { ...headers, "content-length": String(body.length) });
                res.end(body);
                return;
            }
            res.writeHead(200, headers);
            createReadStream(filePath, { highWaterMark: OBJECT_STREAM_HIGH_WATER_MARK }).pipe(res);
            return;
        }
        const length = range.end - range.start + 1;
        res.writeHead(206, {
            ...headers,
            "content-length": String(length),
            "content-range": `bytes ${range.start}-${range.end}/${info.size}`,
        });
        createReadStream(filePath, { start: range.start, end: range.end, highWaterMark: OBJECT_STREAM_HIGH_WATER_MARK }).pipe(res);
    } catch {
        sendJson(res, 404, { ok: false, error: "OBJECT_NOT_FOUND" });
    }
}

async function ensureCapacity(userId, metadata, delta, incomingKey, protectedKeys = new Set()) {
    if (delta <= 0) return;
    const users = await readAllUserMetadata(userId, metadata);
    const used = totalBytes(users);
    const availableAfterExisting = MAX_STORAGE_BYTES - used;
    if (delta <= availableAfterExisting) {
        await ensureFreeDisk();
        return;
    }

    let need = delta - availableAfterExisting;
    const currentUserId = String(userId);
    const protectedByUser = new Map();
    for (const user of users) {
        const keys = await collectProtectedStorageKeys(user.userId, user.metadata);
        if (user.userId === currentUserId) for (const key of protectedKeys) keys.add(key);
        protectedByUser.set(user.userId, keys);
    }
    const candidates = users
        .flatMap((user) =>
            Object.values(user.metadata.objects)
                .filter((item) => item.kind === "file" && !(user.userId === currentUserId && item.storageKey === incomingKey) && !item.pinned && !protectedByUser.get(user.userId)?.has(item.storageKey))
                .map((item) => ({ user, item })),
        )
        .sort((a, b) => Date.parse(a.item.lastAccessedAt || a.item.createdAt || "") - Date.parse(b.item.lastAccessedAt || b.item.createdAt || ""));

    const removable = [];
    for (const candidate of candidates) {
        if (need <= 0) break;
        removable.push(candidate);
        need -= Number(candidate.item.bytes || 0);
    }
    if (need > 0) {
        const error = new Error("STORAGE_QUOTA_EXCEEDED");
        error.statusCode = 413;
        throw error;
    }
    const changedUserIds = new Set();
    for (const { user, item } of removable) {
        await rm(join(userDir(user.userId), item.path), { force: true });
        delete user.metadata.objects[item.storageKey];
        changedUserIds.add(user.userId);
    }
    for (const changedUserId of changedUserIds) {
        if (changedUserId !== currentUserId) await writeMetadata(changedUserId, users.find((user) => user.userId === changedUserId).metadata);
    }
    await ensureFreeDisk();
}

async function ensureFreeDisk() {
    try {
        const fs = await statfs(DATA_DIR);
        const freeBytes = Number(fs.bavail) * Number(fs.bsize);
        if (freeBytes < MIN_FREE_BYTES) {
            const error = new Error("STORAGE_VOLUME_LOW");
            error.statusCode = 507;
            throw error;
        }
    } catch (error) {
        if (error?.statusCode) throw error;
    }
}

async function getUsage(userId) {
    const users = await readAllUserMetadata();
    const metadata = await readMetadata(userId);
    const protectedKeys = await collectProtectedStorageKeys(userId, metadata);
    const usedBytes = totalBytes(users);
    const userUsedBytes = Object.values(metadata.objects).reduce((total, item) => total + Number(item.bytes || 0), 0);
    return {
        used_bytes: usedBytes,
        max_bytes: MAX_STORAGE_BYTES,
        available_bytes: Math.max(0, MAX_STORAGE_BYTES - usedBytes),
        user_used_bytes: userUsedBytes,
        scope: "global",
        object_count: Object.values(metadata.objects).filter((item) => item.kind === "file").length,
        protected_object_count: Object.values(metadata.objects).filter((item) => item.kind === "file" && (item.pinned || protectedKeys.has(item.storageKey))).length,
        state_count: Object.values(metadata.objects).filter((item) => item.kind === "state").length,
    };
}

async function fetchPlatformBootstrap(session, gatewaySession = session) {
    if (!PLATFORM_API_BASE_URL || !EXCHANGE_SECRET || !gatewaySession.apiKeyId) return null;
    try {
        const response = await fetch(`${PLATFORM_API_BASE_URL}/api/v1/nextchat/bootstrap`, {
            headers: {
                accept: "application/json",
                authorization: `Bearer ${gatewaySession.apiKey}`,
                "x-nextchat-secret": EXCHANGE_SECRET,
                "x-nextchat-user-id": String(session.userId),
                "x-nextchat-api-key-id": String(gatewaySession.apiKeyId),
            },
            signal: AbortSignal.timeout(15_000),
        });
        const payload = await safeJson(response);
        if (!response.ok) return null;
        return payload?.data || payload;
    } catch {
        return null;
    }
}

async function proxyRequest(req, res, target, extraHeaders, options = {}) {
    const headers = { ...req.headers, ...extraHeaders };
    delete headers.host;
    delete headers.cookie;
    // Node's fetch does not decode every browser-advertised encoding (notably
    // zstd). Keep gateway JSON parseable instead of forwarding a compressed
    // upstream body after stripping its content-encoding header.
    headers["accept-encoding"] = "identity";
    const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
        duplex: "half",
        redirect: "manual",
        signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (options.rewriteJson && isJsonResponse(upstream.headers)) {
        const body = rewritePlatformJsonText(await upstream.text());
        res.writeHead(upstream.status, {
            ...filteredProxyHeaders(upstream.headers, ["content-length", "content-encoding"]),
            "content-type": "application/json; charset=utf-8",
            "content-length": String(Buffer.byteLength(body)),
        });
        res.end(body);
        return;
    }
    res.writeHead(upstream.status, filteredProxyHeaders(upstream.headers));
    if (upstream.body) {
        for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
}

async function readSessionFromRequest(req) {
    const token = parseCookies(req.headers.cookie || "").canvas_session;
    if (!token || !/^[A-Za-z0-9_-]{32,}$/.test(token)) return null;
    try {
        const session = JSON.parse(await readFile(join(SESSIONS_DIR, `${token}.json`), "utf8"));
        if (!session.expiresAt || Date.parse(session.expiresAt) <= Date.now() || session.userId <= 0 || !session.apiKey) {
            await rm(join(SESSIONS_DIR, `${token}.json`), { force: true });
            return null;
        }
        return session;
    } catch {
        return null;
    }
}

async function readMetadata(userId) {
    const path = join(userDir(userId), "metadata.json");
    try {
        const metadata = JSON.parse(await readFile(path, "utf8"));
        return { version: 1, objects: metadata.objects || {} };
    } catch {
        return { version: 1, objects: {} };
    }
}

async function writeMetadata(userId, metadata) {
    await mkdir(userDir(userId), { recursive: true, mode: 0o700 });
    await writePrivateJson(join(userDir(userId), "metadata.json"), { version: 1, objects: metadata.objects });
}

async function readAllUserMetadata(currentUserId, currentMetadata) {
    const users = [];
    try {
        const entries = await readdir(USERS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
            users.push({ userId: entry.name, metadata: entry.name === String(currentUserId) && currentMetadata ? currentMetadata : await readMetadata(entry.name) });
        }
    } catch {}
    if (currentUserId && !users.some((user) => user.userId === String(currentUserId))) {
        users.push({ userId: String(currentUserId), metadata: currentMetadata || { version: 1, objects: {} } });
    }
    return users;
}

function totalBytes(users) {
    return users.reduce((total, user) => total + Object.values(user.metadata.objects).reduce((sum, item) => sum + Number(item.bytes || 0), 0), 0);
}

async function collectProtectedStorageKeys(userId, metadata) {
    const keys = new Set();
    const stateItems = Object.values(metadata.objects).filter((item) => item.kind === "state");
    await Promise.all(
        stateItems.map(async (item) => {
            try {
                const raw = await readFile(join(userDir(userId), item.path), "utf8");
                collectStorageKeysFromJson(JSON.parse(raw), keys);
            } catch {}
        }),
    );
    return keys;
}

function collectStorageKeysFromJson(value, keys) {
    if (!value || typeof value !== "object") return keys;
    if (typeof value.storageKey === "string") keys.add(value.storageKey);
    if (typeof value.storage_key === "string") keys.add(value.storage_key);
    for (const child of Object.values(value)) {
        if (Array.isArray(child)) {
            child.forEach((item) => collectStorageKeysFromJson(item, keys));
        } else {
            collectStorageKeysFromJson(child, keys);
        }
    }
    return keys;
}

function userDir(userId) {
    if (!/^\d+$/.test(String(userId))) throw new Error("INVALID_USER_ID");
    return join(USERS_DIR, String(userId));
}

async function withUserLock(userId, callback) {
    const previous = userLocks.get(userId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    userLocks.set(userId, current);
    await previous;
    try {
        return await callback();
    } finally {
        release();
        if (userLocks.get(userId) === current) userLocks.delete(userId);
    }
}

async function withStorageLock(callback) {
    const previous = storageLock;
    let release;
    storageLock = new Promise((resolve) => {
        release = resolve;
    });
    await previous;
    try {
        return await callback();
    } finally {
        release();
    }
}

async function serveStatic(req, res, pathname) {
    const requested = pathname === "/" ? "/index.html" : pathname;
    const candidate = resolve(STATIC_DIR, `.${normalize(requested)}`);
    const safePath = relative(STATIC_DIR, candidate);
    const isSafe = safePath && !safePath.startsWith("..") && !safePath.includes(`${"/"}..${"/"}`);
    let filePath = isSafe ? candidate : join(STATIC_DIR, "index.html");
    let info;
    try {
        info = await stat(filePath);
        if (!info.isFile()) throw new Error("not a file");
    } catch {
        filePath = join(STATIC_DIR, "index.html");
        info = await stat(filePath);
    }
    const contentType = mimeType(extname(filePath));
    const headers = {
        "content-type": `${contentType}; charset=utf-8`,
        "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
        vary: "Accept-Encoding",
    };
    const encoding = selectStaticEncoding(req, contentType);
    if (encoding) {
        const body = await getCompressedStaticBody(filePath, info, encoding);
        res.writeHead(200, { ...headers, "content-encoding": encoding, "content-length": body.length });
        res.end(body);
        return;
    }
    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
}

async function getCompressedStaticBody(filePath, info, encoding) {
    const key = `${filePath}:${info.size}:${info.mtimeMs}:${encoding}`;
    const cached = staticCompressionCache.get(key);
    if (cached) return cached;
    const source = await readFile(filePath);
    const body = encoding === "br"
        ? await compressBrotli(source, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
        : await compressGzip(source, { level: 6 });
    if (body.length <= STATIC_COMPRESSION_CACHE_LIMIT) {
        while (staticCompressionCacheBytes + body.length > STATIC_COMPRESSION_CACHE_LIMIT) {
            const oldest = staticCompressionCache.keys().next().value;
            if (!oldest) break;
            const oldestBody = staticCompressionCache.get(oldest);
            staticCompressionCache.delete(oldest);
            staticCompressionCacheBytes -= oldestBody?.length || 0;
        }
        staticCompressionCache.set(key, body);
        staticCompressionCacheBytes += body.length;
    }
    return body;
}

function selectStaticEncoding(req, contentType) {
    if (!/^(text\/|application\/(javascript|json|xml)|image\/svg\+xml)/i.test(contentType)) return null;
    const accepted = String(req.headers["accept-encoding"] || "").toLowerCase();
    if (/\bbr(?:\s*;|,|$)/.test(accepted)) return "br";
    if (/\bgzip(?:\s*;|,|$)/.test(accepted)) return "gzip";
    return null;
}

async function streamToFile(req, path, maxBytes) {
    await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
    const handle = await import("node:fs/promises").then((fs) => fs.open(path, "w", 0o600));
    let bytes = 0;
    try {
        for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > maxBytes) {
                const error = new Error("UPLOAD_TOO_LARGE");
                error.statusCode = 413;
                throw error;
            }
            await handle.write(chunk);
        }
    } finally {
        await handle.close();
    }
    return bytes;
}

async function readRequestText(req, maxBytes) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
            const error = new Error("REQUEST_TOO_LARGE");
            error.statusCode = 413;
            throw error;
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req, maxBytes) {
    const text = await readRequestText(req, maxBytes);
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function safeJson(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

async function writePrivateJson(path, value) {
    await writePrivateText(path, JSON.stringify(value));
}

async function writePrivateText(path, text) {
    await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
    const tempPath = `${path}.tmp-${randomBytes(8).toString("hex")}`;
    await writeFile(tempPath, text, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, path);
}

function validateStorageKey(value) {
    if (!/^[A-Za-z0-9._:-]{1,180}$/.test(value)) {
        const error = new Error("INVALID_STORAGE_KEY");
        error.statusCode = 400;
        throw error;
    }
}

function validateDomain(value) {
    if (!["canvas", "assets", "image-workbench", "video-workbench"].includes(value)) {
        const error = new Error("INVALID_STORAGE_DOMAIN");
        error.statusCode = 400;
        throw error;
    }
}

function parseRangeHeader(value, size) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!match) return null;
    const suffix = !match[1] && match[2] ? Number(match[2]) : 0;
    const start = match[1] ? Number(match[1]) : Math.max(0, size - suffix);
    const end = match[2] && match[1] ? Number(match[2]) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
    return { start, end: Math.min(end, size - 1) };
}

function buildAuthUrl(path) {
    const redirect = PLATFORM_ENTRY_PATH.startsWith("/") ? PLATFORM_ENTRY_PATH : `/${PLATFORM_ENTRY_PATH}`;
    return `${PLATFORM_WEB_URL}${path.startsWith("/") ? path : `/${path}`}?redirect=${encodeURIComponent(redirect)}`;
}

function rewritePlatformJsonText(text) {
    try {
        return JSON.stringify(rewritePlatformJsonValue(JSON.parse(text)));
    } catch {
        return text;
    }
}

function rewritePlatformJsonValue(value, key = "") {
    if (typeof value === "string") return rewritePlatformUrl(value, key);
    if (Array.isArray(value)) return value.map((item) => rewritePlatformJsonValue(item, key));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([itemKey, item]) => [itemKey, rewritePlatformJsonValue(item, itemKey)]));
}

function rewritePlatformUrl(value, key = "") {
    if (isPlatformGatewayPath(value)) return `/api/platform/gateway${value}`;
    if (isPlatformImageStudioPath(value)) return value.replace(/^\/api\/v1\/nextchat\/image-studio\//, "/api/platform/image-studio/");
    const platformPath = platformApiPath(value);
    if (platformPath && isPlatformGatewayPath(platformPath)) return `/api/platform/gateway${platformPath}`;
    if (platformPath && isPlatformImageStudioPath(platformPath)) return platformPath.replace(/^\/api\/v1\/nextchat\/image-studio\//, "/api/platform/image-studio/");
    if (isProxyableAbsoluteAssetUrl(value) || isLikelyPlatformAssetField(key, value)) return signedAssetProxyUrl(value);
    return value;
}

function platformApiPath(value) {
    if (!PLATFORM_API_BASE_URL || typeof value !== "string") return "";
    let base;
    let parsed;
    try {
        base = new URL(PLATFORM_API_BASE_URL);
        parsed = new URL(value);
    } catch {
        return "";
    }
    return parsed.origin === base.origin ? `${parsed.pathname}${parsed.search}` : "";
}

function isPlatformGatewayPath(value) {
    return (
        typeof value === "string" &&
        (/^\/v1\/images\/(?:tasks|task-assets)\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+$/.test(value) ||
            /^\/v1\/videos\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+\/(?:content|download)(?:[/?#].*)?$/.test(value) ||
            /^\/v1\/contents\/generations\/tasks\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+\/(?:content|download)(?:[/?#].*)?$/.test(value))
    );
}

function isPlatformImageStudioPath(value) {
    return typeof value === "string" && /^\/api\/v1\/nextchat\/image-studio\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+$/.test(value);
}

function isProxyableAbsoluteAssetUrl(value) {
    return Boolean(parseProxyableAssetUrl(value));
}

function parseProxyableAssetUrl(value, allowSigned = false) {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return null;
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return null;
    }
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && !IS_PRODUCTION)) return null;
    if (allowSigned && IS_PRODUCTION && isPrivateAssetProxyHost(parsed.hostname)) return null;
    if (!allowSigned && !PLATFORM_ASSET_PROXY_ORIGINS.has(parsed.origin)) return null;
    return parsed;
}

function isLikelyPlatformAssetField(key, value) {
    const field = String(key || "").toLowerCase();
    if (!["url", "image_url", "thumbnail_url", "download_url", "content_url", "file_url", "uri"].some((name) => field === name || field.endsWith(`_${name}`))) return false;
    return isLikelyFetchableAssetUrl(value);
}

function isLikelyFetchableAssetUrl(value) {
    if (typeof value !== "string") return false;
    if (!/^https:\/\//i.test(value) && !(!IS_PRODUCTION && /^http:\/\/127\.0\.0\.1(?::\d+)?\//i.test(value))) return false;
    try {
        const parsed = new URL(value);
        const path = parsed.pathname.toLowerCase();
        return (
            /\.(png|jpe?g|webp|gif|avif|bmp|mp4|mov|webm|mp3|wav|m4a|ogg)$/i.test(path) ||
            path.includes("image-task-results/") ||
            path.includes("image-studio/") ||
            path.includes("/task-assets/") ||
            path.includes("/images/") ||
            path.includes("/videos/") ||
            path.includes("/contents/")
        );
    } catch {
        return false;
    }
}

function signedAssetProxyUrl(value) {
    const expires = Math.floor(Date.now() / 1000) + Math.max(60, ASSET_PROXY_TTL_SECONDS);
    return `/api/platform/asset-proxy?url=${encodeURIComponent(value)}&expires=${expires}&sig=${assetProxySignature(value, expires)}`;
}

function verifyAssetProxyRequest(value, searchParams) {
    const expires = Number(searchParams.get("expires") || 0);
    const sig = searchParams.get("sig") || "";
    if (!Number.isSafeInteger(expires)) return false; // expiry is advisory; valid sig is sufficient
    if (!sig || !EXCHANGE_SECRET) return false;
    const expected = assetProxySignature(value, expires);
    try {
        return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
        return false;
    }
}

function assetProxySignature(value, expires) {
    return createHmac("sha256", EXCHANGE_SECRET).update(`${expires}\n${value}`).digest("base64url");
}

function isPrivateAssetProxyHost(hostname) {
    const value = String(hostname || "").toLowerCase();
    if (!value || value === "localhost" || value.endsWith(".local")) return true;
    if (value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
    const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(value);
    if (!match) return false;
    const [a, b] = match.slice(1).map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function parseAllowedOrigins(value, defaults) {
    const entries = String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    return new Set(
        [...defaults, ...entries]
            .map((item) => {
                try {
                    return new URL(item).origin;
                } catch {
                    return "";
                }
            })
            .filter(Boolean),
    );
}

function parseIdSet(value) {
    return new Set(
        String(value || "")
            .split(",")
            .map((item) => Number(item.trim()))
            .filter((item) => Number.isSafeInteger(item) && item > 0),
    );
}

function parsePlatformGatewaySession(value, purpose) {
    if (!value || typeof value !== "object") return null;
    const apiKey = typeof value.api_key === "string" ? value.api_key.trim() : "";
    const apiKeyId = Number(value.api_key_id || value.key_id || 0);
    if (!apiKey || !Number.isSafeInteger(apiKeyId) || apiKeyId <= 0) return null;
    return { apiKey, apiKeyId, purpose };
}

function gatewaySessionForPurpose(session, purpose) {
    const scoped = session.sessions?.[purpose];
    if (scoped?.apiKey && Number.isSafeInteger(Number(scoped.apiKeyId)) && Number(scoped.apiKeyId) > 0) {
        return { ...scoped, apiKeyId: Number(scoped.apiKeyId) };
    }
    return session;
}

function gatewaySessionForPath(session, suffix) {
    const path = String(suffix || "").toLowerCase();
    if (path.startsWith("/v1/images/") || path === "/v1/videos" || path.startsWith("/v1/videos/") || path === "/v1/agnesapi" || path.startsWith("/v1/contents/generations/")) return gatewaySessionForPurpose(session, "image");
    return gatewaySessionForPurpose(session, "chat");
}

function mergeWorkspaceModels(primary, secondary) {
    const primaryGroups = Array.isArray(primary?.groups) ? primary.groups : [];
    const secondaryGroups = Array.isArray(secondary?.groups) ? secondary.groups : [];
    if (!primaryGroups.length) return secondary || primary || null;
    if (!secondaryGroups.length) return primary;
    const groups = new Map();
    for (const sourceGroups of [primaryGroups, secondaryGroups]) {
        for (const group of sourceGroups) {
            const key = `${group?.id ?? ""}:${group?.name ?? ""}:${group?.platform ?? ""}`;
            const existing = groups.get(key);
            if (!existing) {
                groups.set(key, { ...group, models: [...(group?.models || [])] });
                continue;
            }
            const seen = new Set((existing.models || []).map(workspaceModelKey));
            for (const model of group?.models || []) {
                const modelKey = workspaceModelKey(model);
                if (!seen.has(modelKey)) {
                    existing.models.push(model);
                    seen.add(modelKey);
                }
            }
        }
    }
    return {
        ...primary,
        image_capabilities_version: primary.image_capabilities_version || secondary.image_capabilities_version,
        groups: Array.from(groups.values()),
    };
}

function workspaceModelKey(model) {
    return String(model?.id || model?.name || model?.display_name || JSON.stringify(model));
}

function isAdminPayload(value) {
    if (!value || typeof value !== "object") return false;
    const role = String(value.role || value.user_role || "").trim().toLowerCase();
    return role === "admin" || value.is_admin === true || value.admin === true;
}

function isJsonResponse(headers) {
    return String(headers.get("content-type") || "").toLowerCase().includes("application/json");
}

function filteredProxyHeaders(headers, omit = []) {
    const blocked = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", ...omit].map((item) => item.toLowerCase()));
    return Object.fromEntries(Array.from(headers.entries()).filter(([key]) => !blocked.has(key.toLowerCase())));
}

function setCookie(res, name, value, maxAge) {
    const attributes = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.max(0, maxAge)}`];
    if (IS_PRODUCTION) attributes.push("Secure");
    res.setHeader("Set-Cookie", attributes.join("; "));
}

function parseCookies(value) {
    return Object.fromEntries(
        value
            .split(";")
            .map((item) => item.trim().split("="))
            .filter(([key, val]) => key && val)
            .map(([key, val]) => [key, decodeURIComponent(val)]),
    );
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    if (res.headersSent) return;
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
}

function normalizeOrigin(value) {
    return String(value || "").trim().replace(/\/+$/, "");
}

function sanitizeRuntimeValue(value) {
    return String(value || "").replace(/[^A-Za-z0-9-]/g, "");
}

function parseBytes(value, fallback) {
    if (!value) return fallback;
    const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i.exec(String(value).trim());
    if (!match) return fallback;
    const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
    return Math.max(1, Math.floor(Number(match[1]) * (units[match[2]?.toLowerCase()] || 1)));
}

function formatBytes(value) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}

function extensionForMime(value) {
    const mime = value.split(";")[0].trim().toLowerCase();
    const map = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
        "audio/ogg": ".ogg",
    };
    return map[mime] || ".bin";
}

function sanitizeMimeType(value) {
    const mime = String(value || "application/octet-stream").split(";")[0].trim().toLowerCase();
    return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime) ? mime : "application/octet-stream";
}

function mimeType(extension) {
    const map = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
    };
    return map[extension.toLowerCase()] || "application/octet-stream";
}
