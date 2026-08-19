---
title: Docker 部署
description: 使用 Docker Compose 部署无限画布
---

# Docker 部署

如果你希望在自己的机器或服务器上运行项目，可以直接使用 Docker Compose。

## 使用发布镜像

```bash
git clone git@github.com:tigerowo/infinite-canvas.git
cd infinite-canvas
cp .env.example .env
docker compose up -d
```

启动后访问：

```text
http://localhost:3000
```

默认管理员账号：

```text
用户名：admin
密码：.env 中的 ADMIN_PASSWORD
```

## 本地构建镜像

如果需要基于当前源码构建镜像：

```bash
cp .env.example .env
docker compose -f docker-compose.local.yml up -d --build
```

## 数据目录

Zeabur 正式部署使用持久化卷挂载 `/data/infinite-canvas`，SQLite 数据库和生成的图片、视频、音频都保存在该目录。Docker Compose 本地开发仍可把本地目录挂载到容器内 `/app/data`；生产环境不要把本地卷当作多副本共享存储。

Docker 部署时建议把 `.env` 中的 SQLite 路径设置为：

```text
DATABASE_DSN=/app/data/infinite-canvas.db
```

生产容量策略：默认总卷 30GB，预留 3GB，媒体池约 27GB；达到 24GB 左右时先清理过期临时文件和超过 72 小时且无资产、画布、历史或任务引用的媒体。带引用文件不会自动删除，仍不足时拒绝新写入。管理员可在 `/admin/storage` 查看真实磁盘容量、用户占用、孤儿/隔离文件和引用，并执行受保护的回收或删除。

如果需要让火山方舟拉取本地上传的 Seedance 参考素材，还需要把 `PUBLIC_BASE_URL` 设置为公网可访问的站点地址。
