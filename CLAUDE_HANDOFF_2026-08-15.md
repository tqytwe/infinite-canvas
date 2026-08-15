# Jisudeng AI 创作空间交接说明（2026-08-15）

> 本文是问题交接，不代表当前版本已经可用。当前最严重的图片结果回收问题和视频生成问题都没有完成端到端验收。

## 1. 代码与生产基线

### Infinite Canvas

- 本地目录：`/home/codex/worktrees/infinite-canvas`
- Git 远端：`https://github.com/tqytwe/infinite-canvas.git`
- 分支：`main`
- 当前代码提交：`fbb893e849c572cec093a0f93514d26930a8cb3b`
- `origin/main`：与本地 HEAD 一致
- 定制前基线：`b66936d891b82c2b51c1ed05e1a6eae3e31d4ca3`
- 生产域名：`https://jisudengcanvas.zeabur.app`
- Zeabur 项目：`gmssh`
- Project ID：`6a51de14c2881a93656fa4c5`
- Environment ID：`6a51de14104975fcb46761c3`
- Service ID：`6a7da69f2b4272705cd15e4d`
- 当前生产 Deployment ID：`6a80300546afbcef424ce2c6`
- 当前生产提交：`fbb893e849c572cec093a0f93514d26930a8cb3b`
- 当前生产状态：`RUNNING`
- 持久卷目录：`/data/infinite-canvas`
- Canvas 本地空间策略：全站共享 30 GiB，非单用户 30 GiB

本文档本身不提交，避免因为只增加交接文件而触发 Zeabur 自动部署。业务代码在生成本文档前是干净工作树。

### 主平台 sub2api

- 相关本地目录：`/home/codex/worktrees/sub2api-image-task-asset-proxy-20260814`
- Git 远端：`https://github.com/tqytwe/sub2api.git`
- 生产主分支：`origin/play/main`
- 当前远端主分支提交：`cf1df2e1704802d1a6e0f3f50bdc39bdd5dd2ea5`
- 上述工作树 HEAD：`871a3a7fe744a795eafc3d6ac458199550452551`
- `cf1df2e17` 是合并提交，和 `871a3a7fe` 的文件树无差异。
- 主平台 Web：`https://www.jisudeng.com`
- Gateway：`https://api.jisudeng.com`

主平台不能删除 NextChat / Image Studio 后端能力。Web 入口已经切到 Canvas，但 APP 仍依赖 NextChat 移动协议和 Image Studio BFF。

## 2. 用户当前看到的严重问题

### P0：图片已扣费、对象存储已有文件，但 Canvas 判定失败且没有结果

最新截图路径：

`/home/codex/.codex/attachments/b6aa2ed8-157d-41f0-802d-e95adb7629cd/codex-clipboard-fc1a454c-4061-4d9c-bac6-90aac1b1a578.png`

截图中 17:22 和 17:24 的任务均显示 `成功 0 / 失败 1`，右侧结果为空。用户已多次确认：

1. 主平台完成了计费。
2. 主平台配置的对象存储中存在生成文件。
3. Canvas 没有显示结果。
4. 刷新后任务可能消失、保持“生成中”或变成失败。
5. “我的资产”也可能为空。

这条问题截至当前提交没有被端到端证明解决。

### P0：视频仍不可用

当前生产运行日志已经明确记录：

```text
2026-08-15T09:30:11Z POST /api/platform/gateway/v1/videos 404 74ms
2026-08-15T09:30:24Z POST /api/platform/gateway/v1/videos 404 53ms
```

`fbb893e` 只把 OpenAI 风格视频提交由 multipart 改成 JSON，解决了先前 `model is required` 的请求格式错误，但最新版真实请求仍返回 404。没有做付费视频生成成功验收，因此视频不能宣称修复。

### P1：加载慢

加载慢不是单一 CDN 问题。当前生成结果路径是：

```text
上游模型
  -> 主平台异步任务
  -> 主平台把结果写入对象存储
  -> Canvas 浏览器轮询主平台
  -> Canvas 服务端代理对象存储文件给浏览器
  -> 浏览器完整下载文件
  -> 浏览器再上传到 Canvas /data/infinite-canvas
  -> 浏览器再写一份工作台状态 JSON
```

同一份结果经过主平台、对象存储、Canvas 服务端、浏览器、Canvas 持久卷，多次传输且存在重复存储。对象存储和 Canvas 在同一服务器并不会自动让浏览器这条链路变成内网直连。

## 3. 当前实现的真实边界

### Canvas 服务端

核心文件：`server/index.mjs`

已经实现：

