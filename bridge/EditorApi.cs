using System.Text.Json;

namespace Ew4.Editor;

public sealed record EditorResponse(byte[] Bytes, string ContentType = "application/json", string? FileName = null, int Status = 200);

// Host-neutral routing keeps the Android editor and local Web service on one contract.
public sealed class EditorApi(AuthorEngine engine)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public EditorResponse Dispatch(string method, string target, string? body = null)
    {
        try
        {
            var uri = new Uri("https://editor.invalid/" + target.TrimStart('/'));
            string path = uri.AbsolutePath.Replace("/editor-api/", "", StringComparison.Ordinal);
            var query = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Select(p => p.Split('=', 2)).ToDictionary(p => Uri.UnescapeDataString(p[0]), p => Uri.UnescapeDataString(p.ElementAtOrDefault(1) ?? ""));
            T Read<T>() => JsonSerializer.Deserialize<T>(body ?? "{}", Json) ?? throw new InvalidDataException("请求为空");
            string Q(string key) => query.GetValueOrDefault(key) ?? throw new InvalidDataException("缺少参数: " + key);
            EditorResponse Data(object value) => new(JsonSerializer.SerializeToUtf8Bytes(value, Json));
            if (method == "GET")
            {
                if (path.StartsWith("scenario/", StringComparison.Ordinal)) return Data(engine.Scenario(path[9..]));
                if (path.StartsWith("terrain/", StringComparison.Ordinal)) return new(engine.Terrain(int.Parse(path[8..])), "application/octet-stream");
                if (path.StartsWith("events/", StringComparison.Ordinal)) return Data(engine.Events(path[7..], query.TryGetValue("faction", out var faction) ? int.Parse(faction) : null));
                if (path.StartsWith("player/", StringComparison.Ordinal)) return new(engine.StoryPlayerAsset(path[7..]), path.EndsWith(".js") ? "text/javascript" : path.EndsWith(".css") ? "text/css" : "image/svg+xml");
                return path switch
                {
                    "project" => Data(engine.Overview()),
                    "unit-types" => Data(engine.UnitTypes()),
                    "maps" => Data(engine.Maps()),
                    "rules" => Data(engine.Rules()),
                    "rule-file" => Data(engine.RuleFile(Q("path"))),
                    "author" => new(engine.AuthorBytes(), "application/json", "project.ew4author"),
                    "country-image" => new(engine.CountryImage(Q("id"), int.Parse(Q("frame"))), "image/png"),
                    "event-image" => new(engine.EventImage(Q("path")), "image/png"),
                    "stories" => Data(engine.Stories()),
                    "story-image" => new(engine.StoryImage(Q("path"), query.GetValueOrDefault("session")), "image/png"),
                    _ => new([], Status: 404)
                };
            }
            if (method != "POST") return new([], Status: 405);
            return path switch
            {
                "preview" => Data(engine.Preview(Read<BatchRequest>())),
                "unit-types-preview" => Data(engine.PreviewUnitTypes(Read<UnitTypesRequest>())),
                "unit-types-deploy-preview" => Data(engine.PreviewUnitTypeDeployment(Read<UnitTypeDeploymentRequest>())),
                "csv-preview" => Data(engine.PreviewCsv(Read<CsvRequest>())),
                "countries-preview" => Data(engine.PreviewCountries(Read<CountriesRequest>())),
                "events-preview" => Data(engine.PreviewEvents(Read<EventsRequest>())),
                "mod-preview" => Data(engine.PreviewMod(Read<ModImportRequest>())),
                "stories-preview" => Data(engine.PreviewStories(Read<StoryRequest>())),
                "story-play" => Data(engine.PlayStory(Read<StoryPlayRequest>())),
                "story-action" => Data(engine.StoryAction(Read<StoryActionRequest>())),
                "apply" => Data(engine.Apply(Read<ApplyRequest>())),
                "history" => Data(engine.History(Read<HistoryRequest>())),
                "validate" => Data(engine.Validate()),
                "new-scenario" => Data(engine.NewScenario(Read<NewScenarioRequest>())),
                "inspect-export" => Data(engine.InspectExport(Read<InspectExportRequest>())),
                "rules-preview" => Data(engine.PreviewRules(Read<RuleFileRequest>())),
                "restore" => Data(engine.Restore(Read<RestoreRequest>())),
                "export" => new(engine.Export(Read<ExportRequest>()), "application/zip", Read<ExportRequest>().Id + ".ew4mod"),
                "export-original" => new(engine.ExportOriginal(Read<OriginalExportRequest>()), "application/zip", "resources.zip"),
                "export-btl" => new(engine.ExportBtl(Read<BtlExportRequest>()), "application/octet-stream", Read<BtlExportRequest>().Scenario + ".btl"),
                _ => new([], Status: 404)
            };
        }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            return new(JsonSerializer.SerializeToUtf8Bytes(new { error = error.Message }, Json), Status: 400);
        }
    }
}
