using System.Text.Json.Nodes;
using Ew4.Mods;

namespace Ew4.Editor;

public sealed partial class AuthorEngine
{
    private const string EventGraphPath = "client/editor-event-graphs.json";
    private static string GraphEventPrefix(int faction) => "editor.f" + faction + "/";
    private JsonObject EventGraphs(Dictionary<string, byte[]> files) => files.ContainsKey(EventGraphPath) || sourceHashes.ContainsKey(EventGraphPath)
        ? ModFiles.Object(Read(files, EventGraphPath)) : new JsonObject();

    // Store editable definitions separately; the runtime receives only supported conditions and effects.
    private static JsonArray CompileEventGraph(string scenario, int slot, string faction, JsonObject graph)
    {
        var events = graph["events"] as JsonArray ?? throw new InvalidDataException("事件数组缺失");
        if (events.Count > 1024) throw new InvalidDataException("单个国家最多 1024 个事件");
        var ids = events.Select(e => (string?)e?["id"] ?? "").ToArray();
        if (ids.Any(id => string.IsNullOrWhiteSpace(id) || id.Length > 128 || id.Any(char.IsControl)) || ids.Distinct().Count() != ids.Length)
            throw new InvalidDataException("事件 ID 为空、重复或过长");
        var prefix = GraphEventPrefix(slot);
        var output = (JsonArray)events.DeepClone();
        var byId = output.Cast<JsonObject>().ToDictionary(e => (string)e["id"]!);
        var links = graph["links"] as JsonArray ?? [];
        if (links.Count > 4096) throw new InvalidDataException("事件连线过多");
        var incoming = ids.ToDictionary(id => id, _ => new List<JsonNode>());
        var linkIds = new HashSet<string>();
        foreach (var item in links)
        {
            var link = item as JsonObject ?? throw new InvalidDataException("连线无效");
            string id = (string?)link["id"] ?? "", source = (string?)link["source"] ?? "", target = (string?)link["target"] ?? "";
            string kind = (string?)link["kind"] ?? "condition", choice = (string?)link["choice"] ?? "";
            if (id.Length is 0 or > 128 || !linkIds.Add(id) || source == target || !byId.ContainsKey(source) || !byId.ContainsKey(target)
                || kind is not ("condition" or "result") || kind == "condition" && choice.Length > 0) throw new InvalidDataException("事件连线端点或类型无效");
            JsonNode gate = new JsonObject { ["type"] = "event_completed", ["key"] = source };
            if (kind == "result")
            {
                string key = "scenario/editor/" + Hash(System.Text.Encoding.UTF8.GetBytes(scenario + ":" + slot + ":" + id))[..24];
                JsonArray effects;
                if (choice.Length > 0)
                {
                    var selected = (byId[source]["popup"]?["choices"] as JsonArray)?.OfType<JsonObject>().SingleOrDefault(c => (string?)c["id"] == choice)
                        ?? throw new InvalidDataException("结果连线引用的选项不存在");
                    effects = selected["effects"] as JsonArray ?? new JsonArray();
                    if (selected["effects"] == null) selected["effects"] = effects;
                }
                else
                {
                    effects = byId[source]["effects"] as JsonArray ?? new JsonArray();
                    if (byId[source]["effects"] == null) byId[source]["effects"] = effects;
                }
                effects.Add(new JsonObject { ["type"] = "state", ["key"] = key, ["value"] = 1 });
                gate = new JsonObject { ["type"] = "all", ["conditions"] = new JsonArray(gate,
                    new JsonObject { ["type"] = "state", ["key"] = key, ["compare"] = "eq", ["value"] = 1 }) };
            }
            incoming[target].Add(gate);
        }
        var visiting = new HashSet<string>(); var visited = new HashSet<string>();
        foreach (var id in ids) Visit(id);
        void Visit(string id)
        {
            if (visited.Contains(id)) return;
            if (!visiting.Add(id)) throw new InvalidDataException("事件连线存在循环，无法形成链或树");
            foreach (var link in links.OfType<JsonObject>().Where(l => (string?)l["source"] == id)) Visit((string)link["target"]!);
            visiting.Remove(id); visited.Add(id);
        }
        foreach (var (id, ev) in byId)
        {
            string join = (string?)graph["joins"]?[id] ?? "all";
            if (join is not ("all" or "any")) throw new InvalidDataException("事件汇合类型无效");
            var gates = new JsonArray(new JsonObject { ["type"] = "faction_exists", ["faction"] = faction }, ev["condition"]?.DeepClone() ?? new JsonObject { ["type"] = "always" });
            if (incoming[id].Count > 0) gates.Add(new JsonObject { ["type"] = join, ["conditions"] = new JsonArray(incoming[id].ToArray()) });
            ev["condition"] = new JsonObject { ["type"] = "all", ["conditions"] = gates };
            Bind(ev);
            ev["id"] = prefix + id;
        }
        return output;

        void Bind(JsonNode? node)
        {
            if (node is JsonObject obj)
            {
                string? type = (string?)obj["type"];
                if (type is "event_completed" or "event_count")
                {
                    string key = (string?)obj["key"] ?? "";
                    if (!byId.ContainsKey(key)) throw new InvalidDataException("前置事件不存在：" + key);
                    obj["key"] = prefix + key;
                }
                if (type != null && !obj.ContainsKey("faction")) obj["faction"] = faction;
                foreach (string key in new[] { "faction", "otherFaction", "templateFaction" })
                    if ((string?)obj[key] == "@player") obj[key] = faction;
                foreach (var value in obj.ToArray()) if (value.Key != "victoryRules") Bind(value.Value);
            }
            else if (node is JsonArray array) foreach (var value in array) Bind(value);
        }
    }

    private void RebindEventFaction(Dictionary<string, byte[]> files, string scenario, string before, string after, List<Diff> diffs)
    {
        var document = EventDocument(files);
        if (document.Events[scenario] is JsonArray events)
        {
            var old = events.ToJsonString(); Replace(events);
            if (old != events.ToJsonString())
            { files[document.Path] = Bytes(document.Events); diffs.Add(new(document.Path, scenario, "faction", before, after)); }
        }
        var graphs = EventGraphs(files);
        if (graphs[scenario] != null)
        {
            var old = graphs.ToJsonString(); Replace(graphs[scenario]);
            if (old != graphs.ToJsonString()) files[EventGraphPath] = Bytes(graphs);
        }
        void Replace(JsonNode? node)
        {
            if (node is JsonObject obj)
            {
                foreach (var pair in obj.ToArray())
                    if (pair.Key is "faction" or "otherFaction" or "templateFaction" && pair.Value is JsonValue value && value.TryGetValue<string>(out var id) && id == before) obj[pair.Key] = after;
                    else Replace(pair.Value);
            }
            else if (node is JsonArray array) foreach (var child in array) Replace(child);
        }
    }
}