- 平台一次性 `launch_token` 换取 Canvas Cookie 会话。
- 匿名用户只读，登录用户才可生成、上传和写状态。
- 平台 Gateway 代理：`/api/platform/gateway/*`。
- 平台 Image Studio BFF 代理：`/api/platform/image-studio/*`。
- 对象/状态持久化：`/api/storage/objects/*`、`/api/storage/state/*`。
- 同源资产代理：`/api/platform/asset-proxy`。
- `/data/infinite-canvas/users/<user-id>/...` 用户隔离目录。
- 全站共享 30 GiB 统计和 LRU 清理。
- Range 下载和部分静态压缩。

但 Canvas 服务端没有任务表、任务状态机、后台轮询 Worker、失败重试队列或生成回调。生成任务的生命周期仍然由浏览器页面维护。

### 图片工作台

核心文件：

- `web/src/pages/image/index.tsx`
- `web/src/services/api/image.ts`
- `web/src/services/image-storage.ts`
- `web/src/services/workbench-cloud.ts`

当前托管模式调用的是通用异步图片接口：

```text
POST /v1/images/generations/async
GET  /v1/images/tasks/:task_id
GET  /v1/images/task-assets/...
```

主平台其实已经有更完整、由服务端管理队列和历史的 Image Studio BFF：

```text
GET    /api/v1/nextchat/image-studio/models
GET    /api/v1/nextchat/image-studio/estimate
POST   /api/v1/nextchat/image-studio/generate
POST   /api/v1/nextchat/image-studio/references
GET    /api/v1/nextchat/image-studio/jobs/active
GET    /api/v1/nextchat/image-studio/jobs
GET    /api/v1/nextchat/image-studio/jobs/:id
GET    /api/v1/nextchat/image-studio/jobs/:id/download
GET    /api/v1/nextchat/image-studio/assets/:id/content
GET    /api/v1/nextchat/image-studio/assets/:id/thumbnail
```

Canvas 服务端已经有 `/api/platform/image-studio/*` 代理，但生图工作台没有使用它。这是最值得优先纠正的架构分叉。

### 视频工作台

核心文件：

- `web/src/pages/video/index.tsx`
- `web/src/services/api/video.ts`
- `web/src/lib/seedance-video.ts`

视频 provider 目前主要靠模型名称正则猜测：OpenAI、Seedance、Agnes、Grok、Ark/plugin。没有主平台返回的明确 provider/protocol 能力契约，也没有每个线上模型的集成测试矩阵。

### 工作台历史

图片和视频历史不是数据库记录，而是每用户一个整体 JSON：

- `state:image-workbench`
- `state:video-workbench`

每次更新采用“读取整个数组 -> 合并 -> 重写整个 JSON”。多标签页、慢请求和状态刷新之间仍可能发生覆盖或回滚。列表增长后读写成本也是 O(N)。

## 4. 图片失败最可能发生的具体位置

不能在没有真实响应体的情况下把某一条写成已确认根因。当前应按下列顺序查证。

### 4.1 任务完成但 Canvas 解析出 0 张图片

`pollManagedImageGenerationTask()` 在 `status=completed` 时调用 `parseManagedImageResult()`。页面随后执行：

```text
successCount = providerImages.length
successCount == 0 -> status = failed -> “缺少生成结果”
```

这与截图中的 `成功 0 / 失败 1` 高度一致，但当前日志没有保存轮询响应的字段摘要，因此仍需用真实任务证明。

必须记录而不能记录敏感内容的字段：

- Canvas request ID
- task ID
- user ID / API key ID（可哈希或只记 ID）
- submit HTTP 状态和返回字段名
- 每次 poll HTTP 状态、任务 status、result/data 的类型与数量
- 结果 URL 类型：相对路径、主平台绝对 URL、对象存储 URL
- 下载 HTTP 状态、Content-Type、Content-Length、耗时
- 写入 Canvas 对象 storageKey、字节数、耗时
- 最终工作台状态写入结果

不要记录 API Key、Cookie、完整提示词、完整 URL query 或图片数据。

### 4.2 主平台异步任务完成，但结果转存或 Redis 完成状态异常

主平台关键文件：

- `backend/internal/handler/image_task_handler.go`
- `backend/internal/service/image_task.go`
- `backend/internal/service/image_storage.go`

主平台会强制异步 OpenAI 图片请求返回 `b64_json`，然后 `ImageResultUploader` 转存对象存储，再把短 URL 写入 Redis 任务结果。通用异步任务 TTL 默认只有 24 小时。

需要从主平台日志按 task ID 查：

