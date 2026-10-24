using System.IO.Compression;
using System.Text.Json.Nodes;
using System.Text;
using System.Xml.Linq;
using Ew4.Core;
using Ew4.Mods;

internal static class OriginalExportCompatibility
{
    internal static void Run(string root)
    {
        byte[] Base(string path) => File.ReadAllBytes(Path.Combine(root, ".local/rewrite/data", path));
        var hashes = JsonNode.Parse(File.ReadAllBytes(Path.Combine(root, ".local/baseline.json")))!["files"]!.AsObject();
        var baseline = new ModBase(Base, hashes.Where(p => p.Key.StartsWith("data/")).Select(p => p.Key[5..]));
        using var zip = ZipFile.OpenRead(Path.Combine(root, ".local/runtime-compatibility/original-resources.zip"));
        using var mod = ZipFile.OpenRead(Path.Combine(root, ".local/runtime-compatibility/original-resources.ew4mod"));
        byte[] Read(ZipArchive archive, string path) { using var input = archive.GetEntry(path)!.Open(); using var output = new MemoryStream(); input.CopyTo(output); return output.ToArray(); }
        Require(zip.GetEntry("mod.json") == null, "raw export must not be an ew4mod package");
        Require(zip.GetEntry("original/conquest1.btl") != null && zip.GetEntry("original/conquest2.btl") != null, "all project BTLs included");
        Require(zip.GetEntry("rewrite/extension.json") != null && zip.GetEntry("rewrite/editor-events.json") != null
            && zip.GetEntry("client/editor-event-graphs.json") != null, "runtime event definitions, registration and editable layout retained");
        Require(Read(zip,"original/conquest1.btl").AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(root,".local/runtime-compatibility/original-conquest1.btl"))), "single BTL bytes match resource ZIP");
        var files = JsonNode.Parse(Read(mod,"mod.json"))!["files"]!.AsObject();
        foreach (var pair in files) Require(Read(mod,pair.Key).AsSpan().SequenceEqual(Read(zip,pair.Key)), "matching raw bytes: " + pair.Key);
        var content = baseline.Content(p => zip.GetEntry(p) != null ? Read(zip,p) : Base(p), ["conquest1","conquest2"]);
        var country = content.Battle("conquest1").Factions[0].CountryId;
        var start = content.Start("conquest1",country);
        var ready = ScenarioRules.Evaluate(start.Session.World with {Round=999}).State;
        Require(ready.PendingDialogue == ScenarioRules.DialogueId("editor.f0/root"), "raw resource extension opens event");
        var chosen = ScenarioRules.Choose(ready,ready.Revision,"editor.f0/root","yes").State;
        Require(chosen.ExtensionState["scenario/original-export"] == 7,"raw resource branch runs");
        foreach (string scope in new[] { "commanders", "countries" })
        {
            using var scoped = ZipFile.OpenRead(Path.Combine(root,".local/runtime-compatibility/" + scope + "-resources.zip"));
            Require(scoped.GetEntry("mod.json") == null, scope + " is an original resource ZIP");
            foreach (string path in new[] { "original/def_commander.xml", "legacy/catalog.json", "client/manifest.json",
                "client/countries.json", "original/stringtable_cn.ini", "client/images/buildings.png", "client/images/buildings_hd.png",
                "client/ui/commanders1_hd/Napoleon_Raw.png", "rewrite/extension.json", "rewrite/editor-events.json", "original/conquest1.btl" })
                Require(scoped.GetEntry(path) != null, scope + " dependency retained: " + path);
            foreach (var entry in scoped.Entries)
                Require(Read(scoped,entry.FullName).AsSpan().SequenceEqual(Read(zip,entry.FullName)), scope + " original bytes: " + entry.FullName);
            var overlay = baseline.Content(p => scoped.GetEntry(p) != null ? Read(scoped,p) : Base(p), ["conquest1","conquest2"]);
            var startup = overlay.Start("conquest1",overlay.Battle("conquest1").Factions[0].CountryId);
            var trigger = ScenarioRules.Evaluate(startup.Session.World with {Round=999}).State;
            Require(trigger.PendingDialogue == ScenarioRules.DialogueId("editor.f0/root"),scope + " runtime dependencies load");
            Require(ScenarioRules.Choose(trigger,trigger.Revision,"editor.f0/root","yes").State.ExtensionState["scenario/original-export"] == 7,scope + " branch runs");
            if (scope == "countries") Require(scoped.GetEntry("original/conquest2.btl") != null,"country bindings include unchanged project BTLs");
        }
        foreach (string scope in new[] { "project", "commanders", "countries" })
        {
            using var assets = ZipFile.OpenRead(Path.Combine(root,".local/runtime-compatibility/" + scope + "-assets-resources.zip"));
            Require(assets.GetEntry("assets/def_commander.xml") != null && assets.GetEntry("assets/stringtable_cn.ini") != null,"legacy native definitions");
            Require(Read(assets,"assets/def_commander.xml").AsSpan().SequenceEqual(Read(zip,"original/def_commander.xml")),"legacy XML bytes preserved");
            Require(Read(assets,"assets/conquest1.btl").AsSpan().SequenceEqual(Read(zip,"original/conquest1.btl")),"legacy BTL does not silently drop extensions");
            Require(Read(assets,"rewrite-resources/rewrite/editor-events.json").AsSpan().SequenceEqual(Read(zip,"rewrite/editor-events.json")),"Rewrite-only event data retained");
            Require(JsonNode.Parse(Read(assets,"export-map.json"))!["notes"]!.AsArray().Count >= 3,"compatibility and mapping report");
            var manifest = JsonNode.Parse(Read(zip,"client/manifest.json"))!;
            foreach (string atlas in new[] {"buildings","buildings_hd","commanders1_hd","image_flag_hd"})
            {
                var xml = XElement.Parse("<atlas>" + Encoding.UTF8.GetString(Read(assets,"assets/"+atlas+".xml")) + "</atlas>");
                var png = StbImageSharp.ImageResult.FromMemory(Read(assets,"assets/"+atlas+".png"),StbImageSharp.ColorComponents.RedGreenBlueAlpha);
                foreach (var frame in xml.Descendants("Image"))
                {
                    string name = (string)frame.Attribute("name")!;
                    var rect = manifest["atlases"]![atlas]![name]!;
                    foreach (string key in new[] {"x","y","w","h"}) Require((double)frame.Attribute(key)! == (double)rect[key]!,"legacy atlas coordinates");
                    Require((int)frame.Attribute("x")!+(int)frame.Attribute("w")! <= png.Width && (int)frame.Attribute("y")!+(int)frame.Attribute("h")! <= png.Height,"legacy atlas pixels in bounds");
                    if (atlas != "commanders1_hd" || name != "Napoleon_Raw.png") continue;
                    var portrait = StbImageSharp.ImageResult.FromMemory(Read(zip,"client/ui/commanders1_hd/Napoleon_Raw.png"),StbImageSharp.ColorComponents.RedGreenBlueAlpha);
                    int x=(int)frame.Attribute("x")!, y=(int)frame.Attribute("y")!;
                    for (int row=0;row<portrait.Height;row++) Require(png.Data.AsSpan(((y+row)*png.Width+x)*4,portrait.Width*4).SequenceEqual(portrait.Data.AsSpan(row*portrait.Width*4,portrait.Width*4)),"reconstructed legacy portrait pixels");
                }
            }
        }
        Console.WriteLine("Raw resource ZIP: original paths, BTL bytes, ew4mod equivalence and real Rewrite event branch passed");
    }
    private static void Require(bool condition,string message) { if (!condition) throw new Exception(message); }
}
