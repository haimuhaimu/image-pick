# ImagePick · 选片台

**你来选图片，Agent 来接收反馈。**

面向 AI 创作的本地选片工具。看完整大图、对照原版、放大细节、标记精选／返修／淘汰，把修改意见变成 Agent 可以准确读取的结构化反馈。

[English](README.md) · [接入 Codex / DeepSeek Harness](docs/integrations.md)

## 先试一下

需要 **Node.js 22 或更新版本**，不需要生图 API Key，也不需要安装运行时依赖。

```sh
git clone https://github.com/haimuhaimu/image-pick.git
cd image-pick
npm run demo
```

打开终端打印的本机地址，通常是 **http://127.0.0.1:4180**。演示图片由程序在本机生成，不下载照片、不调用模型。按 Ctrl+C 停止服务。

## 怎么选片

- 完整大图、缩略图、总览、左右键连续看图。
- 有参考图时，可并排对照并同步缩放、拖动。
- 有关注区域时，一键看脸、商品或其他细节；没有区域也能正常浏览。
- 逐图标记「精选／返修／淘汰」，写下修改意见。
- 支持筛选、明暗外观和窄屏布局。v0.1 页面为中文。

标记首先是**浏览器草稿**。点「提交评价」并看到成功回执后，才算交给本地服务；只评一部分也可以，其他图片继续保持未标记。提交后再修改，会成为尚未提交的新草稿。

## 使用自己的图片

将 `album.json` 与照片放在同一个目录：

```json
{
  "schemaVersion": 1,
  "id": "my-shoot",
  "revision": "1",
  "title": "我的这一组照片",
  "photos": [
    {"id": "photo-01", "file": "photo-01.png", "title": "第一张", "group": "候选"}
  ]
}
```

在 ImagePick 目录运行：

```sh
node bin/image-pick.mjs validate /你的照片目录/album.json
node bin/image-pick.mjs serve /你的照片目录/album.json
```

支持 PNG、JPEG、WebP。图片路径必须在清单目录内，不能通过符号链接绕过。最多 500 张，单张 32 MiB、合计 256 MiB。图片加载为固定内存快照；修改原文件后需要重启，新版本不会套用旧评价。

`referenceId` 指向同一清单内的参考图；可选 `focusBox` 是 `[左, 上, 右, 下]`，取值 0–1。详细格式见[清单说明](skills/image-pick/references/manifest.md)。

## Agent 怎么接收评价

点「提交评价」后，对 Agent 说“评估完了”。它可以读取：

```sh
node bin/image-pick.mjs feedback /你的照片目录/album.json
node bin/image-pick.mjs feedback /你的照片目录/album.json --since 上一次提交ID
```

回执默认存放在照片清单目录下的 `.image-pick/reviews`。也可以给启动与读取命令同时加 `--reviews /私有反馈目录`。真实照片和反馈都不要提交到公开仓库。

「已有精选」和「当前独立评价」分开记录；没有标记不是通过，没有备注也不会补写淘汰原因。没有指定 `--since` 时读取的是当前提交快照，不能把所有旧标记都称为本轮新增。

`receipt: null` 表示当前相册 ID 与图片版本没有已提交回执；同一反馈目录里仍可能保留旧图片版本的回执。遇到这种情况应先核对版本摘要，不要直接让用户重复提交。

浏览器导出可用于备份或提交失败时保全草稿；导出的未提交草稿不是正式回执，v0.1 暂无导入恢复界面。多次提交会保留独立快照，不是实时多人协作文档，也不会后台唤醒 Agent。

## 两端共用

[共享 Skill](skills/image-pick/SKILL.md) 通过 `.agents/skills` 接入 Codex 和 DeepSeek Harness，同一工具、同一数据格式。运行环境需要本地命令、共享文件系统和浏览器；不依赖某个专有画布。安装与实际验证边界见[接入说明](docs/integrations.md)。

## 安全与开源

只监听本机回环地址，不上传图片、不调用模型、不遥测、不删除淘汰稿、不覆盖原图，也不自动更改原项目的正式精选。不要把服务直接暴露到公网。

MIT 开源。测试和演示只使用合成图片，不包含任何私人角色项目或真实选片记录。贡献方法见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全边界见 [SECURITY.md](SECURITY.md)。