- `image_task.offload_failed`
- `image_task.complete_store_failed`
- `image_task.failure_store_failed`
- 任务最终 Redis JSON
- 对象存储 key 与任务 ID 是否一致

“对象存储有文件”只能证明某次 Save 成功，不能单独证明任务完成状态、Canvas 轮询响应和 Canvas 本地落盘成功。

### 4.3 结果 URL 下载或代理失败

Canvas 会把结果 URL 通过 Gateway/签名资产代理转为同源 URL，然后由浏览器下载。这里可能出现：

- URL 字段名或嵌套结构没有被改写。
- 相对路径被错误拼接。
- 对象存储域名不在允许列表。
- 内网对象存储主机被 SSRF 私网地址保护拒绝。
- 主平台资产接口要求 API Key，但代理选错 chat/image 会话。
- 对象存储返回慢、重定向、错误 Content-Type 或无 Content-Length。
- 浏览器下载成功，但二次上传 Canvas 持久卷失败。

### 4.4 浏览器状态竞争

当前页面在 provider 完成后先保存一次“结果已完成、交付 pending”，然后下载/落盘，再保存“stored”。同时存在：

- 初始化刷新
- 云端状态读取
- localforage 读取
- pending 任务恢复
- 多标签页写入
- 用户点击历史记录触发媒体 hydration

现有 `updatedAt` 和写队列只是缓解，没有基于服务端版本号/CAS/事务的并发控制。

## 5. 30 GiB 本地空间的未完成语义

当前健康检查：

```json
{
  "ok": true,
  "status": "ok",
  "storage": {
    "data_dir": "/data/infinite-canvas",
    "scope": "global",
    "max_bytes": 32212254720,
    "min_free_bytes": 536870912
  }
}
```

全站 30 GiB 和全局 LRU 已编码并有单测，但“滚动删除”没有满足真实产品要求：

- 所有被 canvas/assets/image-workbench/video-workbench 状态 JSON 引用的对象都会被标记为 protected。
- 生成历史引用了生成文件后，这些文件不能被 LRU 删除。
- 当所有大文件都被状态引用时，系统会直接返回 `STORAGE_QUOTA_EXCEEDED`，不会自动删除最旧历史记录及其文件。
- LRU 只管 Canvas 持久卷，不会清理主平台对象存储，因此会形成两套生命周期和两份空间账。

正确的滚动策略必须以“历史记录/项目”为删除单位：先选最旧且未固定的记录，事务性删除记录引用，再删除文件；不能只删文件留下坏引用，也不能把所有历史引用永久保护。

## 6. 已做的修改

以下是从定制基线 `b66936d8` 到当前 `fbb893e` 的主要提交。

### 部署、认证、品牌、文档和容量

- `89da330`：增加托管 AI 创作空间部署、Node 服务端、平台会话交换、代理和本地对象/状态存储。
- `2929956`：Jisudeng 品牌、站内文档、移除 GitHub/版本入口、增加返回主平台入口。
- `2852a01`：把配额改为全站共享 30 GiB。
- `738420b`：平台提示词交接、管理员文档保护和 creation intent。
- `7525eb4`：进一步收紧管理员文档权限。
- `a02a3a0`：聊天与图片使用分开的托管 API Key 会话。
- `1062399`：尝试保留用户选择的模型和分组。

### 图片异步、历史和媒体恢复

- `173f252`：异步图片 task ID 写入工作台历史，刷新后恢复轮询。
- `c81ddcc`：图片/视频交付、工作台云状态和 Canvas 生成链路的大范围稳定化。
- `d6b1927`：改写异步图片 poll URL。
- `8c1e88d`：等待托管会话恢复后再加载历史。
- `d618dad`：会话恢复后再 hydrate 资产。
- `dad8940`：初始加载性能调整。
- `e830637`：静态压缩缓冲。
- `efa4a07`：延后托管 bootstrap。
- `decab32`：launch exchange 后保留认证状态。
- `9813966`：媒体 hydrate 前先恢复工作台记录。
- `b50011b`：渐进 hydrate 工作台媒体。
- `e896af9`：媒体恢复改用 store session。
- `1a10b35`：hydrate 后刷新当前结果。
- `815bf84`：选中历史时按需加载图片。
- `6d194e7`：减少刷新竞争覆盖已 hydrate 的历史。
- `091fdb7`：历史媒体默认按需加载。
- `506488c`：provider 完成后先持久化任务结果，再进行本地交付。
- `40d9644`：代理请求强制 `Accept-Encoding: identity`，避免 zstd 响应被错误当作 JSON。

