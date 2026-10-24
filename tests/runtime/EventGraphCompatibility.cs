using System.IO.Compression;
using System.Text.Json.Nodes;
using Ew4.Core;
using Ew4.Mods;
using Ew4.Persistence;

internal static class EventGraphCompatibility
{
    internal static void Run(string root)
    {
        byte[] Base(string path) => File.ReadAllBytes(Path.Combine(root, ".local/rewrite/data", path));
        var hashes = JsonNode.Parse(File.ReadAllBytes(Path.Combine(root, ".local/baseline.json")))!["files"]!.AsObject();
        var baseline = new ModBase(Base, hashes.Where(p => p.Key.StartsWith("data/")).Select(p => p.Key[5..]));
        using var zip = ZipFile.OpenRead(Path.Combine(root, ".local/runtime-compatibility/event-graphs.ew4mod"));
        byte[] Entry(string path) { using var stream = zip.GetEntry(path)!.Open(); using var output = new MemoryStream(); stream.CopyTo(output); return output.ToArray(); }
        var files = JsonNode.Parse(Entry("mod.json"))!["files"]!.AsObject();
        var content = baseline.Content(p => files.ContainsKey(p) ? Entry(p) : Base(p), ["conquest1", "conquest2"]);
        var country = content.Battle("conquest1").Factions[0].CountryId;
        var start = content.Start("conquest1", country);
        var owner = start.Session.World.Factions[0];
        var ready = ScenarioRules.Evaluate(start.Session.World with { Round = 999 }).State;
        Require(ready.PendingDialogue == ScenarioRules.DialogueId("editor.f0/root"), "scoped root opens");
        var yes = ScenarioRules.Choose(ready, ready.Revision, "editor.f0/root", "yes").State;
        Require(yes.ExtensionState["scenario/left"] == 1 && yes.ExtensionState["scenario/right"] == 1 && yes.ExtensionState["scenario/join"] == 1
            && yes.ExtensionState["scenario/either"] == 1 && !yes.ExtensionState.ContainsKey("scenario/rejected"), "parallel branches and all/any joins");
        Require(yes.Factions.Single(f => f.Id == owner.Id).Resources.Food == owner.Resources.Food + 31, "default effect targets owning country");
        Require(!yes.ExtensionState.ContainsKey("scenario/other-country") && !yes.ExtensionState.ContainsKey("scenario/other-btl"), "country and BTL gates preserved");
        var no = ScenarioRules.Choose(ready, ready.Revision, "editor.f0/root", "no").State;
        Require(no.ExtensionState["scenario/rejected"] == 1 && no.ExtensionState["scenario/either"] == 1 && !no.ExtensionState.ContainsKey("scenario/join"), "alternate choice suppresses yes branch");
        var session = start.Session with { World = yes };
        var restored = SessionSave.Decode(SessionSave.Encode(session), new(session.ContentRevision, session.World.ContentRevision, session.Account.ContentRevision));
        Require(restored.World.TriggeredScenarioEvents.Contains("editor.f0/join"), "compiled graph save restore");
        Console.WriteLine("Scoped event graph: real startup, both choices, parallel all/any joins, owner targets and save restore passed");
    }
    private static void Require(bool condition, string message) { if (!condition) throw new Exception(message); }
}
