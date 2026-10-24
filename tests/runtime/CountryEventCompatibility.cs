using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Ew4.Core;
using Ew4.Mods;
using Ew4.Persistence;

internal static class CountryEventCompatibility
{
    internal static void Run(string root)
    {
        byte[] Base(string path) => File.ReadAllBytes(Path.Combine(root, ".local/rewrite/data", path));
        var hashes = JsonNode.Parse(File.ReadAllBytes(Path.Combine(root, ".local/baseline.json")))!["files"]!.AsObject();
        var baseline = new ModBase(Base, hashes.Where(p => p.Key.StartsWith("data/", StringComparison.Ordinal)).Select(p => p.Key[5..]));
        using var zip = ZipFile.OpenRead(Path.Combine(root, ".local/runtime-compatibility/countries-events.ew4mod"));
        byte[] Entry(string path) { using var stream = zip.GetEntry(path)!.Open(); using var output = new MemoryStream(); stream.CopyTo(output); return output.ToArray(); }
        var files = JsonNode.Parse(Entry("mod.json"))!["files"]!.AsObject();
        foreach (var (path, hash) in files) Require(Convert.ToHexStringLower(SHA256.HashData(Entry(path))) == (string)hash!, "package hash: " + path);
        var content = baseline.Content(p => files.ContainsKey(p) ? Entry(p) : Base(p), ["conquest1", "conquest2"]);
        var country = content.Country("test.republic")!;
        Require(country.Name == "测试共和国" && country.Color == "#247a4d80" && country.FlagImage == null, "country metadata");
        Require(content.Country("fra")!.Name == "法兰西新名称", "alias and rename");
        var atlas = JsonNode.Parse(Entry("client/manifest.json"))!["atlases"]!;
        foreach (string name in new[] { "buildings", "buildings_hd" }) for (int i = 1; i <= 4; i++) Require(atlas[name]![country.Flag + i + ".png"] != null, "animation frame");
        var battle = content.Battle("conquest1");
        Require(battle.CountryIds != null && battle.Factions.Any(f => f.CountryId == "test.republic"), "CNTR country");
        var start = content.Start("conquest1", "test.republic");
        Require(start.Session.World.Factions.Any(f => f.Name == country.Name), "startup country name");
        var world = start.Session.World with { Round = 999 };
        var triggered = ScenarioRules.Evaluate(world).State;
        Require(triggered.ExtensionState["scenario/supply"] == 1 && triggered.PendingDialogue == ScenarioRules.DialogueId("council"), "dependency tree and pending popup");
        var chosen = ScenarioRules.Choose(triggered, triggered.Revision, "council", "yes").State;
        var finished = ScenarioRules.Evaluate(chosen).State;
        Require(finished.ExtensionState["scenario/branch"] == 7 && finished.ExtensionState["scenario/complete"] == 1, "popup branch and following event");
        var session = start.Session with { World = finished };
        var restored = SessionSave.Decode(SessionSave.Encode(session), new(session.ContentRevision, session.World.ContentRevision, session.Account.ContentRevision));
        Require(restored.World.ExtensionState["scenario/branch"] == 7 && restored.World.TriggeredScenarioEvents.Contains("aftermath"), "save restore");
        Require(content.Extensions.ScenarioEvents["conquest2"].Single().Id == "other-scenario", "other scenario preserved");
        Console.WriteLine("Country flags/CNTR and event branches: package hashes, startup, execution and save restore passed");
    }
    private static void Require(bool condition, string message) { if (!condition) throw new Exception(message); }
}
