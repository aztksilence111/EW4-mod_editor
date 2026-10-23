# EW4-mod_editor

欧陆战争 4 Rewrite 批量 Mod 编辑器，初步实现版本 `0.1.0`。

以用户提供的 Vue 3 / TypeScript / Canvas 编辑器为底座，增加独立的本地作者服务。复用地图、缩放、图层与原版面板；Rewrite 读写、将领转换和 Mod 校验使用所选 Rewrite 源码快照中的实现。

## 启动

需要 Node.js 22+、npm、.NET SDK 10，以及带完整 `rewrite/data` 的 [ew4-rewrite](https://github.com/aztksilence111/ew4-rewrite) 工作副本。

默认两项目并列放置：

```text
game/
  o4mod/rewrite/
  mod-editor/
```

```powershell
npm ci
npm run setup
npm run dev
```

打开 <http://127.0.0.1:5174>。API 监听 `127.0.0.1:5184`。非默认源码位置：

```powershell
npm run setup -- C:/path/to/ew4-rewrite/rewrite
```

`setup` 在 `.local/rewrite` 固定必要源码及资源，生成逐文件 SHA-256 基线。它读取当前工作副本，包括尚未提交的源码；基线文件哈希才是本次作者工程的准确输入，Git 提交号只作来源提示。该目录不进入 Git。若已经建立基线，脚本拒绝覆盖；切换引擎版本请用新的编辑器检出目录并先导出作者工程。

## 当前功能

- 将领表格：国家/名称筛选、多选，能力、军衔、爵位、四技能和初始装备数值批改。
- 国家资源、部队、城市、领土和手工辖区批量修改。同一规则可用于多份剧本，国家以真实 ID 匹配。
- 地图点选和双角点矩形选择，选择高亮、辖区颜色层；带选区的配方限定同一底图。
- 规则顺序执行，差异预览、整批提交、撤销/重做、旧预览拒绝、任务 ID 重试去重。
- CSV 往返、配方 JSON、作者工程 `.ew4author` 保存和恢复，本地草稿持久化。
- 将领 XML → Rewrite 转换器 → `legacy/catalog.json` → 源哈希更新 → 运行时校验。
- 通过 Rewrite `ModStore.Seal` / `Validate` / `Import` / `Export` 输出 `.ew4mod`。导出使用独立暂存和安装目录。
- 原编辑器保留在“原版示例”入口；Rewrite 工程与原版草稿、示例资源分开。

作者工程保存在 `.local/author.json`。最多保留 30 批撤销历史，切换页面后仍可恢复。导出的 `.ew4author` 绑定精确资源基线，恢复前会校验。当前是单个活动作者工程，多个工程可以分别导出保存。

## 格式与事务

BTL 首版只进行保持记录数和坐标不变的字段修改。每条记录的原始字节及未知字段保留；已知 JURI/CNTR/VICT 扩展重新绑定主体哈希，再由 Rewrite 读取及开局验证。未知可选块允许原样保存，但会阻止修改；未知必需块由 Rewrite 拒绝。原版编辑器的扩展 BTL 写出旁路也已阻止。

首次建立 JURI 时，先固定引擎当前的有效自动辖区，再应用选区修改，预览中会列出此初始化。已有 JURI 中的 `-1` 不会被自动补齐。领土和辖区是两种独立规则。

预览验证受影响剧本的代表开局，将领改动会覆盖全部剧本。完整校验会逐个验证所有征服可玩国家。导出另做 Rewrite 的完整包与资源检查；校验失败不会发布新的工程修订。验证和导出可能需要几十秒。

CSV 第一行为字段名，包含 `schema`、`sourceHash` 和稳定 `id`。`name` / `country` 是锁定身份列。缺列或空单元格表示不修改；技能和装备的 `~clear` 明确写入 `-1`。重复 ID、重复/未知列、过期源哈希、非法数值均阻止整批提交。倍率取整有显式选项，越界拒绝，不自动截断。

## 检查

```powershell
npm test
npm run build
npm run build:bridge
npm run test:integration
node tests/browser.mjs
```

集成测试启动独立 `5185` API，测试作者状态和生成包均放在 `.local/tests`，不修改当前作者草稿。浏览器测试需要开发服务已启动，默认使用本机 Microsoft Edge。截图与检查报告位于 `.local`。

## 首版边界

这是规划的首轮可用基础，尚未完成全部 P1：已有 Mod 包的导入合并、Rewrite 扩展技能绑定编辑、头像映射、网页表格粘贴、国家科技数组、部队部署/删除、建筑迁移及引用联动仍待实现。高级区域复制、事件与胜负编辑、地图变形、XLSX 和独立游戏预览界面也尚未接入。

地图资源目前沿用附件的示例图集与名称数据；BTL/BIN 来自当前 Rewrite 工程，因此新增图集、国家、城市的显示适配仍需完善，不能把地图示例外观视为游戏画面的精确预览。旧 `.ew4p` 只能在原版示例中使用，尚不能直接迁移为 Rewrite 作者工程。分包构建不再输出单 HTML，旧按钮会明确提示。

本地作者服务不提供任意路径写入或命令执行 API，只监听回环地址，检查 Host、Origin、JSON 类型及写请求标头。它不连接玩家服务、不写账户或存档、不自动启用导出的 Mod。桌面模拟开局不替代 Android 真机验收。

来源与权属见 [NOTICE.md](NOTICE.md)，实现及验证记录见 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。
