using Ew4.Editor;

string webRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, WebRootPath = Directory.Exists(webRoot) ? webRoot : null });
int port = int.Parse(Environment.GetEnvironmentVariable("EW4_EDITOR_PORT") ?? "5184");
builder.WebHost.UseUrls("http://127.0.0.1:" + port);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 32 * 1024 * 1024);
var engine = new AuthorEngine(Path.GetFullPath(Environment.GetEnvironmentVariable("EW4_EDITOR_HOME") ?? ".local"));
var api = new EditorApi(engine);
var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();
app.Use(async (context, next) =>
{
    if (context.Request.Path is var path && (path == "/editor-api/restore" || path == "/editor-api/stories-preview"))
        context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>()!.MaxRequestBodySize = 512L * 1024 * 1024;
    var host = context.Request.Host;
    string? origin = context.Request.Headers.Origin;
    bool localOrigin = origin == null || Uri.TryCreate(origin, UriKind.Absolute, out var uri)
        && uri.Host == "127.0.0.1" && uri.Scheme == "http" && uri.Port is 5174 or 5175 or 5184;
    if (host.Host != "127.0.0.1" || !localOrigin || context.Request.Method == "POST"
        && (context.Request.Headers["X-EW4-Editor"] != "1" || !context.Request.HasJsonContentType()))
    { context.Response.StatusCode = 403; return; }
    context.Response.Headers.CacheControl = "no-store";
    await next();
});
app.Map("/editor-api/{**path}", async (HttpContext context) =>
{
    using var reader = new StreamReader(context.Request.Body);
    var response = api.Dispatch(context.Request.Method, context.Request.Path + context.Request.QueryString, await reader.ReadToEndAsync());
    context.Response.StatusCode = response.Status;
    context.Response.ContentType = response.ContentType;
    if (response.FileName != null) context.Response.Headers.ContentDisposition = "attachment; filename=\"" + response.FileName + "\"";
    await context.Response.Body.WriteAsync(response.Bytes);
});
app.Run();
