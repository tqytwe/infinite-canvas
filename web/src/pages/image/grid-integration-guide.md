# 图片工作台网格视图集成指南

## 步骤1: 添加Import

在 `web/src/pages/image/index.tsx` 顶部添加：

```typescript
import { ImageGridView } from "@/components/canvas/image-grid-view";
```

## 步骤2: 添加State

在组件内部的useState区域添加：

```typescript
const [displayMode, setDisplayMode] = useState<"sequential" | "grid">("sequential");
const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
```

## 步骤3: 添加模式切换按钮

在结果展示区域添加切换按钮：

```tsx
{results.length > 1 && (
    <div style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem" }}>
        <button
            onClick={() => setDisplayMode("sequential")}
            style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border: displayMode === "sequential" ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                backgroundColor: displayMode === "sequential" ? "#eff6ff" : "white",
                cursor: "pointer",
            }}
        >
            逐个展示
        </button>
        <button
            onClick={() => setDisplayMode("grid")}
            style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border: displayMode === "grid" ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                backgroundColor: displayMode === "grid" ? "#eff6ff" : "white",
                cursor: "pointer",
            }}
        >
            网格对比
        </button>
    </div>
)}
```

## 步骤4: 条件渲染网格视图

在结果展示区域添加条件渲染：

```tsx
{displayMode === "grid" ? (
    <ImageGridView
        images={results.flatMap(r => r.images)}
        selectedIds={selectedImageIds}
        onSelect={(id) => {
            const newSet = new Set(selectedImageIds);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            setSelectedImageIds(newSet);
        }}
        onAddToCanvas={async (id) => {
            const image = results.flatMap(r => r.images).find(img => img.id === id);
            if (image) {
                await addImageToCanvas(image.dataUrl);
            }
        }}
        onDownload={(id) => {
            const image = results.flatMap(r => r.images).find(img => img.id === id);
            if (image) {
                downloadImage(image.dataUrl, `image-${id}.png`);
            }
        }}
        onDelete={(id) => {
            setResults(prev => prev.map(r => ({
                ...r,
                images: r.images.filter(img => img.id !== id)
            })).filter(r => r.images.length > 0));
        }}
    />
) : (
    // 原有的逐个展示逻辑
    ...
)}
```

## 辅助函数

添加下载函数：

```typescript
function downloadImage(dataUrl: string, filename: string) {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.click();
}
```
