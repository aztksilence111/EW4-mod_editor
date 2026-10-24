using System.Text;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using Ew4.Mods;

namespace Ew4.Editor;

public sealed partial class AuthorEngine
{
    private Dictionary<string, byte[]> LegacyResourceExport(Dictionary<string, byte[]> files)
    {
        var output = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var mappings = new List<object>();
        void Add(string target, byte[] bytes, string source)
        {
            ModFiles.PathName(target);
            if (!output.TryAdd(target, bytes)) throw new InvalidDataException("原版资源路径冲突: " + target);
            mappings.Add(new { source, target });
        }
        foreach (var (path, bytes) in files)
        {
            Add("rewrite-resources/" + path, bytes, path);
            if (path.StartsWith("original/", StringComparison.Ordinal)) Add("assets/" + path[9..], bytes, path);
        }

        var atlases = ModFiles.Object(Read(files, "client/manifest.json"))["atlases"]!.AsObject();
        var originalAtlases = ModFiles.Object(BaseRead("client/manifest.json"))["atlases"]!.AsObject();
        var known = sourceHashes.Keys.Union(files.Keys).ToHashSet(StringComparer.Ordinal);
        foreach (var (atlas, value) in atlases)
        {
            string imagePath = "client/images/" + atlas + ".png", directory = "client/ui/" + atlas + "/";
            bool changed = !JsonNode.DeepEquals(value, originalAtlases[atlas]) || files.ContainsKey(imagePath)
                || files.Keys.Any(p => p.StartsWith(directory, StringComparison.Ordinal));
            if (!changed) continue;
            var sprites = value!.AsObject();
            if (sprites.Count == 0) continue;
            int N(JsonNode entry, string field) => checked((int)entry[field]!.GetValue<double>());
            byte[] image;
            if (known.Contains(imagePath)) image = Read(files, imagePath);
            else if (sprites.All(p => known.Contains(directory + p.Key)))
            {
                int width = Math.Max(1, sprites.Max(p => N(p.Value!, "x") + N(p.Value!, "w")));
                int height = Math.Max(1, sprites.Max(p => N(p.Value!, "y") + N(p.Value!, "h")));
                Raster.Dimensions(width, height);
                var raster = new Raster(width, height, new byte[checked(width * height * 4)]);
                foreach (var (sprite, rect) in sprites)
                {
                    int w = N(rect!, "w"), h = N(rect!, "h");
                    if (w == 0 || h == 0) continue;
                    var source = Raster.Decode(Read(files, directory + sprite));
                    if (source.Width != w || source.Height != h) throw new InvalidDataException("原版图集帧尺寸不匹配: " + atlas + "/" + sprite);
                    raster.Copy(source, 0, 0, N(rect!, "x"), N(rect!, "y"), w, h);
                }
                image = raster.Png();
            }
            else throw new InvalidDataException("无法恢复原版图集: " + atlas);
            Add("assets/" + atlas + ".png", image, "client/manifest.json:atlases/" + atlas);
            var texture = new XElement("Texture", new XAttribute("name", atlas + ".png"));
            var images = new XElement("Images", sprites.Select(pair => new XElement("Image", new XAttribute("name", pair.Key),
                pair.Value!.AsObject().Select(attribute => new XAttribute(attribute.Key, attribute.Value!.GetValue<double>())))));
            Add("assets/" + atlas + ".xml", Encoding.UTF8.GetBytes(texture.ToString() + "\n" + images), "client/manifest.json:atlases/" + atlas);
        }
        Add("export-map.json", Bytes(new
        {
            schema = 1, layout = "legacy-assets", mappings,
            notes = new[] {
                "assets/ 使用原版 APK 的资源路径；图集由当前 manifest 和图片恢复为 PNG/XML。不是 APK 或原生代码补丁。",
                "rewrite-resources/ 保留本次导出的完整 Rewrite 原目录资源；export-map.json 记录路径对照。",
                "新增国家 ID、领土颜色、CNTR/JURI/VICT 扩展、扩展技能和事件树需要 Rewrite 引擎；原版不识别这些扩展。",
                "BTL 字节和已有扩展原样保留。原版目录布局不等于原版游戏兼容转换，不会删除扩展或改写原生代码。"
            }
        }), "export metadata");
        return output;
    }
}
