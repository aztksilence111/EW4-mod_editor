using Ew4.Editor;

var builder = WebApplication.CreateBuilder(args);
int port = int.Parse(Environment.GetEnvironmentVariable("EW4_EDITOR_PORT") ?? "5184");
builder.WebHost.UseUrls("http://127.0.0.1:" + port);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 32 * 1024 * 1024);
var engine = new AuthorEngine(Path.GetFullPath(Environment.GetEnvironmentVariable("EW4_EDITOR_HOME") ?? ".local"));
var app = builder.Build();
// The bridge is local-only. Reject cross-site writes, including form POSTs.
app.Use(async (context, next) =>
{
    if (context.Request.Path == "/editor-api/restore")
        context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize = 512L * 1024 * 1024;
    var host = context.Request.Host;
    string? origin = context.Request.Headers.Origin;
    bool localOrigin = origin == null || Uri.TryCreate(origin, UriKind.Absolute, out var uri)
        && uri.Host == "127.0.0.1" && uri.Scheme == "http" && uri.Port is 5174 or 5175 or 5184;
    if (host.Host != "127.0.0.1" || !localOrigin || context.Request.Method == "POST"
        && (context.Request.Headers["X-EW4-Editor"] != "1" || !context.Request.HasJsonContentType()))
    { context.Response.StatusCode = 403; return; }
    context.Response.Headers.CacheControl = "no-store";
    try { await next(); }
    catch (Exception e) when (e is not OutOfMemoryException)
    {
        context.Response.StatusCode = 400;
        await context.Response.WriteAsJsonAsync(new { error = e.Message });
    }
});
app.MapGet("/editor-api/project", () => engine.Overview());
app.MapGet("/editor-api/scenario/{id}", (string id) => engine.Scenario(id));
app.MapGet("/editor-api/terrain/{id:int}", (int id) => Results.File(engine.Terrain(id), "application/octet-stream"));
app.MapPost("/editor-api/preview", (BatchRequest request) => engine.Preview(request));
app.MapPost("/editor-api/csv-preview", (CsvRequest request) => engine.PreviewCsv(request));
app.MapPost("/editor-api/countries-preview", (CountriesRequest request) => engine.PreviewCountries(request));
app.MapGet("/editor-api/country-image", (string id, int frame, HttpContext context) =>
{
    var bytes = engine.CountryImage(id, frame);
    context.Response.Headers.CacheControl = "private, max-age=86400";
    return Results.File(bytes, "image/png");
});
app.MapGet("/editor-api/events/{id}", (string id, int? faction) => engine.Events(id, faction));
app.MapGet("/editor-api/event-image", (string path) => Results.File(engine.EventImage(path), "image/png"));
app.MapPost("/editor-api/events-preview", (EventsRequest request) => engine.PreviewEvents(request));
app.MapPost("/editor-api/mod-preview", (ModImportRequest request) => engine.PreviewMod(request));
app.MapPost("/editor-api/apply", (ApplyRequest request) => engine.Apply(request));
app.MapPost("/editor-api/history", (HistoryRequest request) => engine.History(request));
app.MapPost("/editor-api/validate", () => engine.Validate());
app.MapGet("/editor-api/author", () => Results.File(engine.AuthorBytes(), "application/json", "project.ew4author"));
app.MapPost("/editor-api/restore", (RestoreRequest request) => engine.Restore(request));
app.MapPost("/editor-api/export", (ExportRequest request) => Results.File(engine.Export(request), "application/zip", request.Id + ".ew4mod"));
app.MapPost("/editor-api/export-original", (OriginalExportRequest request) => Results.File(engine.ExportOriginal(request), "application/zip", (request.Scope == "project" ? "original" : request.Scope) + (request.Layout == "legacy" ? "-assets" : "") + "-resources.zip"));
app.MapPost("/editor-api/export-btl", (BtlExportRequest request) => Results.File(engine.ExportBtl(request), "application/octet-stream", request.Scenario + ".btl"));
app.Run();
