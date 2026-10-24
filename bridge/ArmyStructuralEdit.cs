using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using Ew4.Client;
using Ew4.Core;
using Ew4.Legacy;

namespace Ew4.Editor;

public sealed record ArmyDeletion(byte[] Bytes, int?[] OldToNew);
public sealed record ArmySlotMigration(string File, int RuleIndex, int?[] OldToNew);
public sealed record ArmyDeployment([property: JsonRequired] int Cell, int ArmyType = 0, int ArmyGrade = 0, int Commander = -1,
    int? StrengthNow = null, int? StrengthMax = null);
public sealed record ArmyAddition(byte[] Bytes, int Slot, LegacyArmy Army);

public static class ArmyStructuralEdit
{
    public static ArmyAddition Append(byte[] original, string scenario, ArmyDeployment deployment, ClientContent content)
    {
        var battle = LegacyBattle.Read(original);
        RequireKnownExtensions(original, battle);
        var existingIds = Enumerable.Range(0, battle.Armies.Count)
            .Select(i => scenario + ".unit." + i.ToString(CultureInfo.InvariantCulture)).ToHashSet(StringComparer.Ordinal);
        void CheckVictory(VictoryCondition condition)
        {
            if (condition.Type == "script") throw new InvalidDataException("脚本胜负条件尚不支持部队追加");
            if (condition.Units.Any(id => !existingIds.Contains(id)))
                throw new InvalidDataException("胜负条件引用尚不存在的部队，拒绝追加绑定");
            foreach (var child in condition.Conditions) CheckVictory(child);
        }
        if (battle.Victory is { } victory)
        {
            CheckVictory(victory.Win);
            if (victory.Lose != null) CheckVictory(victory.Lose);
        }
        if (content.Scenarios.Single(s => s.Id == scenario).Mode is not (1 or 2 or 4))
            throw new InvalidDataException("部队追加仅支持可验证开局的单人剧本");
        var map = content.Maps[battle.MapId];
        int cell = deployment.Cell, x = cell % map.Width - battle.Left, y = cell / map.Width - battle.Top;
        if (cell < 0 || cell > short.MaxValue || cell >= map.Cells.Count
            || x < 0 || y < 0 || x >= battle.Width || y >= battle.Height)
            throw new InvalidDataException("部署 cell 必须位于剧本区域且可由 Int16 表示");
        int owner = unchecked((sbyte)battle.SectionBytes("ownership")[y * battle.Width + x]);
        if (owner < 0 || owner >= battle.Factions.Count)
            throw new InvalidDataException("部署 cell 必须属于有效军团");
        if (battle.Armies.Any(a => a.Cell == cell)) throw new InvalidDataException("部署 cell 已有部队");
        if (battle.Armies.Any(a => a.Cell < 0)) throw new InvalidDataException("原有部队含无效草稿空槽，不能追加或复用");
        if (deployment.ArmyType is < 0 or > 21 || deployment.ArmyGrade is < 0 or > 2)
            throw new InvalidDataException("部署兵种/等级必须使用标准目录值");
        var faction = battle.Factions[owner];
        string variant = content.Country(faction.CountryId)?.UnitVariant is string countryVariant
            && !(countryVariant == "others" && !content.Catalogs.Runtime.Variants.ContainsKey(faction.Variant))
            ? countryVariant : faction.Variant;
        var profile = content.Catalogs.Runtime.Unit(variant, deployment.ArmyType, deployment.ArmyGrade).Profile;
        var terrain = content.Catalogs.Terrain.Resolve(map.Cells[cell]).Movement;
        if (!terrain.Active || terrain.Sea != (profile.Category == "naval"))
            throw new InvalidDataException("部署 cell 不可通行：舰船需海面，无运输陆军需陆地");
        if (deployment.Commander < -1 || deployment.Commander > short.MaxValue
            || deployment.Commander >= 0 && !content.Catalogs.Runtime.Commanders.ContainsKey(deployment.Commander))
            throw new InvalidDataException("部署将领不在当前目录中");
        int maximum = deployment.StrengthMax ?? profile.MaxHealth, health = deployment.StrengthNow ?? maximum;
        if (maximum is < 1 or > short.MaxValue || health < 1 || health > maximum)
            throw new InvalidDataException("部署兵力必须满足 1 <= 当前兵力 <= 最大兵力 <= 32767");
        var record = new byte[32];
        BinaryPrimitives.WriteInt16LittleEndian(record, (short)cell);
        record[2] = (byte)deployment.ArmyType; record[3] = (byte)deployment.ArmyGrade;
        BinaryPrimitives.WriteInt16LittleEndian(record.AsSpan(4), (short)health);
        BinaryPrimitives.WriteInt16LittleEndian(record.AsSpan(6), (short)maximum);
        BinaryPrimitives.WriteInt16LittleEndian(record.AsSpan(16), (short)deployment.Commander);
        record[25] = 1; record[26] = 255;
        var section = battle.Sections.Single(s => s.Name == "armies");
        int tail = section.Offset + section.Count * section.Stride;
        byte[] body = new byte[checked(battle.LegacyLength + record.Length)];
        original.AsSpan(0, tail).CopyTo(body);
        record.CopyTo(body, tail);
        original.AsSpan(tail, battle.LegacyLength - tail).CopyTo(body.AsSpan(tail + record.Length));
        BinaryPrimitives.WriteInt32LittleEndian(body.AsSpan(32), checked(section.Count + 1));
        string hash = Convert.ToHexStringLower(SHA256.HashData(body));
        byte[] output = body;
        if (battle.CountryIds != null) output = LegacyBattle.Read(output).WithCountryIds(battle.CountryIds with { BaseSha256 = hash });
        if (battle.Jurisdictions != null) output = LegacyBattle.Read(output).WithJurisdictions(battle.Jurisdictions with { BaseSha256 = hash });
        if (battle.Victory != null) output = LegacyBattle.Read(output).WithVictory(battle.Victory);
        LegacyBattle.Read(output);
        return new(output, section.Count, LegacyArmy.Read(record));
    }

