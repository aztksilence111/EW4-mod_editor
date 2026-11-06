using System.IO.Compression;
using System.Text.Json;
using Ew4.Core;
using Ew4.Legacy;
using Ew4.Mods;

namespace Ew4.Editor;

public sealed record InspectExportRequest(string Name, string Data, string Mode = "auto");
public sealed record ExportIssue(string Severity, string File, string Stage, string Code, string Message);

public sealed partial class AuthorEngine
{
    // Inspection uses exported bytes plus the immutable baseline, never unsaved author overrides.
    public object InspectExport(InspectExportRequest request)
    {
        lock (gate)
        {
            var issues = new List<ExportIssue>();
            var files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            string[] ids = [];
            byte[] bytes = [];
            void Check(string file, string stage, Action action)
            {
                try { action(); }
                catch (Exception e) when (e is not OutOfMemoryException)
                { issues.Add(new("error", file, stage, e is RuleViolation rule ? rule.Code : "export.invalid", e.Message)); }
            }
            Check(request.Name, "读取文件", () =>
            {
                if (request.Data == null || request.Data.Length > 28 * 1024 * 1024) throw new InvalidDataException("文件不能超过 20 MiB");
                bytes = Convert.FromBase64String(request.Data);
                if (bytes.Length is 0 or > 20 * 1024 * 1024) throw new InvalidDataException("文件为空或超过 20 MiB");
                string extension = Path.GetExtension(request.Name).ToLowerInvariant();
                if (extension == ".btl")
                {
                    if (request.Mode is not ("auto" or "campaign" or "conquest")) throw new InvalidDataException("请选择单个 BTL 的检查模式");
                    string id = Path.GetFileNameWithoutExtension(request.Name);
                    if (request.Mode != "auto" || !baseline.Scenarios.Contains(id))
                    {
                        var battle = LegacyBattle.Read(bytes);
                        bool conquest = request.Mode == "conquest" || request.Mode == "auto" && battle.Factions.All(f => f.Ai);
                        id = conquest ? "conquest_export_check" : "custom_export_check";
                    }
                    files[ScenarioPath(id)] = bytes; ids = [id];
                    issues.Add(new("warning", request.Name, "检查范围", "external_resources",
                        "单个 BTL 不含将领、事件树及图片；使用编辑器资源基线检查。检查模式：" + (id.StartsWith("conquest", StringComparison.Ordinal) ? "征服" : "战役/原文件模式") + "；可手动选择战役或征服。"));
                    return;
                }
                if (extension is not (".zip" or ".ew4mod")) throw new InvalidDataException("请选择 .btl、.zip 或 .ew4mod 文件");
                using var archive = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
                var entries = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
                long total = 0;
                if (archive.Entries.Count > 10000) throw new InvalidDataException("包内文件数超过 10000");
                foreach (var entry in archive.Entries)
                {
                    if (entry.FullName.EndsWith('/')) continue;
                    string path = ModFiles.PathName(entry.FullName);
                    total = checked(total + entry.Length);
                    if (entry.Length > 64 * 1024 * 1024 || total > 64 * 1024 * 1024)
                        throw new InvalidDataException("展开资源不能超过 64 MiB");
                    using var stream = entry.Open(); using var output = new MemoryStream(); stream.CopyTo(output);
                    if (!entries.TryAdd(path, output.ToArray())) throw new InvalidDataException("包内路径重复: " + path);
                }
                if (entries.ContainsKey("mod.json"))
                {
                    var manifest = JsonSerializer.Deserialize<ModManifest>(entries["mod.json"], Json)
                        ?? throw new InvalidDataException("缺少 Mod 清单");
                    if (manifest.Files == null || manifest.Scenarios == null) throw new InvalidDataException("Mod 清单字段缺失");
                    if (manifest.Scenarios.Length is < 1 or > 1000 || manifest.Scenarios.Distinct().Count() != manifest.Scenarios.Length)
                        throw new InvalidDataException("Mod 剧本清单无效");
                    foreach (string id in manifest.Scenarios) ScenarioPath(id);
                    ids = manifest.Scenarios;
                    foreach (string path in manifest.Files.Keys)
                        files.Add(ModFiles.PathName(path), entries.TryGetValue(path, out var data) ? data : throw new InvalidDataException("包内缺少: " + path));
                    string job = Path.Combine(home, "inspections", Guid.NewGuid().ToString("N"));
                    foreach (var (path, data) in entries) ModFiles.Write(job, path, data);
                    Check("mod.json", "内容包清单、哈希及兼容性", () =>
                        new ModStore(baseline, Path.Combine(job, "installed"), Path.Combine(job, "saves")).Validate(job));
                }
                else
                {
                    bool legacy = entries.ContainsKey("export-map.json");
                    if (legacy)
                    {
                        // Rebuild the deployment files from their retained Rewrite sources and compare them too.
                        var retained = entries.Where(p => p.Key.StartsWith("rewrite-resources/", StringComparison.Ordinal))
                            .ToDictionary(p => p.Key[18..], p => p.Value, StringComparer.Ordinal);
                        Check("assets/", "部署资源一致性", () =>
                        {
                            var rebuilt = LegacyResourceExport(retained);
                            foreach (var (path, data) in rebuilt.Where(p => p.Key.StartsWith("assets/", StringComparison.Ordinal)))
                                if (!entries.TryGetValue(path, out var actual) || !actual.AsSpan().SequenceEqual(data))
                                    throw new InvalidDataException("部署资源缺失或与 Rewrite 源资源不一致: " + path);
                        });
                    }
                    foreach (var (path, data) in entries)
                    {
                        string resource = legacy && path.StartsWith("rewrite-resources/", StringComparison.Ordinal)
                            ? path[18..] : path;
                        if (legacy && !path.StartsWith("rewrite-resources/", StringComparison.Ordinal)) continue;
                        if (!ModFiles.RuntimePath(resource)) throw new InvalidDataException("不支持的资源路径: " + path);
                        files.Add(resource, data);
                    }
                    if (files.Count == 0) throw new InvalidDataException("资源 ZIP 中没有可检查的 Rewrite 资源");
                    ids = files.Keys.Where(p => p.StartsWith("original/", StringComparison.Ordinal) && p.EndsWith(".btl", StringComparison.Ordinal))
                        .Select(p => Path.GetFileNameWithoutExtension(p)).ToArray();
                    if (ids.Length == 0) ids = baseline.Scenarios;
                    foreach (string id in ids) ScenarioPath(id);
                    issues.Add(new("warning", request.Name, "检查范围", "baseline_dependencies", "资源 ZIP 的未包含文件使用编辑器资源基线补齐。"));
                }
            });
            if (files.Count > 0 && !issues.Any(i => i.Stage == "读取文件" && i.Severity == "error"))
                InspectContent(files, ids, issues);
            if (Path.GetExtension(request.Name).Equals(".btl", StringComparison.OrdinalIgnoreCase) && ids.Length == 1)
                for (int i = 0; i < issues.Count; i++)
                    if (issues[i].File == ScenarioPath(ids[0])) issues[i] = issues[i] with { File = request.Name };
            return new { valid = issues.All(i => i.Severity != "error"), issues, scenarios = ids.Length,
                sha256 = Hash(bytes), baseline = baseline.Revision, state.Revision };
        }
    }

