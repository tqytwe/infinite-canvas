import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const webRoot = resolve(import.meta.dirname, "..");
const dataRoot = resolve(webRoot, "src/data/prompts");
const assetRoot = resolve(webRoot, "public");
const sources = [
    ["image", "banana-prompt-quicker.json"],
    ["image", "davidwu-gpt-image2-prompts.json"],
    ["image", "freestylefly-gpt-image-2.json"],
    ["image", "awesome-gpt-image.json"],
    ["image", "awesome-gpt4o-image-prompts.json"],
    ["image", "youmind-gpt-image-2.json"],
    ["image", "youmind-nano-banana-pro.json"],
    ["image", "image.zh-CN.json"],
    ["video", "video.zh-CN.json"],
    ["canvas", "canvas.zh-CN.json"],
];

let records = 0;
let errors = 0;
const seenAssets = new Set();

for (const [mediaType, fileName] of sources) {
    const path = resolve(dataRoot, mediaType === "image" && !fileName.includes(".zh-CN") ? `image/${fileName}` : fileName);
    if (!existsSync(path)) {
        console.error(`[prompt-library] missing data file: ${path}`);
        errors += 1;
        continue;
    }
    const items = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(items) || items.length === 0) {
        console.error(`[prompt-library] empty or invalid source: ${path}`);
        errors += 1;
        continue;
    }
    for (const item of items) {
        records += 1;
        if (!item.id || !item.title || !item.prompt) {
            console.error(`[prompt-library] incomplete record: ${fileName}:${item.id || "<missing>"}`);
            errors += 1;
        }
        if (typeof item.coverUrl !== "string" || !item.coverUrl.startsWith("/prompts/")) {
            console.error(`[prompt-library] non-local cover: ${fileName}:${item.id || "<missing>"}`);
            errors += 1;
            continue;
        }
        const assetPath = resolve(assetRoot, item.coverUrl.slice(1));
        if (!existsSync(assetPath)) {
            console.error(`[prompt-library] missing cover asset: ${item.coverUrl}`);
            errors += 1;
        }
        seenAssets.add(assetPath);
    }
}

const assetCount = readdirRecursive(assetRoot, "prompts").length;
console.log(`[prompt-library] records=${records} referencedAssets=${seenAssets.size} localAssets=${assetCount}`);
if (errors) {
    console.error(`[prompt-library] failed with ${errors} error(s)`);
    process.exit(1);
}

function readdirRecursive(root, relative) {
    const directory = resolve(root, relative);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const child = `${relative}/${entry.name}`;
        return entry.isDirectory() ? readdirRecursive(root, child) : [child];
    });
}
