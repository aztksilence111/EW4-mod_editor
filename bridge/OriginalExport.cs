using System.IO.Compression;
using System.Text.Json.Nodes;
using Ew4.Mods;

namespace Ew4.Editor;

public sealed record OriginalExportRequest(int Revision, string Scope = "project", string Layout = "rewrite");
public sealed record BtlExportRequest(int Revision, string Scenario);

public sealed partial class AuthorEngine
{
    public byte[] ExportOriginal(OriginalExportRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            if (request.Scope is not ("project" or "commanders" or "countries"))
                throw new InvalidDataException("未知资源导出范围");
            if (request.Layout is not ("rewrite" or "legacy")) throw new InvalidDataException("未知资源目录布局");
            var files = PrepareExport();
            if (request.Scope == "project")
            {
                // Include each BTL even when only its external event tree was edited.
                foreach (string id in Scenarios) files.TryAdd(ScenarioPath(id), Read(files, ScenarioPath(id)));
            }
            else files = ResourceExportFiles(files, request.Scope);
            CheckResources(files);
            CheckContent(files, Scenarios, true);
            if (request.Layout == "legacy") files = LegacyResourceExport(files);
            using var output = new MemoryStream();
            using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
                foreach (var (path, bytes) in files.OrderBy(p => p.Key, StringComparer.Ordinal))
                {
                    Ew4.Mods.ModFiles.PathName(path);
                    using var stream = archive.CreateEntry(path, CompressionLevel.Optimal).Open();
                    stream.Write(bytes);
                }
            return output.ToArray();
        }
    }

    private Dictionary<string, byte[]> ResourceExportFiles(Dictionary<string, byte[]> prepared, string scope)
    {
        var result = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var pending = new Queue<string>();
        void Include(string path)
        {
            if (result.TryAdd(path, Read(prepared, path))) pending.Enqueue(path);
        }
        Include("legacy/catalog.json");
        Include("client/manifest.json");
        if (scope == "commanders") Include("original/def_commander.xml");
        else
        {
            Include("client/countries.json");
            Include("original/stringtable_cn.ini");
            foreach (string id in Scenarios) Include(ScenarioPath(id));
        }
        if (prepared.ContainsKey("rewrite/extension.json") || CommanderBindingsPath(prepared) != null)
        {
            Include("rewrite/extension.json");
            // Script targets may depend on changed faction slots/country bindings in these BTLs.
            foreach (string id in Scenarios)
                if (prepared.ContainsKey(ScenarioPath(id))) Include(ScenarioPath(id));
        }

        // Catalog hashes and sprite maps are shared files: retain their changed sources/assets together.
        foreach (string source in LegacyCatalogConverter.Sources)
            if (prepared.ContainsKey("original/" + source)) Include("original/" + source);
        foreach (string path in prepared.Keys.Where(p => p.StartsWith("client/", StringComparison.Ordinal)
            || p.StartsWith("frontend/", StringComparison.Ordinal))) Include(path);
        while (pending.TryDequeue(out string? path))
        {
            if (!path.EndsWith(".json", StringComparison.Ordinal)) continue;
            Visit(JsonNode.Parse(result[path]));
        }
        return result;

        void Visit(JsonNode? node)
        {
            if (node is JsonObject obj) { foreach (var pair in obj) Visit(pair.Value); }
            else if (node is JsonArray array) { foreach (var item in array) Visit(item); }
            else if (node is JsonValue value && value.TryGetValue<string>(out string? reference)
                && (prepared.ContainsKey(reference) || sourceHashes.ContainsKey(reference))) Include(reference);
        }
    }

    public byte[] ExportBtl(BtlExportRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            if (!Scenarios.Contains(request.Scenario)) throw new InvalidDataException("剧本不在当前工程中");
            var prepared = PrepareExport();
            CheckContent(prepared, [request.Scenario], true);
            return Read(prepared, ScenarioPath(request.Scenario));
        }
    }
}