这些提交修复了若干独立问题，但没有形成一次真实付费任务从提交、轮询、对象存储、Canvas 本地落盘、刷新恢复、资产展示到下载的闭环验收。

### 提示词库

- `f6e0973`：第一次本地中文提示词实现，破坏了原缩略图/分类。
- `1ddf2a5`：回滚上述实现。
- `c0b0932`：重新实现 image/video/canvas 三类本地提示词和本地 WebP 资源。
- `d55a1de`：补提交被 `.gitignore` 忽略的 JSON 数据。

当前校验：

```text
records=2685 referencedAssets=2685 localAssets=2685
```

未完全满足之处：很多 WebP 是本地生成的文字预览卡，不是真实模型效果图；只有一部分远程原始封面成功本地化。视频中文提示词数量也很少。构建产生多个大块：

- `image.zh-CN` 约 1.62 MB（gzip 约 555 KB）
- `freestylefly` 约 1.19 MB
- `davidwu` 约 1.07 MB
- 主入口约 1.01 MB

虽然源按动态 import 拆分，首次打开对应大源仍会慢。

### 视频协议

- `fbb893e`：为 `seedance2.5` 和通用 OpenAI 视频改用 JSON 请求。

当前真实生产仍返回 404，此提交没有完成兼容性验收。

### 主平台配套修改

- `0cb52edb9`：Canvas 返回 chat/image 两套托管会话。
- `11148aa49`：异步图片 task asset 通过主平台鉴权路由读取。
- `e47fb6150`：主平台 AI 创作空间入口启动 Canvas。
- `871a3a7fe`：稳定 Image Studio lease recovery 测试。
- `cf1df2e17`：PR #258 合并到 `play/main`。

## 7. 已验证和没有验证的内容

### 当前通过

- Canvas server：`npm test`，12/12 通过。
- Canvas web：`npm run typecheck` 通过。
- Canvas web：`npm run build` 通过。
- 提示词：`npm run prompt-library:check` 通过，2685/2685。
- 生产根页面 HTTP 200。
- `/api/health` HTTP 200，确认 `/data/infinite-canvas`、全站 30 GiB。
- 本地提示词 WebP HTTP 200。
- Zeabur 当前运行提交与 Git `fbb893e` 一致。

### 当前没有通过或根本没测

- 真实付费图片生成后显示结果。
- 对象存储结果下载耗时和吞吐。
- Canvas 自动落盘 `/data/infinite-canvas`。
- 刷新、退出重登、跨设备恢复同一个完成任务。
- “我的资产”展示生成结果。
- 连续提交多个图片任务且互不阻塞。
- 视频任一线上模型成功生成。
- Seedance 2.5、Agnes、Grok、Veo/Sora 的真实请求/轮询矩阵。
- 30 GiB 填满后的“删除最旧历史 + 文件”滚动行为。
- 多用户同时生成和多标签页状态竞争。
- APP 回归验收。
- 管理员查看用户、任务、失败原因和空间占用的管理页面（Canvas 当前没有）。

## 8. 推荐的修复方向

### 第一阶段：先建立证据闭环，不再猜协议

1. 给 Canvas submit/poll/download/store/state-save 增加结构化日志和统一 correlation ID。
2. 给主平台 task submit/worker/offload/complete/get-asset 增加同一 task ID 的可检索日志。
3. 使用一个明确授权的测试账号只生成 1 张低成本图片。
4. 保存完整但脱敏的事件时间线和响应字段摘要。
5. 在看到真实 poll JSON 前，不继续增加解析分支。

### 第二阶段：不要再让浏览器拥有任务状态机

优先复用主平台现有 Image Studio BFF，而不是 Canvas 继续直连 `/v1/images/*/async`：

1. Canvas 图片工作台调用 `/api/platform/image-studio/generate`。
2. 任务列表/刷新恢复调用 `/api/platform/image-studio/jobs*`。
3. 主平台数据库中的 job/asset 作为任务状态权威来源。
4. Canvas 服务端负责后台镜像已完成文件到 `/data/infinite-canvas`，浏览器只读取状态，不负责中转大文件。
5. 镜像完成后写 per-job manifest；失败可重试且不能把生成成功改判为生成失败。
6. UI 分离 `generation_status` 和 `local_copy_status`：生成成功但本地复制失败时显示“生成成功，正在恢复文件”，不能显示“生成失败”。

如果坚持使用通用 `/v1/images/*/async`，也必须在 Canvas 服务端增加持久任务表和 Worker，由服务端轮询和落盘，浏览器只订阅/查询。

### 第三阶段：统一存储职责

