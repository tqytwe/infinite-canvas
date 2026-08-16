const fs = require("fs");
const content = fs.readFileSync("index.tsx", "utf-8");

const oldCode = `    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        try {
            console.log("[Canvas] addResultToReferences:", { hasDataUrl: !!image.dataUrl, index });
            if (!image.dataUrl) {
                console.error("[Canvas] No dataUrl in image");
                message.error("图片数据缺失");
                return;
            }
            const stored = await uploadImage(image.dataUrl);
            console.log("[Canvas] Upload complete:", { url: stored.url, storageKey: stored.storageKey });
            setReferences((value) => [...value, { id: nanoid(), name: \\`result-\\${index + 1}.png\\`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
            message.success(t("imageWorkbench.addedReference"));`;

const newCode = `    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        try {
            console.log("[Canvas] addResultToReferences:", { 
                hasDataUrl: !!image.dataUrl, 
                hasStorageKey: !!image.storageKey,
                hasSourceUrl: !!image.sourceUrl,
                index 
            });
            
            // If already uploaded (has storageKey), reuse it directly
            if (image.storageKey) {
                console.log("[Canvas] Reusing existing storageKey:", image.storageKey);
                setReferences((value) => [...value, { 
                    id: nanoid(), 
                    name: \\`result-\\${index + 1}.png\\`, 
                    type: image.mimeType, 
                    dataUrl: image.dataUrl, 
                    storageKey: image.storageKey 
                }]);
                message.success(t("imageWorkbench.addedReference"));
                return;
            }
            
            if (!image.dataUrl) {
                console.error("[Canvas] No dataUrl in image");
                message.error("图片数据缺失");
                return;
            }
            const stored = await uploadImage(image.dataUrl);
            console.log("[Canvas] Upload complete:", { url: stored.url, storageKey: stored.storageKey });
            setReferences((value) => [...value, { id: nanoid(), name: \\`result-\\${index + 1}.png\\`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
            message.success(t("imageWorkbench.addedReference"));`;

console.log("Applying fix...");
const updated = content.replace(oldCode, newCode);

if (updated === content) {
    console.error("Pattern not found!");
    process.exit(1);
}

fs.writeFileSync("index.tsx", updated, "utf-8");
console.log("✓ Fixed addResultToReferences to reuse existing storageKey");
