# 实现与验证记录

日期：2026-11-07。当前交付版本：0.4.1。

本记录保留从 0.1.0 起各阶段的实现和验收证据；当前功能、使用说明及已知限制以 [README.md](../README.md) 为准，版本差异见 [CHANGELOG.md](../CHANGELOG.md)。Rewrite 扩展技能列表无固定数量上限，但当前编辑器 UI/API 仍限制可编辑槽位为 0..15；这项编辑器限制尚未解除。

## 2026-11-07：0.4.1 手机布局修复

0.4.0 发布后截图复核发现规则工作区子项被 flex 收缩，手机单列网格内文本区与后续按钮发生重叠。固定子项不收缩、移动端网格采用内容高度及固定文本区高度。规则双尺寸 UI 8 项重新通过，新增文本区/按钮、网格/导入区位置断言，并目视复核390宽截图；新双端包核对272项/0错，APK v2/v3签名及16 KiB对齐通过。Android versionCode 4，资源基线和作者目录同0.4.0。

## 2026-11-07：R 新接口与 0.4.0 双端包

R 源码与资源独立固定在 `.local/r3-20261107`，来源提交 `47f8067508030665b835e56fc3e767b2254aea3b`；使用快照逐文件哈希校验。新增 `RuleEditing.cs` 与 `RuleWorkbench.vue`，10 类扩展模块入口，完整 JSON / Lua / PNG 文件预览事务，接入当前引擎内容校验与开局检查；离线说明与 8 组官方规则示例随前端发布。国家/将领读取使用 `AuthorCatalog` 保留 schema 3 拆分结构。Android versionCode 3、独立基线目录 `r3-20261107`，旧版目录保留。

当前基线通过单元 13、规则 API 30（含全部模块骨架和 8 组官方示例、导出复检、重导入、历史及非法输入原子拒绝）、规则桌面/手机 UI 8、新建剧本/导出检查 API 25、日本/神罗全图 18；成品独立桌面双尺寸 UI 2、新建/导出检查双尺寸 UI 14 通过。构建零警告零错误。成品在 `release/0.4.0`；两包 SHA-256、前端及后端内容核对 272 项、0 错误，APK v2/v3 签名和 16 KiB 对齐通过，签名与 0.3.1 相同。Android 未连接真机。

## 2026-11-07：底图新建剧本与导出文件检查

追加全图适配实测：`tests/configured-maps.mjs` 18/18通过。日本 map4=267×217/57939格，神罗 map5=201×261/52461格；按实际BIN全范围创建（0,0起点，无裁切），前端BIN/BTL解析、无归属初始化、地图末端地块55578/52460归属修改、BTL导出和真实引擎开局全部通过，覆盖超过32767的全图格号。无需额外地图分支修改。成果 `.local/scenario-tools/configured-maps/{summary.json,custom_full_japan.btl,custom_full_hre.btl}` 及对应 `.check.json`，隔离测试端口5345退出已关闭，未写用户当前作者稿。使用上一段验证相同基线/DLL环境变量运行该测试。

R 版原先只通过已有 BTL 加载底图，导致已在 `def_map.xml` 登记、但没有剧本引用的东亚地图无法进入编辑。新增 `maps` 和 `new-scenario` 作者 API，以及顶部“新建剧本”面板。根据配置和实际 BIN 生成全图空白 v2 BTL，仅复制模板国家记录及必要 CNTR，设置一个非中立玩家国家、其余 AI；无归属领土、不复制旧地图城市/部队/事件/辖区/胜负扩展。拒绝重复 ID、旧修订、非法地图，创建进入完整作者撤销/重做和磁盘恢复。前端创建后只选择新剧本，进入领土批处理。当前未新增 R 部队/城市部署界面，空白稿仍需后续部署。

新增 `inspect-export` API 与“验证导出→检查导出文件”。只使用上传的实际字节和不可变资源基线，不读取作者覆盖补齐依赖、不写作者状态或历史。支持独立 BTL、两种资源 ZIP 和标准 `.ew4mod`；限制20 MiB压缩文件/64 MiB展开资源、10000条归档记录，检查路径、大小写重复、清单哈希、资源依赖、BTL结构/矩形/归属/引用及真实 `ClientContent.Start`。征服逐个检查非中立国家，保留逐剧本/国家的错误；引擎明确容忍的重复站点/事件、未解析绑定记为提示。assets 布局从保留源重建部署文件并比较；单 BTL 可指定自动/战役/征服模式，报告保留实际文件名、全图格号及错误码，可下载JSON。空白场景、未随BTL附带的外置内容和未执行多人开局等范围提示明确显示；不声称检查覆盖后续回合及视觉效果。

