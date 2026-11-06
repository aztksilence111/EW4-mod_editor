using System.Text.Json.Nodes;
using Ew4.Legacy;
using Ew4.Mods;

namespace Ew4.Editor;

internal static class AuthorCatalog
{
    internal static LegacyCatalogFiles Load(Func<string, byte[]> read) => LegacyCatalogFiles.Load(path => read(path.StartsWith("data/", StringComparison.Ordinal) ? "legacy/" + path[5..] : path));
    internal static JsonObject Read(Func<string, byte[]> read) => Load(read).Catalog;
    internal static void Write(Dictionary<string, byte[]> files, Func<string, byte[]> read, JsonObject catalog)
    {
        var bundle = Load(read);
        if (!bundle.IsSplit) { files["legacy/catalog.json"] = LegacyCatalogFiles.Encode(catalog); return; }
        foreach (var (name, bytes) in LegacyCatalogFiles.Split(catalog, bundle.RuntimeRules, bundle.MetagameRules))
        {
            string path = "legacy/" + name;
            if (!JsonNode.DeepEquals(ModFiles.Object(read(path)), ModFiles.Object(bytes))) files[path] = bytes;
        }
    }
}
