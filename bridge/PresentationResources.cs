using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
using System.Xml.Linq;
using Ew4.Legacy;
using Ew4.Mods;

namespace Ew4.Editor;

internal static class PresentationResources
{
    private static readonly JsonSerializerOptions CompactJson = new(JsonSerializerDefaults.Web);

    internal static void Synchronize(Dictionary<string, byte[]> files, Func<string, byte[]> read,
        Func<string, byte[]> baselineRead, IEnumerable<string> scenarios)
    {
        bool commanderChanged = Changed("original/def_commander.xml");
        bool capitalChanged = Changed("original/def_capital.xml");
        bool stringsChanged = Changed("original/stringtable_cn.ini");
        bool cityChanged = Changed("original/def_areaname.xml");
        bool armyChanged = Changed("original/def_army.xml");

        if (commanderChanged || capitalChanged || stringsChanged)
        {
            var manifest = ModFiles.Object(read("client/manifest.json"));
            bool changed = false;
            if (commanderChanged)
            {
                var commanders = CommanderMap(read("original/def_commander.xml"));
                changed |= Replace(manifest, "commanders", commanders);
                changed |= CopyRenamedCommanderSprites(manifest, commanders,
                    ModFiles.Object(baselineRead("client/manifest.json")), files, baselineRead);
            }
            if (capitalChanged)
                changed |= Replace(manifest, "capitals", CapitalMap(read("original/def_capital.xml")));
            if (stringsChanged)
                changed |= Replace(manifest, "strings", JsonSerializer.SerializeToNode(Strings(read("original/stringtable_cn.ini"))));
            if (changed) files["client/manifest.json"] = JsonSerializer.SerializeToUtf8Bytes(manifest, CompactJson);
        }

        if (armyChanged || stringsChanged)
        {
            var countries = Countries(read, baselineRead, scenarios);
            var current = TryRead(read, "client/countries.json");
            if (current == null || !JsonEqual(current, countries))
                files["client/countries.json"] = JsonSerializer.SerializeToUtf8Bytes(countries, CompactJson);
        }

        if (cityChanged)
        {
            var cities = new JsonObject
            {
                ["schema"] = 1,
                ["source"] = "original/def_areaname.xml",
                ["cities"] = CityMap(read("original/def_areaname.xml"))
            };
            var current = TryRead(read, "frontend/city-names.json");
            if (current == null || !JsonEqual(current, cities))
                files["frontend/city-names.json"] = JsonSerializer.SerializeToUtf8Bytes(cities, CompactJson);
        }

        bool Changed(string path) => !read(path).AsSpan().SequenceEqual(baselineRead(path));
    }

    private static JsonObject CommanderMap(byte[] bytes) =>
        new(ModFiles.Xml(bytes).Root!.Elements().Select(e =>
            KeyValuePair.Create<string, JsonNode?>((string)e.Attribute("id")!, JsonValue.Create((string)e.Attribute("name")!))));

    private static JsonObject CapitalMap(byte[] bytes) =>
        new(ModFiles.Xml(bytes).Root!.Elements().Select(e =>
            KeyValuePair.Create<string, JsonNode?>((string)e.Attribute("id")!, LegacyCatalogConverter.Attr(e))));

    private static JsonObject CityMap(byte[] bytes) =>
        new(ModFiles.Xml(bytes).Root!.Elements().Select(e =>
            KeyValuePair.Create<string, JsonNode?>((string)e.Attribute("id")!, JsonValue.Create((string)e.Attribute("name")!))));

    private static Dictionary<string, string> Strings(byte[] bytes) => ModFiles.Text(bytes).Split('\n')
        .Where(line => line.Contains('=') && !line.TrimStart().StartsWith(';'))
        .Select(line => line.Split('=', 2)).GroupBy(pair => pair[0].Trim())
        .ToDictionary(group => group.Key, group => group.Last()[1].Trim(), StringComparer.Ordinal);