验证：`npm test` 13/13；`tests/scenario-tools.mjs` 25/25（东亚无已有BTL、领土实际编辑/保存/撤销、BTL逐字节导出、ZIP/.ew4mod、哈希篡改、assets不一致、目录穿越、大小写重名、改名征服识别、作者无写入、历史及重启）；`tests/browser-scenario-tools.mjs` 1440×960 / 390×844 共14/14，零浏览器脚本错误，实际创建、上传检查及报告下载。截图 `.local/scenario-tools/screenshots/check-{1440,390}.png` 已目视检查。`npm run build` / 类型检查及 `dotnet build bridge/Ew4.Editor.csproj -v:q -o .tmp/scenario-tools-build` 通过，C#零警告/错误；新增脚本语法及定向差异空白检查通过。

复跑测试前设置 PowerShell 环境：`$env:EW4_EDITOR_BASELINE_HOME='E:/Workplace/game/mod-editor/.local/r3'`、`$env:EW4_EDITOR_TEST_DLL='.tmp/scenario-tools-build/Ew4.Editor.dll'`，再运行上述两个 Node 脚本。测试用隔离作者目录，API 5341/重启5342，浏览器静态5343/API5344；都在退出时停止。原服务5184、用户作者稿和发行包保持原状态；本轮仅交付源码及开发构建，不覆盖原有未提交工作，不修改固定Rewrite快照或相邻游戏项目。

## 0.3.1：原版复用将领批改

原版新增独立内容工作区，支持 588 条内置将领的筛选、多选、规则队列、赋值/增加/倍率、取整、差异预览、撤销/重做及配方。原版和 R 版共用原生字段清单；原版直接操作本地 XML，导入完整原版 XML 或兼容 R 原生字段 CSV，导出独立 `def_commander.xml`，不调用 R 作者写接口。校验完整原版 ID 集、国家、技能/装备范围及 XML/CSV 字段，拒绝扩展节点和注册绑定。

将领 XML 纳入原版 `.ew4p` 和自动草稿；旧工程不带该字段时回退内置原版定义。切换版本保留两端编辑状态。Windows 和 Android 同步为 0.3.1，Android versionCode 递增至 2。

本轮通过单元/格式 12 项、原版将领双尺寸浏览器 8 项、Android 传输模拟 4 项及最终独立桌面包 2 项。浏览器验证实际导出 XML 仅有指定将领字段变化、拒绝扩展和越界输入、兼容 R 原生 CSV、预览/应用/历史、工程/草稿恢复、版本切换及 R 作者状态不变；原生传输验证原版 CSV 批改后 XML 可进入 Android 保存桥接。前端类型检查、双端构建、成品核验 268 项（0 错误）、APK v2/v3 签名和 16 KiB 对齐通过。无连接真机，设备安装与系统选择器仍未验收。成品保存于 `release/0.3.1`，旧版本保留；预览沿用旧作者目录以保留当前 R 状态。

## 0.3.0：剧情、版本隔离与编辑器双端

新增 `.local/r3` 独立 R 版快照及 schema 3 拆分目录兼容，保留旧基线和作者草稿。剧情工作区支持 ZIP/文件夹素材预览与应用、共享 PNG 素材、场景和步骤编辑、选项条件/效果、开局/胜败绑定及完整 JSON；预览使用游戏实际剧情播放器和隔离运行账户。导入执行路径、图片和容量校验，修改进入作者事务、撤销/重做及标准内容包导出。

原版/R 按钮分别保留草稿；原版 BTL、工程导入、恢复及导出验证实际扩展字节，拒绝 R 拓展内容。R 的 assets 布局导出仍是 R 版资源路径恢复包，不代表原版引擎兼容转换。

双端共享 `EditorApi.cs` 与作者引擎。Windows 独立包包含运行时和基线；Android 编辑器包名 `org.ew4.modeditor`，通过 WebView 与本地作者引擎工作，提供系统文件/文件夹选择和原生保存。Android 最低版本 8，当前交付 ARM64 开发签名 APK。

验证通过：格式 11、旧基线主集成 46、剧情 API 8、拆分目录 4、桌面/手机剧情 UI 6、Android 传输模拟 3，以及最终独立桌面包 1440×960/390×844 两项页面验收；前端类型检查、Web/Android 构建和脚本语法检查通过。成品一致性核验 268 项、0 错误，APK v2/v3 签名及 16 KiB 对齐通过。没有连接 Android 真机，未验证设备安装与系统选择器。交付目录 `release/0.3.0`，摘要和核验记录随包保存。

## 国家与可视化事件树

