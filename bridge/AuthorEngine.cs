using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using Ew4.Client;
using Ew4.Core;
using Ew4.Legacy;
using Ew4.Mods;

namespace Ew4.Editor;

public sealed record Selection(string? Country = null, string? Search = null, int[]? Ids = null,
    int? ArmyType = null, int? Commander = null, int[]? Cells = null, int? MapId = null);
public sealed record BatchRule(string Domain, string Field, string Operation, double Value, Selection Filter,
    string? TargetCountry = null, int? Center = null, string Rounding = "round", string? SkillId = null, int? SkillSlot = null, int SkillLevel = 1,
    ArmyDeployment? Deployment = null);
public sealed record BatchRequest(int Revision, string TaskId, string[] Scenarios, BatchRule[] Rules);
public sealed record ApplyRequest(int Revision, string TaskId, string Token);
public sealed record HistoryRequest(int Revision, string Direction);
public sealed record RestoreRequest(int Revision, string Document);
public sealed record ExportRequest(int Revision, string Id, string Name, string Version);
public sealed record CsvRequest(int Revision, string TaskId, Dictionary<string, string>[] Rows);
public sealed record ModImportRequest(int Revision, string TaskId, string Package, string Mode, string Conflict);
public sealed record Diff(string File, string Object, string Field, object Before, object After);
public sealed record SkillViewRecord(string Id, string Name, string Description);
public sealed record AuthorSource(string Id, string Name, string Version, string PackageHash, Dictionary<string, string> Files);
public sealed record AuthorSnapshot(Dictionary<string, byte[]> Files, string[]? Scenarios = null, AuthorSource[]? Sources = null);
public sealed record AuthorState(int Schema, string Id, string Baseline, int Revision,
    Dictionary<string, byte[]> Files, List<AuthorSnapshot> Undo, List<AuthorSnapshot> Redo,
    Dictionary<string, int> Applied, string[]? Scenarios = null, AuthorSource[]? Sources = null);
internal sealed record Pending(BatchRequest Request, string Token, AuthorSnapshot Snapshot, Diff[] Changes, string Fingerprint);

public sealed partial class AuthorEngine
{
    private readonly object gate = new();
    private readonly string home, data, stateFile, fingerprint;
    private readonly ModBase baseline;
    private readonly Dictionary<string, string> sourceHashes;
    private readonly Dictionary<string, byte[]> baseCache = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (ModManifest Manifest, Dictionary<string, byte[]> Files)> importCache = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Pending> pending = new(StringComparer.Ordinal);
    private AuthorState state;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private static readonly string[] CommanderFields = ["rank", "nobilityrank", "star", "infantry", "cavalry", "artillery", "warship", "fort", "business", "movement", "training", "skill1", "skill2", "skill3", "skill4", "item1", "item2"];
    private static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    private static byte[] Bytes<T>(T value) => JsonSerializer.SerializeToUtf8Bytes(value, Json);

