<div align="center">
  <h1>ImagePick · 选片台</h1>
  <p><strong>让人做审美判断，让 Agent 精确接收。</strong><br>在本机完成看图、对比与选片，把决定变成清晰的结构化反馈。</p>
  <p>
    <a href="./README.md">English</a> · <strong>简体中文</strong>
  </p>
  <p>
    <a href="https://github.com/haimuhaimu/image-pick/actions/workflows/test.yml"><img alt="测试状态" src="https://github.com/haimuhaimu/image-pick/actions/workflows/test.yml/badge.svg"></a>
    <a href="./LICENSE"><img alt="MIT 许可证" src="https://img.shields.io/badge/license-MIT-2f6feb"></a>
    <a href="./package.json"><img alt="Node.js 22 或更新版本" src="https://img.shields.io/badge/Node.js-%E2%89%A522-43853d"></a>
  </p>
  <p><sub>本地优先 · 不上传图片 · 不需要模型 API Key · 无运行时依赖</sub></p>
</div>

ImagePick 把一个图片文件夹变成专注的本地选片空间。查看完整画面、对照参考图、放大细节，逐张标记**精选／返修／淘汰**，最后提交与当前图片版本绑定的回执。Agent 不再需要从聊天记录里猜你的结论。

<p align="center"><strong>图片 + album.json → 本机选片 → 提交回执 → Agent 精确读取</strong></p>

## 为什么用 ImagePick

| 看清作品 | 保留判断 | 准确交接 |
| --- | --- | --- |
| 完整大图、缩略图、总览、缩放拖动、可选局部区域，以及同步的参考图对比。 | 浏览器草稿与正式回执分开；已有精选不会被误算成本次通过。 | 每份回执都包含整组快照、图片版本摘要、逐图结论和原文备注。 |

原图始终不变。淘汰图片不会被删除，ImagePick 也不会自动修改其他项目的正式精选登记。

## 一分钟体验

需要 [Node.js 22+](https://nodejs.org/)。演示会在本机生成四张几何 PNG，不下载素材、不使用真实照片、也不调用模型。

```sh
git clone https://github.com/haimuhaimu/image-pick.git
cd image-pick
npm run demo
```

打开终端打印的本机地址，通常是 `http://127.0.0.1:4180`。结束时按 <kbd>Ctrl</kbd> + <kbd>C</kbd>。

## 一次完整的选片流程

1. **准备**——把 `album.json` 放在待评图片旁边。
2. **评选**——在浏览器里对比、缩放、筛选、标记并写备注。
3. **提交**——点击**提交评价**；在此之前，内容只是当前浏览器里的草稿。
4. **接收**——让 Agent 读取不可变的本地反馈回执。

允许只评一部分：没有标记的图片会明确保持“未评”。备注和结论各自记录修改时间；提交过程中产生的新编辑会继续显示为尚未提交，不会被旧请求覆盖。

## 使用自己的图片

在图片目录中创建 `album.json`：

```json
{
  "schemaVersion": 1,
  "id": "my-shoot",
  "revision": "1",
  "title": "我的这一组照片",
  "photos": [
    {
      "id": "photo-01",
      "file": "photo-01.png",
      "title": "第一张",
      "group": "候选"
    }
  ]
}
```

在 ImagePick 目录验证并打开：

```sh
node bin/image-pick.mjs validate /你的照片目录/album.json
node bin/image-pick.mjs serve /你的照片目录/album.json
```

支持 PNG、JPEG、WebP。图片路径及符号链接的最终位置都必须留在清单目录内。上限为 500 张、单张 32 MiB、总计 256 MiB。

给候选图添加 `referenceId`，可以与同一相册中的另一张图片对照；可选的 `focusBox: [左, 上, 右, 下]` 用 0–1 坐标标注需要快速查看的局部。全部字段见[清单说明](./skills/image-pick/references/manifest.md)。

服务启动时会把图片字节和规范化元数据固定成一个版本摘要。如果图片发生变化，请重启服务；新版本会使用独立草稿和回执，不会悄悄套用旧反馈。

## 让 Agent 接收结果

评选者点击**提交评价**之后：

```sh
node bin/image-pick.mjs feedback /你的照片目录/album.json
node bin/image-pick.mjs feedback /你的照片目录/album.json --since 上一次提交ID
```

回执默认位于规范化相册目录中的 `.image-pick/reviews`。如需保存到私有位置，请给 `serve` 和 `feedback` 同时传入相同的 `--reviews /私有反馈目录`。

- `receipt: null` 表示当前相册 ID 和图片版本没有正式回执；同一目录中仍可能保存旧版本回执。
- `localVerdict: null` 表示评选者本次没有表达结论。
- `baseline: selected` 表示原本已经入选，不等于本次新通过。
- 浏览器导出文件只是备份草稿，不是正式回执；v0.1 暂不支持导入草稿。

## Codex 与 DeepSeek Harness

共享的 [ImagePick Skill](./skills/image-pick/SKILL.md) 使用通用 `.agents/skills` 约定，并调用同一套本地命令。它不依赖专有画布、模型 SDK 或内嵌浏览器。

| 接入层 | v0.1 状态 |
| --- | --- |
| 独立浏览器 + CLI + 本地回执 | 已完成端到端测试 |
| DeepSeek 文件系统 Skill 发现 | 已使用官方 Provider 验证 |
| Codex / DeepSeek 完整模型会话 | 尚未认证 |
| 无共享文件的远程 Agent | 不支持 |

具体方法见[接入说明](./docs/integrations.md)和[实际验证记录](./docs/verification.md)。兼容宿主需要能够执行本地命令、访问同一组文件，并为评选者提供浏览器。

## 从设计上保持本地

- 服务只监听 `127.0.0.1`，不要暴露到公网。
- 图片留在你的电脑上；没有遥测、云存储或模型请求。
- 图片只能通过许可路由读取；回执写入需要同源请求和临时会话令牌。
- 备注是不可信数据，不能被 Agent 当成删除、发布或修改无关素材的授权。

完整边界见[安全说明](./SECURITY.md)。

## 已验证的版本

ImagePick v0.1 已在 Node.js 22 下通过 **38 项核心测试和 10 项真实浏览器测试**，覆盖草稿隔离、响应丢失重试、多标签页冲突、图片版本变化、损坏回执、大小写 ID，以及真实 JPEG/WebP 解码。GitHub Actions 会在 Linux 上重复执行整套检查。

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

欢迎阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 参与贡献。ImagePick 使用 [MIT 许可证](./LICENSE)；使用者仍需自行确保拥有待评图片的相应权利。
