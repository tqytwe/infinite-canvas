import i18n from "@/i18n";
import { loadLocalPromptBundle } from "./prompt-bundles";
import type { PromptSource } from "./prompt-source-presets";

export type RawPrompt = {
    id: string;
    title: string;
    prompt: string;
    description: string;
    coverUrl: string;
    referenceImageUrls: string[];
    tags: string[];
    preview: string;
    createdAt: string;
    updatedAt: string;
    author?: string;
    sourceUrl?: string;
    imageMode?: string;
    imageModel?: string;
    imageSize?: string;
    imageCount?: number;
};

type RunOptions = { signal?: AbortSignal };

async function fetchSource(source: PromptSource, options?: RunOptions) {
    const response = await fetch(source.url, { cache: "no-store", signal: options?.signal });
    if (!response.ok) throw new Error(i18n.t("config.promptSources.runtime.requestFailed", { status: response.status }));
    return source.format === "markdown" ? response.text() : response.json();
}

export async function runPromptSource(source: PromptSource, options?: RunOptions): Promise<RawPrompt[]> {
    if (source.storage === "local") return loadLocalPromptBundle(source.localBundle);
    if (!source.url.trim()) throw new Error(i18n.t("config.promptSources.runtime.urlRequired"));
    let data: unknown;
    try {
        data = await fetchSource(source, options);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error(i18n.t("config.promptSources.runtime.fetchFailed", { name: source.name, error: error instanceof Error ? error.message : String(error) }));
    }

    const items = source.format === "markdown" ? parseMarkdownSource(data, source) : parseJsonSource(data, source);
    if (source.builtIn && !items.length) throw new Error(i18n.t("config.promptSources.runtime.noPrompts", { name: source.name }));
    return items;
}

function parseJsonSource(data: unknown, source: PromptSource) {
    if (!Array.isArray(data)) throw new Error(i18n.t("config.promptSources.runtime.invalidRoot", { name: source.name }));
    return normalizeItems(data, source);
}

function parseMarkdownSource(data: unknown, source: PromptSource) {
    if (typeof data !== "string") throw new Error(i18n.t("config.promptSources.runtime.invalidMarkdown", { name: source.name }));
    const lines = data.replace(/\r\n/g, "\n").split("\n");
    const items: RawPrompt[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        const heading = lines[index].match(/^###\s+(.+?)\s*$/);
        if (!heading) continue;
        const end = lines.slice(index + 1).findIndex((line) => /^###\s+/.test(line));
        const sectionEnd = end < 0 ? lines.length : index + 1 + end;
        const section = lines.slice(index + 1, sectionEnd);
        const promptHeadingIndex = section.findIndex((line) => /^####\s+.*(?:Prompt|提示词)/i.test(line));
        if (promptHeadingIndex < 0) {
            index = sectionEnd - 1;
            continue;
        }
        const promptStart = section.slice(promptHeadingIndex + 1).findIndex((line) => /^```/.test(line));
        if (promptStart < 0) {
            index = sectionEnd - 1;
            continue;
        }
        const openingIndex = promptHeadingIndex + 1 + promptStart;
        const closingIndex = section.slice(openingIndex + 1).findIndex((line) => /^```/.test(line));
        if (closingIndex < 0) {
            index = sectionEnd - 1;
            continue;
        }
        const prompt = section.slice(openingIndex + 1, openingIndex + 1 + closingIndex).join("\n").trim();
        if (!prompt) {
            index = sectionEnd - 1;
            continue;
        }
        const title = heading[1].replace(/^No\.\s*\d+\s*[:：]\s*/i, "").trim();
        const coverUrl = firstMarkdownImage(section, source.url) || "";
        const sourceUrl = firstWatchLink(section) || "";
        const description = firstMarkdownQuote(section);
        items.push({
            id: `${source.id}-${String(items.length + 1).padStart(4, "0")}`,
            title: title || `${source.name} ${items.length + 1}`,
            prompt,
            description,
            coverUrl,
            referenceImageUrls: coverUrl ? [coverUrl] : [],
            tags: [source.name, source.mediaType],
            preview: "",
            createdAt: "",
            updatedAt: "",
            sourceUrl,
        });
        index = sectionEnd - 1;
    }
    return items;
}

function normalizeItems(values: unknown[], source: PromptSource) {
    const seen = new Set<string>();
    const items: RawPrompt[] = [];
    values.forEach((value, index) => {
        const record = asRecord(value);
        const title = stringValue(record.title).trim();
        const prompt = stringValue(record.prompt).trim();
        if (!title || !prompt) return;
        const id = stringValue(record.id).trim() || `${source.id}-${leftPad(index + 1)}`;
        if (seen.has(id)) return;
        seen.add(id);
        const referenceImageUrls = stringArray(record.referenceImageUrls).map((url) => absoluteUrl(source.url, url));
        const coverUrl = absoluteUrl(source.url, stringValue(record.coverUrl)) || referenceImageUrls[0] || "";
        items.push({
            id,
            title,
            prompt,
            description: stringValue(record.description),
            coverUrl,
            referenceImageUrls,
            tags: stringArray(record.tags),
            preview: stringValue(record.preview),
            createdAt: stringValue(record.createdAt),
            updatedAt: stringValue(record.updatedAt),
            author: stringValue(record.author),
            sourceUrl: absoluteUrl(source.url, stringValue(record.sourceUrl)),
            imageMode: optionalString(record.imageMode),
            imageModel: optionalString(record.imageModel),
            imageSize: optionalString(record.imageSize),
            imageCount: optionalNumber(record.imageCount),
        });
    });
    return items;
}

function firstMarkdownImage(lines: string[], baseUrl: string) {
    for (const line of lines) {
        const markdown = line.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/);
        if (markdown?.[1]) return absoluteUrl(baseUrl, markdown[1]);
        const html = line.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (html?.[1]) return absoluteUrl(baseUrl, html[1]);
    }
    return "";
}

function firstWatchLink(lines: string[]) {
    for (const line of lines) {
        const match = line.match(/\]\((https?:\/\/[^)\s]*youmind\.com\/[^)\s]*\?id=\d+)\)/i);
        if (match?.[1]) return match[1];
    }
    return "";
}

function firstMarkdownQuote(lines: string[]) {
    return lines
        .filter((line) => /^\s*>\s+/.test(line))
        .map((line) => line.replace(/^\s*>\s+/, "").trim())
        .find(Boolean) || "";
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.map(stringValue).map((item) => item.trim()).filter(Boolean) : [];
}

function optionalString(value: unknown) {
    const result = stringValue(value).trim();
    return result || undefined;
}

function optionalNumber(value: unknown) {
    const result = Number(value);
    return Number.isFinite(result) && result > 0 ? result : undefined;
}

function absoluteUrl(baseUrl: string, path: string) {
    if (!path) return "";
    try {
        return new URL(path, baseUrl).toString();
    } catch {
        return path;
    }
}

function leftPad(value: number) {
    return String(value).padStart(4, "0");
}