辖区修改新增地图独立入口。`ScenarioView.jurisdictionEditing` 根据真实开局返回当前 BTL 的城市/工厂/马厩中心及可编辑陆地，避免前端复刻引擎规则。界面通过既有辖区事务执行当前剧本的选区修改；预览颜色覆盖与作者数据分离，选区/中心/剧本/版本变化时作废。中心聚焦标记、地图拾取、整辖区选择及差异列表均已接入。

`jurisdictions.mjs` 验证征服及战役元数据、首次 JURI 初始化、未选地块与主体字节保留、无效目标原子拒绝、剧本隔离、历史/重启和精确 BTL 导出，并通过真实 Rewrite 开局及存档恢复。`browser-jurisdictions.mjs` 使用 5175 UI 和隔离 API，验证桌面/手机拾取、点选/矩形选择、预览画布像素变化及取消恢复、过期预览清理、应用/历史与剧本隔离、非空画布及无横向溢出。

本轮辖区专项及 1440×960/390×844 浏览器验收通过，前端类型检查/构建、后端零警告构建、11 项格式检查和 46 项主集成检查通过。5175 预览沿用原作者目录，5185 加载 `.local/build-jurisdictions`，重启前后 `author.json` 哈希一致；5174/5184 未修改。

新增 `OriginalExport.cs`：校验后导出原目录 ZIP 或单个精确 BTL，将领/国家可独立选择资源范围。分域输出保留共享 catalog/manifest 的变更源文件、client/frontend 资源及注册 JSON 引用依赖，包含脚本依赖的已修改 BTL；国家额外包含项目所有 BTL。按实际输出叠加基线再做资源和完整开局检查，所有导出不改变作者状态。`LegacyResourceExport.cs` 提供 `assets/` 布局，原始文件保持字节，manifest 图集恢复为 PNG/XML，目录型图片按坐标重组；完整 Rewrite 资源留在 `rewrite-resources/`，并输出路径/兼容报告。此布局不等同于原版引擎兼容转换。

`original-export.mjs` 使用隔离工程，混合修改将领及头像、国家/四帧旗帜/绑定和事件分支，检查三类范围、两种目录及单 BTL，比较资源原字节，并由真实 Rewrite 运行事件分支。`browser-original-export.mjs` 对桌面/手机检查选择器、下载名称及内容、草稿拦截和旧 .ew4mod 导出；使用现有 UI 加隔离 API，保留预览作者工程。

验证结果：原格式导出 6 项、桌面 1440×960/手机 390×844 下载验收、真实 Rewrite 叠加资源开局及选项分支、图集坐标和重组头像像素均通过；格式 11 项（93 个 BTL 精确往返）、前端构建/类型检查、后端零警告构建及 diff/脚本语法检查通过。浏览器状态提示改为不拦截点击。5175 预览沿用原作者目录，仅重启自有 5185 API 至 `.local/build-original-final`，重启前后作者文件 SHA256 一致；5174/5184 服务未动。

新增全页“内容编辑”工作区，将领、国家、事件树与地图分离；内容分类切换保留草稿，地图批处理引用已定义的国家和将领。国家支持名称/ID/领土色、CSV、模板、静态 PNG 与四帧动画，四帧按 Rewrite 原生 100 ms 周期写入两套图集。改名同步原字符串，改 ID 保留别名，BTL 绑定使用 CNTR。

事件画布使用 Vue Flow。矩形节点可拖动，端口连接、选项分支、缩放、平移和自动排列可用；点击事件打开图文/条件/结果详情。`EventEditing.cs` 处理事务与原生 BTL 事件，`EventGraphs.cs` 按 BTL 和国家槽位保存图形元数据，并将连线编译成 Rewrite 的完成条件及状态效果；节点坐标、编辑定义和编译定义统一进入历史。结果信号持久保留，周期事件不会自动重置连线。国家重新绑定时同步编译后的势力引用。

新增 `countries-events.mjs` 13 项、`event-graphs.mjs` 9 项隔离检查，覆盖原子失败、四帧资源、别名/同 ID 改名、国家/BTL 隔离、连线与汇合、跨国原生事件保护、位置历史、重启、标准包导出及真实 Rewrite 分支运行/存档恢复。资源专项 8 项及格式 11 项通过，前后端构建通过。`browser-countries-events.mjs` 覆盖 1440×960 和 390×844 的独立工作区、图片/动画、节点拖动及连线跟随、端口连接和历史操作；证据保存在 `.local/screenshots` 及对应 JSON。测试使用隔离作者目录，基线与相邻 Rewrite 工程未修改。

## 0.2.0 提交前复核

