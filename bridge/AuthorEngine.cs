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
    string? TargetCountry = null, int? Center = null, string Rounding = "round");
public sealed record BatchRequest(int Revision, string TaskId, string[] Scenarios, BatchRule[] Rules);
public sealed record ApplyRequest(int Revision, string TaskId, string Token);
public sealed record HistoryRequest(int Revision, string Direction);
public sealed record RestoreRequest(int Revision, string Document);
public sealed record ExportRequest(int Revision, string Id, string Name, string Version);
public sealed record CsvRequest(int Revision, string TaskId, Dictionary<string, string>[] Rows);
public sealed record Diff(string File, string Object, string Field, object Before, object After);
public sealed record AuthorState(int Schema, string Id, string Baseline, int Revision,
    Dictionary<string, byte[]> Files, List<Dictionary<string, byte[]>> Undo, List<Dictionary<string, byte[]>> Redo,
    Dictionary<string, int> Applied);
internal sealed record Pending(BatchRequest Request, string Token, Dictionary<string, byte[]> Files, Diff[] Changes, string Fingerprint);

public sealed class AuthorEngine
{
    private readonly object gate = new();
    private readonly string home, data, stateFile, fingerprint;
    private readonly ModBase baseline;
    private readonly Dictionary<string, string> sourceHashes;
    private readonly Dictionary<string, byte[]> baseCache = new(StringComparer.Ordinal);
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
        state = File.Exists(stateFile) ? JsonSerializer.Deserialize<AuthorState>(File.ReadAllBytes(stateFile), Json)!
            : new(1, Guid.NewGuid().ToString("N"), fingerprint, 0, [], [], [], []);
        CheckState(state);
    }
    private byte[] BaseRead(string path)
    {
        if (!sourceHashes.TryGetValue(path, out var expected)) throw new FileNotFoundException("基础资源未登记: " + path);
        if (baseCache.TryGetValue(path, out var cached)) return cached;
        var bytes = File.ReadAllBytes(ModFiles.Under(data, path));
        if (Hash(bytes) != expected) throw new InvalidDataException("基础资源已变化，请重新建立基线: " + path);
        baseCache[path] = bytes; return bytes;
    }
    private byte[] Read(Dictionary<string, byte[]> files, string path) => files.TryGetValue(path, out var bytes) ? bytes : BaseRead(path);
    private ClientContent Content(Dictionary<string, byte[]> files) => baseline.Content(p => Read(files, p), baseline.Scenarios);
    private void Revision(int revision) { if (revision != state.Revision) throw new InvalidDataException("工程修订已变化，请重新预览"); }
    private void Persist(AuthorState next)
    {
        File.WriteAllBytes(stateFile + ".pending", Bytes(next));
        File.Move(stateFile + ".pending", stateFile, true);
        state = next; pending.Clear();
    }
    private void CheckState(AuthorState candidate)
    {
        if (candidate.Schema != 1 || candidate.Baseline != fingerprint || string.IsNullOrWhiteSpace(candidate.Id)
            || candidate.Files == null || candidate.Undo == null || candidate.Redo == null || candidate.Applied == null)
            throw new InvalidDataException("作者工程版本或基础资源不匹配");
        foreach (var files in candidate.Undo.Concat(candidate.Redo).Append(candidate.Files))
            foreach (var (path, bytes) in files)
                if (!ModFiles.RuntimePath(ModFiles.PathName(path)) || !sourceHashes.ContainsKey(path) || bytes == null)
                    throw new InvalidDataException("不支持的作者覆盖: " + path);
    }
    private static string ScenarioPath(string id)
    {
        if (id.Length > 80 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '_')) throw new InvalidDataException("剧本ID无效");
        return "original/" + id + ".btl";
    }
    private string MapFile(int id) => "original/" + (string?)ModFiles.Xml(BaseRead("original/def_map.xml")).Root!
        .Elements("map").Single(e => (int)e.Attribute("id")! == id).Attribute("file");
    public byte[] Terrain(int id) { lock (gate) return Read(state.Files, MapFile(id)); }
    public object Scenario(string id)
    {
        lock (gate)
        {
            var bytes = Read(state.Files, ScenarioPath(id)); var b = LegacyBattle.Read(bytes);
            var terrain = LegacyTerrainMap.Read(Read(state.Files, MapFile(b.MapId)));
            return new { id, bytes = Convert.ToBase64String(b.ToLegacyBytes()), sha256 = Hash(bytes), b.MapId,
                factions = b.Factions.Select((f, i) => new { index = i, id = f.CountryId, f.Variant }),
                jurisdictions = b.Jurisdictions?.CellCenters,
                effectiveJurisdictions = b.Jurisdictions?.CellCenters ?? EffectiveJurisdictions(state.Files, b, id, terrain.Width), mapWidth = terrain.Width,
                extensions = ExtensionTags(bytes, b.LegacyLength), state.Revision };
        }
    }
    public object Overview()
    {
        lock (gate)
        {
            var strings = LegacyCatalogConverter.Strings(Read(state.Files, "original/stringtable_cn.ini"));
            var commanders = ModFiles.Xml(Read(state.Files, "original/def_commander.xml")).Root!.Elements().Select(e =>
            {
                var row = e.Attributes().ToDictionary(a => a.Name.LocalName, a => a.Value);
                row["displayName"] = strings.GetValueOrDefault("name_" + row["name"], row["name"]); return row;
            }).ToArray();
            var names = new Dictionary<string, string>();
            foreach (var e in ModFiles.Xml(Read(state.Files, "original/def_battlelist.xml")).Root!.Elements())
            {
                string key = (string?)e.Attribute("name") ?? "";
                foreach (var a in new[] { "file", "file2" }) if (e.Attribute(a) is XAttribute file)
                    names[Path.GetFileNameWithoutExtension(file.Value)] = strings.GetValueOrDefault("title_" + key, key);
            }
            return new { state.Id, state.Revision, baseline = baseline.Revision, fingerprint, commanders,
                commanderSourceHash = Hash(Read(state.Files, "original/def_commander.xml")),
                scenarios = baseline.Scenarios.Select(id => new { id, name = names.GetValueOrDefault(id, id), modified = state.Files.ContainsKey(ScenarioPath(id)) }),
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
            foreach (var rule in request.Rules)
            {
                if (rule.Filter == null) throw new InvalidDataException("缺少筛选条件");
                if (rule.Domain == "commanders") EditCommanders(next, rule, diffs);
                else
                {
                    if (request.Scenarios.Length == 0) throw new InvalidDataException("请选择剧本");
                    foreach (string id in request.Scenarios.Distinct()) EditBattle(next, ScenarioPath(id), rule, diffs);
                }
            }
            if (diffs.Any(d => d.File == "original/def_commander.xml")) ConvertCommanders(next);
            string[] affected = diffs.Any(d => d.File == "original/def_commander.xml") ? baseline.Scenarios
                : diffs.Where(d => d.File.EndsWith(".btl", StringComparison.Ordinal)).Select(d => Path.GetFileNameWithoutExtension(d.File)).Distinct().ToArray();
            CheckContent(next, affected);
            string token = Guid.NewGuid().ToString("N");
            if (pending.Count >= 8) pending.Clear();
            pending[token] = new(request, token, next, diffs.ToArray(), Hash(Bytes(state.Files)));
            return new { token, request.TaskId, state.Revision, changes = diffs, count = diffs.Count,
                affectedScenarios = affected.Length, files = next.Keys.Except(state.Files.Keys).Union(diffs.Select(d => d.File)).ToArray(), rounding = "显式取整，越界拒绝，未截断" };
        }
    }
    public object Apply(ApplyRequest request)
    {
        lock (gate)
        {
            if (state.Applied.TryGetValue(request.TaskId, out int appliedRevision)) return new { revision = state.Revision, appliedRevision, duplicate = true };
            Revision(request.Revision);
            if (!pending.TryGetValue(request.Token, out var p) || p.Request.TaskId != request.TaskId
                || p.Request.Revision != state.Revision || p.Fingerprint != Hash(Bytes(state.Files))) throw new InvalidDataException("预览已过期");
            if (p.Changes.Length == 0) return new { revision = state.Revision, changes = 0 };
            var applied = new Dictionary<string, int>(state.Applied) { [request.TaskId] = state.Revision + 1 };
            Persist(state with { Revision = state.Revision + 1, Files = p.Files,
                Undo = state.Undo.Append(state.Files).TakeLast(30).ToList(), Redo = [], Applied = applied });
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
                CheckContent(next, baseline.Scenarios);
            }
            string token = Guid.NewGuid().ToString("N"); if (pending.Count >= 8) pending.Clear();
            pending[token] = new(new(request.Revision, request.TaskId, [], []), token, next, diffs.ToArray(), Hash(Bytes(state.Files)));
            return new { token, request.TaskId, state.Revision, count = diffs.Count, changes = diffs, affectedScenarios = diffs.Count > 0 ? baseline.Scenarios.Length : 0 };
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
            var remaining = from.Take(from.Count - 1).ToList(); var target = to.Append(state.Files).ToList();
            Persist(state with { Revision = state.Revision + 1, Files = from[^1], Undo = undo ? remaining : target, Redo = undo ? target : remaining });
            return new { state.Revision };
        }
    }
    public byte[] AuthorBytes() { lock (gate) return Bytes(state); }
    public object Restore(RestoreRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            var candidate = JsonSerializer.Deserialize<AuthorState>(request.Document, Json) ?? throw new InvalidDataException("工程为空");
            CheckState(candidate); CheckContent(candidate.Files, baseline.Scenarios);
            Persist(candidate with { Revision = state.Revision + 1, Undo = state.Undo.Append(state.Files).TakeLast(30).ToList(), Redo = [],
                Applied = state.Applied.Concat(candidate.Applied).GroupBy(p => p.Key).ToDictionary(g => g.Key, g => g.Last().Value) });
            return new { state.Revision };
        }
    }
    private void CheckContent(Dictionary<string, byte[]> files, IEnumerable<string> ids, bool allCountries = false)
    {
        var content = Content(files);
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
        lock (gate) { CheckContent(state.Files, baseline.Scenarios, true); return new { valid = true, scenarios = baseline.Scenarios.Length, state.Revision }; }
    }
    public byte[] Export(ExportRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision); ModFiles.Identifier(request.Id);
            if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Version)) throw new InvalidDataException("请填写名称和版本");
            string job = Path.Combine(home, "exports", Guid.NewGuid().ToString("N")); string author = Path.Combine(job, "author");
            Directory.CreateDirectory(author);
            foreach (var (path, bytes) in state.Files) ModFiles.Write(author, path, bytes);
            var store = new ModStore(baseline, Path.Combine(job, "mods"), Path.Combine(job, "preview-saves"));
            store.Seal(author, request.Id, request.Name, request.Version); store.Validate(author);
            var imported = store.Import(author, request.Id, request.Name);
            string package = Path.Combine(job, request.Id + ".ew4mod"); store.Export(imported.Key, package);
            return File.ReadAllBytes(package);
        }
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
    private void EditBattle(Dictionary<string, byte[]> next, string path, BatchRule rule, List<Diff> diffs)
    {
        byte[] original = Read(next, path); var battle = LegacyBattle.Read(original); var body = battle.ToLegacyBytes();
        if (rule.Filter.Cells != null && rule.Filter.MapId != battle.MapId) throw new InvalidDataException("选区底图不匹配，跨地图选区规则必须分别配置");
        var terrain = LegacyTerrainMap.Read(Read(next, MapFile(battle.MapId)));
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
}
