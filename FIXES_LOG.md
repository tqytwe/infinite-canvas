# Infinite Canvas 修复日志

## 2026-08-16

### BUG修复：Agnes图片生成n参数问题

**问题描述**：
- 用户选择生成4张图片时，Agnes只生成1张
- 原因：Agnes Image 2.0/2.1 Flash官方API不支持n参数（批量生成）
- 官方文档：https://agnes-ai.com/en/docs/agnes-image-20-flash
- 文档中所有示例都是单图生成，响应的data数组只包含一个结果

**解决方案**：
对于不支持n参数的模型（如Agnes），需要：
1. 发送n个独立的单图请求（并行或串行）
2. 或在UI层提示用户该模型不支持批量生成

**技术细节**：
- 当前代码位置：`web/src/services/api/image.ts:808-825` (submitManagedImageGeneration)
- n参数正确传递到请求body，但Agnes后端忽略该参数
- 需要在`createManagedImageGenerationTask`中检测Agnes模型，改为循环发送单个请求

**实施计划**：
- [ ] 方案A：检测Agnes模型，循环发送n次单图请求（推荐）
- [ ] 方案B：在UI显示警告"该模型不支持批量生成，将只生成1张"
- [ ] 更新CHANGELOG
- [ ] 提交到远程仓库

---