统一 `package.json`、`package-lock.json` 和 bridge 的版本号为 0.2.0；README 增补相对 0.1.0 的差异、将领批改流程、工程文件用途及技能槽位/部署 UI 限制，新增 CHANGELOG，并忽略本地 `.tmp` 笔记。

本次使用隔离的 0.2.0 bridge 构建重新验证：格式 11/11，前端类型检查及生产构建通过，C# 构建零警告/错误，13 个新增或修改的 JavaScript 测试脚本语法检查通过。完整集成入口通过主集成 46、导入 19、技能 5、资源 8、结构 writer 12/API 25、部署 writer 27/API 46 项检查，并通过部署导出包清单哈希、真实开局和存档恢复检查。草稿与测试产物均隔离保存在 `.local`，未修改运行中的作者草稿。

本次版本整理未重跑浏览器专项；此前桌面/手机浏览器及实际下载包验收证据保留在下方各阶段记录中。资源基线与相邻 Rewrite 工程未修改。

## 交付结构

| 路径 | 职责 |
| --- | --- |
| `src/App.vue` / 原组件 | 保留地图与原版工作流，增加独立 Rewrite 入口 |
| `src/components/RewriteWorkbench.vue` | 将领表、选择集、批处理、差异和导出 |
| `src/core/editor/api.ts` | 有类型的作者服务协议 |
| `bridge/AuthorEngine.cs` / `bridge/ModImport.cs` | 原字节修改、事务、历史、转换、验证、内容包物化导入与冲突预览 |
| `bridge/Program.cs` | 回环作者 API 及跨站请求限制 |
| `tools/setup.mjs` | 固定 Rewrite 当前源码与资源基线 |
| `tools/dev.mjs` | 开发期构建、启动和停止两个服务 |
| `tests/` | 格式、隔离集成和真实浏览器验证 |

独立项目使用 .NET 作者桥接，不修改旁边 `o4mod` 的 Web 宿主或源码。开发服务、作者草稿、临时 Mod 安装和预览档案全部归本项目 `.local` 所有；没有接入玩家活动状态。此路线服务于独立仓库的初步实现，之后可将桥接协议迁入游戏的独立编辑路径。

## 验证入口

- `formats.test.mjs`：附件 93 份 BTL 无改动逐字节往返、扩展原样保留及工程包保存、截断/越界拒绝、BTL 记录反向引用和绝对 cell 校验、BIN 头和长度。
- `integration.mjs`：588 位将领、95 份剧本；将领加成和两份征服的法国粮食修改；任务去重、过期预览、原子失败、撤销/重做、CSV 往返及错误、城市/部队预览、JURI/CNTR/VICT 混合写出、未知块拒绝、未改字节保留、完整开局、打包与工程恢复。
- `import.mjs`：19 项专用检查，覆盖替换、合并的暂停/保留/覆盖策略、包及文件哈希、覆盖来源和再编辑标记、剧本清单、预览无副作用、重复提交、过期预览、完整历史快照、旧工程迁移及进程重启后的撤销。默认 `npm run test:integration` 在原集成测试后执行此套件，也可用 `npm run test:import` 单独运行。
- `skills.mjs`：5 项技能绑定检查，覆盖原生 XML 技能与 Rewrite 最终有效技能并排读取、无扩展工程回退、注册技能绑定替换、扩展绑定文件写回、全剧本校验、撤销/重做及未知技能原子拒绝。
- `resources.mjs`：8 项资源专项检查，覆盖将领改名后的 manifest 与头像图集别名、目录型高清头像复制、城市名称、字符串表驱动的国家名称、图集坐标边界、完整资源校验、validate 和导出。
- `helpers/import-fixture.mjs`：通过真实作者 API 修改 `conquest1` 法国粮食并经标准导出校验生成夹具；缓存仅保存在 `.local/fixtures`，按资源基线、桥接 DLL 和包 SHA-256 检查复用条件，不提交游戏内容。
- `browser.mjs` / `browser-import.mjs`：1440×960 和 390×844；画布像素非空、无页面横向溢出、将领筛选/选择/预览、导出及地图视图；选择内容包、预览不落盘、切换策略清除旧预览、实际应用、三种冲突策略、撤销/重做。`npm run test:browser:import` 自动启动隔离草稿与 5175/5186 服务并在结束后关闭，不使用当前作者草稿。

详细机器结果及截图放在 `.local`，不将游戏包或本机路径写入公开证据。集成测试的 Mod 含作者改动，用于验证，不是建议的游戏平衡方案。

