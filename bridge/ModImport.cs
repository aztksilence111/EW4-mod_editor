using System.Text.Json;
using Ew4.Mods;

namespace Ew4.Editor;

public sealed partial class AuthorEngine
{
    public object PreviewMod(ModImportRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            if (string.IsNullOrWhiteSpace(request.TaskId) || request.TaskId.Length > 100 || state.Applied.ContainsKey(request.TaskId))
                throw new InvalidDataException("导入任务无效或已经提交");
            if (request.Mode is not ("replace" or "merge") || request.Conflict is not ("reject" or "keep" or "incoming"))
                throw new InvalidDataException("请选择导入方式和冲突策略");
            if (request.Package == null || request.Package.Length > 28 * 1024 * 1024) throw new InvalidDataException("内容包不能超过 20 MiB");
            byte[] package = Convert.FromBase64String(request.Package);
            if (package.Length is 0 or > 20 * 1024 * 1024) throw new InvalidDataException("内容包不能超过 20 MiB");
            string job = Path.Combine(home, "imports", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(job);
            string archive = Path.Combine(job, "source.ew4mod"); File.WriteAllBytes(archive, package);
            // Reuse the engine's archive path, duplicate, hash and resource checks before materializing overrides.
            using (var source = new ImportSource(archive))
            {
                if (!source.Contains("mod.json")) throw new InvalidDataException("请选择带 mod.json 的 Rewrite .ew4mod 内容包");
                var incoming = JsonSerializer.Deserialize<ModManifest>(source.Read("mod.json"), Json) ?? throw new InvalidDataException("清单无效");
                if (incoming.Files == null || incoming.Scenarios == null || incoming.Warnings == null) throw new InvalidDataException("清单字段缺失");
                long total = 0;
                foreach (string path in incoming.Files.Keys)
                {
                    byte[] bytes = source.Read(path);
                    total = checked(total + bytes.Length);
                    if (total > 64 * 1024 * 1024) throw new InvalidDataException("作者导入的展开资源不能超过 64 MiB");
                }
            }
            string packageHash = Hash(package);
            ModManifest manifest; Dictionary<string, byte[]> files; ModStore? store = null;
            if (importCache.TryGetValue(packageHash, out var cached)) { manifest = cached.Manifest; files = new(cached.Files, StringComparer.Ordinal); }
            else
            {
                store = new ModStore(baseline, Path.Combine(job, "mods"), Path.Combine(job, "preview-saves"));
                var info = store.Import(archive, "editor-import", "Editor import");
                string installed = ModFiles.Under(store.Root, info.Key);
                manifest = store.Validate(installed);
                files = manifest.Files.Keys.ToDictionary(p => p, p => File.ReadAllBytes(ModFiles.Under(installed, p)), StringComparer.Ordinal);
                importCache[packageHash] = (manifest, new(files, StringComparer.Ordinal));
            }
            var conflicts = files.Where(p => state.Files.TryGetValue(p.Key, out var current) && !current.AsSpan().SequenceEqual(p.Value))
                .Select(p => new { path = p.Key, currentHash = Hash(state.Files[p.Key]), incomingHash = Hash(p.Value), baselineHash = sourceHashes.GetValueOrDefault(p.Key) }).ToArray();
            if (request.Mode == "merge" && request.Conflict == "reject" && conflicts.Length > 0)
                return new { token = "", request.TaskId, state.Revision, count = 0, changes = Array.Empty<Diff>(), conflicts,
                    affectedScenarios = manifest.Scenarios.Length, package = new { manifest.Id, manifest.Name, manifest.Version, warnings = manifest.Warnings } };

            var next = request.Mode == "replace" ? new Dictionary<string, byte[]>(StringComparer.Ordinal) : new(state.Files, StringComparer.Ordinal);
            var accepted = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var (path, bytes) in files)
            {
                if (request.Mode == "merge" && request.Conflict == "keep" && state.Files.ContainsKey(path)) continue;
                next[path] = bytes; accepted[path] = manifest.Files[path];
            }
            string[] scenarios = request.Mode == "replace" ? manifest.Scenarios : Scenarios.Union(manifest.Scenarios).ToArray();
            PresentationResources.Synchronize(next, path => Read(next, path), BaseRead, scenarios);
            var sourceInfo = new AuthorSource(manifest.Id, manifest.Name, manifest.Version, packageHash, accepted);
            var prior = state.Sources ?? [];
            if (request.Mode == "merge" && prior.LastOrDefault(s => s.PackageHash == sourceInfo.PackageHash) is { } same)
                sourceInfo = sourceInfo with { Files = same.Files.Concat(accepted).GroupBy(p => p.Key).ToDictionary(g => g.Key, g => g.Last().Value) };
            var sources = request.Mode == "replace" ? new[] { sourceInfo } : accepted.Count == 0 ? prior
                : prior.Where(s => s.PackageHash != sourceInfo.PackageHash).Append(sourceInfo).ToArray();
            var snapshot = new AuthorSnapshot(next, scenarios, sources);
            CheckState(state with { Files = next, Scenarios = scenarios, Sources = sources, Undo = [], Redo = [] });
            string candidate = Path.Combine(job, "candidate"); Directory.CreateDirectory(candidate);
            foreach (var (path, bytes) in next) ModFiles.Write(candidate, path, bytes);
            ProjectResourceValidation.Check(path => Read(next, path), baseline.Files.Union(next.Keys).ToHashSet(StringComparer.Ordinal));
            if (store != null) { store.Seal(candidate, manifest.Id, manifest.Name, manifest.Version, scenarios); store.Validate(candidate); }
            CheckContent(next, scenarios, true, scenarios);

            var diffs = new List<Diff>();
            foreach (string path in state.Files.Keys.Union(next.Keys).Order(StringComparer.Ordinal))
            {
                byte[]? before = state.Files.GetValueOrDefault(path) ?? (sourceHashes.ContainsKey(path) ? BaseRead(path) : null);
                byte[]? after = next.GetValueOrDefault(path) ?? (sourceHashes.ContainsKey(path) ? BaseRead(path) : null);
                if (before == null && after == null || before != null && after != null && before.AsSpan().SequenceEqual(after)) continue;
                diffs.Add(new(path, "file", "sha256", before == null ? "(新增)" : Hash(before), after == null ? "(删除)" : Hash(after)));
            }
            if (Hash(Bytes(Snapshot with { Files = [] })) != Hash(Bytes(snapshot with { Files = [] })))
                diffs.Add(new("工程", "import", "来源与剧本清单", string.Join(',', (state.Sources ?? []).Select(s => s.Id)), manifest.Id));
            string token = Guid.NewGuid().ToString("N"); if (pending.Count >= 8) pending.Clear();
            pending[token] = new(new(request.Revision, request.TaskId, scenarios, []), token, snapshot, diffs.ToArray(), Hash(Bytes(Snapshot)));
            return new { token, request.TaskId, state.Revision, count = diffs.Count, changes = diffs, conflicts, affectedScenarios = scenarios.Length,
                package = new { manifest.Id, manifest.Name, manifest.Version, warnings = manifest.Warnings } };
        }
    }
}
