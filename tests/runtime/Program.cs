using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Ew4.Core;
using Ew4.Editor;
using Ew4.Legacy;
using Ew4.Mods;
using Ew4.Persistence;

string root = Path.GetFullPath(args[0]);
if (args.Contains("--deployment-export")) { DeploymentCompatibility.VerifyExport(root); return; }
if (args.Contains("--deployment")) { DeploymentCompatibility.Run(root); return; }
if (args.Contains("--structural-browser")) { StructuralBrowserCompatibility.Run(root); return; }
if (args.Contains("--structural")) { StructuralCompatibility.Run(root); return; }
string evidence = Path.Combine(root, ".local", "runtime-compatibility");
Directory.CreateDirectory(evidence);
string data = Path.Combine(root, ".local", "rewrite", "data");
byte[] Read(string path) => File.ReadAllBytes(Path.Combine(data, path));
var manifest = JsonNode.Parse(File.ReadAllBytes(Path.Combine(root, ".local", "baseline.json")))!;
var paths = manifest["files"]!.AsObject().Where(p => p.Key.StartsWith("data/", StringComparison.Ordinal))
    .Select(p => p.Key[5..]).ToArray();
var baseline = new ModBase(Read, paths);
const string id = "conquest1";
const string battlePath = "original/conquest1.btl";
byte[] original = Read(battlePath);
byte[] upstream = original;
var battle = LegacyBattle.Read(original);
byte[] edited = original;
var content = baseline.Content(path => path == battlePath ? edited : Read(path), [id]);
var terrain = content.Maps[battle.MapId];
var results = new List<object>();
void Require(bool condition, string message) { if (!condition) throw new Exception(message); }
byte[] Append(byte[] bytes, string section, int countHeader, byte[] record)
{
    var parsed = LegacyBattle.Read(bytes);
    var entry = parsed.Sections.Single(s => s.Name == section);
    int offset = entry.Offset + entry.Count * entry.Stride;
    var next = bytes[..offset].Concat(record).Concat(bytes[offset..]).ToArray();
    BinaryPrimitives.WriteInt32LittleEndian(next.AsSpan(countHeader * 4), parsed.Header[countHeader] + 1);
    return next;
}
int serviceCell = battle.Sites.First(s => s.BuildingKind != 255).Cell;
var market = new byte[116];
for (int i = 0; i < 14; i++) BinaryPrimitives.WriteInt32LittleEndian(market.AsSpan(i * 8), -1);
BinaryPrimitives.WriteInt32LittleEndian(market.AsSpan(112), serviceCell);
var tavern = new byte[108];
BinaryPrimitives.WriteInt32LittleEndian(tavern, content.Catalogs.Runtime.Commanders.Keys.First());
BinaryPrimitives.WriteInt32LittleEndian(tavern.AsSpan(16), 1);
BinaryPrimitives.WriteInt32LittleEndian(tavern.AsSpan(100), 1);
BinaryPrimitives.WriteInt32LittleEndian(tavern.AsSpan(104), serviceCell);
var fire = new byte[8];
BinaryPrimitives.WriteInt32LittleEndian(fire, serviceCell);
BinaryPrimitives.WriteInt32LittleEndian(fire.AsSpan(4), 1);
original = Append(Append(Append(original, "opaque116", 10, market), "opaque108", 14, tavern), "opaque8", 16, fire);
var ev = new byte[44];
BinaryPrimitives.WriteInt32LittleEndian(ev, 99);
BinaryPrimitives.WriteInt32LittleEndian(ev.AsSpan(16), -1);
BinaryPrimitives.WriteInt32LittleEndian(ev.AsSpan(20), serviceCell);
original = Append(original, "opaque44", 9, ev);
battle = LegacyBattle.Read(original);
byte[] Tombstone(string section, int slot, bool shortCell)
{
    var bytes = original.ToArray();
    var entry = battle.Sections.Single(s => s.Name == section);
    int size = section switch { "sites" => 16, "armies" => 32, "opaque8" => 8, "opaque116" => 116, "opaque108" => 108, _ => throw new Exception(section) };
    int cellOffset = section switch { "opaque116" => 112, "opaque108" => 104, _ => 0 };
    if (shortCell) BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(entry.Offset + size * slot + cellOffset), -1);
    else BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(entry.Offset + size * slot + cellOffset), -1);
    return bytes;
}
void Check(string name, byte[] bytes, string? expectedCode = null, Action<GameSession>? verify = null, bool reportValid = true)
{
    edited = bytes;
    File.WriteAllBytes(Path.Combine(evidence, name + ".btl"), bytes);
    try
    {
        if (expectedCode == null)
        {
            var report = JsonSerializer.SerializeToNode(BattleReferenceValidation.Build(LegacyBattle.Read(bytes), terrain))!;
            Require(report["valid"]!.GetValue<bool>() == reportValid, name + ": unexpected reference report " + report["conflicts"]);
        }
        var start = content.Start(id, "fra");
        Require(expectedCode == null, name + " unexpectedly started");
        verify?.Invoke(start.Session);
        byte[] save = SessionSave.Encode(start.Session);
        var restored = SessionSave.Decode(save, new(start.Session.ContentRevision,
            start.Session.World.ContentRevision, start.Session.Account.ContentRevision));
        Require(restored.World.Units.Count == start.Session.World.Units.Count, "Restore lost units");
        Require(restored.Markets.Count == start.Session.Markets.Count, "Restore lost markets");
        Require(restored.TavernCandidates.Count == start.Session.TavernCandidates.Count, "Restore lost tavern candidates");
        verify?.Invoke(restored);
        results.Add(new { name, accepted = true, restored = true });
    }
    catch (RuleViolation error) when (expectedCode != null)
    {
        Require(error.Code == expectedCode, name + ": expected " + expectedCode + ", got " + error.Code);
        results.Add(new { name, accepted = false, code = error.Code });
    }
}

