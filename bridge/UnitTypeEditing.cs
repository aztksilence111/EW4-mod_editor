using System.Text.Json;
using System.Text.Json.Nodes;
using Ew4.Legacy;
using Ew4.Mods;

namespace Ew4.Editor;

public sealed record UnitTypeEdit(string? OriginalId, string Id, string Template, string Name, string Description,
    string VisualTemplate, JsonObject Attributes, JsonObject? Recruitment = null);
public sealed record UnitTypesRequest(int Revision, string TaskId, UnitTypeEdit[] Units);
public sealed record UnitTypeDeploymentRequest(int Revision, string TaskId, string Scenario, int Faction,
    string Profile, string Unit, int Cell, bool Ready = true);

public sealed partial class AuthorEngine
{
    private bool UnitTypesSupported => typeof(ExtensionLoader).GetProperty("UnitRecruitment") != null;
    public object UnitTypes()
    {
        lock (gate)
        {
            var catalog = AuthorCatalog.Read(p => Read(state.Files, p));
            var manifest = ModFiles.Object(Read(state.Files, "client/manifest.json"));
            var registration = ReadOptional(state.Files, "rewrite/extension.json");
            var config = registration?["unitRecruitment"] is JsonValue path ? ReadOptional(state.Files, path.GetValue<string>()) : null;
            return new { state.Revision, supported = UnitTypesSupported,
                units = catalog["profiles"]!.AsArray().Select(p => new { id = (string)p!["id"]!, attributes = p,
                    visual = manifest["profiles"]![(string)p["id"]!],
                    recruitment = config?["offers"]?.AsArray().Where(o => (string?)o!["profile"] == (string?)p["id"]).ToArray() ?? [] }),
                scenarios = Scenarios, countries = CountryRows() };
        }
    }
    private JsonObject? ReadOptional(Dictionary<string, byte[]> files, string path)
    {
        try { return ModFiles.Object(Read(files, path)); }
        catch (FileNotFoundException) { return null; }
    }
    public object PreviewUnitTypes(UnitTypesRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            if (!UnitTypesSupported) throw new InvalidDataException("当前冻结引擎尚未支持独立兵种招募，请用新版 R 源码建立新基线");
            if (string.IsNullOrWhiteSpace(request.TaskId) || request.TaskId.Length > 100 || state.Applied.ContainsKey(request.TaskId)
                || request.Units == null || request.Units.Length is < 1 or > 100)
                throw new InvalidDataException("兵种批处理参数无效");
            var next = new Dictionary<string, byte[]>(state.Files, StringComparer.Ordinal);
            var index = ModFiles.Object(Read(next, "legacy/catalog.json"));
            bool split = (int?)index["schema_version"] == 3;
            string profileFile = split ? "legacy/units.json" : "legacy/catalog.json";
            var root = ModFiles.Object(Read(next, profileFile));
            var profiles = root[split ? "units" : "profiles"]!.AsArray();
            var manifest = ModFiles.Object(Read(next, "client/manifest.json"));
            var visuals = manifest["profiles"]!.AsObject();
            var extensions = ReadOptional(next, "rewrite/extension.json") ?? new JsonObject { ["schema"] = 1, ["apiVersion"] = 3 };
            if ((int?)extensions["apiVersion"] < 3) extensions["apiVersion"] = 3;
            string recruitmentFile = (string?)extensions["unitRecruitment"] ?? "rewrite/unit-recruitment.json";
            if (!ExtensionLoader.PathValid(recruitmentFile)) throw new InvalidDataException("招募配置路径无效");
            var recruitment = ReadOptional(next, recruitmentFile) ?? new JsonObject { ["schema"] = 1, ["offers"] = new JsonArray() };
            var offers = recruitment["offers"]!.AsArray();
            var changes = new List<Diff>(); var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var allowed = new HashSet<string>(["category", "grade", "max_health", "movement", "minimum_attack", "maximum_attack", "minimum_range", "maximum_range",
                "food_consumption", "kill_experience", "ignition_numerator", "ignition_denominator", "attack_bands", "traits", "damage_multipliers", "weapon", "skill_slots"], StringComparer.Ordinal);
            foreach (var edit in request.Units)
            {
                if (edit == null || !ProfileId(edit.Id) || !ids.Add(edit.Id) || string.IsNullOrWhiteSpace(edit.Name) || edit.Name.Length > 128
                    || edit.Name.Any(char.IsControl) || edit.Description == null || edit.Description.Length > 4000 || edit.Attributes == null
                    || edit.Attributes.Any(p => !allowed.Contains(p.Key) || p.Value == null))
                    throw new InvalidDataException("兵种 ID、名称或属性无效");
                var old = profiles.SingleOrDefault(p => (string?)p!["id"] == edit.Id);
                if (edit.OriginalId != null && (edit.OriginalId != edit.Id || old == null))
                    throw new InvalidDataException("已有兵种 ID 不允许改名；请复制为新兵种");
                if (edit.OriginalId == null && (profiles.Any(p => string.Equals((string?)p!["id"], edit.Id, StringComparison.OrdinalIgnoreCase)) || visuals.ContainsKey(edit.Id)))
                    throw new InvalidDataException("兵种 ID 已存在: " + edit.Id);
                var template = old ?? profiles.SingleOrDefault(p => (string?)p!["id"] == edit.Template)
                    ?? throw new InvalidDataException("未知兵种模板: " + edit.Template);
                var profile = template.DeepClone().AsObject(); profile["id"] = edit.Id;
                foreach (var (key, value) in edit.Attributes) profile[key] = value!.DeepClone();
                if ((int)profile["minimum_attack"]! > (int)profile["maximum_attack"]!)
                    throw new InvalidDataException("最低攻击不能大于最高攻击");
                if (profile["weapon"] is JsonValue weapon && weapon.GetValue<string>() is not ("gun" or "guns" or "mgun" or "cannon" or "rocket" or "cold"))
                    throw new InvalidDataException("未知武器类型");
                var visual = (visuals[edit.VisualTemplate] ?? throw new InvalidDataException("未知兵模模板")).DeepClone().AsObject();
                visual["name"] = edit.Name; visual["description"] = edit.Description;
                if (edit.OriginalId == null) { visual["recruitGroup"] = edit.Id; visual.Remove("presentations"); }
                else if (visuals[edit.Id]?["recruitGroup"] is JsonNode group) visual["recruitGroup"] = group.DeepClone();
                visual["stats"] = new JsonObject { ["name"] = edit.Name, ["type"] = profile["category"]!.DeepClone(),
                    ["grade"] = profile["grade"]!.DeepClone(), ["strength"] = profile["max_health"]!.DeepClone(), ["movement"] = profile["movement"]!.DeepClone(),
                    ["minatk"] = profile["minimum_attack"]!.DeepClone(), ["maxatk"] = profile["maximum_attack"]!.DeepClone(),
                    ["minatkrange"] = profile["minimum_range"]!.DeepClone(), ["maxatkrange"] = profile["maximum_range"]!.DeepClone(),
                    ["consumption"] = profile["food_consumption"]!.DeepClone() };
                if (old != null) profiles[profiles.IndexOf(old)] = profile; else profiles.Add(profile);
                visuals[edit.Id] = visual;
                var visualConfig = ReadOptional(next, "client/unit-visuals.json");
                if (visualConfig != null)
                {
                    var effects = ModFiles.Object(Read(next, "client/effects.json"));
                    string? motion = (string?)visualConfig["profiles"]?[edit.VisualTemplate] ?? (string?)effects["bindings"]?[edit.VisualTemplate];
                    if (motion != null) visualConfig["profiles"]![edit.Id] = motion;
                    else visualConfig["profiles"]?.AsObject().Remove(edit.Id);
                    if (visualConfig["composites"]?[edit.VisualTemplate] is JsonNode parts)
                        visualConfig["composites"]![edit.Id] = parts.DeepClone();
                    else visualConfig["composites"]?.AsObject().Remove(edit.Id);
                    next["client/unit-visuals.json"] = Bytes(visualConfig);
                }
                // Other offers targeting this profile are retained; the form owns exactly the profile's default offer.
                string offerId = edit.Id + ".recruit";
                var existing = offers.SingleOrDefault(o => (string?)o!["id"] == offerId);
                if (existing != null) offers.Remove(existing);
                if (edit.Recruitment != null)
                {
                    var offer = edit.Recruitment.DeepClone().AsObject(); offer["id"] = offerId; offer["profile"] = edit.Id;
                    offers.Add(offer);
                }
                changes.Add(new(profileFile, edit.Id, "profile", (object?)old?.DeepClone() ?? "新增", profile.DeepClone()));
                changes.Add(new("client/manifest.json", edit.Id, "visual", "", visual.DeepClone()));
                changes.Add(new(recruitmentFile, offerId, "recruitment", (object?)existing ?? "无", (object?)edit.Recruitment ?? "无"));
            }
            next[profileFile] = Bytes(root); next["client/manifest.json"] = Bytes(manifest);
            extensions["unitRecruitment"] = recruitmentFile;
            next[recruitmentFile] = Bytes(recruitment); next["rewrite/extension.json"] = Bytes(extensions);
            CheckState(state with { Files = next }); CheckResources(next); CheckContent(next, Scenarios);
            return StoreResourcePreview(request.Revision, request.TaskId, next, changes, Scenarios.Length);
        }
    }
    private static bool ProfileId(string id) => !string.IsNullOrWhiteSpace(id) && id.Length <= 110 && id.Contains('.')
        && id.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-');

    public object PreviewUnitTypeDeployment(UnitTypeDeploymentRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            if (!UnitTypesSupported || !Scenarios.Contains(request.Scenario) || !ProfileId(request.Unit)
                || string.IsNullOrWhiteSpace(request.TaskId) || request.TaskId.Length > 100 || state.Applied.ContainsKey(request.TaskId))
                throw new InvalidDataException("独立兵种部署参数或引擎版本无效");
            var content = Content(state.Files);
            if (!content.Catalogs.Runtime.Profiles.TryGetValue(request.Profile, out var definition)) throw new InvalidDataException("兵种不存在");
            var battle = content.Battle(request.Scenario); var map = content.Maps[battle.MapId];
            if (request.Faction < 0 || request.Faction >= battle.Factions.Count || request.Cell < 0 || request.Cell >= map.Cells.Count
                || request.Cell % map.Width < battle.Left || request.Cell % map.Width >= battle.Left + battle.Width
                || request.Cell / map.Width < battle.Top || request.Cell / map.Width >= battle.Top + battle.Height)
                throw new InvalidDataException("部署国家或格子无效");
            int local = (request.Cell / map.Width - battle.Top) * battle.Width + request.Cell % map.Width - battle.Left;
            if (unchecked((sbyte)battle.SectionBytes("ownership")[local]) != request.Faction || battle.Armies.Any(a => a.Cell == request.Cell))
                throw new InvalidDataException("开局增援请选择本国无部队的格子");
            var terrain = content.Catalogs.Terrain.Resolve(map.Cells[request.Cell]).Movement;
            bool air = content.Extensions.GetType().GetProperty("UnitLayers")?.GetValue(content.Extensions) is object layers
                && JsonSerializer.SerializeToNode(layers, Json)?["profiles"]?[request.Profile]?["layer"]?.GetValue<string>() == "air";
            if (!terrain.Active || !air && terrain.Sea != (definition.Profile.Category == "naval"))
                throw new InvalidDataException("部署位置与兵种的海陆类型不匹配");
            var next = new Dictionary<string, byte[]>(state.Files, StringComparer.Ordinal);
            var document = EventDocument(next);
            if ((document.Events[request.Scenario]?.AsArray() ?? []).Any(e => e?["id"]?.GetValue<string>() == "editor.spawn." + request.Unit
                || e?.ToJsonString().Contains("\"" + request.Unit + "\"", StringComparison.Ordinal) == true))
                throw new InvalidDataException("部队实例 ID 已被事件引用，请使用新 ID");
            var events = document.Events[request.Scenario] as JsonArray ?? new JsonArray();
            if (document.Events[request.Scenario] == null) document.Events[request.Scenario] = events;
            string faction = LegacyScenarioInitialization.FactionId(request.Scenario, request.Faction, battle.Factions[request.Faction]);
            var choice = content.Scenarios.Single(s => s.Id == request.Scenario);
            var initial = content.Start(request.Scenario, choice.Mode == 2 ? battle.Factions.First(f => f.Camp != 4).CountryId : null).Session.World;
            if (initial.Units.Any(u => u.Cell == request.Cell) || initial.Cells[request.Cell].Owner != faction)
                throw new InvalidDataException("开局事件已占用该格或改变归属，请选择其他增援位置");
            var entry = new JsonObject { ["id"] = "editor.spawn." + request.Unit,
                ["condition"] = new JsonObject { ["type"] = "round", ["compare"] = "ge", ["value"] = 1 },
                ["effects"] = new JsonArray(new JsonObject { ["type"] = "unit_spawn", ["faction"] = faction, ["profile"] = request.Profile,
                    ["unit"] = request.Unit, ["cells"] = new JsonArray(request.Cell), ["ready"] = request.Ready }) };
            events.Add(entry); document.Manifest["scenarioEvents"] = document.Path;
            document.Manifest["apiVersion"] = Math.Max(3, (int?)document.Manifest["apiVersion"] ?? 1);
            next["rewrite/extension.json"] = Bytes(document.Manifest); next[document.Path] = Bytes(document.Events);
            CheckState(state with { Files = next }); CheckResources(next); CheckContent(next, Scenarios);
            return StoreResourcePreview(request.Revision, request.TaskId, next,
                [new(document.Path, request.Unit, "openingReinforcement", "无", entry.DeepClone())], 1);
        }
    }
}
