using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Ew4.Core;
using Ew4.Legacy;
using Ew4.Mods;
using Ew4.Persistence;

internal static class StructuralBrowserCompatibility
{
    internal static void Run(string root)
    {
        string directory = Path.Combine(root, ".local/runtime-compatibility");
        byte[] Read(string path) => File.ReadAllBytes(Path.Combine(root, ".local/rewrite/data", path));
        var baselineManifest = JsonNode.Parse(File.ReadAllBytes(Path.Combine(root, ".local/baseline.json")))!;
        var baseline = new ModBase(Read, baselineManifest["files"]!.AsObject()
            .Where(p => p.Key.StartsWith("data/", StringComparison.Ordinal)).Select(p => p.Key[5..]));
        var results = new List<object>();
        foreach (int width in new[] { 1440, 390 })
        {
            using var zip = ZipFile.OpenRead(Path.Combine(directory, $"structural-browser-{width}.ew4mod"));
            byte[] Entry(string path)
            {
                using var stream = zip.GetEntry(path)!.Open();
                using var buffer = new MemoryStream(); stream.CopyTo(buffer); return buffer.ToArray();
            }
            var manifest = JsonNode.Parse(Entry("mod.json"))!;
            var files = manifest["files"]!.AsObject();
            foreach (var (path, hash) in files)
                if (Convert.ToHexStringLower(SHA256.HashData(Entry(path))) != hash!.GetValue<string>())
                    throw new Exception("Package hash mismatch: " + path);
            const string battlePath = "original/conquest1.btl";
            var bytes = Entry(battlePath);
            if (!bytes.AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(directory, "structural-first.btl"))))
                throw new Exception("Browser package differs from verified structural output");
            File.WriteAllBytes(Path.Combine(directory, $"structural-browser-{width}.btl"), bytes);
            var battle = LegacyBattle.Read(bytes);
            var content = baseline.Content(p => files.ContainsKey(p) ? Entry(p) : Read(p), ["conquest1"]);
            var started = content.Start("conquest1", "fra");
            void Verify(Ew4.Core.GameSession session)
            {
                if (session.World.Units.Count != battle.Armies.Count) throw new Exception("Unit count mismatch");
                foreach (var (army, slot) in battle.Armies.Select((a, i) => (a, i)))
                    if (session.World.Units.Single(u => u.Id == "conquest1.unit." + slot).Cell != army.Cell)
                        throw new Exception("Unit slot/cell mismatch");
                if (session.Markets.Count == 0 || session.TavernCandidates.Count == 0)
                    throw new Exception("Independent commerce missing");
                ExtensionVictory.ValidateTargets(battle.Victory!, session.World, initial: true);
            }
            Verify(started.Session);
            var restored = SessionSave.Decode(SessionSave.Encode(started.Session), new(started.Session.ContentRevision,
                started.Session.World.ContentRevision, started.Session.Account.ContentRevision));
            Verify(restored);
            results.Add(new { width, packageHashes = true, startup = true, saveRestore = true,
                armies = battle.Armies.Count, sha256 = Convert.ToHexStringLower(SHA256.HashData(bytes)) });
        }
        File.WriteAllText(Path.Combine(directory, "structural-browser-runtime-result.json"),
            JsonSerializer.Serialize(results, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine("Structural browser packages: 2 startup/save restore checks passed");
    }
}