Check("upstream-baseline", upstream);
Check("fixture-baseline", original);
Check("negative-army", Tombstone("armies", 0, true), "legacy.start_army_owner");
Check("negative-site", Tombstone("sites", 0, true));
Require(battle.Markets.Count > 0 && battle.Taverns.Count > 0, "Commerce fixtures required");
Check("negative-market", Tombstone("opaque116", 0, false), "legacy.commerce_location");
Check("negative-tavern", Tombstone("opaque108", 0, false), "legacy.commerce_location");
Require(battle.SectionBytes("opaque8").Length > 0, "Environment fixture required");
Check("negative-fire", Tombstone("opaque8", 0, false), "legacy.environment");

foreach (var (cell, label) in new[] { (battle.Markets[0].Cell, "market"), (battle.Taverns[0].Cell, "tavern") })
{
    int slot = battle.Sites.ToList().FindIndex(s => s.Cell == cell);
    Require(slot >= 0, "Expected co-located site");
    var bytes = Tombstone("sites", slot, true);
    Check("site-delete-preserves-" + label, bytes, verify: session => {
        if (label == "market") Require(session.Markets.Any(m => m.Cell == cell), "Independent market lost");
        else Require(session.TavernCandidates.Any(c => c.Cell == cell), "Independent tavern lost");
    });
}

// Event references are signed bytes: zero is live, 128..255 are inactive.
var eventSection = battle.Sections.Single(s => s.Name == "opaque44");
var armySection = battle.Sections.Single(s => s.Name == "armies");
var siteSection = battle.Sections.Single(s => s.Name == "sites");
var eventBytes = original.ToArray();
Require(battle.Events.Count > 0, "Event fixture required");
int oldId = battle.Events[0].Id;
Require(oldId is >= 0 and < 128, "Expected signed event reference");
for (int i = 0; i < battle.Armies.Count; i++)
    if (battle.Armies[i].State70 == oldId) eventBytes[armySection.Offset + i * 32 + 26] = 0;
for (int i = 0; i < battle.Sites.Count; i++)
    if (battle.Sites[i].State11 == oldId) eventBytes[siteSection.Offset + i * 16 + 11] = 0;
BinaryPrimitives.WriteInt32LittleEndian(eventBytes.AsSpan(eventSection.Offset), 0);
eventBytes[armySection.Offset + 26] = 0;
Require(LegacyBattle.Read(eventBytes).Armies[0].State70 == 0, "Event fixture offset differs from parser");
Check("event-zero-binding", eventBytes);
var inactiveBytes = original.ToArray();
inactiveBytes[armySection.Offset + 26] = 128;
Require(LegacyBattle.Read(inactiveBytes).Armies[0].State70 == -128, "Signed event fixture differs from parser");
Check("event-signed-inactive", inactiveBytes);
var missingEvent = original.ToArray();
missingEvent[armySection.Offset + 26] = 0;
Check("unresolved-event-zero", missingEvent, reportValid: false);
Require(content.Start(id, "fra").Rules.MissingEventReferences.Count > 0, "Unresolved zero must remain visible");
var unusedCell = original.ToArray();
BinaryPrimitives.WriteInt32LittleEndian(unusedCell.AsSpan(eventSection.Offset + 20), terrain.Width * terrain.Height + 100);
Check("non-cell-effect-outside-map", unusedCell);
BinaryPrimitives.WriteInt32LittleEndian(unusedCell.AsSpan(eventSection.Offset + 8), 5);
Check("cell-effect-outside-map", unusedCell, "legacy.event_definition");
var outsideCommerce = original.ToArray();
BinaryPrimitives.WriteInt32LittleEndian(outsideCommerce.AsSpan(battle.Sections.Single(s => s.Name == "opaque116").Offset + 112), 0);
BinaryPrimitives.WriteInt32LittleEndian(outsideCommerce.AsSpan(battle.Sections.Single(s => s.Name == "opaque108").Offset + 104), 0);
Check("independent-commerce-outside-scenario", outsideCommerce);
if (args.Contains("--browser"))
    foreach (int width in new[] { 1440, 390 })
        Check("browser-export-" + width, File.ReadAllBytes(Path.Combine(evidence, "browser-" + width + ".btl")));

File.WriteAllText(Path.Combine(evidence, "result.json"), JsonSerializer.Serialize(new {
    scenario = id, upstreamSha256 = Convert.ToHexStringLower(SHA256.HashData(upstream)),
    fixtureSha256 = Convert.ToHexStringLower(SHA256.HashData(original)),
    runtimeSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(typeof(LegacyBattle).Assembly.Location))),
    checks = results
}, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"Rewrite startup/restore: {results.Count} checks passed; evidence .local/runtime-compatibility/result.json");