    private static JsonObject Countries(Func<string, byte[]> read, Func<string, byte[]> baselineRead,
        IEnumerable<string> scenarios)
    {
        var existing = (TryRead(read, "client/countries.json") ?? JsonNode.Parse(Encoding.UTF8.GetString(baselineRead("client/countries.json")))!).AsObject();
        var existingCountries = existing["countries"]?.AsObject() ?? new JsonObject();
        var catalog = ModFiles.Object(read("legacy/catalog.json"));
        var variants = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var country in ModFiles.Xml(read("original/def_army.xml")).Root!.Elements())
        {
            string id = (string)country.Attribute("name")!;
            if (id == "others") continue;
            variants[id] = [id];
        }
        foreach (string scenario in scenarios.Distinct(StringComparer.Ordinal))
        {
            byte[] bytes;
            try { bytes = read("original/" + scenario + ".btl"); }
            catch (FileNotFoundException) { continue; }
            foreach (var faction in LegacyBattle.Read(bytes).Factions)
            {
                if (!variants.TryGetValue(faction.CountryId, out var choices)) variants[faction.CountryId] = choices = [];
                choices.Add(faction.Variant);
            }
        }
        var strings = Strings(read("original/stringtable_cn.ini"));
        bool sameStrings = (string?)existing["sourceSha256"]?["stringtable_cn.ini"] == Convert.ToHexStringLower(SHA256.HashData(read("original/stringtable_cn.ini")));
        var result = new JsonObject { ["schema"] = 1, ["countries"] = new JsonObject() };
        var output = result["countries"]!.AsObject();
        foreach (var (id, choices) in variants.OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            if (existing["aliases"]?[id] != null) continue;
            string? variant = choices.Count == 1 ? choices.Single() : null;
            var prior = existingCountries[id] as JsonObject;
            var entry = new JsonObject
            {
                ["name"] = sameStrings && prior?["name"] != null ? (string?)prior["name"] : strings.GetValueOrDefault(id, strings.GetValueOrDefault("name_" + id,
                    (string?)prior?["name"] ?? id)),
                ["flag"] = variant,
                ["unitVariant"] = variant == null ? null : catalog["variants"]!.AsObject().ContainsKey(variant) ? variant : "others",
                ["visualVariant"] = variant
            };
            if (prior?["flagImage"] is JsonNode flagImage) entry["flagImage"] = flagImage.DeepClone();
            if (prior?["color"] is JsonNode color) entry["color"] = color.DeepClone();
            foreach (string field in new[] { "flag", "unitVariant", "visualVariant" })
                if (prior?.ContainsKey(field) == true) entry[field] = prior[field]?.DeepClone();
            if (entry["flagImage"] != null) entry.Remove("flag");
            output[id] = entry;
        }
        foreach (var (id, entry) in existingCountries) if (!output.ContainsKey(id)) output[id] = entry?.DeepClone();
        if (existing["aliases"] is JsonNode aliases) result["aliases"] = aliases.DeepClone();
        result["sourceSha256"] = new JsonObject
        {
            ["def_army.xml"] = Convert.ToHexString(SHA256.HashData(read("original/def_army.xml"))).ToLowerInvariant(),
            ["stringtable_cn.ini"] = Convert.ToHexString(SHA256.HashData(read("original/stringtable_cn.ini"))).ToLowerInvariant()
        };
        return result;
    }

    private static bool CopyRenamedCommanderSprites(JsonObject manifest, JsonObject commanders, JsonObject baseline,
        Dictionary<string, byte[]> files, Func<string, byte[]> baselineRead)
    {
        var atlases = manifest["atlases"]?.AsObject() ?? throw new InvalidDataException("manifest 缺少图集");
        var baselineAtlases = baseline["atlases"]?.AsObject() ?? throw new InvalidDataException("基线 manifest 缺少图集");
        var baselineCommanders = baseline["commanders"]?.AsObject() ?? throw new InvalidDataException("基线 manifest 缺少将领映射");
        bool changed = false;
        foreach (var (id, nameNode) in commanders)
        {
            string name = nameNode?.GetValue<string>() ?? throw new InvalidDataException("将领名称为空: " + id);
            string? oldName = (string?)baselineCommanders[id];
            if (oldName == null) continue;
            foreach (var (atlasName, sourceSprites) in baselineAtlases)
            {
                var source = sourceSprites?[oldName + ".png"];
                if (source == null) continue;
                var target = atlases[atlasName]?.AsObject() ?? throw new InvalidDataException("manifest 缺少图集: " + atlasName);
                if (target[name + ".png"] != null) continue;
                target[name + ".png"] = source.DeepClone();
                string oldPath = "client/ui/" + atlasName + "/" + oldName + ".png";
                string newPath = "client/ui/" + atlasName + "/" + name + ".png";
                try { files[newPath] = baselineRead(oldPath); } catch (FileNotFoundException) { }
                changed = true;
            }
        }
        return changed;
    }

    private static JsonNode? TryRead(Func<string, byte[]> read, string path)
    {
        try { return JsonNode.Parse(read(path)); }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
        catch (KeyNotFoundException) { return null; }
    }

    private static bool Replace(JsonObject root, string key, JsonNode? value)
    {
        if (value == null) return false;
        if (root[key] is JsonNode current && JsonEqual(current, value)) return false;
        root[key] = value; return true;
    }

    private static bool JsonEqual(JsonNode left, JsonNode right) =>
        left.ToJsonString(CompactJson) == right.ToJsonString(CompactJson);
}