本轮结果：4 组格式测试通过（覆盖 93 份 BTL 及两张 BIN），C# 构建零警告/零错误，前端类型检查和构建通过；19 项导入专用检查、5 项技能绑定检查和 8 项资源专项检查通过，已验证导入缓存命中。资源同步会根据原始 XML/字符串表更新 `client/manifest.json`、`client/countries.json` 和 `frontend/city-names.json`，对聚合图集和目录型高清图集分别保留映射或复制头像文件；作者工程在恢复、预览、校验和导出前检查图集坐标（含实际 PNG 边界）、头像、首都、国家和城市资源，并同步运行 catalog 的源哈希/源树。技能编辑将原生 XML 的 `skill1..skill4` 与 Rewrite 最终有效的 `skill_slots` 分开显示；有扩展清单时写回 `commanderBindings`，旧工程继续使用 `legacy/catalog.json` 回退路径，并对受影响的全部剧本做启动校验。导入夹具和浏览器验收结果保存在 `.local`。

本轮完整串行入口通过 46 项隔离集成检查、19 项导入检查、5 项技能检查和 8 项资源检查；标准导出链路生成含混合扩展的 91,901 字节测试包。内容包导入支持替换/合并、冲突暂停/保留/覆盖、来源哈希、剧本清单和历史快照，前端已完成导入预览及文件差异展示的验收。BTL 导出现在会先建立部队、建筑、商店、酒馆、火焰和事件的 cell/ID 反向索引，拒绝重复 cell、悬空事件和越界剧本矩形；没有对应 BIN 时明确记录延后检查。

## 关键取舍

1. 常规编辑以定长字段补丁保留 BTL 未知主体字节；bridge 的最小部队结构删除单独生成槽位映射并验证启动，不开放通用重排、改尺寸或建筑结构编辑。
2. 未知可选扩展仅支持原样保留，修改时保守拒绝；已知块重建后由引擎实际开局检查。
3. 将领转换使用 Rewrite 当前转换器，并定点替换将领相关运行目录和源树/源哈希；其他目录覆盖保持不变。有自定义技能槽时拒绝可能破坏覆盖的原技能改写。
4. 首次建立手工辖区明确记录初始化，将当前引擎辖区物化。现有显式 `-1` 始终保留。
5. 预览使用代表开局，完整校验覆盖全部征服可玩国家。包导出继续运行上游的资源和清单校验。
6. Vite 明确排除 `.local` 和桥接构建目录的文件监视，避免扫描整个引擎快照及占用 Windows 打包暂存目录。导出复用上游标准 Seal / Validate / Import / Export 链路。

## 后续顺序

1. 最小 bridge 部队结构删除及 Rewrite UI 已实现并验证；下一阶段先核对 Rewrite 部队开局约束，再实现最小追加部署 writer 和作者事务，保留既有槽位及所有非部队主体字节，覆盖扩展重绑、真实开局/存档恢复和原子拒绝，再接 UI。原版负 cell 导出闸门继续保留；不支持的外部脚本/剧情/胜负依赖仍拒绝迁移。
2. 多作者工程库、其他旧工程迁移、表格粘贴、筛选配方和大规模虚拟表格。
3. 隔离游戏预览、代表玩法测试及 Android 真机验收。

导入预览首次遇到一个包时仍执行完整 Rewrite 资源校验；服务端的按包 SHA-256 进程内缓存和测试夹具缓存分别减少同进程重复导入与跨测试重复打包的开销。资源适配专项已完成，本轮补充了格式层的 BTL 引用校验和导出闸门；下一轮进入保留槽位的部队部署/删除以及建筑与商店、酒馆、事件、辖区的事务引用维护。

## 事务交互回归

2026-10-24 本轮：格式测试扩展至 9 项，修正新增建筑覆盖原有工事/桥梁的问题，只有显式负 cell 槽位可复用，反向索引也检查 `constructionType=255` 的设施记录。新增建筑桥梁数组独立复制，默认首都/工事字段使用可序列化的 `255`。删除部队不再清空同格商店/酒馆；建筑删除不再解除同格部队独立的事件绑定。`event.index` 经 Rewrite `LegacyScenarioEvents` 核对为效果作用 cell，主体删除不再改写该坐标。火焰仅在同格没有建筑和部队时清理。

`tests/browser.mjs` 在 1440×960 和 390×844 下实际新增/删除部队、新增建筑并下载 BTL，验证建筑计数 349、部队保留槽位计数 253，输出 21,640 字节，浏览器错误为零；通过实际控件设置军团归属。初始作者面板先等待刷新完成，地图按 hex 坐标选点并在选点后打开浮窗。5184 原来运行旧的 `build-skills` DLL，缺少 `reverseReferences`，已确认项目归属并重启为当前 bridge 构建；预览仍为 5174/5184。

