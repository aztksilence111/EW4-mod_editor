using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Ew4.Core;
using Ew4.Editor;
using Ew4.Legacy;
using Ew4.Mods;
using Ew4.Persistence;

internal static class DeploymentCompatibility
{
    private const string Id = "conquest1", BattlePath = "original/conquest1.btl";
    private static string DirectoryPath(string root) => Path.Combine(root, ".local/runtime-compatibility");
    private static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    private static void Require(bool ok, string message) { if (!ok) throw new Exception(message); }
    private static ModBase Baseline(string root)
    {
        var manifest = JsonNode.Parse(File.ReadAllBytes(Path.Combine(root, ".local/baseline.json")))!;
        return new(path => Read(root, path), manifest["files"]!.AsObject()
            .Where(p => p.Key.StartsWith("data/", StringComparison.Ordinal)).Select(p => p.Key[5..]));
    }
    private static byte[] Read(string root, string path) => File.ReadAllBytes(Path.Combine(root, ".local/rewrite/data", path));
    private static void VerifyUnits(GameSession session, LegacyBattle battle)
    {
        Require(session.World.Units.Count == battle.Armies.Count, "Runtime unit count mismatch");
        foreach (var (army, slot) in battle.Armies.Select((a, i) => (a, i)))
            Require(session.World.Units.Single(u => u.Id == Id + ".unit." + slot).Cell == army.Cell, "Existing identity/cell changed");
        if (battle.Victory != null) ExtensionVictory.ValidateTargets(battle.Victory, session.World, initial: true);
    }
    internal static void Run(string root)
    {
        string directory = DirectoryPath(root);
        byte[] input = File.ReadAllBytes(Path.Combine(directory, "structural-input.btl")), edited = input;
        var prior = JsonNode.Parse(File.ReadAllBytes(Path.Combine(directory, "structural-result.json")))!;
        Require(Hash(input) == prior["fixtureSha256"]!.GetValue<string>(), "Cached structural fixture changed");
        Require(Hash(File.ReadAllBytes(typeof(LegacyBattle).Assembly.Location)) == prior["runtimeSha256"]!.GetValue<string>(), "Cached runtime changed");
        var content = Baseline(root).Content(p => p == BattlePath ? edited : Read(root, p), [Id]);
        var battle = LegacyBattle.Read(input);
        var map = content.Maps[battle.MapId];
        var ownership = battle.SectionBytes("ownership");
        var occupied = battle.Armies.Select(a => (int)a.Cell).ToHashSet();
        var candidates = Enumerable.Range(0, battle.Width * battle.Height).Select(local => new {
            local, cell = (battle.Top + local / battle.Width) * map.Width + battle.Left + local % battle.Width,
            owner = unchecked((sbyte)ownership[local])
        }).Where(c => c.cell <= short.MaxValue && !occupied.Contains(c.cell)).ToArray();
        var land = candidates.Where(c => c.owner >= 0 && c.owner < battle.Factions.Count
            && !content.Catalogs.Terrain.Resolve(map.Cells[c.cell]).Movement.Sea).ToArray();
        var sea = candidates.First(c => c.owner >= 0 && c.owner < battle.Factions.Count
            && content.Catalogs.Terrain.Resolve(map.Cells[c.cell]).Movement.Sea);
        int cell = land[0].cell, secondCell = land[1].cell;
        int commander = content.Catalogs.Runtime.Commanders.Keys.First();
        var cases = new List<string>();
        void Check(string name, byte[] source, ArmyDeployment deployment)
        {
            var parsed = LegacyBattle.Read(source);
            byte[] before = source.ToArray();
            var result = ArmyStructuralEdit.Append(source, Id, deployment, content);
            var after = LegacyBattle.Read(result.Bytes);
            Require(source.AsSpan().SequenceEqual(before), "Writer mutated source");
            Require(result.Slot == parsed.Armies.Count && after.Armies.Count == parsed.Armies.Count + 1, "Not appended at tail");
            Require(after.LegacyLength == parsed.LegacyLength + 32, "Wrong body length");
            var header = parsed.ToLegacyBytes()[..72];
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(32), after.Armies.Count);
            Require(header.AsSpan().SequenceEqual(after.ToLegacyBytes().AsSpan(0, 72)), "Other header bytes changed");
            foreach (var section in parsed.Sections.Where(s => s.Name != "armies"))
                Require(parsed.SectionBytes(section.Name).AsSpan().SequenceEqual(after.SectionBytes(section.Name)), "Changed " + section.Name);
            Require(parsed.SectionBytes("armies").AsSpan().SequenceEqual(after.SectionBytes("armies").AsSpan(0, parsed.Armies.Count * 32)), "Survivors changed");
            Require(after.Events.SequenceEqual(parsed.Events), "Event bindings changed");
            Require(JsonSerializer.Serialize(after.Victory) == JsonSerializer.Serialize(parsed.Victory), "Victory identity changed");
            Require(after.Factions.Select(f => f.CountryId).SequenceEqual(parsed.Factions.Select(f => f.CountryId)), "Faction identities changed");
            Require(after.Jurisdictions?.CellCenters.SequenceEqual(parsed.Jurisdictions!.CellCenters) != false, "Jurisdictions changed");
            Require(result.Army.State70 == -1 && result.Army.Commander == deployment.Commander
                && result.Army.Movement == 0 && result.Army.Flag58 == 0 && result.Army.Flag5c == 1
                && result.Army.ConstructionTurns == 0 && result.Army.Acted == 0 && result.Army.Transport == 0, "Unsafe defaults");
            edited = result.Bytes;
            var started = content.Start(Id, "fra");
            VerifyUnits(started.Session, after);
            var unit = started.Session.World.Units.Single(u => u.Id == Id + ".unit." + result.Slot);
            Require((unit.CommanderId != null) == (deployment.Commander >= 0), "Commander assignment mismatch");
            Require(unit.Combatant.Health > 0 && unit.Combatant.Health <= unit.Combatant.Profile.MaxHealth, "Invalid runtime health");
            Require(!started.Session.World.Events.SelectMany(e => e.Rules).Any(r => r.UnitId == unit.Id), "Default unit inherited death event");
            var restored = SessionSave.Decode(SessionSave.Encode(started.Session), new(started.Session.ContentRevision,
                started.Session.World.ContentRevision, started.Session.Account.ContentRevision));
            VerifyUnits(restored, after);
            Require(restored.World.Units.Single(u => u.Id == unit.Id).CommanderId == unit.CommanderId, "Commander lost in save");
            File.WriteAllBytes(Path.Combine(directory, name + ".btl"), result.Bytes);
            cases.Add(name + ": bytes, defaults, identities, startup and save restore passed");
        }
        Check("deployment-default", input, new(cell));
        byte[] first = edited;
        Check("deployment-second", first, new(secondCell, ArmyType: 1, ArmyGrade: 1));
        Check("deployment-commander", input, new(cell, Commander: commander, StrengthNow: 50, StrengthMax: 100));
        Check("deployment-naval", input, new(sea.cell, ArmyType: 14));
        Check("deployment-plain", Read(root, BattlePath), new(cell));
        Check("deployment-after-delete", File.ReadAllBytes(Path.Combine(directory, "structural-first.btl")), new(cell));
        void Reject(string name, byte[] source, ArmyDeployment deployment)
        {
            byte[] before = source.ToArray();
            try { ArmyStructuralEdit.Append(source, Id, deployment, content); throw new Exception("Accepted " + name); }
            catch (InvalidDataException) { cases.Add(name + ": rejected without mutation"); }
            Require(source.AsSpan().SequenceEqual(before), "Rejection mutated source");
        }
        foreach (var (name, deployment) in new (string, ArmyDeployment)[] {
            ("negative cell", new(-1)), ("out of map", new(map.Cells.Count)), ("Int16 overflow", new(32768)),
            ("outside scenario region", new(0)),
            ("occupied cell", new(battle.Armies[0].Cell)), ("naval on land", new(cell, ArmyType: 14)),
            ("land on sea", new(sea.cell)), ("invalid type", new(cell, ArmyType: 22)),
            ("negative type", new(cell, ArmyType: -1)), ("nonstandard grade", new(cell, ArmyGrade: 3)),
            ("unknown commander", new(cell, Commander: 32767)), ("negative commander", new(cell, Commander: -2)),
            ("zero health", new(cell, StrengthNow: 0)), ("health overflow", new(cell, StrengthMax: 32768)),
            ("health above maximum", new(cell, StrengthNow: 101, StrengthMax: 100))
        }) Reject(name, input, deployment);
        byte[] Rebind(byte[] body)
        {
            string hash = Hash(body);
            byte[] bytes = LegacyBattle.Read(body).WithCountryIds(battle.CountryIds! with { BaseSha256 = hash });
            bytes = LegacyBattle.Read(bytes).WithJurisdictions(battle.Jurisdictions! with { BaseSha256 = hash });
            return LegacyBattle.Read(bytes).WithVictory(battle.Victory!);
        }
        var ownerSection = battle.Sections.Single(s => s.Name == "ownership");
        foreach (byte owner in new byte[] { 255, 128, 127 })
        {
            var body = battle.ToLegacyBytes(); body[ownerSection.Offset + land[0].local] = owner;
            var source = Rebind(body);
            File.WriteAllBytes(Path.Combine(directory, "deployment-owner-" + owner + ".btl"), source);
            Reject("invalid owner " + owner, source, new(cell));
        }
        var invalid = battle.ToLegacyBytes();
        BinaryPrimitives.WriteInt16LittleEndian(invalid.AsSpan(battle.Sections.Single(s => s.Name == "armies").Offset), -1);
        Reject("existing draft tombstone", Rebind(invalid), new(cell));
        var scripted = battle.WithVictory(new() { Win = new() { Type = "all", Conditions = [new() { Type = "script", Script = "rewrite/test.lua", Function = "noop" }] } });
        File.WriteAllBytes(Path.Combine(directory, "deployment-scripted.btl"), scripted);
        Reject("nested scripted victory", scripted, new(cell));
        Reject("future unit victory target", battle.WithVictory(new() { Win = new() {
            Type = "units_destroyed", Units = [Id + ".unit." + battle.Armies.Count] } }), new(cell));
        File.WriteAllText(Path.Combine(directory, "deployment-result.json"), JsonSerializer.Serialize(new {
            checks = cases.Count, cases, cell, secondCell, seaCell = sea.cell, mapId = battle.MapId,
            owner = battle.Factions[land[0].owner].CountryId, commander, armyCount = battle.Armies.Count,
            fixtureSha256 = Hash(input), outputSha256 = Hash(first), runtimeSha256 = prior["runtimeSha256"]!.GetValue<string>()
        }, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine($"Deployment writer: {cases.Count} checks passed");
    }

    internal static void VerifyExport(string root)
    {
        string directory = DirectoryPath(root);
        using var zip = ZipFile.OpenRead(Path.Combine(directory, "deployment-army-append.ew4mod"));
        byte[] Entry(string path)
        {
            using var stream = zip.GetEntry(path)!.Open();
            using var buffer = new MemoryStream(); stream.CopyTo(buffer); return buffer.ToArray();
        }
        var files = JsonNode.Parse(Entry("mod.json"))!["files"]!.AsObject();
        foreach (var (path, hash) in files) Require(Hash(Entry(path)) == hash!.GetValue<string>(), "Package hash mismatch: " + path);
        var bytes = Entry(BattlePath);
        Require(bytes.AsSpan().SequenceEqual(File.ReadAllBytes(Path.Combine(directory, "deployment-default.btl"))), "Export differs from writer");
        var battle = LegacyBattle.Read(bytes);
        var content = Baseline(root).Content(p => files.ContainsKey(p) ? Entry(p) : Read(root, p), [Id]);
        var started = content.Start(Id, "fra");
        VerifyUnits(started.Session, battle);
        var restored = SessionSave.Decode(SessionSave.Encode(started.Session), new(started.Session.ContentRevision,
            started.Session.World.ContentRevision, started.Session.Account.ContentRevision));
        VerifyUnits(restored, battle);
        File.WriteAllText(Path.Combine(directory, "deployment-export-result.json"), JsonSerializer.Serialize(new {
            packageHashes = true, startup = true, saveRestore = true, armies = battle.Armies.Count, sha256 = Hash(bytes)
        }, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine("Deployment export: manifest hashes, startup and save restore passed");
    }
}
