using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;
using Ew4.Client;
using Ew4.Core;
using Ew4.Legacy;
using Ew4.Mods;

namespace Ew4.Editor;

public sealed record StoryRequest(int Revision, string TaskId, JsonObject? Catalog = null,
    Dictionary<string, string>? Files = null, string? Package = null);
public sealed record StoryPlayRequest(int Revision, string Scenario, string Scene, JsonObject Catalog);
public sealed record StoryActionRequest(string Session, string Op, long Revision, string? Offer, string? Tag, string? Target);

public sealed partial class AuthorEngine
{
    private sealed record StorySession(ClientGame Game, Dictionary<string, byte[]> Files, DateTime Created);
    private readonly Dictionary<string, StorySession> storySessions = new(StringComparer.Ordinal);
    private string StoryCatalogPath(Dictionary<string, byte[]> files) => (string?)EventDocument(files).Manifest["storyPresentation"] ?? "rewrite/story/catalog.json";
    public object Stories()
    {
        lock (gate)
        {
            var path = StoryCatalogPath(state.Files);
            var catalog = sourceHashes.ContainsKey(path) || state.Files.ContainsKey(path) ? ModFiles.Object(Read(state.Files, path))
                : new JsonObject { ["schema"] = 1, ["backgrounds"] = new JsonObject(), ["characters"] = new JsonObject(),
                    ["scenes"] = new JsonObject(), ["bindings"] = new JsonObject() };
            var scenes = catalog["scenes"] as JsonObject ?? new JsonObject();
            foreach (var file in catalog["sceneFiles"] as JsonArray ?? [])
            {
                var scene = ModFiles.Object(Read(state.Files, ModFiles.PathName(file!.GetValue<string>())));
                scenes.Add(scene["id"]!.GetValue<string>(), scene.DeepClone());
            }
            catalog["sceneFiles"] = new JsonArray(); catalog["scenes"] = scenes.DeepClone();
            return new { state.Revision, path, catalog, images = sourceHashes.Keys.Union(state.Files.Keys)
                .Where(p => StoryValidation.Media(p)).OrderBy(p => p, StringComparer.Ordinal).ToArray() };
        }
    }
    private Dictionary<string, byte[]> StoryCandidate(StoryRequest request)
    {
        Revision(request.Revision);
        var next = new Dictionary<string, byte[]>(state.Files, StringComparer.Ordinal);
        var incoming = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        long total = 0;
        void Add(string path, byte[] bytes)
        {
            path = ModFiles.PathName(path);
            total += bytes.Length;
            if (incoming.Count >= 4096 || total > 256L * 1024 * 1024 || bytes.Length > 16 * 1024 * 1024)
                throw new InvalidDataException("素材包超过限制：4096 文件 / 256 MiB，单文件 16 MiB");
            if (!incoming.TryAdd(path, bytes)) throw new InvalidDataException("素材路径重复（含大小写）: " + path);
        }
        if (request.Package != null)
        {
            var package = Convert.FromBase64String(request.Package);
            if (package.Length > 256 * 1024 * 1024) throw new InvalidDataException("ZIP 超过 256 MiB");
            using var zip = new ZipArchive(new MemoryStream(package), ZipArchiveMode.Read);
            foreach (var entry in zip.Entries)
            {
                if (entry.FullName.EndsWith('/')) continue;
                // Validate every path, even unsupported files, before selecting reusable resources.
                ModFiles.PathName(entry.FullName);
                if (entry.Length > 16 * 1024 * 1024 || total + entry.Length > 256L * 1024 * 1024)
                    throw new InvalidDataException("ZIP 展开大小超过限制");
                using var stream = entry.Open(); using var output = new MemoryStream();
                var buffer = new byte[81920]; int count;
                while ((count = stream.Read(buffer)) > 0)
                {
                    if (output.Length + count > 16 * 1024 * 1024) throw new InvalidDataException("ZIP 文件展开大小超过限制");
                    output.Write(buffer, 0, count);
                }
                Add(entry.FullName, output.ToArray());
            }
        }
        foreach (var (path, value) in request.Files ?? []) Add(path, Convert.FromBase64String(value));
        // A folder or ZIP may contain a single enclosing directory.
        while (incoming.Count > 0 && !incoming.Keys.Any(p => p.StartsWith("rewrite/") || p.StartsWith("client/") || p.StartsWith("assets/"))
            && incoming.Keys.All(p => p.Contains('/')) && incoming.Keys.Select(p => p.Split('/')[0]).Distinct().Count() == 1)
            incoming = incoming.ToDictionary(p => p.Key[(p.Key.IndexOf('/') + 1)..], p => p.Value, StringComparer.OrdinalIgnoreCase);
        foreach (var (path, bytes) in incoming.Where(p => p.Key.EndsWith(".png", StringComparison.OrdinalIgnoreCase)))
        {
            if (bytes.Length < 24 || !bytes.Take(8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })
                || System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(16, 4)) is 0 or > 4096
                || System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(20, 4)) is 0 or > 4096)
                throw new InvalidDataException("剧情 PNG 最大为 4096×4096: " + path);
            var raster = Raster.Decode(bytes);
            if (raster.Width > 4096 || raster.Height > 4096) throw new InvalidDataException("剧情 PNG 最大为 4096×4096: " + path);
            string target = path.StartsWith("rewrite/", StringComparison.Ordinal) || path.StartsWith("client/", StringComparison.Ordinal)
                ? path : "rewrite/story/media/" + path;
            if (!StoryValidation.Media(target)) throw new InvalidDataException("剧情素材路径无效: " + path);
            next[target] = bytes;
        }
        JsonObject? catalog = request.Catalog?.DeepClone().AsObject();
        if (incoming.TryGetValue("rewrite/extension.json", out var manifestBytes))
        {
            string? importedPath = (string?)ModFiles.Object(manifestBytes)["storyPresentation"];
            if (importedPath != null)
            {
                importedPath = ModFiles.PathName(importedPath);
                if (!incoming.TryGetValue(importedPath, out var raw)) throw new InvalidDataException("素材包缺少剧情目录: " + importedPath);
                catalog ??= ModFiles.Object(raw);
                foreach (var node in catalog["sceneFiles"] as JsonArray ?? [])
                {
                    string scenePath = ModFiles.PathName(node!.GetValue<string>());
                    if (!scenePath.StartsWith("rewrite/", StringComparison.Ordinal) || !scenePath.EndsWith(".json", StringComparison.Ordinal)
                        || !incoming.TryGetValue(scenePath, out var scene)) throw new InvalidDataException("素材包缺少场景: " + scenePath);
                    next[scenePath] = scene;
                }
            }
        }
        if (catalog != null)
        {
            var manifest = EventDocument(next).Manifest;
            string path = StoryCatalogPath(next);
            if (!path.StartsWith("rewrite/", StringComparison.Ordinal) || !path.EndsWith(".json", StringComparison.Ordinal)) throw new InvalidDataException("剧情目录路径无效");
            manifest["apiVersion"] = Math.Max(3, (int?)manifest["apiVersion"] ?? 0); manifest["storyPresentation"] = path;
            next[path] = Bytes(catalog); next["rewrite/extension.json"] = Bytes(manifest);
        }
        CheckState(state with { Files = next }); CheckResources(next);
        _ = Content(next); // The same API 3 loader and validators used on Android and Web.
        return next;
    }
    public object PreviewStories(StoryRequest request)
    {
        lock (gate)
        {
            if (string.IsNullOrWhiteSpace(request.TaskId) || request.TaskId.Length > 100 || state.Applied.ContainsKey(request.TaskId)) throw new InvalidDataException("剧情任务 ID 无效");
            var next = StoryCandidate(request);
            var diffs = next.Where(p => !state.Files.TryGetValue(p.Key, out var old) || !old.SequenceEqual(p.Value))
                .Where(p => !sourceHashes.TryGetValue(p.Key, out var hash) || Hash(p.Value) != hash || state.Files.ContainsKey(p.Key))
                .Select(p => new Diff(p.Key, "story", "sha256", sourceHashes.ContainsKey(p.Key) || state.Files.ContainsKey(p.Key) ? Hash(Read(state.Files, p.Key)) : "", Hash(p.Value))).ToList();
            return StoreResourcePreview(request.Revision, request.TaskId, next, diffs, Scenarios.Length);
        }
    }
    public byte[] StoryImage(string path, string? session = null)
    {
        lock (gate)
        {
            if (!StoryValidation.Media(path)) throw new InvalidDataException("剧情图片路径无效");
            return Read(session == null ? state.Files : RequireStorySession(session).Files, path);
        }
    }
    private StorySession RequireStorySession(string id) => storySessions.TryGetValue(id, out var session) && DateTime.UtcNow - session.Created < TimeSpan.FromHours(6)
        ? session : throw new InvalidDataException("剧情预览已失效，请重新播放");
    public object PlayStory(StoryPlayRequest request)
    {
        lock (gate)
        {
            if (!Scenarios.Contains(request.Scenario)) throw new InvalidDataException("剧本不存在");
            var next = StoryCandidate(new(request.Revision, "preview", request.Catalog));
            string path = StoryCatalogPath(next); var catalog = ModFiles.Object(next[path]);
            var bindings = catalog["bindings"] as JsonObject ?? new JsonObject();
            bindings[request.Scenario] = new JsonObject { ["openingStory"] = new JsonObject { ["key"] = "editor.preview", ["scene"] = request.Scene } };
            catalog["bindings"] = bindings; next[path] = Bytes(catalog);
            var content = Content(next); string id = Guid.NewGuid().ToString("N");
            var game = new ClientGame(content, Path.Combine(home, "story-previews", id));
            var battle = content.Battle(request.Scenario);
            string? country = content.Scenarios.Single(s => s.Id == request.Scenario).Mode == 2 ? battle.Factions.First(f => f.Camp != 4).CountryId : null;
            var response = ModFiles.Object(Encoding.UTF8.GetBytes(game.Dispatch("/api/start", System.Text.Json.JsonSerializer.Serialize(new { scenario = request.Scenario, country }))));
            if ((bool?)response["ok"] != true) throw new InvalidDataException((string?)response["message"] ?? "剧情预览启动失败");
            if (storySessions.Count >= 4) storySessions.Remove(storySessions.MinBy(p => p.Value.Created).Key);
            storySessions[id] = new(game, next, DateTime.UtcNow);
            return new { session = id, response };
        }
    }
    public JsonObject StoryAction(StoryActionRequest request)
    {
        lock (gate)
        {
            if (request.Op is not ("state" or "story_next" or "story_choice" or "story_skip")) throw new InvalidDataException("仅允许剧情预览操作");
            return ModFiles.Object(Encoding.UTF8.GetBytes(RequireStorySession(request.Session).Game.Dispatch("/api/action",
                System.Text.Json.JsonSerializer.Serialize(request, Json))));
        }
    }
    public byte[] StoryPlayerAsset(string path)
    {
        ModFiles.PathName(path);
        if (path is not ("story-player.js" or "story-player.css") && !(path.StartsWith("story-icons/", StringComparison.Ordinal) && path.EndsWith(".svg", StringComparison.Ordinal)))
            throw new InvalidDataException("播放器资源无效");
        var bytes = File.ReadAllBytes(ModFiles.Under(Path.Combine(home, "rewrite/player"), path));
        return path == "story-player.js" ? Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(bytes).Replace("'/story-icons/", "'/editor-api/player/story-icons/", StringComparison.Ordinal)) : bytes;
    }
}
