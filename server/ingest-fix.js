const fs = require("fs");
const content = fs.readFileSync("index.mjs", "utf-8");

// 找到ingest端点的URL处理部分，在parseProxyableAssetUrl之前添加相对路径转换
const oldCode = `    // Support both a raw CDN URL and a signed proxy URL (/api/platform/asset-proxy?url=...)
    let cdnUrl = rawUrl;
    if (rawUrl.startsWith("/api/platform/asset-proxy?") || rawUrl.includes("/api/platform/asset-proxy?")) {
        try {
            const qmark = rawUrl.indexOf("?");
            const params = new URLSearchParams(qmark >= 0 ? rawUrl.slice(qmark + 1) : "");
            cdnUrl = params.get("url") || "";
        } catch { cdnUrl = ""; }
    }
    const parsed = cdnUrl ? parseProxyableAssetUrl(cdnUrl) : null;`;

const newCode = `    // Support both a raw CDN URL and a signed proxy URL (/api/platform/asset-proxy?url=...)
    let cdnUrl = rawUrl;
    if (rawUrl.startsWith("/api/platform/asset-proxy?") || rawUrl.includes("/api/platform/asset-proxy?")) {
        try {
            const qmark = rawUrl.indexOf("?");
            const params = new URLSearchParams(qmark >= 0 ? rawUrl.slice(qmark + 1) : "");
            cdnUrl = params.get("url") || "";
        } catch { cdnUrl = ""; }
    }
    
    // Gateway API returns relative paths like /api/platform/gateway/v1/images/task-assets/...
    // Convert to absolute URL for parseProxyableAssetUrl validation
    if (cdnUrl.startsWith("/")) {
        const protocol = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
        const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
        cdnUrl = \`\${protocol}://\${host}\${cdnUrl}\`;
    }
    
    const parsed = cdnUrl ? parseProxyableAssetUrl(cdnUrl) : null;`;

if (content.includes(oldCode)) {
    const updated = content.replace(oldCode, newCode);
    fs.writeFileSync("index.mjs", updated, "utf-8");
    console.log("✓ 已添加相对路径转换逻辑");
} else {
    console.log("✗ 未找到匹配的代码段");
    process.exit(1);
}
