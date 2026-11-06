using System.Text;
using System.Text.Json.Nodes;
using Ew4.Legacy;
using Ew4.Mods;

namespace Ew4.Editor;

public sealed record RuleFileRequest(int Revision, string TaskId, Dictionary<string, string?> Files);
public sealed record RuleModule(string Key, string Name, string Path, string Guide, JsonNode Initial);

public sealed partial class AuthorEngine
{
    private static bool RulePath(string path) => ModFiles.RuntimePath(ModFiles.PathName(path))
        && (path.EndsWith(".json", StringComparison.Ordinal) || path.EndsWith(".png", StringComparison.Ordinal)
            || path.StartsWith("rewrite/", StringComparison.Ordinal) && path.EndsWith(".lua", StringComparison.Ordinal));

    private static RuleModule[] RuleModules => [
        new("unitLayers", "空地分层 / 双层单位", "rewrite/unit-layers.json", "UNIT_LAYERS.md", JsonNode.Parse("{\"enabled\":false,\"surfaceCapacity\":1,\"airCapacity\":1,\"profiles\":{}}")!),
        new("construction", "自定义建筑 / 工兵施工", "rewrite/construction.json", "CUSTOM_CONSTRUCTION.md", JsonNode.Parse("{\"enabled\":false,\"builderProfiles\":[],\"buildings\":{}}")!),
        new("economy", "剧本粮食与收入", "rewrite/economy.json", "SCENARIO_ECONOMY.md", JsonNode.Parse("{\"schema\":1,\"scenarios\":{}}")!),
        new("commanderAbilities", "自定义将领能力栏", "rewrite/commander-abilities.json", "COMMANDER_ABILITIES.md", JsonNode.Parse("{\"schema\":1,\"abilities\":[],\"commanders\":{},\"units\":{}}")!),
        new("skills", "主动技能 / 被动光环 / 战术技能", "rewrite/skills.json", "RULE_EXTENSIONS.md", new JsonArray()),
        new("statuses", "持续状态与技能属性", "rewrite/statuses.json", "RULE_EXTENSIONS.md", new JsonArray()),
        new("unitBindings", "部队技能绑定", "rewrite/unit-bindings.json", "RULE_EXTENSIONS.md", new JsonArray()),
        new("commanderBindings", "将领技能绑定", "rewrite/commander-bindings.json", "RULE_EXTENSIONS.md", new JsonArray()),
        new("itemBindings", "装备与物品效果", "rewrite/item-bindings.json", "ITEM_EFFECTS.md", new JsonArray()),
        new("legacySkillParameters", "原技能参数", "rewrite/legacy-skills.json", "RULE_EXTENSIONS.md", JsonNode.Parse("{\"schema\":1,\"skills\":{}}")!)
    ];

    public object Rules()
    {
        lock (gate)
        {
            var manifest = EventDocument(state.Files).Manifest;
            return new { state.Revision, apiVersion = 3, engineSource = engineSourceCommit,
                modules = RuleModules, manifest,
                files = sourceHashes.Keys.Union(state.Files.Keys).Where(p => RulePath(p) && (!p.EndsWith(".png", StringComparison.Ordinal) || state.Files.ContainsKey(p))).Order(StringComparer.Ordinal)
                    .Select(path => new { path, modified = state.Files.ContainsKey(path), bytes = Read(state.Files, path).Length }) };
        }
    }
    public object RuleFile(string path)
    {
        lock (gate)
        {
            if (!RulePath(path)) throw new InvalidDataException("请选择 JSON、扩展 Lua 或 PNG 规则资源");
            var bytes = Read(state.Files, path);
            if (bytes.Length > 4 * 1024 * 1024) throw new InvalidDataException("单份规则资源不能超过 4 MiB");
            return new { state.Revision, path, text = path.EndsWith(".png", StringComparison.Ordinal) ? null : Encoding.UTF8.GetString(bytes),
                data = Convert.ToBase64String(bytes), sha256 = Hash(bytes) };
        }
    }
    public object PreviewRules(RuleFileRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            if (string.IsNullOrWhiteSpace(request.TaskId) || request.TaskId.Length > 100 || state.Applied.ContainsKey(request.TaskId)
                || request.Files == null || request.Files.Count is < 1 or > 256)
                throw new InvalidDataException("规则修改任务无效（每批1..256份文件）");
            var next = new Dictionary<string, byte[]>(state.Files, StringComparer.Ordinal);
            long total = 0;
            foreach (var (path, encoded) in request.Files)
            {
                if (!RulePath(path)) throw new InvalidDataException("不支持的规则资源: " + path);
                if (encoded == null) { next.Remove(path); continue; }
                if (encoded.Length > 6 * 1024 * 1024) throw new InvalidDataException("规则资源过大: " + path);
                byte[] bytes = Convert.FromBase64String(encoded);
                if (bytes.Length > 4 * 1024 * 1024 || (total += bytes.Length) > 20 * 1024 * 1024) throw new InvalidDataException("规则资源单份上限4 MiB，整批20 MiB");
                if (path.EndsWith(".json", StringComparison.Ordinal)) _ = JsonNode.Parse(bytes) ?? throw new InvalidDataException("JSON为空: " + path);
                if (path.EndsWith(".lua", StringComparison.Ordinal)) _ = new UTF8Encoding(false, true).GetString(bytes);
                if (path.EndsWith(".png", StringComparison.Ordinal)) _ = Raster.Decode(bytes);
                next[path] = bytes;
            }
            CheckState(state with { Files = next });
            PresentationResources.Synchronize(next, p => Read(next, p), BaseRead, Scenarios);
            SyncCatalogSources(next);
            CheckResources(next);
            ContentValidation.Check(baseline, p => Read(next, p), Scenarios, sourceHashes.Keys.Union(next.Keys).ToHashSet(StringComparer.Ordinal));
            CheckContent(next, Scenarios, true);
            var diffs = state.Files.Keys.Union(next.Keys).Select(path =>
            {
                byte[]? before = state.Files.GetValueOrDefault(path) ?? (sourceHashes.ContainsKey(path) ? BaseRead(path) : null);
                byte[]? after = next.GetValueOrDefault(path) ?? (sourceHashes.ContainsKey(path) ? BaseRead(path) : null);
                return new { path, before, after };
            }).Where(p => p.before == null || p.after == null || !p.before.AsSpan().SequenceEqual(p.after))
                .Select(p => new Diff(p.path, "rules", "sha256", p.before == null ? "(新增)" : Hash(p.before), p.after == null ? "(恢复基线/移除)" : Hash(p.after))).ToList();
            return StoreResourcePreview(request.Revision, request.TaskId, next, diffs, Scenarios.Length);
        }
    }
}
