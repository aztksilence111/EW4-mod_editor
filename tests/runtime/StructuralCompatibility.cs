using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Ew4.Core;
using Ew4.Editor;
using Ew4.Legacy;
using Ew4.Mods;
using Ew4.Persistence;

internal static class StructuralCompatibility
{
    internal static void Run(string root)
    {
        string evidence = Path.Combine(root, ".local/runtime-compatibility");
        Directory.CreateDirectory(evidence);
        byte[] Read(string path) => File.ReadAllBytes(Path.Combine(root, ".local/rewrite/data", path));
        var manifest = JsonNode.Parse(File.ReadAllBytes(Path.Combine(root, ".local/baseline.json")))!;
        var paths = manifest["files"]!.AsObject().Where(p => p.Key.StartsWith("data/", StringComparison.Ordinal)).Select(p => p.Key[5..]);
        var baseline = new ModBase(Read, paths);
        const string id = "conquest1", path = "original/conquest1.btl";
        byte[] upstream = Read(path), edited = upstream;
        var content = baseline.Content(p => p == path ? edited : Read(p), [id]);
        var battle = LegacyBattle.Read(upstream);
        var terrain = content.Maps[battle.MapId];
        var world = content.Start(id, "fra").Session.World;
        var centers = world.Jurisdictions ?? TerritorialJurisdictions.Create(world);
        void Require(bool ok, string message) { if (!ok) throw new Exception(message); }
        byte[] Append(byte[] bytes, string name, int header, byte[] record)
        {
            var parsed = LegacyBattle.Read(bytes);
            var section = parsed.Sections.Single(s => s.Name == name);
            int tail = section.Offset + section.Count * section.Stride;
            byte[] output = bytes[..tail].Concat(record).Concat(bytes[tail..]).ToArray();
            BinaryPrimitives.WriteInt32LittleEndian(output.AsSpan(header * 4), parsed.Header[header] + 1);
            return output;
        }
        int cell = battle.Armies[0].Cell;
        var market = new byte[116];
        for (int i = 0; i < 14; i++) BinaryPrimitives.WriteInt32LittleEndian(market.AsSpan(i * 8), -1);
        BinaryPrimitives.WriteInt32LittleEndian(market.AsSpan(112), cell);
        var tavern = new byte[108];
        BinaryPrimitives.WriteInt32LittleEndian(tavern, content.Catalogs.Runtime.Commanders.Keys.First());
        BinaryPrimitives.WriteInt32LittleEndian(tavern.AsSpan(16), 1);
        BinaryPrimitives.WriteInt32LittleEndian(tavern.AsSpan(100), 1);
        BinaryPrimitives.WriteInt32LittleEndian(tavern.AsSpan(104), cell);
        var fire = new byte[8];
        BinaryPrimitives.WriteInt32LittleEndian(fire, cell);
        BinaryPrimitives.WriteInt32LittleEndian(fire.AsSpan(4), 1);
        byte[] input = Append(Append(Append(upstream, "opaque116", 10, market), "opaque108", 14, tavern), "opaque8", 16, fire);
        int eventId = Enumerable.Range(0, 128).First(i => battle.Events.All(e => e.Id != i));
        var ev = new byte[44];
        BinaryPrimitives.WriteInt32LittleEndian(ev, eventId);
        BinaryPrimitives.WriteInt32LittleEndian(ev.AsSpan(8), 5);
        BinaryPrimitives.WriteInt32LittleEndian(ev.AsSpan(16), -1);
        BinaryPrimitives.WriteInt32LittleEndian(ev.AsSpan(20), cell);
        input = Append(input, "opaque44", 9, ev);
        battle = LegacyBattle.Read(input);
        var armies = battle.Sections.Single(s => s.Name == "armies");
        input[armies.Offset + 26] = input[armies.Offset + 32 + 26] = (byte)eventId;
        var sites = battle.Sections.Single(s => s.Name == "sites");
        input[sites.Offset + 11] = (byte)eventId;
        battle = LegacyBattle.Read(input);
        string hash = Convert.ToHexStringLower(SHA256.HashData(input));
        input = battle.WithCountryIds(new(1, hash, battle.Factions.Select(f => f.CountryId).ToArray(),
            new Dictionary<int, string> { [battle.Events.Count - 1] = "fra" }));
        var assignments = Enumerable.Range(0, battle.Width * battle.Height)
            .Select(i => centers.CellCenters[(battle.Top + i / battle.Width) * terrain.Width + battle.Left + i % battle.Width]).ToArray();
        input = LegacyBattle.Read(input).WithJurisdictions(new(1, battle.MapId, terrain.Width, terrain.Height,
            battle.Left, battle.Top, battle.Width, battle.Height, hash, assignments));
        var noVictory = input;
        int last = battle.Armies.Count - 1;
        input = LegacyBattle.Read(input).WithVictory(new() {
            Win = new() { Type = "all", Conditions = [new() { Type = "units_destroyed", Units = [id + ".unit." + last] },
                new() { Type = "cells_owned", Cells = [cell] }] },
            Lose = new() { Type = "units_lost", Units = [id + ".unit.1"] }
        });
        var fixture = LegacyBattle.Read(input);
        var results = new List<string>();
        void Check(string name, byte[] source, int[] removed)
        {
            byte[] before = source.ToArray();
            var parsed = LegacyBattle.Read(source);
            var output = ArmyStructuralEdit.Delete(source, id, removed);
            Require(before.AsSpan().SequenceEqual(source), "Writer mutated input");
            var after = LegacyBattle.Read(output.Bytes);
            Require(after.Armies.Count == parsed.Armies.Count - removed.Length, "Header count mismatch");
            Require(after.LegacyLength == parsed.LegacyLength - removed.Length * 32, "Body length mismatch");
            var expectedHeader = parsed.ToLegacyBytes()[..72];
            BinaryPrimitives.WriteInt32LittleEndian(expectedHeader.AsSpan(32), after.Armies.Count);
            Require(after.ToLegacyBytes().AsSpan(0, 72).SequenceEqual(expectedHeader), "Other header bytes changed");
            foreach (var section in parsed.Sections.Where(s => s.Name != "armies"))
                Require(parsed.SectionBytes(section.Name).AsSpan().SequenceEqual(after.SectionBytes(section.Name)), "Changed " + section.Name);
            Require(after.Events.SequenceEqual(parsed.Events), "Effective event country bindings changed");
            Require(after.Factions.Select(f => f.CountryId).SequenceEqual(parsed.Factions.Select(f => f.CountryId)), "Effective faction bindings changed");
            int next = 0;
            for (int i = 0; i < parsed.Armies.Count; i++)
            {
                Require(output.OldToNew[i] == (removed.Contains(i) ? null : next++), "Slot migration mismatch");
                if (output.OldToNew[i] is int slot)
                    Require(parsed.SectionBytes("armies").AsSpan(i * 32, 32).SequenceEqual(after.SectionBytes("armies").AsSpan(slot * 32, 32)), "Survivor bytes changed");
            }
            edited = output.Bytes;
            var started = content.Start(id, "fra");
            var session = started.Session;
            if (after.Victory != null)
                Require(started.Rules.Turns.Victory.Custom!.Win.Conditions[0].Units[0] == id + ".unit." + output.OldToNew[last], "Victory target retargeted");
            void Verify(GameSession value)
            {
                Require(value.World.Units.Count == after.Armies.Count, "Runtime count mismatch");
                foreach (var (army, slot) in after.Armies.Select((army, slot) => (army, slot)))
                    Require(value.World.Units.Single(u => u.Id == id + ".unit." + slot).Cell == army.Cell, "Runtime unit identity mismatch");
                var expectedEvents = after.Armies.Select((army, slot) => (army, slot)).Where(p => p.army.State70 == eventId)
                    .Select(p => id + ".unit." + p.slot).Order().ToArray();
                var actualEvents = value.World.Events.Single(e => e.Id == "legacy.event." + eventId).Rules
                    .Where(r => r.Trigger == TriggerKind.UnitDestroyed).Select(r => r.UnitId!).Order().ToArray();
                Require(expectedEvents.SequenceEqual(actualEvents), "Death event identities changed");
                Require(value.Markets.Any(m => m.Cell == cell) && value.TavernCandidates.Any(t => t.Cell == cell), "Independent commerce lost");
                Require(value.World.Jurisdictions!.CellCenters.Where((_, i) => i / terrain.Width >= battle.Top && i / terrain.Width < battle.Top + battle.Height
                    && i % terrain.Width >= battle.Left && i % terrain.Width < battle.Left + battle.Width).SequenceEqual(assignments), "Jurisdictions changed");
                if (after.Victory != null) ExtensionVictory.ValidateTargets(after.Victory, value.World, initial: true);
            }
            Verify(session);
            var restored = SessionSave.Decode(SessionSave.Encode(session), new(session.ContentRevision, session.World.ContentRevision, session.Account.ContentRevision));
            Verify(restored);
            File.WriteAllBytes(Path.Combine(evidence, name + ".btl"), output.Bytes);
            results.Add(name + ": bytes, extensions, startup and save restore passed");
        }
        Check("structural-first", input, [0]);
        Check("structural-middle", input, [last / 2]);
        Check("structural-last", noVictory, [last]);
        Check("structural-multiple", input, [last / 2, 0]);
        Check("structural-all", noVictory, Enumerable.Range(0, battle.Armies.Count).ToArray());
        foreach (var (name, slots) in new[] { ("empty", Array.Empty<int>()), ("duplicate", new[] { 0, 0 }), ("negative", new[] { -1 }),
            ("out-of-range", new[] { battle.Armies.Count }), ("victory-target", new[] { last }), ("lose-target", new[] { 1 }) })
        {
            try { ArmyStructuralEdit.Delete(input, id, slots); throw new Exception("Accepted " + name); }
            catch (InvalidDataException) { results.Add(name + ": rejected"); }
        }
        var scripted = fixture.WithVictory(new() { Win = new() { Type = "script", Script = "rewrite/test.lua", Function = "noop" } });
        try { ArmyStructuralEdit.Delete(scripted, id, [0]); throw new Exception("Accepted scripted victory"); }
        catch (InvalidDataException) { results.Add("scripted victory: rejected before writing"); }
        Require(fixture.ToBytes().AsSpan().SequenceEqual(input), "Rejection mutated fixture");
        File.WriteAllBytes(Path.Combine(evidence, "structural-input.btl"), input);
        File.WriteAllText(Path.Combine(evidence, "structural-result.json"), JsonSerializer.Serialize(new {
            checks = results.Count, cases = results, scenario = id, armyCount = battle.Armies.Count, eventId,
            upstreamSha256 = Convert.ToHexStringLower(SHA256.HashData(upstream)),
            fixtureSha256 = Convert.ToHexStringLower(SHA256.HashData(input)),
            runtimeSha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(typeof(LegacyBattle).Assembly.Location)))
        }, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine($"Structural writer: {results.Count} checks passed; evidence .local/runtime-compatibility/structural-result.json");
    }
}
