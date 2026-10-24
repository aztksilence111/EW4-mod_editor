using Ew4.Legacy;

namespace Ew4.Editor;

internal static class BattleReferenceValidation
{
    internal static object Build(LegacyBattle battle, LegacyTerrainMap terrain)
    {
        int mapCells = checked(terrain.Width * terrain.Height);
        var conflicts = new List<object>();
        void Conflict(string code, string subject, string detail) => conflicts.Add(new { code, subject, detail });

        bool InMap(int cell) => cell >= 0 && cell < mapCells;
        bool InScenario(int cell) => InMap(cell) && cell / terrain.Width >= battle.Top
            && cell / terrain.Width < battle.Top + battle.Height
            && cell % terrain.Width >= battle.Left && cell % terrain.Width < battle.Left + battle.Width;

        var sitesByCell = battle.Sites.Select((site, slot) => (site, slot)).Where(x => x.site.Cell >= 0).GroupBy(x => (int)x.site.Cell)
            .ToDictionary(g => g.Key, g => g.ToArray());
        var effectiveSiteSlots = sitesByCell.ToDictionary(pair => pair.Key, pair => pair.Value[^1].slot);
        var armiesByCell = battle.Armies.Select((army, slot) => (army, slot)).GroupBy(x => (int)x.army.Cell)
            .ToDictionary(g => g.Key, g => g.Select(x => x.slot).ToArray());
        var eventsById = battle.Events.Select((ev, slot) => (ev, slot)).GroupBy(x => x.ev.Id)
            .ToDictionary(g => g.Key, g => g.ToArray());
        var eventIds = eventsById.Keys.ToHashSet();

        foreach (var pair in sitesByCell.Where(pair => pair.Value.Length > 1))
            Conflict("duplicate-site-cell", $"site-cell:{pair.Key}", $"站点槽位重复: {string.Join(',', pair.Value.Select(x => x.slot))}");
        foreach (var pair in armiesByCell.Where(pair => pair.Value.Length > 1))
            Conflict("duplicate-army-cell", $"army-cell:{pair.Key}", $"部队槽位重复: {string.Join(',', pair.Value)}");
        foreach (var pair in eventsById.Where(pair => pair.Value.Length > 1))
            Conflict("duplicate-event-id", $"event:{pair.Key}", $"事件 ID 重复: {string.Join(',', pair.Value.Select(x => x.slot))}");

        void CheckCell(string kind, string subject, int cell, bool requireScenario = true)
        {
            if (!InMap(cell)) Conflict("cell-out-of-range", subject, $"{kind} 格号越界: {cell}");
            else if (requireScenario && !InScenario(cell)) Conflict("cell-outside-scenario", subject, $"{kind} 格号不在剧本区域: {cell}");
        }

        foreach (var (site, slot) in battle.Sites.Select((value, index) => (value, index)))
        {
            if (site.Cell < 0) continue;
            CheckCell("站点", $"site:{slot}@{site.Cell}", site.Cell);
            if (site.State11 >= 0 && !eventIds.Contains(site.State11))
                Conflict("missing-event-reference", $"site:{slot}@{site.Cell}", $"站点引用不存在的事件: {site.State11}");
        }
        foreach (var (army, slot) in battle.Armies.Select((value, index) => (value, index)))
        {
            CheckCell("部队", $"army:{slot}@{army.Cell}", army.Cell);
            if (army.State70 >= 0 && !eventIds.Contains(army.State70))
                Conflict("missing-event-reference", $"army:{slot}@{army.Cell}", $"部队引用不存在的事件: {army.State70}");
        }
        foreach (var (ev, slot) in battle.Events.Select((value, index) => (value, index)))
            if (ev.Effect == 5) CheckCell("事件", $"event:{ev.Id}#{slot}", ev.Cell);

        foreach (var (market, slot) in battle.Markets.Select((value, index) => (value, index)))
        {
            CheckCell("市场", $"market:{slot}@{market.Cell}", market.Cell, false);
        }
        foreach (var (tavern, slot) in battle.Taverns.Select((value, index) => (value, index)))
        {
            CheckCell("酒馆", $"tavern:{slot}@{tavern.Cell}", tavern.Cell, false);
        }

        var jurisdictionCells = new Dictionary<int, List<int>>();
        if (battle.Jurisdictions is { } juri)
            for (int local = 0; local < juri.CellCenters.Count; local++)
            {
                int center = juri.CellCenters[local];
                if (center < 0) continue;
                if (!jurisdictionCells.TryGetValue(center, out var cells)) jurisdictionCells[center] = cells = [];
                cells.Add(local);
                if (!effectiveSiteSlots.ContainsKey(center))
                    Conflict("orphan-jurisdiction-center", $"center:{center}", "辖区中心没有对应的有效站点");
            }

        var cellIndex = sitesByCell.Keys.Union(armiesByCell.Keys).Union(battle.Events.Where(e => e.Cell >= 0).Select(e => e.Cell))
            .Union(battle.Markets.Select(m => m.Cell)).Union(battle.Taverns.Select(t => t.Cell)).Union(jurisdictionCells.Keys)
            .Order().Select(cell => new
            {
                cell,
                sites = sitesByCell.GetValueOrDefault(cell, []).Select(x => x.slot).ToArray(),
                effectiveSite = effectiveSiteSlots.GetValueOrDefault(cell, -1),
                armies = armiesByCell.GetValueOrDefault(cell, []),
                events = battle.Events.Select((ev, slot) => (ev, slot)).Where(x => x.ev.Cell == cell).Select(x => x.ev.Id).Distinct().Order().ToArray(),
                markets = battle.Markets.Select((market, slot) => (market, slot)).Where(x => x.market.Cell == cell).Select(x => x.slot).ToArray(),
                taverns = battle.Taverns.Select((tavern, slot) => (tavern, slot)).Where(x => x.tavern.Cell == cell).Select(x => x.slot).ToArray(),
                jurisdictionLocals = jurisdictionCells.GetValueOrDefault(cell, []).ToArray()
            }).ToArray();

        var eventReferences = battle.Events.Select((ev, slot) => new
        {
            eventId = ev.Id,
            slots = eventsById[ev.Id].Select(x => x.slot).ToArray(),
            cells = battle.Events.Where(candidate => candidate.Id == ev.Id && candidate.Cell >= 0).Select(candidate => candidate.Cell).Distinct().ToArray(),
            armySlots = battle.Armies.Select((army, index) => (army, index)).Where(x => x.army.State70 == ev.Id).Select(x => x.index).ToArray(),
            siteSlots = battle.Sites.Select((site, index) => (site, index)).Where(x => x.site.Cell >= 0 && x.site.State11 == ev.Id).Select(x => x.index).ToArray()
        }).GroupBy(x => x.eventId).Select(g => g.First()).OrderBy(x => x.eventId).ToArray();

        return new
        {
            valid = conflicts.Count == 0,
            conflicts,
            byCell = cellIndex,
            events = eventReferences,
            jurisdictionCenters = jurisdictionCells.OrderBy(x => x.Key).Select(x => new { center = x.Key, locals = x.Value.ToArray() }).ToArray()
        };
    }
}