本轮最终验证：`npm test` 9/9、主集成 46/46、导入 19/19、技能 5/5、资源 8/8、前端构建/类型、C# 构建、浏览器脚本语法和差异检查通过。双视口 `browser.mjs` 通过并检查截图；独立的 `browser-import.mjs` 包装入口本轮未重跑。结构删除后的 Rewrite 实际开局及扩展 writer 仍是下一阶段工作。

## Rewrite 空槽兼容性

2026-10-24：`tests/runtime/RuntimeCompatibility.csproj` 直接引用已构建的 Rewrite DLL，不构建或写入引擎快照。`ClientContent.Start` 与 `SessionSave.Encode/Decode` 验证原始剧本、合法合成记录和逐项破坏后的行为；输入 BTL、运行库哈希和结果保存在 `.local/runtime-compatibility`。负 cell 站点被跳过，负 cell 部队触发 `legacy.start_army_owner`，商店/酒馆触发 `legacy.commerce_location`，火焰触发 `legacy.environment`。

因此本阶段采用兼容性阻止策略：`serializeBtl` 对不支持的空槽明确拒绝，覆盖所有调用者；部队删除仍可保存在草稿并由后续新增复用，全部修复后才可导出。站点删除保留独立商业、环境和事件效果。负 cell 站点不进入 bridge 有效站点/事件引用索引，商业不再被误报为必须附属站点。非 cell 效果不再检查其事件坐标是否位于剧本矩形内，效果 5 仍检查。

事件绑定的实际字节位置为部队偏移 26、站点偏移 11，按 signed byte 解释；`0` 是活跃引用，`128..255` 为负值、不绑定。原始剧本存在缺失的有效 ID，Rewrite 以 MissingEventReferences 保留该信息，前端对应警告，不将 0 视为空引用。类型 255 的安装/桥梁记录仍为有效站点，未放宽复用条件。

`tests/runtime.mjs` 另验证作者恢复失败不改变任何状态、站点空槽与独立商业可恢复并经过标准 Mod 打包。浏览器覆盖删除部队后导出被阻止、复用空槽后下载恢复；未实现结构 writer，也未开放对 Rewrite 扩展主体的直接改写。

本阶段最终验证：格式 11/11；Rewrite 开局/存档恢复 17 项（含桌面/手机真实下载 BTL）；作者恢复/标准打包 6 项；主集成 46、导入 19、技能 5、资源 8 全通过。`test:browser:import` 双视口含导入/冲突/撤销重做和兼容性闸门，均无浏览器错误，截图已检查。前端构建/类型检查、隔离 C# 构建、脚本语法和 diff check 通过。预览为 5174/5184，API 使用本项目 `.local/build-runtime/Ew4.Editor.dll`；引擎快照与邻近工程未修改。

最终巡检补充：Vite 现有排除项追加 `tests/runtime/bin` 和 `tests/runtime/obj`，避免 Windows 构建中的 apphost.exe 被监听引发 EBUSY。重启 UI 后强制重建 runtime 测试项目，UI/API 均保持 HTTP 200，前端构建与类型检查再次通过。

## 最小部队结构删除

### 最小追加部署 writer / 作者 API（2026-10-24）

`ArmyStructuralEdit.Append` 在 armies 段尾插入 32 字节，更新 header[8] 和后续偏移；旧部队记录、所有其他主体段、领土/辖区中心与事件/商业记录保持原字节。CNTR/JURI/VICT 重绑新主体哈希，既有单位身份和嵌套 Win/Lose 目标不变。嵌套脚本胜负、预先指向尚不存在单位的目标、未知 BTL 块和工程外部胜负/剧情/显式及隐式脚本均拒绝。负 cell 部队草稿不复用，通用重排和站点结构操作仍未开放。

源码依据为 Rewrite 的 `LegacyScenarioHost`、`LegacyScenarioInitialization`、`LegacyScenarioMap`、`LegacyArmyRestoration`、`LegacyRuntimeCatalog` 与 `Movement.EntryCost`。ownership 按 signed byte 解释，目标格必须在剧本矩形和 Int16 cell 范围内、归属有效军团且无部队。国家目录的有效 UnitVariant 与 ClientContent 的 fallback 规则一致；兵种限 0..21、等级 0..2，将领为 -1 或当前目录有效 Int16 ID。默认兵力为有效目录满兵力，零移动/士气/经验/行动状态、无运输、非账户将领、flag5c=1、event=-1（字节 255）、建造回合 0。可选 strengthNow/strengthMax 要求 1 <= now <= max <= 32767；它们是原始恢复比例，实际兵力由开局及将领规则换算。将领实例由引擎按新单位 ID 创建。

