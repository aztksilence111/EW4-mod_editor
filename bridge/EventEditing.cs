using System.Buffers.Binary;
using System.Text.Json.Nodes;
using Ew4.Core;
using Ew4.Legacy;
using Ew4.Mods;

namespace Ew4.Editor;

public sealed record LegacyEventEdit(int Slot, int Condition, int Effect, int Round, int Dialogue, int Cell, string Country);
public sealed record EventsRequest(int Revision, string TaskId, string Scenario, JsonArray Events, LegacyEventEdit[]? Legacy = null,
    Dictionary<string, string>? Images = null, int? Faction = null, JsonObject? Graph = null);

public sealed partial class AuthorEngine
{
    public byte[] EventImage(string path)
    {
        lock (gate)
        {
            if (!ExtensionLoader.PathValid(path) || !path.StartsWith("rewrite/", StringComparison.Ordinal) || !path.EndsWith(".png", StringComparison.Ordinal))
                throw new InvalidDataException("事件图片路径无效");
            return Read(state.Files, path);
        }
    }
    private (JsonObject Manifest, string Path, JsonObject Events) EventDocument(Dictionary<string, byte[]> files)
    {
        var manifest = sourceHashes.ContainsKey("rewrite/extension.json") || files.ContainsKey("rewrite/extension.json")
            ? ModFiles.Object(Read(files, "rewrite/extension.json")) : new JsonObject { ["schema"] = 1, ["apiVersion"] = 2 };
        string? registered = (string?)manifest["scenarioEvents"];
        string path = registered ?? "rewrite/editor-events.json";
        if (!ExtensionLoader.PathValid(path) || !path.EndsWith(".json", StringComparison.Ordinal)) throw new InvalidDataException("事件注册路径无效");
        var events = registered == null ? new JsonObject() : ModFiles.Object(Read(files, path));
        return (manifest, path, events);
    }
    public object Events(string id, int? faction = null)
    {
        lock (gate)
        {
            if (!Scenarios.Contains(id)) throw new InvalidDataException("剧本不存在");
            var document = EventDocument(state.Files);
            var battle = LegacyBattle.Read(Read(state.Files, ScenarioPath(id)));
            if (faction is int slot && (slot < 0 || slot >= battle.Factions.Count)) throw new InvalidDataException("国家槽位不存在");
            var content = Content(state.Files);
            var graph = faction is int index ? EventGraphs(state.Files)[id]?[index.ToString()] as JsonObject : null;
            return new { state.Revision, scenario = id, faction, path = document.Path,
                events = faction == null ? document.Events[id]?.DeepClone() ?? new JsonArray() : graph?["events"]?.DeepClone() ?? new JsonArray(),
                graph = graph?.DeepClone() ?? new JsonObject(),
                factions = battle.Factions.Select((f, i) => new { id = LegacyScenarioInitialization.FactionId(id, i, f), country = f.CountryId, name = content.CountryName(f.CountryId) }),
                units = battle.Armies.Select((a, i) => new { id = id + ".unit." + i, cell = a.Cell }),
                legacy = battle.Events.Select((e, slot) => new { slot, e.Id, e.Condition, e.Effect, e.Round, e.Dialogue, e.Cell, e.Country,
                    sites = battle.Sites.Select((s, i) => (s, i)).Where(p => p.s.State11 == e.Id).Select(p => p.i),
                    armies = battle.Armies.Select((a, i) => (a, i)).Where(p => p.a.State70 == e.Id).Select(p => p.i) })
                    .Where(e => faction == null || e.Country == battle.Factions[faction.Value].CountryId) };
        }
    }
    public object PreviewEvents(EventsRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            if (!Scenarios.Contains(request.Scenario) || string.IsNullOrWhiteSpace(request.TaskId) || request.TaskId.Length > 100
                || state.Applied.ContainsKey(request.TaskId) || request.Events == null) throw new InvalidDataException("事件任务参数无效");
            var next = new Dictionary<string, byte[]>(state.Files, StringComparer.Ordinal);
            var document = EventDocument(next); var diffs = new List<Diff>();
            var requestedEvents = request.Events;
            if (request.Faction is int faction)
            {
                var battle = LegacyBattle.Read(Read(next, ScenarioPath(request.Scenario)));
                if (faction < 0 || faction >= battle.Factions.Count) throw new InvalidDataException("国家槽位不存在");
                if (request.Legacy?.Any(e => e.Slot < 0 || e.Slot >= battle.Events.Count || battle.Events[e.Slot].Country != battle.Factions[faction].CountryId
                    || e.Country != battle.Factions[faction].CountryId) == true) throw new InvalidDataException("不能修改其他国家的原版事件");
                var graphs = EventGraphs(next);
                var byScenario = graphs[request.Scenario] as JsonObject ?? new JsonObject();
                graphs[request.Scenario] = null; graphs[request.Scenario] = byScenario;
                var graph = request.Graph?.DeepClone() as JsonObject ?? new JsonObject();
                graph["events"] = request.Events.DeepClone();
                var compiled = CompileEventGraph(request.Scenario, faction, LegacyScenarioInitialization.FactionId(request.Scenario, faction, battle.Factions[faction]), graph);
                var prefix = GraphEventPrefix(faction);
                var managedIds = (byScenario[faction.ToString()]?["events"] as JsonArray ?? []).Select(e => prefix + (string?)e?["id"]).ToHashSet();
                requestedEvents = new JsonArray((document.Events[request.Scenario] as JsonArray ?? []).Where(e => !managedIds.Contains((string?)e?["id"] ?? ""))
                    .Select(e => e?.DeepClone()).Concat(compiled.Select(e => e?.DeepClone())).ToArray());
                if (!JsonNode.DeepEquals(byScenario[faction.ToString()], graph))
                {
                    diffs.Add(new(EventGraphPath, request.Scenario + ":" + faction, "graph", byScenario[faction.ToString()]?.ToJsonString() ?? "", graph.ToJsonString()));
                    byScenario[faction.ToString()] = graph; next[EventGraphPath] = Bytes(graphs);
                }
            }
            else if (EventGraphs(next)[request.Scenario] != null)
                throw new InvalidDataException("此 BTL 已有分国家事件树，请指定国家槽位编辑");
            var definitions = ExtensionLoader.ParseJson<ScriptedScenarioEvent[]>(Bytes(requestedEvents));
            foreach (var (path, encoded) in request.Images ?? [])
            {
                if (!path.StartsWith("rewrite/images/event-", StringComparison.Ordinal) || !path.EndsWith(".png", StringComparison.Ordinal))
                    throw new InvalidDataException("事件图片路径无效");
                ModFiles.PathName(path);
                if (encoded.Length > 6 * 1024 * 1024) throw new InvalidDataException("事件 PNG 超过 4 MiB");
                byte[] bytes = Convert.FromBase64String(encoded);
                if (bytes.Length > 4 * 1024 * 1024) throw new InvalidDataException("事件 PNG 超过 4 MiB");
                if (!bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) throw new InvalidDataException("事件图片必须为 PNG");
                _ = Raster.Decode(bytes);
                if (next.TryGetValue(path, out var previous) && !previous.AsSpan().SequenceEqual(bytes)) throw new InvalidDataException("事件图片路径冲突");
                next[path] = bytes;
                diffs.Add(new(path, request.Scenario, "image", "", Hash(bytes)));
            }
            var prior = document.Events[request.Scenario] as JsonArray ?? new JsonArray();
            if (!JsonNode.DeepEquals(prior, requestedEvents))
            {
                document.Events[request.Scenario] = requestedEvents.DeepClone();
                document.Manifest["scenarioEvents"] = document.Path;
                next["rewrite/extension.json"] = Bytes(document.Manifest); next[document.Path] = Bytes(document.Events);
                foreach (string id in prior.Select(e => (string)e!["id"]!).Union(definitions.Select(e => e.Id)))
                {
                    var old = prior.FirstOrDefault(e => (string?)e?["id"] == id);
                    var updated = requestedEvents.FirstOrDefault(e => (string?)e?["id"] == id);
                    if (!JsonNode.DeepEquals(old, updated)) diffs.Add(new(document.Path, id, "event", old?.ToJsonString() ?? "新增", updated?.ToJsonString() ?? "删除"));
                }
                if (diffs.Count == 0) diffs.Add(new(document.Path, request.Scenario, "order", string.Join(", ", prior.Select(e => (string?)e?["id"])), string.Join(", ", definitions.Select(e => e.Id))));
            }
            if (request.Legacy is { Length: > 0 }) EditLegacyEvents(next, request.Scenario, request.Legacy, diffs);
            CheckState(state with { Files = next }); CheckResources(next); CheckContent(next, [request.Scenario], true);
            return StoreResourcePreview(request.Revision, request.TaskId, next, diffs, diffs.Count == 0 ? 0 : 1);
        }
    }

    private void EditLegacyEvents(Dictionary<string, byte[]> next, string scenario, LegacyEventEdit[] edits, List<Diff> diffs)
    {
        string path = ScenarioPath(scenario); var original = Read(next, path); var battle = LegacyBattle.Read(original);
        if (edits.Select(e => e.Slot).Distinct().Count() != edits.Length) throw new InvalidDataException("原版事件槽位重复");
        if (ExtensionTags(original, battle.LegacyLength).Any(t => t is not ("CNTR" or "JURI" or "VICT"))) throw new InvalidDataException("未知 BTL 扩展阻止事件修改");
        var body = battle.ToLegacyBytes(); int start = battle.Sections.Single(s => s.Name == "opaque44").Offset;
        var countries = battle.Events.Select((e, i) => (e, i)).Where(p => battle.Factions.Any(f => f.CountryId == p.e.Country)).ToDictionary(p => p.i, p => p.e.Country);
        bool changed = false;
        foreach (var edit in edits)
        {
            if (edit.Slot < 0 || edit.Slot >= battle.Events.Count || edit.Condition is < 0 or > 2 || edit.Effect < 0 || edit.Round < 0
                || edit.Dialogue < -1) throw new InvalidDataException("原版事件字段无效");
            var old = battle.Events[edit.Slot]; int offset = start + edit.Slot * 44;
            if (edit.Effect > 5 && edit.Effect != old.Effect) throw new InvalidDataException("不支持的新原版事件效果");
            if (edit.Country != old.Country && !battle.Factions.Any(f => f.CountryId == edit.Country)) throw new InvalidDataException("原版事件目标国家不存在");
            var values = new[] { ("condition", old.Condition, edit.Condition, 4), ("effect", old.Effect, edit.Effect, 8), ("round", old.Round, edit.Round, 12),
                ("dialogue", old.Dialogue, edit.Dialogue, 16), ("cell", old.Cell, edit.Cell, 20) };
            foreach (var (field, before, after, at) in values)
                if (before != after) { BinaryPrimitives.WriteInt32LittleEndian(body.AsSpan(offset + at), after); changed = true; diffs.Add(new(path, "event:" + edit.Slot, field, before, after)); }
            if (old.Country != edit.Country) { countries[edit.Slot] = edit.Country; changed = true; diffs.Add(new(path, "event:" + edit.Slot, "country", old.Country, edit.Country)); }
        }
        if (!changed) return;
        byte[] output = body;
        if (battle.CountryIds != null || edits.Any(e => battle.Events[e.Slot].Country != e.Country))
            output = LegacyBattle.Read(output).WithCountryIds(new(1, Hash(body), battle.Factions.Select(f => f.CountryId).ToArray(), countries));
        if (battle.Jurisdictions != null) output = LegacyBattle.Read(output).WithJurisdictions(battle.Jurisdictions with { BaseSha256 = Hash(body) });
        if (battle.Victory != null) output = LegacyBattle.Read(output).WithVictory(battle.Victory);
        next[path] = output;
    }
}