    public AuthorEngine(string home)
    {
        this.home = home; data = Path.Combine(home, "rewrite/data"); stateFile = Path.Combine(home, "author.json");
        var manifest = JsonNode.Parse(File.ReadAllBytes(Path.Combine(home, "baseline.json")))!;
        sourceHashes = manifest["files"]!.AsObject().Where(p => p.Key.StartsWith("data/", StringComparison.Ordinal))
            .ToDictionary(p => p.Key[5..], p => p.Value!.GetValue<string>(), StringComparer.Ordinal);
        fingerprint = Hash(Bytes(sourceHashes));
        baseline = new ModBase(BaseRead, sourceHashes.Keys);
        state = File.Exists(stateFile) ? LoadState(File.ReadAllBytes(stateFile))
            : new(2, Guid.NewGuid().ToString("N"), fingerprint, 0, [], [], [], []);
        CheckState(state);
        CheckResources(state.Files);
    }
    private static AuthorState LoadState(byte[] bytes)
    {
        var document = ModFiles.Object(bytes);
        if ((int?)document["schema"] == 1)
        {
            foreach (string key in new[] { "undo", "redo" })
                if (document[key] is JsonArray history)
                    document[key] = new JsonArray(history.Select(files => (JsonNode)new JsonObject { ["files"] = files?.DeepClone() }).ToArray());
            document["schema"] = 2;
        }
        return document.Deserialize<AuthorState>(Json) ?? throw new InvalidDataException("工程为空");
    }
    private AuthorSnapshot Snapshot => new(state.Files, state.Scenarios, state.Sources);
    private string[] Scenarios => state.Scenarios ?? baseline.Scenarios;
    private byte[] BaseRead(string path)
    {
        if (!sourceHashes.TryGetValue(path, out var expected)) throw new FileNotFoundException("基础资源未登记: " + path);
        if (baseCache.TryGetValue(path, out var cached)) return cached;
        var bytes = File.ReadAllBytes(ModFiles.Under(data, path));
        if (Hash(bytes) != expected) throw new InvalidDataException("基础资源已变化，请重新建立基线: " + path);
        baseCache[path] = bytes; return bytes;
    }
    private byte[] Read(Dictionary<string, byte[]> files, string path) => files.TryGetValue(path, out var bytes) ? bytes : BaseRead(path);
    private ClientContent Content(Dictionary<string, byte[]> files, string[]? scenarios = null) => baseline.Content(p => Read(files, p), scenarios ?? Scenarios);
    private void Revision(int revision) { if (revision != state.Revision) throw new InvalidDataException("工程修订已变化，请重新预览"); }
    private void Persist(AuthorState next)
    {
        File.WriteAllBytes(stateFile + ".pending", Bytes(next));
        File.Move(stateFile + ".pending", stateFile, true);
        state = next; pending.Clear();
    }
    private void CheckState(AuthorState candidate)
    {
        if (candidate.Schema != 2 || candidate.Baseline != fingerprint || string.IsNullOrWhiteSpace(candidate.Id)
            || candidate.Files == null || candidate.Undo == null || candidate.Redo == null || candidate.Applied == null)
            throw new InvalidDataException("作者工程版本或基础资源不匹配");
        foreach (var snapshot in candidate.Undo.Concat(candidate.Redo).Append(new(candidate.Files, candidate.Scenarios, candidate.Sources)))
        {
            if (snapshot.Files == null) throw new InvalidDataException("工程历史缺少覆盖文件");
            foreach (var (path, bytes) in snapshot.Files)
                if (!ModFiles.RuntimePath(ModFiles.PathName(path)) || bytes == null)
                    throw new InvalidDataException("不支持的作者覆盖: " + path);
            var paths = sourceHashes.Keys.Union(snapshot.Files.Keys, StringComparer.Ordinal).ToArray();
            if (paths.Distinct(StringComparer.OrdinalIgnoreCase).Count() != paths.Length) throw new InvalidDataException("资源路径存在大小写冲突");
            if (snapshot.Scenarios is { } ids)
            {
                if (ids.Length is < 1 or > 1000 || ids.Distinct().Count() != ids.Length) throw new InvalidDataException("剧本清单无效");
                foreach (string id in ids) ScenarioPath(id);
            }
        }
    }
    private static string ScenarioPath(string id)
    {
        if (id.Length > 80 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '_')) throw new InvalidDataException("剧本ID无效");
        return "original/" + id + ".btl";
    }
    private string MapFile(int id, Dictionary<string, byte[]>? files = null) => "original/" + (string?)ModFiles.Xml(Read(files ?? state.Files, "original/def_map.xml")).Root!
        .Elements("map").Single(e => (int)e.Attribute("id")! == id).Attribute("file");
    public byte[] Terrain(int id) { lock (gate) return Read(state.Files, MapFile(id)); }
    public object Scenario(string id)
    {
        lock (gate)
        {
            if (!Scenarios.Contains(id)) throw new InvalidDataException("剧本不在当前工程中");
            var bytes = Read(state.Files, ScenarioPath(id)); var b = LegacyBattle.Read(bytes);
            var terrain = LegacyTerrainMap.Read(Read(state.Files, MapFile(b.MapId)));
            var countries = CountryCatalog.Load(p => Read(state.Files, p));
            return new { id, bytes = Convert.ToBase64String(b.ToLegacyBytes()), sha256 = Hash(bytes), b.MapId,
                factions = b.Factions.Select((f, i) => new { index = i, id = f.CountryId, f.Variant,
                    color = countries.Get(f.CountryId)?.Color is string color ? ScenarioFactions.PackedColor(color) : f.Color }),
                jurisdictions = b.Jurisdictions?.CellCenters,
                effectiveJurisdictions = b.Jurisdictions?.CellCenters ?? EffectiveJurisdictions(state.Files, b, id, terrain.Width), mapWidth = terrain.Width,
                extensions = ExtensionTags(bytes, b.LegacyLength), reverseReferences = BattleReferenceValidation.Build(b, terrain), state.Revision };
        }
    }
    public object Overview()
    {
        lock (gate)
        {
            var strings = LegacyCatalogConverter.Strings(Read(state.Files, "original/stringtable_cn.ini"));
            var catalog = ModFiles.Object(Read(state.Files, "legacy/catalog.json"));
            var content = Content(state.Files);
            var skillDefinitions = catalog["skills"]!.AsArray().Where(e => e != null)
                .ToDictionary(e => (string)e!["id"]!, e => e!, StringComparer.Ordinal);
            JsonObject? CommanderCatalog(string id) => catalog["commanders"]!.AsArray()
                .SingleOrDefault(e => (string?)e!["id"] == "ew4.commander." + id)?.AsObject();
            SkillViewRecord SkillView(string id) => content.Extensions.Bus.Skills.TryGetValue(id, out var extension)
                ? new(id, content.Label(string.IsNullOrWhiteSpace(extension.NameKey) ? id : extension.NameKey), content.Label(extension.DescriptionKey))
                : new(id, (string?)skillDefinitions.GetValueOrDefault(id)?["names"]?["zh_CN"] ?? id,
                    (string?)skillDefinitions.GetValueOrDefault(id)?["legacy_description"] ?? "");
            object[] EffectiveSkills(string id)
            {
                if (!int.TryParse(id, out int number) || !content.Catalogs.Runtime.Commanders.TryGetValue(number, out var runtime)) return [];
                var slots = runtime.Definition.SkillSlots.Count > 0 ? runtime.Definition.SkillSlots
                    : runtime.Definition.Skills.Select((skill, i) => new SkillSlot(skill, "legacy." + i)).ToArray();
                return slots.Select(slot => new { id = slot.Id, instanceId = slot.InstanceId, level = slot.Level, order = slot.Order,
                    name = SkillView(slot.Id).Name, description = SkillView(slot.Id).Description }).ToArray();
            }
            var commanders = ModFiles.Xml(Read(state.Files, "original/def_commander.xml")).Root!.Elements().Select(e =>
            {
                var row = e.Attributes().ToDictionary(a => a.Name.LocalName, a => (object?)a.Value);
                string id = (string)row["id"]!; var entry = CommanderCatalog(id);
                var original = Enumerable.Range(1, 4).Select(i => (string?)row["skill" + i]).Where(v => v is not null && int.Parse(v!) >= 0)
                    .Select(v => "ew4.skill." + v).Select(SkillView).ToArray();
                row["displayName"] = strings.GetValueOrDefault("name_" + (string)row["name"]!, (string)row["name"]!);
                row["originalSkills"] = original; row["effectiveSkills"] = EffectiveSkills(id);
                row["skillBinding"] = entry?["skill_slots"] != null || content.Extensions.CommanderBindings.Any(b => b.Target == "ew4.commander." + id); return row;
            }).ToArray();
            var names = new Dictionary<string, string>();
            foreach (var e in ModFiles.Xml(Read(state.Files, "original/def_battlelist.xml")).Root!.Elements())
            {
                string key = (string?)e.Attribute("name") ?? "";
                foreach (var a in new[] { "file", "file2" }) if (e.Attribute(a) is XAttribute file)
                    names[Path.GetFileNameWithoutExtension(file.Value)] = strings.GetValueOrDefault("title_" + key, key);
            }
            return new { state.Id, state.Revision, baseline = baseline.Revision, fingerprint, commanders,
                countries = CountryRows(), variants = catalog["variants"]!.AsObject().Select(p => p.Key).Order().ToArray(),
                commanderSourceHash = Hash(Read(state.Files, "original/def_commander.xml")),
                scenarios = Scenarios.Select(id => new { id, name = names.GetValueOrDefault(id, id), modified = state.Files.ContainsKey(ScenarioPath(id)) }),
                sources = state.Sources ?? [],
                overrides = state.Files.OrderBy(p => p.Key).Select(p => new { path = p.Key, hash = Hash(p.Value),
                    baselineHash = sourceHashes.GetValueOrDefault(p.Key),
                    source = (state.Sources ?? []).LastOrDefault(s => s.Files.ContainsKey(p.Key))?.Id,
                    edited = (state.Sources ?? []).LastOrDefault(s => s.Files.ContainsKey(p.Key)) is { } source && source.Files[p.Key] != Hash(p.Value) }),
                skills = skillDefinitions.Values.Select(s => (string)s["id"]!).Concat(content.Extensions.Bus.Skills.Keys)
                    .Distinct(StringComparer.Ordinal).Select(SkillView).ToArray(),
                files = state.Files.Keys.Order().ToArray(), canUndo = state.Undo.Count > 0, canRedo = state.Redo.Count > 0 };
        }
    }
    public object Preview(BatchRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            if (string.IsNullOrWhiteSpace(request.TaskId) || request.TaskId.Length > 100 || request.Rules.Length is < 1 or > 50
                || request.Scenarios.Length > 1000) throw new InvalidDataException("批量任务参数无效");
            if (state.Applied.ContainsKey(request.TaskId)) throw new InvalidDataException("任务已提交，请创建新任务");
            var next = new Dictionary<string, byte[]>(state.Files, StringComparer.Ordinal); var diffs = new List<Diff>();
            var slotMigrations = new List<ArmySlotMigration>();
            foreach (var (rule, ruleIndex) in request.Rules.Select((rule, index) => (rule, index)))
            {
                if (rule.Filter == null) throw new InvalidDataException("缺少筛选条件");
                if (rule.Domain == "armies" && rule.Operation == "append" && request.Scenarios.Length != 1)
                    throw new InvalidDataException("追加部署必须明确选择一个剧本");
                if (rule.Domain == "commanders" && rule.Field == "skillBinding") EditCommanderBindings(next, rule, diffs);
                else if (rule.Domain == "commanders") EditCommanders(next, rule, diffs);
                else
                {
                    if (request.Scenarios.Length == 0) throw new InvalidDataException("请选择剧本");
                    foreach (string id in request.Scenarios.Distinct())
                    {
                        if (!Scenarios.Contains(id)) throw new InvalidDataException("剧本不在当前工程中: " + id);
                        EditBattle(next, ScenarioPath(id), rule, diffs, slotMigrations, ruleIndex);
                    }
                }
            }
            if (diffs.Any(d => d.File == "original/def_commander.xml")) ConvertCommanders(next);
            PresentationResources.Synchronize(next, path => Read(next, path), BaseRead, Scenarios);
            SyncCatalogSources(next);
            CheckResources(next);
            bool commanderChanged = diffs.Any(d => d.File == "original/def_commander.xml" || d.File == "legacy/catalog.json" || d.File.StartsWith("rewrite/", StringComparison.Ordinal));
            string[] affected = commanderChanged ? Scenarios
                : diffs.Where(d => d.File.EndsWith(".btl", StringComparison.Ordinal)).Select(d => Path.GetFileNameWithoutExtension(d.File)).Distinct().ToArray();
            CheckContent(next, affected);
            string token = Guid.NewGuid().ToString("N");
            if (pending.Count >= 8) pending.Clear();
            pending[token] = new(request, token, Snapshot with { Files = next }, diffs.ToArray(), Hash(Bytes(Snapshot)));
            return new { token, request.TaskId, state.Revision, changes = diffs, count = diffs.Count,
                affectedScenarios = affected.Length, files = next.Keys.Except(state.Files.Keys).Union(diffs.Select(d => d.File)).ToArray(),
                slotMigrations, rounding = "显式取整，越界拒绝，未截断" };
        }
    }
    public object Apply(ApplyRequest request)
    {
        lock (gate)
        {
            if (state.Applied.TryGetValue(request.TaskId, out int appliedRevision)) return new { revision = state.Revision, appliedRevision, duplicate = true };
            Revision(request.Revision);
            if (!pending.TryGetValue(request.Token, out var p) || p.Request.TaskId != request.TaskId
                || p.Request.Revision != state.Revision || p.Fingerprint != Hash(Bytes(Snapshot))) throw new InvalidDataException("预览已过期");
            if (p.Changes.Length == 0) return new { revision = state.Revision, changes = 0 };
            var applied = new Dictionary<string, int>(state.Applied) { [request.TaskId] = state.Revision + 1 };
            Persist(state with { Revision = state.Revision + 1, Files = p.Snapshot.Files, Scenarios = p.Snapshot.Scenarios, Sources = p.Snapshot.Sources,
                Undo = state.Undo.Append(Snapshot).TakeLast(30).ToList(), Redo = [], Applied = applied });
            return new { state.Revision, changes = p.Changes.Length };
        }
    }
    public object PreviewCsv(CsvRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            if (string.IsNullOrWhiteSpace(request.TaskId) || state.Applied.ContainsKey(request.TaskId) || request.Rows.Length is < 1 or > 10000)
                throw new InvalidDataException("CSV任务或行数无效");
            var seen = new HashSet<int>(); var next = new Dictionary<string, byte[]>(state.Files); var diffs = new List<Diff>();
            const string path = "original/def_commander.xml";
            var xml = ModFiles.Xml(Read(next, path)); var byId = xml.Root!.Elements().ToDictionary(e => (int)e.Attribute("id")!);
            string hash = Hash(Read(next, path));
            var allowed = CommanderFields.Concat(["schema", "sourceHash", "id", "name", "country"]).ToHashSet(StringComparer.Ordinal);
            foreach (var row in request.Rows)
            {
                if (row.Keys.Any(k => !allowed.Contains(k))) throw new InvalidDataException("CSV存在未知列: " + string.Join(',', row.Keys.Except(allowed)));
                if (row.GetValueOrDefault("schema") != "1" || row.GetValueOrDefault("sourceHash") != hash)
                    throw new InvalidDataException("CSV源版本过期，请重新导出");
                if (!int.TryParse(row.GetValueOrDefault("id"), out int id) || !seen.Add(id) || !byId.TryGetValue(id, out var target))
                    throw new InvalidDataException("CSV将领ID重复或不存在: " + row.GetValueOrDefault("id"));
                foreach (string locked in new[] { "name", "country" })
                    if (row.TryGetValue(locked, out string? identity) && identity != (string?)target.Attribute(locked))
                        throw new InvalidDataException("CSV身份列不可修改: " + locked);
                foreach (string field in CommanderFields)
                {
                    if (!row.TryGetValue(field, out var text) || text.Length == 0) continue;
                    if (text == "~clear") text = field.StartsWith("skill", StringComparison.Ordinal) || field.StartsWith("item", StringComparison.Ordinal)
                        ? "-1" : throw new InvalidDataException("该字段不支持清空: " + field);
                    if (!int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out int value)) throw new InvalidDataException($"CSV {id}/{field} 必须是整数");
                    int before = (int)target.Attribute(field)!;
                    if (before == value) continue;
                    var rule = new BatchRule("commanders", field, "set", value, new());
                    var range = CommanderRange(field, ModFiles.Object(Read(next, "legacy/catalog.json")));
                    int after = Compute(before, rule, range.Min, range.Max);
                    target.SetAttributeValue(field, after); diffs.Add(new(path, "commander:" + id, field, before, after));
                }
            }
            if (diffs.Count > 0)
            {
                using var stream = new MemoryStream(); xml.Save(stream); next[path] = stream.ToArray(); ConvertCommanders(next);
                CheckContent(next, Scenarios);
            }
            SyncCatalogSources(next);
            CheckResources(next);
            string token = Guid.NewGuid().ToString("N"); if (pending.Count >= 8) pending.Clear();
            pending[token] = new(new(request.Revision, request.TaskId, [], []), token, Snapshot with { Files = next }, diffs.ToArray(), Hash(Bytes(Snapshot)));
            return new { token, request.TaskId, state.Revision, count = diffs.Count, changes = diffs, affectedScenarios = diffs.Count > 0 ? Scenarios.Length : 0 };
        }
    }
    public object History(HistoryRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            bool undo = request.Direction == "undo";
            if (!undo && request.Direction != "redo") throw new InvalidDataException("历史操作无效");
            var from = undo ? state.Undo : state.Redo; var to = undo ? state.Redo : state.Undo;
            if (from.Count == 0) throw new InvalidDataException("无可用历史");
            var remaining = from.Take(from.Count - 1).ToList(); var target = to.Append(Snapshot).ToList(); var snapshot = from[^1];
            Persist(state with { Revision = state.Revision + 1, Files = snapshot.Files, Scenarios = snapshot.Scenarios, Sources = snapshot.Sources,
                Undo = undo ? remaining : target, Redo = undo ? target : remaining });
            return new { state.Revision };
        }
    }
    public byte[] AuthorBytes() { lock (gate) return Bytes(state); }
    public object Restore(RestoreRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            var candidate = LoadState(Encoding.UTF8.GetBytes(request.Document));
            string[] candidateScenarios = candidate.Scenarios ?? baseline.Scenarios;
            if (candidate.Files.TryGetValue("original/def_commander.xml", out var commander)
                && !commander.AsSpan().SequenceEqual(BaseRead("original/def_commander.xml")))
                ConvertCommanders(candidate.Files);
            PresentationResources.Synchronize(candidate.Files, path => Read(candidate.Files, path), BaseRead, candidateScenarios);
            SyncCatalogSources(candidate.Files);
            CheckState(candidate); CheckResources(candidate.Files);
            CheckContent(candidate.Files, candidateScenarios, scenarios: candidateScenarios);
            Persist(candidate with { Revision = state.Revision + 1, Undo = state.Undo.Append(Snapshot).TakeLast(30).ToList(), Redo = [],
                Applied = state.Applied.Concat(candidate.Applied).GroupBy(p => p.Key).ToDictionary(g => g.Key, g => g.Last().Value) });
            return new { state.Revision };
        }
    }
    private void CheckContent(Dictionary<string, byte[]> files, IEnumerable<string> ids, bool allCountries = false, string[]? scenarios = null)
    {
        var content = Content(files, scenarios);
        foreach (string id in ids)
        {
            var battle = content.Battle(id); var choice = content.Scenarios.Single(s => s.Id == id);
            if (choice.Mode == 3) continue;
            // Each playable faction is validated, not only the first faction in a conquest.
            if (choice.Mode == 2)
                foreach (string country in battle.Factions.Where(f => f.Camp != 4).Select(f => f.CountryId).Take(allCountries ? int.MaxValue : 1)) content.Start(id, country);
            else content.Start(id, null);
        }
    }
    public object Validate()
    {
        lock (gate) { CheckResources(state.Files); CheckContent(state.Files, Scenarios, true); return new { valid = true, scenarios = Scenarios.Length, state.Revision }; }
    }
    public byte[] Export(ExportRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision); ModFiles.Identifier(request.Id);
            if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Version)) throw new InvalidDataException("请填写名称和版本");
            string job = Path.Combine(home, "exports", Guid.NewGuid().ToString("N")); string author = Path.Combine(job, "author");
            Directory.CreateDirectory(author);
            var prepared = PrepareExport();
            foreach (var (path, bytes) in prepared) ModFiles.Write(author, path, bytes);
            ProjectResourceValidation.Check(path => Read(prepared, path), baseline.Files.Union(prepared.Keys).ToHashSet(StringComparer.Ordinal));
            var store = new ModStore(baseline, Path.Combine(job, "mods"), Path.Combine(job, "preview-saves"));
            store.Seal(author, request.Id, request.Name, request.Version, Scenarios); store.Validate(author);
            var imported = store.Import(author, request.Id, request.Name);
            string package = Path.Combine(job, request.Id + ".ew4mod"); store.Export(imported.Key, package);
            return File.ReadAllBytes(package);
        }
    }
    private Dictionary<string, byte[]> PrepareExport()
    {
        var prepared = new Dictionary<string, byte[]>(state.Files, StringComparer.Ordinal);
        PresentationResources.Synchronize(prepared, path => Read(prepared, path), BaseRead, Scenarios);
        SyncCatalogSources(prepared);
        CheckResources(prepared);
        return prepared;
    }
    private void CheckResources(Dictionary<string, byte[]> files) =>
        ProjectResourceValidation.Check(path => Read(files, path), sourceHashes.Keys.Union(files.Keys).ToHashSet(StringComparer.Ordinal));
    private void SyncCatalogSources(Dictionary<string, byte[]> files)
    {
        const string path = "legacy/catalog.json";
        var catalog = ModFiles.Object(Read(files, path));
        var hashes = catalog["source_sha256"]?.AsObject() ?? throw new InvalidDataException("运行目录缺少源哈希");
        var trees = catalog["source_trees"]?.AsObject() ?? throw new InvalidDataException("运行目录缺少源树");
        bool changed = false;
        foreach (string source in LegacyCatalogConverter.Sources)
        {
            string sourcePath = "original/" + source;
            string hash = Hash(Read(files, sourcePath));
            if ((string?)hashes[source] == hash) continue;
            hashes[source] = hash; changed = true;
            if (source.EndsWith(".xml", StringComparison.Ordinal))
                trees[source] = LegacyCatalogConverter.Tree(ModFiles.Xml(Read(files, sourcePath)).Root!);
        }
        if (changed) files[path] = Bytes(catalog);
    }
    private static int Compute(int before, BatchRule rule, int min, int max)
    {
        double value = rule.Operation switch { "set" => rule.Value, "add" => before + rule.Value, "multiply" => before * rule.Value,
            _ => throw new InvalidDataException("未知运算") };
        value = rule.Rounding switch { "round" => Math.Round(value, MidpointRounding.AwayFromZero), "floor" => Math.Floor(value),
            "ceil" => Math.Ceiling(value), _ => throw new InvalidDataException("请选择取整方式") };
        if (!double.IsFinite(value) || value < min || value > max) throw new InvalidDataException($"{rule.Field} 结果 {value} 越界 [{min}, {max}]");
        return (int)value;
    }
    private void EditCommanderBindings(Dictionary<string, byte[]> next, BatchRule rule, List<Diff> diffs)
    {
        if (string.IsNullOrWhiteSpace(rule.SkillId) || rule.SkillSlot is < 0 or > 15 || rule.SkillLevel is < 1 or > 99)
            throw new InvalidDataException("技能绑定参数无效");
        string? registeredPath = CommanderBindingsPath(next);
        if (registeredPath == null)
        {
            EditLegacyCommanderBindings(next, rule, diffs);
            return;
        }
        string path = registeredPath;
        var bindings = JsonNode.Parse(Read(next, path))?.AsArray() ?? throw new InvalidDataException("将领技能绑定文件必须是数组");
        var catalog = ModFiles.Object(Read(next, "legacy/catalog.json"));
        var skills = catalog["skills"]!.AsArray().Where(s => s != null).Select(s => (string)s!["id"]!)
            .Concat(Content(next).Extensions.Bus.Skills.Keys).ToHashSet(StringComparer.Ordinal);
        if (!skills.Contains(rule.SkillId)) throw new InvalidDataException("技能未注册: " + rule.SkillId);
        var selected = rule.Filter.Ids?.ToHashSet() ?? [];
        var content = Content(next);
        foreach (var entry in catalog["commanders"]!.AsArray().Where(e => e != null))
        {
            var idText = (string)entry!["legacy_attributes"]!["id"]!;
            if (!int.TryParse(idText, out int id) || selected.Count > 0 && !selected.Contains(id)
                || !MatchCountry(rule.Filter, (string?)entry["legacy_attributes"]!["country"])) continue;
            int slot = rule.SkillSlot ?? throw new InvalidDataException("技能槽位缺失");
            if (!content.Catalogs.Runtime.Commanders.TryGetValue(id, out var runtime)) continue;
            var slots = runtime.Definition.SkillSlots.Count > 0 ? runtime.Definition.SkillSlots.ToList()
                : runtime.Definition.Skills.Select((skill, i) => new SkillSlot(skill, "legacy." + i, 1, i)).ToList();
            var before = slots.Select(s => s.Id).ToArray();
            if (rule.Operation == "remove")
            {
                if (slot >= slots.Count) continue;
                slots.RemoveAt(slot);
            }
            else if (rule.Operation == "set")
            {
                while (slots.Count <= slot) slots.Add(new SkillSlot(rule.SkillId, "binding." + id + "." + slots.Count, rule.SkillLevel, slots.Count));
                slots[slot] = slots[slot] with { Id = rule.SkillId, Level = rule.SkillLevel, Order = slot };
            }
            else throw new InvalidDataException("绑定操作无效");
            slots = slots.Select((s, i) => s with { Order = i }).ToList();
            var after = slots.Select(s => s.Id).ToArray();
            if (before.SequenceEqual(after)) continue;
            var target = "ew4.commander." + id;
            bindings.Add(new JsonObject { ["target"] = target, ["mode"] = "replace", ["skills"] = JsonSerializer.SerializeToNode(slots, Json) });
            diffs.Add(new(path, "commander:" + id, "skillBinding", string.Join(',', before), string.Join(',', after)));
        }
        if (diffs.Any(d => d.File == path)) next[path] = Encoding.UTF8.GetBytes(bindings.ToJsonString(Json));
    }
    private void EditLegacyCommanderBindings(Dictionary<string, byte[]> next, BatchRule rule, List<Diff> diffs)
    {
        string path = "legacy/catalog.json"; var catalog = ModFiles.Object(Read(next, path));
        var skills = catalog["skills"]!.AsArray().Where(s => s != null).Select(s => (string)s!["id"]!).ToHashSet(StringComparer.Ordinal);
        if (!skills.Contains(rule.SkillId!)) throw new InvalidDataException("技能未注册: " + rule.SkillId);
        var selected = rule.Filter.Ids?.ToHashSet() ?? [];
        foreach (var entry in catalog["commanders"]!.AsArray().Where(e => e != null))
        {
            var idText = (string)entry!["legacy_attributes"]!["id"]!;
            if (!int.TryParse(idText, out int id) || selected.Count > 0 && !selected.Contains(id)
                || !MatchCountry(rule.Filter, (string?)entry["legacy_attributes"]!["country"])) continue;
            var slots = entry["skill_slots"] is JsonArray existing
                ? existing.Select(s => s!.DeepClone()).ToList()
                : entry["skills"]!.AsArray().Select((s, i) => (JsonNode)new JsonObject { ["id"] = (string)s!, ["instanceId"] = "legacy." + i, ["level"] = 1, ["order"] = i }).ToList();
            int slot = rule.SkillSlot!.Value;
            var before = slots.Select(s => (string?)s!["id"] ?? "").ToArray();
            if (rule.Operation == "remove") { if (slot < slots.Count) slots.RemoveAt(slot); }
            else
            {
                while (slots.Count <= slot) slots.Add(new JsonObject { ["id"] = rule.SkillId, ["instanceId"] = "binding." + slots.Count, ["level"] = rule.SkillLevel, ["order"] = slots.Count });
                var current = slots[slot]!.AsObject(); current["id"] = rule.SkillId; current["level"] = rule.SkillLevel; current["order"] = slot;
            }
            var after = slots.Select(s => (string?)s!["id"] ?? "").ToArray();
            if (before.SequenceEqual(after)) continue;
            entry["skill_slots"] = new JsonArray(slots.ToArray()); entry["skills"] = new JsonArray(after.Select(s => (JsonNode)JsonValue.Create(s)!).ToArray());
            diffs.Add(new(path, "commander:" + id, "skillBinding", string.Join(',', before), string.Join(',', after)));
        }
        if (diffs.Any(d => d.File == path)) next[path] = Bytes(catalog);
    }
    private string? CommanderBindingsPath(Dictionary<string, byte[]> files)
    {
        JsonObject extension;
        try { extension = ModFiles.Object(Read(files, "rewrite/extension.json")); }
        catch (FileNotFoundException) { return null; }
        string? path = (string?)extension["commanderBindings"];
        if (path == null) return null;
        if (!ExtensionLoader.PathValid(path) || !path.EndsWith(".json", StringComparison.Ordinal))
            throw new InvalidDataException("将领技能绑定路径无效");
        return path;
    }
    private void EditCommanders(Dictionary<string, byte[]> next, BatchRule rule, List<Diff> diffs)
    {
        string path = "original/def_commander.xml"; var xml = ModFiles.Xml(Read(next, path));
        if (!CommanderFields.Contains(rule.Field)) throw new InvalidDataException("将领字段不在首版支持范围");
        var catalog = ModFiles.Object(Read(next, "legacy/catalog.json"));
        var range = CommanderRange(rule.Field, catalog);
        foreach (var row in xml.Root!.Elements())
        {
            int id = (int)row.Attribute("id")!;
            if (rule.Filter.Ids?.Contains(id) == false || !MatchCountry(rule.Filter, (string?)row.Attribute("country"))
                || rule.Filter.Search is { Length: > 0 } search && !row.ToString().Contains(search, StringComparison.OrdinalIgnoreCase)) continue;
            int before = (int)row.Attribute(rule.Field)!;
            int after = Compute(before, rule, range.Min, range.Max);
            if (before == after) continue;
            row.SetAttributeValue(rule.Field, after);
            diffs.Add(new(path, "commander:" + id, rule.Field, before, after));
        }
        if (diffs.Any(d => d.File == path)) { using var stream = new MemoryStream(); xml.Save(stream); next[path] = stream.ToArray(); }
    }
    private static (int Min, int Max) CommanderRange(string field, JsonObject catalog) =>
        (field.StartsWith("skill", StringComparison.Ordinal) || field.StartsWith("item", StringComparison.Ordinal) ? -1 : 0,
         field switch { "rank" => catalog["native_tables"]!["commander_rank_health_bonus"]!.AsArray().Count - 1,
             "nobilityrank" => catalog["native_tables"]!["commander_nobility_healing"]!.AsArray().Count - 1,
             _ when field.StartsWith("skill", StringComparison.Ordinal) => 39, _ => 32767 });
    private void ConvertCommanders(Dictionary<string, byte[]> next)
    {
        var current = ModFiles.Object(Read(next, "legacy/catalog.json"));
        var converted = LegacyCatalogConverter.Convert(name => Read(next, "original/" + name), current);
        var oldCommanders = current["commanders"]!.AsArray().ToDictionary(e => (string)e!["id"]!, e => e!);
        foreach (var entry in converted["commanders"]!.AsArray())
        {
            var old = oldCommanders[(string)entry!["id"]!];
            foreach (var extra in old.AsObject().Where(p => p.Key is not ("id" or "legacy_attributes" or "skills"))) entry[extra.Key] = extra.Value?.DeepClone();
            bool nativeSkillsChanged = Enumerable.Range(1, 4).Any(i => (string?)entry["legacy_attributes"]!["skill" + i] != (string?)old["legacy_attributes"]!["skill" + i]);
            if (!nativeSkillsChanged) entry["skills"] = old["skills"]!.DeepClone();
            else if (old["skill_slots"] != null) throw new InvalidDataException("运行目录存在自定义技能槽，请通过扩展绑定编辑，避免覆盖");
        }
        // Only replace commander-dependent sections. Preserve unrelated runtime overrides.
        foreach (string field in new[] { "commanders" }) current[field] = converted[field]!.DeepClone();
        current["source_sha256"]!["def_commander.xml"] = converted["source_sha256"]!["def_commander.xml"]!.DeepClone();
        current["source_trees"]!["def_commander.xml"] = converted["source_trees"]!["def_commander.xml"]!.DeepClone();
        next["legacy/catalog.json"] = Bytes(current);
    }
    private static bool MatchCountry(Selection filter, string? country) => string.IsNullOrWhiteSpace(filter.Country) || filter.Country == country;
    private static string[] ExtensionTags(byte[] bytes, int bodyLength)
    {
        if (bodyLength == bytes.Length) return [];
        var result = new List<string>(); int cursor = bodyLength + 16;
        while (cursor < bytes.Length) { result.Add(Encoding.ASCII.GetString(bytes, cursor, 4)); cursor += checked(16 + BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(cursor + 12))); }
        return result.ToArray();
    }
    private int[] EffectiveJurisdictions(Dictionary<string, byte[]> files, LegacyBattle battle, string id, int mapWidth)
    {
        var content = Content(files); var choice = content.Scenarios.Single(s => s.Id == id);
        if (choice.Mode is not (1 or 2)) return Enumerable.Repeat(-1, battle.Width * battle.Height).ToArray();
        var world = content.Start(id, choice.Mode == 2 ? battle.Factions.First(f => f.Camp != 4).CountryId : null).Session.World;
        var effective = world.Jurisdictions ?? TerritorialJurisdictions.Create(world);
        return Enumerable.Range(0, battle.Width * battle.Height).Select(i => effective.CellCenters[(battle.Top + i / battle.Width) * mapWidth + battle.Left + i % battle.Width]).ToArray();
    }
    private void EditBattle(Dictionary<string, byte[]> next, string path, BatchRule rule, List<Diff> diffs,
        List<ArmySlotMigration> slotMigrations, int ruleIndex)
    {
        byte[] original = Read(next, path); var battle = LegacyBattle.Read(original); var body = battle.ToLegacyBytes();
        if (rule.Filter.Cells != null && rule.Filter.MapId != battle.MapId) throw new InvalidDataException("选区底图不匹配，跨地图选区规则必须分别配置");
        var terrain = LegacyTerrainMap.Read(Read(next, MapFile(battle.MapId, next)));
        var ownership = battle.Sections.Single(s => s.Name == "ownership");
        int Local(int cell) => cell < 0 ? -1 : (cell / terrain.Width - battle.Top) * battle.Width + cell % terrain.Width - battle.Left;
        bool CellSelected(int cell)
        {
            int x = cell % terrain.Width, y = cell / terrain.Width;
            if (cell < 0 || x < battle.Left || x >= battle.Left + battle.Width || y < battle.Top || y >= battle.Top + battle.Height) return false;
            int owner = body[ownership.Offset + Local(cell)];
            return (rule.Filter.Cells == null || rule.Filter.Cells.Contains(cell))
                && MatchCountry(rule.Filter, owner < battle.Factions.Count ? battle.Factions[owner].CountryId : null);
        }
        void Patch(string obj, int offset, int size, int min, int max)
        {
            int before = size switch { 1 => body[offset], 2 => BinaryPrimitives.ReadInt16LittleEndian(body.AsSpan(offset)), _ => BinaryPrimitives.ReadInt32LittleEndian(body.AsSpan(offset)) };
            int after = Compute(before, rule, min, max); if (before == after) return;
            if (size == 1) body[offset] = checked((byte)after);
            else if (size == 2) BinaryPrimitives.WriteInt16LittleEndian(body.AsSpan(offset), checked((short)after));
            else BinaryPrimitives.WriteInt32LittleEndian(body.AsSpan(offset), after);
            diffs.Add(new(path, obj, rule.Field, before, after));
        }
        int initial = diffs.Count;
        LegacyJurisdictionData? juri = battle.Jurisdictions;
        if (rule.Domain == "factions")
        {
            var fields = new Dictionary<string, int> { ["price"] = 0, ["industry"] = 4, ["food"] = 8, ["isNPC"] = 12, ["camp"] = 16 };
            if (!fields.TryGetValue(rule.Field, out int offset)) throw new InvalidDataException("不支持的国家字段");
            for (int i = 0; i < battle.Factions.Count; i++)
                if (MatchCountry(rule.Filter, battle.Factions[i].CountryId)) Patch("faction:" + battle.Factions[i].CountryId, 72 + i * 180 + offset, 4, 0, rule.Field == "camp" ? 4 : rule.Field == "isNPC" ? 1 : int.MaxValue);
        }
        else if (rule.Domain == "armies" && rule.Operation is "delete" or "append")
        {
            RequireArmyStructuralDependencies(next);
            if (rule.Operation == "append")
            {
                if (rule.Field != "record" || rule.Value != 0 || rule.Deployment is not { } deployment
                    || rule.Filter.MapId != battle.MapId || rule.Filter.Cells is not { Length: 1 } cells || cells[0] != deployment.Cell
                    || rule.Filter.Ids != null || rule.Filter.Search != null || rule.Filter.ArmyType != null || rule.Filter.Commander != null)
                    throw new InvalidDataException("追加部署要求 field=record、value=0、deployment 及同底图的单一目标 cell，不接受部队筛选");
                if (!CellSelected(deployment.Cell)) throw new InvalidDataException("部署 cell 不符合当前国家筛选条件");
                var added = ArmyStructuralEdit.Append(original, Path.GetFileNameWithoutExtension(path), deployment, Content(next));
                diffs.Add(new(path, "army:" + added.Slot + "@" + deployment.Cell, "record", "absent", added.Army));
                slotMigrations.Add(new(path, ruleIndex, Enumerable.Range(0, battle.Armies.Count).Select(i => (int?)i).ToArray()));
                next[path] = added.Bytes;
                return;
            }
            if (rule.Field != "record" || rule.Value != 0 || rule.Filter.Ids is not { Length: > 0 } ids
                || ids.Distinct().Count() != ids.Length || ids.Any(i => i < 0 || i >= battle.Armies.Count))
                throw new InvalidDataException("结构删除要求 field=record、value=0 和明确有效的非重复部队槽位");
            if (rule.Filter.Search != null) throw new InvalidDataException("结构删除不支持文本筛选");
            if (ids.Any(i => !CellSelected(battle.Armies[i].Cell)
                || rule.Filter.ArmyType is int type && battle.Armies[i].Unit != type
                || rule.Filter.Commander is int commander && battle.Armies[i].Commander != commander))
                throw new InvalidDataException("待删除部队不符合当前筛选条件");
            var deleted = ArmyStructuralEdit.Delete(original, Path.GetFileNameWithoutExtension(path), ids);
            foreach (int slot in ids.Order())
                diffs.Add(new(path, "army:" + slot + "@" + battle.Armies[slot].Cell, "record", slot, "deleted"));
            slotMigrations.Add(new(path, ruleIndex, deleted.OldToNew));
            next[path] = deleted.Bytes;
            return;
        }
        else if (rule.Domain == "armies" || rule.Domain == "builds")
        {
            bool army = rule.Domain == "armies";
            var fields = army ? new Dictionary<string, (int Offset, int Size, int Min, int Max)> {
                ["armyType"] = (2,1,0,20), ["armyGrade"] = (3,1,0,2), ["strengthNow"] = (4,2,1,32767), ["strengthMax"] = (6,2,1,32767),
                ["training"] = (12,1,0,127), ["movement"] = (13,1,0,127), ["morale"] = (14,1,0,127), ["commander"] = (16,2,-1,32767) }
                : new Dictionary<string, (int Offset, int Size, int Min, int Max)> {
                ["areaName"] = (2,2,0,32767), ["constructionType"] = (4,1,0,255), ["constructionLevel"] = (5,1,0,255),
                ["constructionStyle"] = (7,1,0,255), ["capitalStyle"] = (8,1,0,127), ["installationType"] = (9,1,0,127), ["strongPoint"] = (10,1,0,255) };
            if (!fields.TryGetValue(rule.Field, out var spec)) throw new InvalidDataException("不支持的部队/城市字段");
            var section = battle.Sections.Single(s => s.Name == (army ? "armies" : "sites"));
            for (int i = 0; i < section.Count; i++)
            {
                int offset = section.Offset + i * section.Stride; int cell = BinaryPrimitives.ReadInt16LittleEndian(body.AsSpan(offset));
                if (!CellSelected(cell) || rule.Filter.Ids?.Contains(i) == false) continue;
                if (army && (rule.Filter.ArmyType is int type && battle.Armies[i].Unit != type
                    || rule.Filter.Commander is int commander && battle.Armies[i].Commander != commander)) continue;
                Patch((army ? "army:" : "build:") + i + "@" + cell, offset + spec.Offset, spec.Size, spec.Min, spec.Max);
            }
        }
        else if (rule.Domain is "territory" or "jurisdictions")
        {
            if (rule.Operation != "set") throw new InvalidDataException("领土/辖区仅支持赋值");
            int target = rule.Domain == "territory" ? battle.Factions.ToList().FindIndex(f => f.CountryId == rule.TargetCountry) : -1;
            if (rule.Domain == "territory" && target < 0) throw new InvalidDataException("目标国家不在该剧本中: " + rule.TargetCountry);
            int[] centers;
            if (juri != null) centers = juri.CellCenters.ToArray();
            else if (rule.Domain == "jurisdictions")
            {
                centers = EffectiveJurisdictions(next, battle, Path.GetFileNameWithoutExtension(path), terrain.Width);
            }
            else centers = [];
            if (rule.Domain == "jurisdictions" && rule.Center == null) throw new InvalidDataException("缺少辖区中心");
            for (int y = 0; y < battle.Height; y++) for (int x = 0; x < battle.Width; x++)
            {
                int local = y * battle.Width + x, cell = (y + battle.Top) * terrain.Width + x + battle.Left;
                if (!CellSelected(cell)) continue;
                int before = rule.Domain == "territory" ? body[ownership.Offset + local] : centers[local];
                int after = rule.Domain == "territory" ? target : rule.Center!.Value;
                if (before == after) continue;
                if (rule.Domain == "territory") body[ownership.Offset + local] = checked((byte)target); else centers[local] = after;
                diffs.Add(new(path, "cell:" + cell, rule.Domain, before, after));
            }
            if (rule.Domain == "jurisdictions" && diffs.Count != initial)
            {
                if (juri == null) diffs.Add(new(path, "JURI", "initialization", "引擎自动划分", "固定当前有效辖区，再应用选区修改"));
                juri = new(1, battle.MapId, terrain.Width, terrain.Height, battle.Left, battle.Top, battle.Width, battle.Height, Hash(body), centers);
            }
        }
        else throw new InvalidDataException("未知编辑对象: " + rule.Domain);
        if (diffs.Count == initial) return;
        bool bodyChanged = !body.AsSpan().SequenceEqual(original.AsSpan(0, battle.LegacyLength));
        var tags = ExtensionTags(original, battle.LegacyLength);
        if (tags.Any(t => t is not ("JURI" or "CNTR" or "VICT"))) throw new InvalidDataException("存在未知扩展块，拒绝修改: " + path);
        if (!bodyChanged)
        {
            next[path] = juri != null ? battle.WithJurisdictions(juri) : original; return;
        }
        // Record counts and coordinates are stable in this first release. Rebuild understood bindings.
        byte[] output = body;
        if (battle.CountryIds != null) output = LegacyBattle.Read(output).WithCountryIds(battle.CountryIds with { BaseSha256 = Hash(body) });
        if (juri != null) output = LegacyBattle.Read(output).WithJurisdictions(juri with { BaseSha256 = Hash(body) });
        if (battle.Victory != null) output = LegacyBattle.Read(output).WithVictory(battle.Victory);
        LegacyBattle.Read(output); next[path] = output;
    }

    private void RequireArmyStructuralDependencies(Dictionary<string, byte[]> next)
    {
        if (!next.ContainsKey("rewrite/extension.json") && !sourceHashes.ContainsKey("rewrite/extension.json")) return;
        var manifest = JsonNode.Parse(Read(next, "rewrite/extension.json"), new JsonNodeOptions { PropertyNameCaseInsensitive = true })!.AsObject();
        var extensions = Content(next).Extensions;
        if (manifest["victoryRules"] != null || manifest["scenarioEvents"] != null
            || manifest["scripts"] is JsonArray scripts && scripts.Count > 0
            || extensions.Bus.Skills.Values.SelectMany(s => s.Effects)
                .Concat(extensions.Bus.Statuses.Values.SelectMany(s => s.Effects)).Any(e => e.Script != null))
            throw new InvalidDataException("外部胜负、剧情事件或脚本尚不支持部队槽位迁移或追加");
    }
}