    private static void RequireKnownExtensions(byte[] original, LegacyBattle battle)
    {
        for (int cursor = battle.LegacyLength + 16; cursor < original.Length;)
        {
            string tag = Encoding.ASCII.GetString(original, cursor, 4);
            if (tag is not ("CNTR" or "JURI" or "VICT"))
                throw new InvalidDataException("存在未知扩展块，拒绝结构修改: " + tag);
            cursor += checked(16 + BinaryPrimitives.ReadInt32LittleEndian(original.AsSpan(cursor + 12)));
        }
    }

    public static ArmyDeletion Delete(byte[] original, string scenario, IReadOnlyList<int> slots)
    {
        var battle = LegacyBattle.Read(original);
        if (slots.Count == 0 || slots.Distinct().Count() != slots.Count
            || slots.Any(i => i < 0 || i >= battle.Armies.Count))
            throw new InvalidDataException("删除部队需要非空、无重复且有效的当前槽位");
        RequireKnownExtensions(original, battle);
        var removed = slots.ToHashSet();
        var mapping = new int?[battle.Armies.Count];
        int count = 0;
        for (int i = 0; i < mapping.Length; i++)
            if (!removed.Contains(i)) mapping[i] = count++;

        string UnitId(int slot) => scenario + ".unit." + slot.ToString(CultureInfo.InvariantCulture);
        var identities = Enumerable.Range(0, mapping.Length).ToDictionary(UnitId, i => mapping[i], StringComparer.Ordinal);
        VictoryCondition Migrate(VictoryCondition condition)
        {
            if (condition.Type == "script") throw new InvalidDataException("脚本胜负条件尚不支持部队槽位迁移");
            var units = condition.Units.Select(id => identities.TryGetValue(id, out var slot) && slot is int survivor
                ? UnitId(survivor) : throw new InvalidDataException("胜负条件引用被删除或未知的部队: " + id)).ToArray();
            return condition with { Units = units, Conditions = condition.Conditions.Select(Migrate).ToArray() };
        }
        var victory = battle.Victory is { } rules
            ? rules with { Win = Migrate(rules.Win), Lose = rules.Lose == null ? null : Migrate(rules.Lose) } : null;
        var section = battle.Sections.Single(s => s.Name == "armies");
        byte[] body = new byte[battle.LegacyLength - removed.Count * section.Stride];
        original.AsSpan(0, section.Offset).CopyTo(body);
        for (int i = 0; i < mapping.Length; i++)
            if (mapping[i] is int target)
                original.AsSpan(section.Offset + i * section.Stride, section.Stride)
                    .CopyTo(body.AsSpan(section.Offset + target * section.Stride));
        int tail = section.Offset + section.Count * section.Stride;
        original.AsSpan(tail, battle.LegacyLength - tail).CopyTo(body.AsSpan(section.Offset + count * section.Stride));
        BinaryPrimitives.WriteInt32LittleEndian(body.AsSpan(8 * 4), count);

        // Cell-based records stay byte-identical; only unit identities and body bindings change.
        string hash = Convert.ToHexStringLower(SHA256.HashData(body));
        byte[] output = body;
        if (battle.CountryIds != null) output = LegacyBattle.Read(output).WithCountryIds(battle.CountryIds with { BaseSha256 = hash });
        if (battle.Jurisdictions != null) output = LegacyBattle.Read(output).WithJurisdictions(battle.Jurisdictions with { BaseSha256 = hash });
        if (victory != null) output = LegacyBattle.Read(output).WithVictory(victory);
        LegacyBattle.Read(output);
        return new(output, mapping);
    }
}
