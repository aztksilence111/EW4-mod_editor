using System.Buffers.Binary;
using System.Text;
using System.Text.Json.Nodes;
using Ew4.Core;
using Ew4.Legacy;
using Ew4.Mods;

namespace Ew4.Editor;

public sealed record CountryEdit(string? OriginalId, string Id, string Name, string? Color,
    string? UnitVariant, string? VisualVariant, string? Flag, string? Image = null, string[]? Frames = null);
public sealed record CountryAssignment(string Scenario, int Faction, string Country);
public sealed record CountriesRequest(int Revision, string TaskId, CountryEdit[] Countries, CountryAssignment[]? Assignments = null);

public sealed partial class AuthorEngine
{
    private object[] CountryRows() => ModFiles.Object(Read(state.Files, "client/countries.json"))["countries"]!.AsObject()
        .Select(p => new { id = p.Key, name = (string?)p.Value!["name"], color = (string?)p.Value["color"],
            unitVariant = (string?)p.Value["unitVariant"], visualVariant = (string?)p.Value["visualVariant"],
            flag = (string?)p.Value["flag"], flagImage = (string?)p.Value["flagImage"] }).Cast<object>().ToArray();

    public byte[] CountryImage(string id, int frame)
    {
        lock (gate)
        {
            if (frame is < 0 or > 4) throw new InvalidDataException("国旗帧号应为 0..4");
            var country = CountryCatalog.Load(p => Read(state.Files, p)).Get(id) ?? throw new InvalidDataException("未知国家");
            if (country.FlagImage != null) return Read(state.Files, country.FlagImage);
            if (country.Flag == null) throw new InvalidDataException("该国家没有国旗");
            if (frame == 0) return Read(state.Files, "client/ui/image_flag_hd/" + country.Flag + "1.png");
            var atlases = ModFiles.Object(Read(state.Files, "client/manifest.json"))["atlases"]!;
            string sprite = country.Flag + frame + ".png";
            string atlas = atlases["buildings_hd"]?[sprite] == null ? "buildings" : "buildings_hd";
            var rect = atlases[atlas]![sprite]!;
            return Raster.Decode(Read(state.Files, "client/images/" + atlas + ".png"))
                .Crop((int)(double)rect["x"]!, (int)(double)rect["y"]!, (int)(double)rect["w"]!, (int)(double)rect["h"]!).Png();
        }
    }

