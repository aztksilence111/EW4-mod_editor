# 来源记录

## 原编辑器

- 用户提供文件：`欧陆战争4网页编辑器工作内容.zip`。
- SHA-256：`E03AB2214A8EC6D2F8517B3F0D87959136E35B3CD27FF8599AA763CAD966B3F2`。
- 源路径：压缩包内 `ew4-editor-web/`。
- 纳入 `src/`、`public/`、构建配置及锁文件，保留原组件和资源。未纳入原 `node_modules`、`dist`、生成 HTML、IDE 配置和 ZIP。
- 原 README 保存在 `docs/upstream-readme.md`。
- 附件未附明确项目许可证或作者声明；不据此为原源码及游戏素材补写授权。原有源码、文字、图像与游戏资源的权属仍归相应权利人。

## Rewrite

- 上游：<https://github.com/aztksilence111/ew4-rewrite>。
- 运行所需 C# 服务实现及基础资源由用户在本地选择源码目录，通过 `npm run setup` 建立快照；这些源码副本、游戏资源、账号、存档和构建产物不随本仓库上传。
- 快照文件记录准确的输入哈希和读取时的 Git 提交号，保存在不跟踪的 `.local/baseline.json`。
- 本地桥接复用 `Ew4.Core`、`Ew4.Legacy`、`Ew4.Persistence`、`Ew4.Client` 及 `Ew4.Mods`，避免另写一套 Rewrite 运行规则或手改源哈希来绕过校验。

## 新增实现

`bridge/`、`src/core/editor/`、`src/components/RewriteWorkbench.vue`、`tools/`、`tests/` 及相关增量修改为本次项目实现。项目公开托管不改变原材料的权属；本仓库暂不声明覆盖全部材料的统一开源许可证。