建议边界：

- 主平台对象存储：生成结果的权威来源、计费任务证据、APP 与 Web 共享。
- Canvas 30 GiB：用户上传、项目素材、工作区缓存/镜像、导出中间文件。
- Canvas 不应由浏览器把对象存储结果下载后再上传。
- 主平台到 Canvas 的复制应为同服务器服务端链路，并记录耗时、字节数、校验值。
- 制定对象存储与 Canvas 镜像各自的删除策略，避免永久双份。

### 第四阶段：重做 30 GiB 滚动删除

- 给每个 job/asset/project 明确 `created_at`、`last_accessed_at`、`pinned`、`bytes`。
- 在容量不足时选最旧未固定记录。
- 原子删除状态引用和文件；失败可恢复。
- UI 显示全站剩余空间即可，不暴露其他用户详情。
- 管理端增加总量、用户占用、任务状态、失败阶段、清理历史。

### 第五阶段：视频以能力契约驱动

- 主平台 bootstrap 对每个视频模型返回明确 provider、create path、poll path、请求字段、时长/分辨率/参考素材限制。
- Canvas 不再按模型名称正则猜 provider。
- 对每个线上模型做 mock contract test + 一次真实低成本 smoke test。
- 当前 404 必须读取响应 body；401 探针只证明 `/v1/videos` 路由存在，不证明当前图片托管 API Key/分组允许该视频模型。

## 9. Claude 建议先读的文件

### Canvas

1. `server/index.mjs`
2. `server/http.integration.test.mjs`
3. `web/src/pages/image/index.tsx`
4. `web/src/services/api/image.ts`
5. `web/src/services/image-storage.ts`
6. `web/src/services/workbench-cloud.ts`
7. `web/src/services/canvas-cloud.ts`
8. `web/src/pages/video/index.tsx`
9. `web/src/services/api/video.ts`
10. `web/src/stores/use-config-store.ts`

### 主平台

1. `backend/internal/handler/image_task_handler.go`
2. `backend/internal/service/image_task.go`
3. `backend/internal/service/image_storage.go`
4. `backend/internal/server/routes/gateway.go`
5. `backend/internal/server/routes/nextchat.go`
6. `backend/internal/handler/image_studio_handler.go`
7. `backend/internal/handler/image_studio_worker_runtime.go`
8. `backend/internal/service/image_studio.go`
9. `backend/internal/repository/image_studio_jobs_integration_test.go`

## 10. 常用核对命令

```bash
cd /home/codex/worktrees/infinite-canvas
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main

cd /home/codex/worktrees/infinite-canvas/server
npm test

cd /home/codex/worktrees/infinite-canvas/web
npm run typecheck
npm run build
npm run prompt-library:check

cd /home/codex/worktrees/infinite-canvas
npx --yes zeabur@0.21.0 deployment list \
  --service-id 6a7da69f2b4272705cd15e4d --json

npx --yes zeabur@0.21.0 deployment log \
  --service-id 6a7da69f2b4272705cd15e4d \
  --env-id 6a51de14104975fcb46761c3 \
  --type runtime

curl -k -sS https://jisudengcanvas.zeabur.app/api/health
```

## 11. 验收标准

不能再以“代码已提交、部署 RUNNING、单测通过、对象存储有文件”作为完成标准。至少必须提供一条真实任务的证据：

1. 提交返回 task/job ID。
2. 主平台日志证明只扣费一次。
3. 主平台任务完成，返回 1 个可读取 asset。
4. 服务端在合理时间内把文件复制到 Canvas 持久卷（如采用镜像方案）。
5. Canvas UI 显示图片，不是空白/失败。
6. 刷新后任务和图片仍在。
7. 退出重登后仍在。
8. “我的资产”按产品定义可见。
9. 第二个任务可在第一个任务运行时提交，不互相阻塞。
10. 日志能用一个 correlation ID 串起 submit、poll、asset、copy、state。
11. 测试后报告对象存储耗时、复制耗时、文件字节数和最终状态。
12. 视频必须对每个要上线的 provider 分别完成同类验收。

## 12. 明确不要做的事

- 不要继续根据截图猜响应结构后直接加兼容分支。
- 不要把“生成成功但复制失败”写成“生成失败”。
- 不要让浏览器承担长期队列 Worker。
- 不要把 API Key、Cookie、密码、完整提示词或图片 base64 写入日志。
- 不要删除 NextChat/Image Studio 后端或移动协议，APP 仍依赖它们。
- 不要为了 Canvas 结果展示再次修改计费逻辑。
- 不要部署后不做真实任务验收。