    public object PreviewCountries(CountriesRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            if (string.IsNullOrWhiteSpace(request.TaskId) || request.TaskId.Length > 100 || state.Applied.ContainsKey(request.TaskId)
                || request.Countries == null || request.Countries.Length > 200 || (request.Assignments?.Length ?? 0) > 1000
                || request.Countries.Length + (request.Assignments?.Length ?? 0) == 0)
                throw new InvalidDataException("国家批处理参数无效");
            var next = new Dictionary<string, byte[]>(state.Files, StringComparer.Ordinal);
            PresentationResources.Synchronize(next, p => Read(next, p), BaseRead, Scenarios);
            var root = ModFiles.Object(Read(next, "client/countries.json"));
            var countries = root["countries"]!.AsObject();
            var aliases = root["aliases"] as JsonObject ?? new JsonObject();
            root["aliases"] = aliases;
            var diffs = new List<Diff>();
            var sources = new HashSet<string>(StringComparer.Ordinal);
            var targets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var edit in request.Countries)
            {
                if (edit == null || !ScenarioFactions.CountryId(edit.Id) || edit.Id.Length > 128 || edit.Id != edit.Id.Trim()
                    || string.IsNullOrWhiteSpace(edit.Name) || edit.Name.Length > 128 || edit.Name.Any(char.IsControl))
                    throw new InvalidDataException("国家 ID 或名称无效（最多 128 字符）");
                if (!targets.Add(edit.Id) || edit.OriginalId != null && !sources.Add(edit.OriginalId))
                    throw new InvalidDataException("国家批处理含重复 ID");
                if (edit.OriginalId != null && !countries.ContainsKey(edit.OriginalId)) throw new InvalidDataException("原国家不存在: " + edit.OriginalId);
                if (edit.Id != edit.OriginalId && (countries.Any(p => p.Key.Equals(edit.Id, StringComparison.OrdinalIgnoreCase)) || aliases.ContainsKey(edit.Id)))
                    throw new InvalidDataException("国家 ID 已存在或被别名占用: " + edit.Id);
            }
            foreach (var edit in request.Countries)
            {
                var before = edit.OriginalId == null ? null : countries[edit.OriginalId]!.DeepClone();
                var entry = before?.DeepClone().AsObject() ?? new JsonObject();
                entry["name"] = edit.Name; entry["color"] = Empty(edit.Color);
                entry["unitVariant"] = Empty(edit.UnitVariant); entry["visualVariant"] = Empty(edit.VisualVariant);
                if (edit.Frames != null)
                {
                    if (edit.Frames.Length != 4) throw new InvalidDataException("飘动国旗必须上传完整的 4 帧 PNG");
                    var frames = edit.Frames.Select(FlagPng).ToArray();
                    var decoded = frames.Select(Raster.Decode).ToArray();
                    if (decoded.Any(r => r.Width != decoded[0].Width || r.Height != decoded[0].Height))
                        throw new InvalidDataException("国旗动画四帧尺寸必须一致");
                    var image = edit.Image == null ? frames[0] : FlagPng(edit.Image);
                    string code = "modflag_" + Hash(frames.SelectMany(b => b).Concat(image).ToArray())[..24];
                    PackFlags(next, code, decoded);
                    next["client/ui/image_flag_hd/" + code + "1.png"] = image;
                    entry["flag"] = code; entry.Remove("flagImage");
                    diffs.Add(new("client/manifest.json", edit.Id, "flagFrames", (string?)before?["flag"] ?? "", code + " · 4 帧"));
                }
                else if (edit.Image != null)
                {
                    byte[] image = FlagPng(edit.Image);
                    string path = "rewrite/images/flag-" + Hash(image)[..24] + ".png";
                    next[path] = image; entry["flagImage"] = path; entry.Remove("flag");
                }
                else if (Empty(edit.Flag) != (string?)before?["flag"])
                { entry["flag"] = Empty(edit.Flag); entry.Remove("flagImage"); }
                ScenarioFactions.ValidateAppearance(new((string?)entry["flag"], (string?)entry["flagImage"], (string?)entry["color"]));
                if (entry["flag"] == null && entry["flagImage"] == null) throw new InvalidDataException("请选择国旗模板或上传国旗: " + edit.Id);
                if (edit.OriginalId != null && edit.Id != edit.OriginalId)
                {
                    countries.Remove(edit.OriginalId);
                    foreach (var pair in aliases.ToArray()) if ((string?)pair.Value == edit.OriginalId) aliases[pair.Key] = edit.Id;
                    aliases[edit.OriginalId] = edit.Id;
                }
                countries[edit.Id] = entry;
                if (edit.Id == edit.OriginalId && (string?)before?["name"] != edit.Name && !edit.Id.Contains('='))
                    UpdateCountryLabel(next, edit.Id, edit.Name);
                if (edit.Id != edit.OriginalId || !JsonNode.DeepEquals(before, entry))
                    diffs.Add(new("client/countries.json", edit.OriginalId ?? edit.Id, "country", before?.ToJsonString() ?? "新增", entry.ToJsonString() + " · ID=" + edit.Id));
            }
            next["client/countries.json"] = Bytes(root);
            PresentationResources.Synchronize(next, p => Read(next, p), BaseRead, Scenarios);
            SyncCatalogSources(next);
            foreach (var assignment in request.Assignments ?? [])
            {
                if (!Scenarios.Contains(assignment.Scenario) || !countries.ContainsKey(assignment.Country)) throw new InvalidDataException("剧本或目标国家不存在");
                string path = ScenarioPath(assignment.Scenario);
                var battle = LegacyBattle.Read(Read(next, path));
                if (assignment.Faction < 0 || assignment.Faction >= battle.Factions.Count) throw new InvalidDataException("势力槽位不存在");
                string old = battle.Factions[assignment.Faction].CountryId;
                if (old == assignment.Country) continue;
                var ids = battle.Factions.Select(f => f.CountryId).ToArray(); ids[assignment.Faction] = assignment.Country;
                var events = battle.Events.Select((e, i) => (e, i)).Where(p => ids.Contains(p.e.Country == old ? assignment.Country : p.e.Country))
                    .ToDictionary(p => p.i, p => p.e.Country == old ? assignment.Country : p.e.Country);
                next[path] = battle.WithCountryIds(new(1, Hash(battle.ToLegacyBytes()), ids, events));
                var updated = LegacyBattle.Read(next[path]);
                RebindEventFaction(next, assignment.Scenario, LegacyScenarioInitialization.FactionId(assignment.Scenario, assignment.Faction, battle.Factions[assignment.Faction]),
                    LegacyScenarioInitialization.FactionId(assignment.Scenario, assignment.Faction, updated.Factions[assignment.Faction]), diffs);
                diffs.Add(new(path, "faction:" + assignment.Faction, "country", old, assignment.Country));
            }
            CheckState(state with { Files = next }); CheckResources(next); CheckContent(next, Scenarios);
            return StoreResourcePreview(request.Revision, request.TaskId, next, diffs, Scenarios.Length);
        }
    }

    private object StoreResourcePreview(int revision, string taskId, Dictionary<string, byte[]> next, List<Diff> diffs, int affected)
    {
        string token = Guid.NewGuid().ToString("N"); if (pending.Count >= 8) pending.Clear();
        pending[token] = new(new(revision, taskId, [], []), token, Snapshot with { Files = next }, diffs.ToArray(), Hash(Bytes(Snapshot)));
        return new { token, taskId, revision, count = diffs.Count, changes = diffs, affectedScenarios = affected };
    }
    private static string? Empty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
    private void UpdateCountryLabel(Dictionary<string, byte[]> next, string id, string name)
    {
        const string path = "original/stringtable_cn.ini";
        var lines = Encoding.UTF8.GetString(Read(next, path)).Split('\n');
        bool found = false;
        for (int i = 0; i < lines.Length; i++)
        {
            int separator = lines[i].IndexOf('=');
            if (separator < 0 || lines[i].TrimStart().StartsWith(';')) continue;
            string key = lines[i][..separator].Trim().TrimStart('\uFEFF');
            if (key != id && key != "name_" + id) continue;
            lines[i] = lines[i][..(separator + 1)] + name + (lines[i].EndsWith('\r') ? "\r" : ""); found = true;
        }
        string text = string.Join('\n', lines);
        if (!found) text += "\nname_" + id + "=" + name + "\n";
        next[path] = Encoding.UTF8.GetBytes(text);
    }
    private static byte[] FlagPng(string encoded)
    {
        if (encoded.Length > 4 * 1024 * 1024) throw new InvalidDataException("国旗 PNG 超过 3 MiB");
        byte[] bytes = Convert.FromBase64String(encoded);
        if (bytes.Length < 24 || !bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })
            || BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16)) is < 1 or > 512
            || BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20)) is < 1 or > 512)
            throw new InvalidDataException("国旗须为边长 1..512 像素的 PNG");
        _ = Raster.Decode(bytes); return bytes;
    }
    private void PackFlags(Dictionary<string, byte[]> next, string code, Raster[] frames)
    {
        var manifest = ModFiles.Object(Read(next, "client/manifest.json"));
        foreach (string atlas in new[] { "buildings", "buildings_hd" })
        {
            var entries = manifest["atlases"]![atlas]!.AsObject();
            if (entries[code + "1.png"] != null) continue;
            var template = entries["fra1.png"] ?? throw new InvalidDataException("缺少国旗图集模板");
            int w = (int)(double)template["w"]!, h = (int)(double)template["h"]!;
            string path = "client/images/" + atlas + ".png";
            var old = Raster.Decode(Read(next, path));
            int width = Math.Max(old.Width, w * 4), height = old.Height + h;
            Raster.Dimensions(width, height);
            var output = new Raster(width, height, new byte[width * height * 4]);
            output.Copy(old, 0, 0, 0, 0, old.Width, old.Height);
            for (int i = 0; i < 4; i++)
            {
                var source = frames[i];
                for (int y = 0; y < h; y++) for (int x = 0; x < w; x++)
                    Buffer.BlockCopy(source.Pixels, (y * source.Height / h * source.Width + x * source.Width / w) * 4,
                        output.Pixels, ((old.Height + y) * width + i * w + x) * 4, 4);
                var rect = template.DeepClone(); rect["x"] = i * w; rect["y"] = old.Height;
                entries[code + (i + 1) + ".png"] = rect;
            }
            next[path] = output.Png();
        }
        next["client/manifest.json"] = Bytes(manifest);
    }
}
