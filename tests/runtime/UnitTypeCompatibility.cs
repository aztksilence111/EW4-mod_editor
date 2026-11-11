using System.Text.Json;
using System.Text.Json.Nodes;
using Ew4.Core;
using Ew4.Mods;
using Ew4.Persistence;

internal static class UnitTypeCompatibility
{
    internal static void Run(string root, string home, string artifact)
    {
        int checks = 0;
        void Check(bool value, string label) { checks++; if (!value) throw new Exception(label); }
        var document = JsonNode.Parse(File.ReadAllBytes(Path.Combine(home, "author.json")))!;
        var overrides = document["files"]!.AsObject().ToDictionary(p => p.Key, p => Convert.FromBase64String((string)p.Value!));
        var manifest = JsonNode.Parse(File.ReadAllBytes(Path.Combine(home, "baseline.json")))!;
        byte[] Read(string path) => File.ReadAllBytes(Path.Combine(home, "rewrite/data", path));
        var paths = manifest["files"]!.AsObject().Where(p => p.Key.StartsWith("data/")).Select(p => p.Key[5..]).ToArray();
        var baseline = new ModBase(Read, paths);
        var content = baseline.Content(p => overrides.GetValueOrDefault(p) ?? Read(p), ["conquest1", "conquest2"]);
        var start = content.Start("conquest1", "fra");
        var world = start.Session.World;
        Check(world.Units.Single(u => u.Id == "editor.check.spawn").Combatant.Profile.Id == "editor.unit.rifle.0", "opening independent reinforcement");
        Check(content.Catalogs.Runtime.Profiles["editor.unit.rifle.0"].Profile.MaxHealth == 401, "editor custom attributes");
        Check(content.Catalogs.Runtime.Profiles["ew4.unit.fra.militia.0"].Profile.MaxHealth == 60, "editor original retained");
        var restored = SessionSave.Decode(SessionSave.Encode(start.Session), new(start.Session.ContentRevision, world.ContentRevision, start.Session.Account.ContentRevision));
        Check(restored.World.Units.Single(u => u.Id == "editor.check.spawn").Combatant.Profile.MaxHealth == 401, "reinforcement attributes restored");
        var evaluated = ScenarioRules.Evaluate(restored.World, content.Extensions.Bus.Scripts).State;
        Check(evaluated.Units.Count(u => u.Id == "editor.check.spawn") == 1, "reload does not duplicate opening reinforcement");
        var store = new ModStore(baseline, Path.Combine(artifact, "mods"), Path.Combine(artifact, "saves"));
        var installed = store.Import(Path.Combine(artifact, "units.ew4mod"), "ignored", "ignored");
        store.Activate(installed.Key);
        using var reply = JsonDocument.Parse(store.Dispatch("/api/start", "{\"scenario\":\"conquest1\",\"country\":\"fra\"}"));
        Check(reply.RootElement.GetProperty("ok").GetBoolean(), "exported mod starts through real client");
        using var save = JsonDocument.Parse(store.Dispatch("/api/save", "{\"slot\":1}"));
        Check(save.RootElement.GetProperty("ok").GetBoolean(), "client save");
        using var reload = JsonDocument.Parse(store.Dispatch("/api/load", "{\"slot\":1}"));
        Check(reload.RootElement.GetProperty("ok").GetBoolean(), "client reload");
        var reloaded = reload.RootElement.GetProperty("data").GetProperty("units").EnumerateArray();
        Check(reloaded.Count(u => u.GetProperty("id").GetString() == "editor.check.spawn" && u.GetProperty("profile").GetString() == "editor.unit.rifle.0") == 1, "real client reload keeps unique custom unit");
        Console.WriteLine(JsonSerializer.Serialize(new { unitTypeRuntimeChecks = checks, errors = 0 }));
    }
}