开局导入器本身不验证海陆兵种匹配；本阶段明确采用与移动规则相符的保守部署限制：舰船只在海面，无运输陆军只在陆地。边方向、河流、桥梁不作为无来源部署的移动路径测试；不提供运输、事件绑定或任意状态字节参数。完整候选仍经资源及实际开局校验，单人模式限 1/2/4。

作者 `/preview` 的规则：`domain=armies, field=record, operation=append, value=0`，提供 `deployment={cell, armyType?, armyGrade?, commander?, strengthNow?, strengthMax?}`。cell 为必填；默认类型/等级为 0、将领为 -1。请求只允许一个剧本，filter 必须包含匹配的 mapId 及唯一目标 cells=[cell]，可加 country；拒绝 ids/search/armyType/commander 筛选。预览列出末尾新槽位及完整解析后记录，slotMigrations 为旧槽位恒等映射；同批后续规则使用前一规则的候选计数。提交仍受修订/令牌/任务约束，失败批次不写内存或磁盘。

`npm run test:deployment` 使用同一 `EW4_EDITOR_TEST_DLL` 及 BridgeOutput，重用并核验已保存结构夹具/运行库哈希，不重建旧空槽证据。C# harness 的 `--deployment` 运行 writer/开局/存档恢复；JS 使用隔离 5197/5198 检查预览、原子拒绝、连续及删增混合批次、历史、重启和完整国家验证/导出；`--deployment-export` 检查实际标准包清单哈希、BTL 精确一致及开局/恢复。成果在 `.local/runtime-compatibility/deployment-*`，加入 `test:integration`。下一阶段再接 Rewrite 部署 UI，原版导出闸门继续保留。

本阶段最终验证：部署 writer 27 项、作者 API 46 项及 7,712 字节标准包开局/存档恢复（253 单位）通过；输出 BTL SHA256 为 `34186131e0f1be7f59d1b66e2d85db35db52dd2ab6d5c787a68478a9c2b2815b`。格式 11、既有主集成 46/导入 19/技能 5/资源 8、结构运行时 12/API 25，以及导入/删除双视口浏览器回归均通过，删除下载包的 2 项开局/恢复仍通过，截图已检查。前端构建/类型、隔离 C# 构建（零警告/错误）、语法/diff check 通过。旧空槽 17/作者恢复 6 项证据沿用。日志为 `.local/deployment-{integration,browser-import,browser-structural}.log`。预览 API 在核对旧服务归属及空白作者状态后切到 `.local/build-deployment/Ew4.Editor.dll`（PID 10184，SHA256 `cdc7b07cd6de4fc5f07bb40bc81cc5ca9fb6e786c9f0231a271b0e18bb3d4a99`）；UI 5174 PID 36388 未变，两端 HTTP 200。构建复制依赖并使用 --no-dependencies，未写 Rewrite 快照或邻近 o4mod；保留全部未提交改动。

2026-10-24：新增 `bridge/ArmyStructuralEdit.cs`，从完整 BTL 副本移除明确指定的部队槽位，更新 header[8]，缩短 armies section 并移动后续 section。所有存活部队记录、其他 header 字段、站点、领土、火焰、市场、酒馆和事件定义保持原字节；不修改事件 ID、效果 cell 或其他主体绑定。CNTR/JURI 重绑新主体哈希，辖区中心保持原值；VICT 的嵌套 Win/Lose 条件按旧槽位到新槽位迁移存活部队 ID。若条件引用待删除目标或脚本，则拒绝操作。

作者 `/preview` 接受 `domain=armies, field=record, operation=delete, value=0, filter.ids=[当前槽位]`。IDs 必须明确、非空、无重复且全部满足 country/cells/mapId/armyType/commander 筛选，文本筛选拒绝。响应 `slotMigrations` 包含 `file`、零起始 `ruleIndex` 和 `oldToNew` 数组，删除项为 null；每个映射基于该规则执行前的候选状态，同批后续规则使用迁移后的槽位。完整批次通过既有资源/启动校验后才产生待提交预览；Apply 仍使用修订、任务 ID 和指纹约束，失败不写作者状态。

未知可选 BTL 扩展可恢复但禁止结构修改，未知必需块在读取时拒绝。工程若注册外部 victoryRules、scenarioEvents、显式 scripts 或技能/状态隐式脚本，最小实现会保守拒绝，以免其部队 ID 在数组缩短后静默指向其他部队；大小写不同的清单键遵守 Rewrite 的匹配方式。原版序列化兼容性闸门保持，Rewrite UI 接入见下节。

## Rewrite 部队删除交互

