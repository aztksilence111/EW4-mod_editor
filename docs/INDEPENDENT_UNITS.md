# 独立兵种接口与编辑器

2026-11-11：R 版源码新增 API 3 可选 `unitRecruitment` 接口，编辑器在“内容编辑 → 兵种”提供制作入口。新兵种使用独立字符串 profile ID，与原兵种共存，不占用传统 BTL 0～21 数字槽。

支持模板复制、现有兵种属性编辑、兵模和图卡模板、独立招募价格及建筑/等级/国家/剧本条件。属性包括血量、移动、攻击、射程、粮耗、武器、攻击次数、克制倍率、特性和技能槽。自定义美术须由作者提供，编辑器可复用当前工程已有资源。

预览通过完整资源检查及实际开局验证后才可应用，支持历史撤销/重做、工程恢复及 `.ew4mod` 完整导出。新增兵种可通过一次性 `unit_spawn` 开局增援部署；事件状态随存档保存，恢复不会重复生成。单独 BTL 无法携带这些外置定义。

R 版使用通用生产、AI 与存档代码，海军使用海面港口和海军生产组；新增势力也按国家范围获得授权。未配置的原兵种报价保留。编辑器同时适配新版拆分目录，并保留旧冻结基线的既有功能；旧基线会明确提示不支持新接口。

## 启动与工程

Windows 完整解压后运行 `Start-Editor.cmd`；Android 安装编辑器 APK。进入 R 版 → 内容编辑 → 兵种。新版基线保留旧作者目录，旧工程需在原基线继续使用。

```powershell
npm run setup:latest -- ../o4mod/rewrite
npm run dev
```

接口文档：`../o4mod/rewrite/mod-kit/docs/porting/INDEPENDENT_UNITS.md`；最小生成器：`../o4mod/rewrite/mod-kit/examples/independent-units/build.mjs`。后者复制作者自己的基础数据，增加步兵和巡洋舰，不分发贴图。

## 验证

| 范围 | 通过 |
| --- | ---: |
| R 接口、范围、原兵种共存、AI、存档、非法配置及包往返 | 37 |
| 编辑器作者 API、事务、历史、导出及重启 | 20 |
| 编辑器导出包实际开局、增援与存档恢复 | 9 |
| 编辑器桌面与手机视口 | 18 |
| R 游戏内步兵/舰船招募、原兵种共存及存读档，双视口 | 32 |
| 原有高级单位专项 | 35 |
| 旧冻结基线国家/事件流程 | 13 |
| 既有格式测试 | 11 |

以上检查均无错误。Web 构建、Android ARM64 Compile、旧/新基线 bridge 构建、前端类型检查及生产构建通过；示例完整 Mod 校验无警告。招募和编辑器截图已做视觉检查，临时截图不长期归档。游戏浏览器测试先运行 R 的 `--independent-units-only` 生成隔离夹具，再用对应隔离 Web 服务运行 `npm run test:browser:unit-recruitment`。

编辑器专项使用新版冻结基线及对应 DLL（试用服务可保持运行）：

```powershell
$env:EW4_EDITOR_TEST_BASE = '.local/r3-20261111'
$env:EW4_EDITOR_TEST_DLL = 'bridge/bin/Debug/net10.0/Ew4.Editor.dll'
npm run test:unit-types
npm run test:browser:unit-types
```

游戏需 R 版 0.2.39 或更新版本；旧 0.2.38 不包含新接口。未进行 Android 真机验收。