    private void InspectContent(Dictionary<string, byte[]> files, string[] ids, List<ExportIssue> issues)
    {
        byte[] ReadExport(string path) => files.TryGetValue(path, out var data) ? data : BaseRead(path);
        void Check(string file, string stage, Action action)
        {
            try { action(); }
            catch (Exception e) when (e is not OutOfMemoryException)
            { issues.Add(new("error", file, stage, e is RuleViolation rule ? rule.Code : "export.invalid", e.Message)); }
        }
        Check("资源", "资源引用", () => ProjectResourceValidation.Check(ReadExport,
            sourceHashes.Keys.Union(files.Keys).ToHashSet(StringComparer.Ordinal)));
        var allIds = baseline.Scenarios.Union(ids).ToArray();
        // Keep shared extension references resolvable, while checking only the exported scenarios.
        Ew4.Client.ClientContent? content = null;
        Check("资源", "加载引擎", () => content = baseline.Content(ReadExport, allIds));
        if (content != null) Check("资源", "引擎资源依赖", () => ResourceValidation.Check(ReadExport,
            sourceHashes.Keys.Union(files.Keys).ToHashSet(StringComparer.Ordinal), content));
        foreach (string id in ids)
        {
            string path = ScenarioPath(id);
            Check(path, "BTL 结构与引用", () =>
            {
                var battle = LegacyBattle.Read(ReadExport(path));
                var map = ModFiles.Xml(ReadExport("original/def_map.xml")).Root!.Elements("map")
                    .SingleOrDefault(e => (int)e.Attribute("id")! == battle.MapId)
                    ?? throw new InvalidDataException("未配置地图 ID: " + battle.MapId);
                var terrain = LegacyTerrainMap.Read(ReadExport("original/" + (string)map.Attribute("file")!));
                if (battle.Left < 0 || battle.Top < 0 || (long)battle.Left + battle.Width > terrain.Width || (long)battle.Top + battle.Height > terrain.Height)
                    throw new InvalidDataException("剧本矩形超出底图范围");
                var owners = battle.SectionBytes("ownership");
                for (int local = 0; local < owners.Length; local++)
                    if (owners[local] < 128 && owners[local] >= battle.Factions.Count)
                        issues.Add(new("error", path, "领土归属", "invalid_owner",
                            $"全图格号 {(local / battle.Width + battle.Top) * terrain.Width + local % battle.Width + battle.Left} 引用了不存在的国家槽位 {owners[local]}"));
                var report = JsonSerializer.SerializeToElement(BattleReferenceValidation.Build(battle, terrain), Json);
                foreach (var conflict in report.GetProperty("conflicts").EnumerateArray())
                {
                    string code = conflict.GetProperty("code").GetString()!;
                    // Legacy import explicitly resolves duplicate sites/events and preserves missing bindings as diagnostics.
                    string severity = code is "duplicate-site-cell" or "duplicate-event-id" or "missing-event-reference" ? "warning" : "error";
                    issues.Add(new(severity, path, "BTL 引用", code, conflict.GetProperty("detail").GetString()!));
                }
                if (battle.Armies.Count == 0 || battle.Sites.Count == 0)
                    issues.Add(new("warning", path, "可玩性", "empty_scenario", "剧本缺少部队或城市，开局可能直接结束；请完成部署。"));
            });
            if (content == null) continue;
            Check(path, "引擎开局", () =>
            {
                var choice = content.Scenarios.Single(s => s.Id == id);
                var battle = content.Battle(id);
                if (choice.Mode == 3)
                { issues.Add(new("warning", path, "引擎开局", "multiplayer_deferred", "多人剧本尚未执行多人会话开局检查。")); return; }
                if (choice.Mode == 2)
                {
                    var countries = battle.Factions.Where(f => f.Camp != 4).Select(f => f.CountryId).ToArray();
                    if (countries.Length == 0) throw new InvalidDataException("征服没有可用玩家国家");
                    foreach (string country in countries)
                        Check(path, "引擎开局 / " + country, () => content.Start(id, country));
                }
                else content.Start(id, null);
            });
        }
    }
}
