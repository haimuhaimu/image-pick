# Try a re-review in five minutes

This demo makes the existing current-round/history workflow runnable without hand-writing a context file. It generates five original geometric PNGs, two manifests and a context in `.image-pick/rereview-demo`, with an isolated `reviews` directory. It does not download images or call an AI model.

**The earlier feedback is preloaded fiction, labeled `合成示例意见` (synthetic example feedback). It is not your prior review.** The new images are deterministic examples, not outputs of a live AI revision. On a first visit with no existing browser draft or receipt, your own verdicts and notes start blank. They become a real local receipt only when you submit them.

From a checkout with Node.js 22+:

```sh
npm run demo:rereview
```

No dependency install is needed to run the demo. Open the printed `http://127.0.0.1:4180/` URL. If that port is occupied, use `npm run demo:rereview -- --port 0` and open the returned URL. Stop with Ctrl+C. The review interface is currently Chinese.

1. **Review A, the circle.** The example feedback asks to center it without losing the warm gold color. Compare the previous version and decide for yourself; the processing summary is not acceptance.
2. **Select B, the triangle.** Switch the comparison to `参考图` (reference). The example asks for warm gold, but the new triangle deliberately remains blue-gray. A new version does not prove the request was fulfilled.
3. **Write your own note and mark `返修` (rework)** if you agree it needs more work. Click `查看上一版与评价` (previous version and feedback). History is read-only. Click `回到本轮` (return to this round): B, its note and comparison selection remain in place.
4. **Click `提交评价` (submit).** Only then is your review acknowledged. The circle remains unreviewed if you did not mark it; reviewing B does not approve A. Reload or restart the command: submitted feedback remains available, and the preloaded history is unchanged.
5. **Inspect the exact handoff.** After submission, `交给 AI 继续` exposes your acknowledged submission ID and digest. You can inspect the receipt with the command below. If you run `handoff`, copy both identifiers from that acknowledged handoff; do not substitute the fictional historical ID `synthetic-r1` or select “latest.” This demo does not execute an image edit or launch an agent.

```sh
node bin/image-pick.mjs feedback .image-pick/rereview-demo/album.json --reviews .image-pick/rereview-demo/reviews
```

For an actual agent revision, follow [the exact-version handoff instructions](./integrations.md#submit--continue-the-right-version). Use separately authorized image editing, save new files and a new manifest, and review again. Feedback text is data, not permission to delete or publish images.

## Preserve the demo work

Rerunning the command reuses identical files and preserves submitted reviews; it is not a reset. If a generated image, manifest or context was changed, startup refuses the mismatch instead of overwriting it or silently creating a new history identity. Keep that directory. To isolate disk receipts, use a separate checkout or call the exported `generateRereviewDemo(newEmptyDirectory)` helper and launch `serve` with the returned paths. A new folder alone does not isolate browser drafts: the demo has the same album identity and fingerprint. For a completely fresh experience, also use a browser session without an existing draft (such as a new private session) or a different, unused port. Do not delete old reviews or drafts just to clear an error.

For example, run these two commands from the checkout root to use a separate `.image-pick/rereview-second` folder. Choose another folder name if you already used it: repeating these commands resumes that folder rather than clearing it. Open the printed URL in a new private browser session if you want no previous browser draft.

```sh
node --input-type=module -e "import {generateRereviewDemo} from './scripts/demo.mjs'; console.log(await generateRereviewDemo('.image-pick/rereview-second'));"
node bin/image-pick.mjs serve .image-pick/rereview-second/album.json --context .image-pick/rereview-second/context.json --reviews .image-pick/rereview-second/reviews --port 0
```

This is separate from `npm run demo` and `npm run demo:handoff`. No private images, model key, telemetry, public hosting or automatic agent wake-up are involved. Browser-emulated touch checks are not physical-phone certification.

## 中文体验步骤

运行上面的 `npm run demo:rereview`，打开打印出的本机网址。

1. 先看圆：预置意见要求“居中、保留暖金色”。看前后图，再决定你的判断。
2. 点第二张三角，切到“参考图”：它还保留蓝灰色。这里故意留了一个没改完的结果，提醒你“出新版本”不等于“满足要求”。
3. 写自己的意见、点“返修”，再“查看上一版与评价”。旧意见只读；“回到本轮”应回到第二张，并保留备注和对照方式。
4. 点“提交评价”才会产生你本人的本机回执。没评价的第一张仍是未标记，不会被自动算作通过。重启演示不会删除本轮评价或预置历史。
5. 提交后可查看“交给 AI 继续”的准确回执编号和版本指纹；`feedback` 命令可读出真实提交。本演示到交接检查为止，不会自动返修，也不冒充实际 AI 调用。

页面里的“合成示例意见”是虚构的上一轮，不是你以前说过的话；“本轮处理说明”也不是你的验收结论。旧图、新图、两轮回执各自保留。生成文件被修改时会停止，不会覆盖。独立目录只隔离磁盘回执；相同端口仍可能恢复浏览器旧草稿。如需全新体验，保留旧目录和评价，另开空目录，并使用没有旧草稿的浏览器会话（如新的隐私窗口）或不同的未使用端口。

另开目录可在仓库根目录运行上面 `rereview-second` 的两条命令，再用新的隐私窗口打开打印的网址。若这个目录以前用过，换一个目录名，并同步替换两条命令中的目录路径；重复运行不是清空或重置。
