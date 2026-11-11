using Android.App;
using Android.Content;
using Android.Content.PM;
using Android.OS;
using Android.Provider;
using Android.Webkit;
using Android.Widget;
using System.Text;
using System.Text.Json;
using Ew4.Editor;

namespace Ew4.EditorAndroid;

[Activity(Label = "EW4 Mod 编辑器", MainLauncher = true, Exported = true,
    ConfigurationChanges = ConfigChanges.Orientation | ConfigChanges.ScreenSize | ConfigChanges.KeyboardHidden)]
public sealed class MainActivity : Activity
{
    private const string Origin = "https://editor.ew4.local";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private WebView? web;
    private EditorApi? api;
    private IValueCallback? fileCallback;
    private byte[]? saving;
    private int folderRevision;

    protected override async void OnCreate(Bundle? savedInstanceState)
    {
        base.OnCreate(savedInstanceState);
        var loading = new TextView(this) { Text = "正在准备编辑器…", Gravity = global::Android.Views.GravityFlags.Center };
        SetContentView(loading);
        try
        {
            string editorHome = Path.Combine(FilesDir!.AbsolutePath, "r3-20261111");
            await Task.Run(() =>
            {
                // Copy bundled baseline once; author.json is never overwritten on restart.
                string ready = Path.Combine(editorHome, "baseline.ready");
                if (!File.Exists(ready)) { CopyAssets("baseline", editorHome); File.WriteAllText(ready, "1"); }
                api = new EditorApi(new AuthorEngine(editorHome));
            });
            web = new WebView(this);
            web.Settings.JavaScriptEnabled = true; web.Settings.DomStorageEnabled = true;
            web.Settings.AllowFileAccess = false; web.Settings.AllowContentAccess = true;
            web.Settings.SetSupportMultipleWindows(false);
            web.SetWebViewClient(new LocalClient(this)); web.SetWebChromeClient(new Chrome(this));
            web.AddJavascriptInterface(new NativeBridge(this), "ew4Native");
            SetContentView(web); web.LoadUrl(Origin + "/index.html");
        }
        catch (Exception error) { loading.Text = "编辑器启动失败：" + error.Message; }
    }
    private void CopyAssets(string source, string target)
    {
        var children = Assets!.List(source) ?? [];
        if (children.Length > 0) { Directory.CreateDirectory(target); foreach (string child in children) CopyAssets(source + "/" + child, Path.Combine(target, child)); }
        else { Directory.CreateDirectory(Path.GetDirectoryName(target)!); using var input = Assets.Open(source); using var output = File.Create(target); input.CopyTo(output); }
    }
    private void Notify(string callback, object value) => RunOnUiThread(() => web?.EvaluateJavascript(callback + "(" + JsonSerializer.Serialize(value, Json) + ")", null));
    private void ToastError(string message) => RunOnUiThread(() => Toast.MakeText(this, message, ToastLength.Long)?.Show());
    private sealed class LocalClient(MainActivity activity) : WebViewClient
    {
        public override bool ShouldOverrideUrlLoading(WebView? view, IWebResourceRequest? request) => request?.Url?.ToString()?.StartsWith(Origin + "/", StringComparison.Ordinal) != true;
        public override WebResourceResponse? ShouldInterceptRequest(WebView? view, IWebResourceRequest? request)
        {
            string? url = request?.Url?.ToString();
            if (url == null || !url.StartsWith(Origin + "/", StringComparison.Ordinal)) return new("text/plain", "utf-8", new MemoryStream());
            try
            {
                var uri = new Uri(url); string path = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
                if (path.StartsWith("editor-api/", StringComparison.Ordinal))
                {
                    var result = activity.api!.Dispatch("GET", uri.PathAndQuery);
                    return new(result.ContentType, "utf-8", result.Status, result.Status == 200 ? "OK" : "Error", new Dictionary<string, string> { ["Cache-Control"] = "no-store" }, new MemoryStream(result.Bytes));
                }
                if (path.Split('/').Any(s => s is ".." or ".") || path.Contains('\\')) throw new IOException("无效路径");
                using var input = activity.Assets!.Open("www/" + path); using var output = new MemoryStream(); input.CopyTo(output);
                byte[] bytes = output.ToArray();
                if (path.EndsWith(".html", StringComparison.Ordinal)) bytes = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(bytes).Replace("<head>", "<head><script src=\"/native.js\"></script>", StringComparison.Ordinal));
                string mime = path.EndsWith(".html") ? "text/html" : path.EndsWith(".js") ? "text/javascript" : path.EndsWith(".css") ? "text/css" : path.EndsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
                return new(mime, "utf-8", new MemoryStream(bytes));
            }
            catch (Exception) { return new("text/plain", "utf-8", 404, "Not Found", new Dictionary<string, string>(), new MemoryStream()); }
        }
    }
    private sealed class Chrome(MainActivity activity) : WebChromeClient
    {
        public override bool OnShowFileChooser(WebView? webView, IValueCallback? filePathCallback, FileChooserParams? fileChooserParams)
        {
            activity.fileCallback?.OnReceiveValue(null); activity.fileCallback = filePathCallback;
            var intent = new Intent(Intent.ActionOpenDocument); intent.AddCategory(Intent.CategoryOpenable); intent.SetType("*/*");
            intent.PutExtra(Intent.ExtraAllowMultiple, fileChooserParams?.Mode == ChromeFileChooserMode.OpenMultiple);
            activity.StartActivityForResult(intent, 101); return true;
        }
    }
    private sealed class NativeBridge(MainActivity activity) : Java.Lang.Object
    {
        [JavascriptInterface, Java.Interop.Export("request")]
        public void Request(string id, string method, string target, string body)
        {
            _ = Task.Run(() =>
            {
                var result = target.StartsWith("/editor-api/", StringComparison.Ordinal) && method is "GET" or "POST"
                    ? activity.api!.Dispatch(method, target, body) : new EditorResponse([], Status: 403);
                activity.RunOnUiThread(() => activity.web?.EvaluateJavascript("window.ew4NativeReply(" + JsonSerializer.Serialize(id) + "," + JsonSerializer.Serialize(result, Json) + ")", null));
            });
        }
        [JavascriptInterface, Java.Interop.Export("save")]
        public void Save(string name, string bytes)
        {
            activity.RunOnUiThread(() =>
            {
                if (activity.saving != null) { activity.ToastError("请先完成当前导出"); return; }
                try
                {
                    activity.saving = Convert.FromBase64String(bytes);
                    var intent = new Intent(Intent.ActionCreateDocument); intent.AddCategory(Intent.CategoryOpenable); intent.SetType("application/octet-stream");
                    intent.PutExtra(Intent.ExtraTitle, Path.GetFileName(name)); activity.StartActivityForResult(intent, 102);
                }
                catch (Exception e) { activity.saving = null; activity.ToastError(e.Message); }
            });
        }
        [JavascriptInterface, Java.Interop.Export("chooseFolder")]
        public void ChooseFolder(int revision) => activity.RunOnUiThread(() =>
        {
            activity.folderRevision = revision;
            activity.StartActivityForResult(new Intent(Intent.ActionOpenDocumentTree), 103);
        });
    }
    protected override void OnActivityResult(int requestCode, Result resultCode, Intent? data)
    {
        base.OnActivityResult(requestCode, resultCode, data);
        if (requestCode == 101) { fileCallback?.OnReceiveValue(WebChromeClient.FileChooserParams.ParseResult((int)resultCode, data)); fileCallback = null; return; }
        if (requestCode == 102)
        {
            byte[]? bytes = saving; saving = null;
            if (resultCode != Result.Ok || data?.Data is not { } uri || bytes == null) return;
            _ = Task.Run(() => { try { using var output = ContentResolver!.OpenOutputStream(uri, "wt") ?? throw new IOException("无法写入文件"); output.Write(bytes); ToastError("已导出"); } catch (Exception e) { ToastError("导出失败：" + e.Message); } });
            return;
        }
        if (requestCode == 103 && resultCode == Result.Ok && data?.Data is { } folder)
        {
            _ = Task.Run(() =>
            {
                try
                {
                    var files = new Dictionary<string, string>(StringComparer.Ordinal); long total = 0;
                    void Visit(string documentId, string prefix, int depth)
                    {
                        if (depth > 16) throw new IOException("文件夹层级超过 16");
                        var children = DocumentsContract.BuildChildDocumentsUriUsingTree(folder, documentId)!;
                        using var cursor = ContentResolver!.Query(children, [DocumentsContract.Document.ColumnDocumentId!, DocumentsContract.Document.ColumnDisplayName!, DocumentsContract.Document.ColumnMimeType!], null, null, null);
                        while (cursor?.MoveToNext() == true)
                        {
                            string id = cursor.GetString(0)!, name = cursor.GetString(1)!;
                            if (name.Contains('/') || name.Contains('\\') || name is "." or "..") throw new IOException("文件名无效");
                            if (cursor.GetString(2) == DocumentsContract.Document.MimeTypeDir) { Visit(id, prefix + name + "/", depth + 1); continue; }
                            if (files.Count >= 4096) throw new IOException("最多导入 4096 个文件");
                            using var stream = ContentResolver.OpenInputStream(DocumentsContract.BuildDocumentUriUsingTree(folder, id)!)!;
                            using var output = new MemoryStream(); var buffer = new byte[81920]; int count;
                            while ((count = stream.Read(buffer)) > 0) { total += count; if (total > 256L * 1024 * 1024 || output.Length + count > 16 * 1024 * 1024) throw new IOException("素材大小超过限制"); output.Write(buffer, 0, count); }
                            files.Add(prefix + name, Convert.ToBase64String(output.ToArray()));
                        }
                    }
                    Visit(DocumentsContract.GetTreeDocumentId(folder)!, "", 0);
                    var result = api!.Dispatch("POST", "/editor-api/stories-preview", JsonSerializer.Serialize(new StoryRequest(folderRevision, Guid.NewGuid().ToString("N"), Files: files), Json));
                    Notify("window.ew4FolderPreview", new { result.Status, body = Encoding.UTF8.GetString(result.Bytes) });
                }
                catch (Exception e) { Notify("window.ew4FolderPreview", new { status = 400, body = JsonSerializer.Serialize(new { error = e.Message }) }); }
            });
        }
    }
    protected override void OnDestroy() { fileCallback?.OnReceiveValue(null); web?.Destroy(); web?.Dispose(); base.OnDestroy(); }
}
