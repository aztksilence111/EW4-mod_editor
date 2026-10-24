# 实现与验证记录

日期：2026-10-24。当前交付版本：0.2.0。

本记录保留从 0.1.0 起各阶段的实现和验收证据；当前功能、使用说明及已知限制以 [README.md](../README.md) 为准，版本差异见 [CHANGELOG.md](../CHANGELOG.md)。Rewrite 扩展技能列表无固定数量上限，但当前编辑器 UI/API 仍限制可编辑槽位为 0..15；这项编辑器限制尚未解除。

## 未发布：国家与可视化事件树

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
