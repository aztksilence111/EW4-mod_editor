using System.Buffers.Binary;
using Ew4.Legacy;

namespace Ew4.Editor;

public sealed record NewScenarioRequest(int Revision, string Id, int MapId, string Template);

public sealed partial class AuthorEngine
{
    public object Maps()
    {
        lock (gate)
            return Ew4.Mods.ModFiles.Xml(Read(state.Files, "original/def_map.xml")).Root!.Elements("map").Select(e =>
            {
                int id = (int)e.Attribute("id")!;
                string name = (string?)e.Attribute("name") ?? id.ToString();
                var terrain = LegacyTerrainMap.Read(Read(state.Files, MapFile(id)));
                return new { id, name, width = terrain.Width, height = terrain.Height };
            }).ToArray();
    }

    public object NewScenario(NewScenarioRequest request)
    {
        lock (gate)
        {
            Revision(request.Revision);
            if (string.IsNullOrWhiteSpace(request.Id) || request.Id.Length <= 7 || !request.Id.StartsWith("custom_", StringComparison.Ordinal))
                throw new InvalidDataException("新剧本 ID 须以 custom_ 开头，后接字母、数字或下划线");
            string path = ScenarioPath(request.Id);
            if (Scenarios.Contains(request.Id, StringComparer.OrdinalIgnoreCase)
                || sourceHashes.Keys.Concat(state.Files.Keys).Any(p => p.Equals(path, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("剧本 ID 已存在，请使用新 ID");
            if (!Scenarios.Contains(request.Template)) throw new InvalidDataException("请选择用于复制国家配置的剧本");
            var terrain = LegacyTerrainMap.Read(Read(state.Files, MapFile(request.MapId)));
            var template = LegacyBattle.Read(Read(state.Files, ScenarioPath(request.Template)));
            if (template.Factions.Count is < 1 or > 255) throw new InvalidDataException("模板国家数量须为 1..255");
            byte[] factions = template.SectionBytes("factions");
            int player = template.Factions.ToList().FindIndex(f => f.Camp != 4);
            if (player < 0) throw new InvalidDataException("模板没有可用的玩家国家");
            // Custom scenarios are campaigns: exactly one human, no inherited cell/event references.
            for (int i = 0; i < template.Factions.Count; i++)
                BinaryPrimitives.WriteInt32LittleEndian(factions.AsSpan(i * 180 + 12), i == player ? 0 : 1);
            byte[] bytes = new byte[checked(72 + factions.Length + terrain.Width * terrain.Height)];
            int[] header = [2, request.MapId, 0, 0, terrain.Width, terrain.Height, template.Factions.Count,
                0, 0, 0, 0, 0, 100, 50, 0, -1, 0, 0];
            for (int i = 0; i < header.Length; i++) BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(i * 4), header[i]);
            factions.CopyTo(bytes, 72);
            bytes.AsSpan(72 + factions.Length).Fill(255);
            if (template.CountryIds != null)
                bytes = LegacyBattle.Read(bytes).WithCountryIds(new(1, Hash(bytes), template.Factions.Select(f => f.CountryId).ToArray()));
            var next = new Dictionary<string, byte[]>(state.Files, StringComparer.Ordinal) { [path] = bytes };
            string[] scenarios = Scenarios.Append(request.Id).ToArray();
            CheckState(state with { Files = next, Scenarios = scenarios });
            CheckContent(next, [request.Id], true, scenarios);
            Persist(state with { Revision = state.Revision + 1, Files = next, Scenarios = scenarios,
                Undo = state.Undo.Append(Snapshot).TakeLast(30).ToList(), Redo = [] });
            return new { state.Revision, id = request.Id };
        }
    }
}
