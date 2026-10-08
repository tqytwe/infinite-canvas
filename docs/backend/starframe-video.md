# StarFrame 视频与 v0.8.0 升级

## 升级范围

- 从 fork 的 `upgrade/official-v071-20260920` 基线合并官方已发布 `v0.8.0`，不追随未发布 main。
- 保留 fork 原有首页调整、视频 missing-model JSON 兼容与非 JSON 响应提示。
- 分类覆盖以渠道和完整模型名为键。明确的文本、图片、视频、音频优先于名字判断，自动识别保留原行为。
- 新配置保存在现有渠道 JSON 中，不重命名模型，不清空已有用户渠道、画布、素材或任务。

## 两端配置

调用路径是 `Canvas -> https://api.jisudeng.com -> StarFrame/xzapi`，不是要求浏览器直连 xzapi。

1. 主平台部署 StarFrame 网关适配，管理员按该仓库 `docs/STARFRAME_VIDEO_GATEWAY.md` 配置可信上游账号、显式视频协议及模型视频价格。此升级不自动修改生产账号、价格、模型开放列表或数据库。
2. Canvas 新建或编辑渠道，协议选择 `StarFrame / xzapi`，地址使用 `https://api.jisudeng.com`，API Key 使用主平台的用户 Key，不能使用上游供应商 Key。
3. 在现有模型选择弹窗将所需模型明确分类为“视频”，再拉取或添加模型并确认。全部 18 个 `ch...` 模型和其它自定义名字均按完整原值传递。
4. 服务器公开渠道需要管理员同时开放这些模型；显式分类不能绕过模型权限。

## 请求与获取

- 创建使用 `POST /v1/videos` JSON，始终携带 `model`、`prompt`、`mode`、`client_task_id`，duration 是数字。不会删除模型分辨率后缀，也不会据后缀推断请求 resolution。
- references 模式下，一个素材使用 `image` / `video` / `audio`，两个以上使用 `images` / `videos` / `audios`。同类单复数互斥，素材必须有可公开读取的 HTTP URL。
- frames 模式需要同时提供 `first_frame` 和 `last_frame`，不能混入 references。供应商没有公开每个模型的参数能力矩阵，不能保证所有模型都接受同一素材模式或参数组合。
- 通过 `GET /v1/videos/:id` 查询。只有 completed 才取回内容；queued、in_progress、unknown 继续等待，failed 显示 `metadata.fail_reason`。
- completed 的相对 content 路径不是公共播放 URL。客户端向固定 `/v1/videos/:id/content` 携带鉴权请求，再存为正常媒体地址供播放、下载。不会把 Bearer 放进播放器 URL。
- 同单重试保留原 client_task_id；主平台将其映射到稳定的作用域 ID，避免不同用户共享上游账号时冲突。返回记录保留原客户端 ID。原 ID 丢失时不能猜一个新 ID 重新提交。
- 首版主平台收费边界是整数 1–15 秒、480p/720p/1080p 及已配置的视频价格；不支持的收费参数会明确拒绝，而不是钳制或猜测费用。这是网关收费限制，不是供应商模型能力结论。

## 发布与验收

部署前备份 Canvas 数据库、持久数据目录、媒体及云存储配置；主平台备份数据库和 Redis。记录当前部署 commit 与可回滚镜像。官方升级可能包含数据迁移，回滚代码不等于数据库自动回滚。

代码测试只证明协议和回归，不证明 18 个模型生产可用。上线需要分别记录两端部署 commit、健康状态和用户本地电脑浏览器证据。

- 管理员与普通用户：打开分类下拉框不提前确认，选择视频后拉取/手填、保存、重开、刷新仍是视频；同名不同渠道保持各自分类。
- 已有渠道：保持原有默认模型和素材，自动分类的既有默认值不因本次保存被清空。
- 实际创建：完整模型名、JSON body、明确 mode、稳定 client ID 和所选参数正确；记录供应商错误，不用成功的 mock 替代实际生成。
- 查询与内容：queued/in_progress/completed/failed 均可识别，完成后可播放和下载，失败原因可见；鉴权失败不会缓存 HTML/JSON 为视频。
- 网络超时：先查询原任务，同单重试复用 ID，不换账号重复提交；检查没有重复扣款，查询和下载不额外收费。
- 主题与布局：浅色、深色，桌面、窄屏，以及游客、普通用户、管理员三身份检查。

Canvas 在同一数据库事务内创建唯一提交记录并扣费，事务成功后才允许一次 POST。提交记录删除时仅隐藏，终态清理不删除提交资格；超时、崩溃、响应落库失败保留 submission_unknown，不自动重新收费或 POST。已知 sfv_ 始终查询原任务，模型与渠道从原视频保存配置恢复。查询和下载核验原用户、模型、渠道及 StarFrame 协议，成功查询进行中状态会清理旧失败。

主平台提交记录与任务映射永久保存在 PostgreSQL，Redis 丢失或过期不会重新开放提交。上游接受后本地落库前崩溃、以及网关异步记账中断，仍需人工对账；不承诺自动恢复未知上游 ID 或自动补扣费。

协议来源：[StarFrame/xzapi 文档](https://docs.xzapi.vip/)。