“部队”面板展示当前剧本的零起始部队槽位、地块、兵种和将领；可多选当前槽位，或通过地图点选/矩形选区选入部队。专用删除预览只针对当前剧本，发送明确的槽位 IDs 和地图 ID，不复用多剧本批处理范围。预览列出全部删除目标和完整槽位迁移（null 显示“删除”），取消不写作者状态。改变槽位选择、刷新或切换剧本清除预览，异步返回校验选择签名，提交使用预览原修订；后端保护及过期错误原样展示。提交、撤销、重做后重新加载场景并清空旧选择，避免删除已迁移槽位中的其他部队。刷新也清除旧批处理预览。

`npm run test:browser:structural` 使用隔离 5175/5195 服务，与导入浏览器入口串行执行；沿用 bridge 的既有来源校验端口。1440×960 和 390×844 均覆盖真实地图点选、表格多选、删除对象及迁移展示、取消无写入、其他请求改变修订后的过期拒绝、VICT 目标保护、应用及撤销重做、画布像素和页面无溢出、标准包实际下载。更严格的控制台检查同时修正了导出 Mod ID 表单不兼容浏览器 Unicode sets 模式的旧 pattern。

`tests/runtime/StructuralBrowserCompatibility.cs` 直接读取两份下载包，校验所有清单文件哈希，抽取 BTL 与已验证 structural-first 逐字节对照，再从包覆盖读取内容完成真实 Rewrite 开局与 SessionSave 编解码恢复，核对 251 支部队的槽位身份和位置、独立商业及胜负目标。结果保存在 `.local/runtime-compatibility/structural-browser-*.{json,btl,ew4mod}`，截图在 `.local/screenshots/structural-*`，无需重复生成旧空槽兼容性夹具。使用 `--structural-browser` 运行此 C# 模式；与原 structural 模式共用 `BridgeOutput` 指定的隔离 DLL。

本阶段最终验证：格式 11/11、主集成 46/46、导入 19/19、技能 5/5、资源 8/8、结构运行时 12/12、作者 API 25/25；新删除浏览器与既有导入浏览器入口均通过双视口，删除下载包额外通过 2 项实际开局/存档恢复，所有浏览器错误为空。前端构建/类型、隔离 bridge 构建（零警告/错误）、语法和差异检查通过。新构建位于 `.local/build-structural-ui`，其 Editor DLL 与仍在 5184 加载的 build-structural 逐字节一致（SHA b56c833f5afd9adb6271708f2be48fbf25d1f04dd5aef6f1b022f40014625df9），无需重启。预览 UI 5174/API 5184 归属未变且均 HTTP 200；测试监听已清理。旧 17 项空槽兼容性及 6 项作者恢复/导出证据沿用。全部既有未提交改动保留，单 Agent，未修改 Rewrite 快照或邻近 o4mod。

`tests/runtime/StructuralCompatibility.cs` 通过真实 Rewrite DLL 验证首/中/末、多项及全部删除、存活部队身份、死亡事件规则、独立商业、辖区、VICT 目标和存档恢复，另覆盖非法槽位、被引用目标及脚本胜负拒绝，共 12 项。`tests/structural.mjs` 的 25 项作者 API 检查覆盖预览无副作用、逐规则映射、错误筛选/批次回滚、未知扩展和外部依赖拒绝、幂等提交、过期预览、撤销重做、进程重启、全部可玩国家验证和标准 Mod 导出。API 写出与实际开局/恢复过的 BTL 逐字节一致。输入、输出、库哈希、检查报告和测试包位于 `.local/runtime-compatibility/structural-*`。

常规入口为 `npm run test:structural`，已加入 `test:integration`，需要当前 bridge 构建。隔离构建使用 `dotnet build bridge/Ew4.Editor.csproj --no-dependencies -o .local/build-structural -v:q`（目录先复制既有运行依赖）；设置 `EW4_EDITOR_TEST_DLL` 指向隔离 DLL 后，入口自动将同一输出目录传给 C# harness 的 `BridgeOutput`。作者专项使用 5193，进程重启检查使用 5194，避免 Windows 旧进程端口释放延迟。

本阶段最终验证：格式 11/11、结构运行时 12/12、结构作者 API 25/25、既有集成 46/46、导入 19/19、技能 5/5、资源 8/8；前端构建/类型检查、隔离 C# 构建（零警告/错误）、脚本语法及 diff check 通过。双视口 `test:browser:import` 继续覆盖导入/冲突/历史和原版导出闸门，均零浏览器错误，截图已检查。结构测试包为 7,690 字节。预览 UI 5174 不变，5184 API 在重新核对归属后切换至本轮隔离 DLL，两个端口均 HTTP 200。全部既有未提交改动保留，未修改 Rewrite 快照或邻近 o4mod。
