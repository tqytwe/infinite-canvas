---
title: 待测试
description: 当前版本已实现但仍需人工验证的变更项
---

# 待测试

## 模型能力发现与 SenseNova 图片模型

- Canvas 拉取每个本地渠道的 `/v1/models` 时，应优先使用单个模型返回的 `modalities`、`image_capabilities`、`video_capabilities` 或嵌套 `capabilities`；只有旧响应没有任何能力字段时才使用兼容名称识别。
- `sensenova-u1.5-lite` 和 `sensenova-u1-fast` 必须仅凭精确 ID 出现在图片模型选择器中；同名前缀或后缀的未声明模型不得被误判为图片模型。
- 图片、视频、文本和音频选择器必须按渠道各自的能力表过滤，不能将一个渠道的模型能力带到另一个渠道；`video视频` 与 `Grok Heavy` 的已保存视频模型应仍可独立选择。
- 接口失败或返回空模型列表时，Canvas 必须保留已保存模型，显示渠道级错误和重试入口；恢复后重新拉取应更新能力状态。生产验收时，若两个 SenseNova 模型仍不在原始 66 个已保存模型中，再核对该 API Key 的分组、`model_mapping` 和图片权限。
- 极速蹬受管会话通过 Canvas 服务端读取 `nextchat/bootstrap` 的 `modalities`、图片/视频操作、适配器和能力版本；缺失任一媒体合同字段时不得按名称猜测能力，配置页必须显示可重试的明确原因。
- 受管图片和视频请求必须在 Canvas 服务端再次按会话、分组、模型、操作和适配器校验。`sensenova-u1.5-lite` 可生成和编辑，`sensenova-u1-fast` 仅可生成；U1.5 多图和 U1 Fast 参考图/编辑均应在请求前明确拒绝。

## 创作空间统一登录终态

- 从极速蹬 `/ai-creation-space` 进入 Canvas 后，成功兑换只写入 Canvas 本地会话并清理地址栏中的 `launch_token`。
- 重复兑换、过期令牌、错误密钥、缺少统一登录配置和平台暂时不可用时，Canvas 显示对应终态错误；刷新或重复点击不会在 Canvas 与控制台之间循环。
- 直接访问 Canvas 未登录时跳主站登录，登录成功后只通过 `/ai-creation-space` 返回一次 Canvas；生产环境需核对平台 URL、managed mode 和交换密钥一致性。

## 视频状态查询模型路由

- 使用用户自有的极速蹬 `video视频` API Key 创建 `manxue2.5`、`minimax_h3`、`seedance2.5`、`sd2.5`、`veo-3.1`、`veo-3.1-fast` 和 `veo-3.1-i2v` 后，Canvas 的服务端状态轮询必须携带对应模型名。
- 当网关同一分组包含多个视频上游账号时，状态查询必须继续命中创建该模型的账号；不得因查询请求缺少模型而默认路由到 `agnes-video-v2.0` 账号并返回 `task_not_exist`。

## Seedance 与 Veo 文档协议

- 标准 Seedance、Veo 和 Sora-2 渠道应使用 `POST /v1/videos` 的 JSON 请求；Seedance 使用 `seconds`/`resolution`，Veo 使用整数 `duration`，参考图分别按文档字段传递。
- 普通 Seedance 渠道不应再被改写到 Ark Plan 的 `/contents/generations/tasks`；Ark Plan 渠道仍应保留原路径。
- Veo 4/6/8 秒选择应分别发送对应时长，任务应按 5 秒间隔轮询，超过 10 分钟应明确提示超时；创建后上游暂时返回 `task_not_exist` 时应在 20 分钟内继续重试。
- 上游返回 `insufficient credits`、`video generation timed out` 等明确失败信息时，Canvas 必须立即同步为失败并停止轮询；只有明确限流信息才允许重试。
- 生产环境需使用真实测试账号分别验证 Seedance 2.5、Veo 3.1、Veo 3.1 Fast、Veo 3.1 I2V 以及 Sora-2 的文生视频、参考图和失败状态。

## 视频异步任务状态机

- 上游返回 `timeout`、`timed_out`、`expired`、`rejected`、`blocked`、`moderated` 或 `incomplete` 时，任务应立即显示失败并停止轮询。
- 上游返回 `completed` 但暂时没有视频地址时，任务最多等待 2 分钟补偿结果；仍没有地址时应显示协议错误，不得显示成功。
- 渠道不存在、渠道不支持模型、密钥配置失效等确定性轮询错误应立即失败；网络暂时故障可以重试，但不能超过 20 分钟。
- KIE、APIMart、本地直连和平台代理应对同一组终态显示一致。

## 视频模型目录与 Seedance 双版本

- 视频模型列表应保留 `manxue2.5`、`minimax_h3`、`seedance2.5`、`sd2.5`、`veo-3.1`、`veo-3.1-fast`、`veo-3.1-i2v` 这 7 个独立模型名。
- `sd2.5` 与 `seedance2.5` 请求协议相同，但模型 ID 不得合并；两者都必须能单独选择、提交和轮询。
- MiniMax 文本模型不得因为名称包含 `minimax` 而出现在视频模型列表。

## 图片生成结果持久化

- 仅返回 `b64_json` 的图片模型，生成成功后结果应立即显示，不再出现“没有可显示的图片”。
- 刷新生图工作台后，已生成结果仍应能从存储层恢复；服务端对象存储不可用时应保留在当前浏览器的 IndexedDB 中。

## 极速蹬统一登录与用户自有密钥

- 平台 `/ai-creation-space` 已可生成短时一次性启动令牌；Canvas 只兑换平台用户 ID，不返回、不创建平台托管 API Key。
- Canvas 已按 `platform_user_id` 创建或复用本地影子账号；再次从极速蹬进入后，应看到同一画布、素材、生成历史和用户配置。
- 统一登录启用时，普通 Canvas 注册、普通账号密码登录、Linux.do 登录及云端渠道均已关闭；用户应在配置页填写自己的 Base URL、API Key 和模型后再生成。
- 管理员仍可从 `/login?redirect=/admin` 使用本地管理员账号进入后台。
- 仍需在正式环境完成首次登录、重复登录、配置保留、用户自有密钥生成以及令牌重放失败的浏览器验收。

## 本地持久卷与管理员空间管理

- 服务端媒体根目录为 `/data/infinite-canvas`，默认 10GB 总卷预留 1GB，媒体池达到 8GB 清理阈值时只回收过期临时文件和超过保留期且全局无引用的媒体。
- 被用户资产、画布、图片/视频历史、任务或公共素材引用的对象不会自动删除；管理员逐对象删除也会先执行引用检查。
- 管理员后台 `/admin/storage` 提供真实文件系统容量、应用登记容量、用户占用排行、孤儿/隔离文件扫描、策略回收、隔离区清理，以及二次确认的引用对象强制删除。
- 生产环境仍需人工验证卷挂载、重启后文件与 SQLite 索引保持、A/B 用户隔离、Range 视频播放、接近阈值时拒绝新写入，以及删除最后一个引用后才能回收。

## 视频素材封面与品牌界面

- 从视频创作台或画布把视频加入“我的素材”后，应生成独立首帧 JPEG 封面；刷新、重新登录后封面仍可显示。
- 没有历史封面的旧视频应使用视频预览兜底，不应出现损坏的图片占位。
- 用户界面不再显示 GitHub 标识或版本号入口；内部 `VERSION` 仍用于发布追踪。
