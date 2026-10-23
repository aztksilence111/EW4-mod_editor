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
    var host = context.Request.Host;
    string? origin = context.Request.Headers.Origin;
    bool localOrigin = origin == null || Uri.TryCreate(origin, UriKind.Absolute, out var uri)
        && uri.Host == "127.0.0.1" && uri.Scheme == "http" && uri.Port is 5174 or 5184;
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
app.MapPost("/editor-api/apply", (ApplyRequest request) => engine.Apply(request));
app.MapPost("/editor-api/history", (HistoryRequest request) => engine.History(request));
app.MapPost("/editor-api/validate", () => engine.Validate());
app.MapGet("/editor-api/author", () => Results.File(engine.AuthorBytes(), "application/json", "project.ew4author"));
app.MapPost("/editor-api/restore", (RestoreRequest request) => engine.Restore(request));
app.MapPost("/editor-api/export", (ExportRequest request) => Results.File(engine.Export(request), "application/zip", request.Id + ".ew4mod"));
app.Run();
