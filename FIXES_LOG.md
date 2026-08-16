# Infinite Canvas 修复日志

## 2026-08-16

### ✅ 已修复：Agnes图片生成n参数问题

**问题描述**：
- 用户选择生成4张图片时，Agnes只生成1张
- 原因：Agnes Image 2.0/2.1 Flash官方API不支持n参数（批量生成）
- 官方文档：https://agnes-ai.com/en/docs/agnes-image-20-flash
- 文档中所有示例都是单图生成，响应的data数组只包含一个结果

**解决方案**：
对于不支持n参数的模型（如Agnes），发送n个并行的单图请求

**技术实现**：
1. 新增 `modelSupportsNParameter(model: string)` 辅助函数
   - 检测模型名称中是否包含"agnes"
   - 可扩展支持其他不支持批量的模型
   
2. 修改 `requestManagedImageGeneration()` 函数
   - 检测到Agnes模型且n>1时：
     * 创建n个独立的任务请求（count设为"1"）
     * 并行发送所有请求
     * 并行轮询所有任务
     * 合并结果返回
   - 其他模型保持原有逻辑（直接传递n参数）

**代码位置**：
- 文件：`web/src/services/api/image.ts`
- 新增函数：第773-782行
- 修改函数：第784-818行

**提交信息**：
- Commit: `2a52716`
- 消息: "fix: Agnes image generation n parameter - send multiple requests"
- 时间: 2026-08-16

**测试状态**：
- ✅ TypeScript编译（之前存在的错误不在本次修复范围内）
- ⏳ 等待推送到远程仓库（需要配置Git认证）
- ⏳ 等待生产部署
- ⏳ 需要真实Agnes账号测试批量生成

**后续工作**：
1. 配置Git推送认证
2. 推送到GitHub触发Zeabur自动部署
3. 使用真实Agnes模型测试生成4张图片
4. 验证图片质量和生成时间

---

### 相关资源

**Agnes AI 官方文档**：
- Agnes Image 2.0 Flash: https://agnes-ai.com/en/docs/agnes-image-20-flash
- Agnes Image 2.1 Flash: https://agnes-ai.com/en/docs/agnes-image-21-flash

**项目文档**：
- 交接文档: `CLAUDE_HANDOFF_2026-08-15.md`
- 状态报告: `../infinite-canvas-status-2026-08-16.md` (本地)

**相关文件**：
- 图片API实现: `web/src/services/api/image.ts`
- 视频API实现: `web/src/services/api/video.ts`
- 配置管理: `web/src/stores/use-config-store.ts`
- 服务端路由: `server/index.mjs`

---

## 版本历史

### v3.1 - 2026-08-16
- ✅ Agnes图片批量生成支持
- ✅ 服务端图片拉取（commit 4ab93ca）
- ✅ 视频路由修复（commit 035e8d6, 2adff91）
- ✅ 生成历史面板（commit 0c8c899）

### v3.0 - 2026-08-15
- 交接文档基线（commit fbb893e）
- ARK Seedance路由修复
- 性能优化（keep-alive, 缓存）

---

## 待办事项

### 高优先级
- [ ] 推送Agnes修复到远程仓库
- [ ] 验证生产部署成功
- [ ] 真实测试Agnes批量生成（4张图片）
- [ ] 监控生产日志确认无错误

### 中优先级
- [ ] 添加其他不支持n参数的模型到 `modelSupportsNParameter`
- [ ] 考虑添加UI提示：显示"正在生成第X/N张图片"
- [ ] 优化并行请求的错误处理（部分成功/部分失败）

### 低优先级
- [ ] 考虑添加配置选项：用户可选串行或并行生成
- [ ] 为批量请求添加整体进度条
- [ ] 记录批量生成的性能指标

---

## 注意事项

1. **Git推送认证**：当前仓库使用HTTPS，需要配置Personal Access Token或改用SSH
2. **TypeScript错误**：存在一些TypeScript错误但与本次修复无关，不影响运行
3. **并行请求限制**：同时发送大量请求可能触发rate limit，建议n值限制在10以内
4. **幂等性**：每个请求都有独立的idempotency key，确保重试安全

