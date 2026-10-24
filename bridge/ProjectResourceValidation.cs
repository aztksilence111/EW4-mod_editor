using System.Text.Json.Nodes;
using Ew4.Mods;
using Ew4.Legacy;

namespace Ew4.Editor;

internal static class ProjectResourceValidation
{
    internal static void Check(Func<string, byte[]> read, HashSet<string> files)
    {
        void Need(string path)
        {
            ModFiles.PathName(path);
            if (!files.Contains(path)) throw new InvalidDataException("缺少项目资源: " + path);
        }

        var manifest = ModFiles.Object(read("client/manifest.json"));
        var atlases = manifest["atlases"] as JsonObject ?? throw new InvalidDataException("manifest 缺少图集配置");
        foreach (var (atlas, sprites) in atlases)
        {
            ModFiles.PathName(atlas);
            string? atlasPath = new[] {
                "client/images/" + atlas + ".png",
                "client/images/" + atlas + "_hd.png",
                "client/ui/" + atlas + ".png",
                "client/ui/" + atlas + "_hd.png",
                "client/ui_hd/" + atlas + ".png",
            }.FirstOrDefault(files.Contains);
            string? atlasDirectory = atlasPath == null && files.Any(path => path.StartsWith("client/ui/" + atlas + "/", StringComparison.Ordinal))
                ? "client/ui/" + atlas + "/" : null;
            if (atlasPath == null && atlasDirectory == null) throw new InvalidDataException("缺少图集资源: " + atlas);
            if (sprites is not JsonObject entries) throw new InvalidDataException("图集条目无效: " + atlas);
            Raster? raster = null;
            if (atlasPath != null) raster = Raster.Decode(read(atlasPath));
            foreach (var (sprite, frame) in entries)
            {
                ModFiles.PathName(sprite);
                if (atlasDirectory != null) Need(atlasDirectory + sprite);
                if (frame is not JsonObject entry || entry["x"] is null || entry["y"] is null || entry["w"] is null || entry["h"] is null)
                    throw new InvalidDataException("图集坐标缺失: " + atlas + "/" + sprite);
                double x = Coordinate(entry, "x"), y = Coordinate(entry, "y"), w = Coordinate(entry, "w"), h = Coordinate(entry, "h");
                if (raster != null && (x + w > raster.Width || y + h > raster.Height))
                    throw new InvalidDataException("图集坐标超出贴图: " + atlas + "/" + sprite);
            }

            static double Coordinate(JsonObject frame, string key)
            {
                double value;
                try { value = frame[key]!.GetValue<double>(); }
                catch (Exception e) when (e is FormatException or InvalidOperationException or OverflowException)
                { throw new InvalidDataException("图集坐标无效: " + key, e); }
                if (!double.IsFinite(value) || value < 0 || value != Math.Truncate(value) || key is "w" or "h" && value <= 0)
                    throw new InvalidDataException("图集坐标无效: " + key);
                return value;
            }
        }

        var commanders = manifest["commanders"] as JsonObject ?? throw new InvalidDataException("manifest 缺少将领映射");
        foreach (var row in ModFiles.Xml(read("original/def_commander.xml")).Root!.Elements())
        {
            string id = (string)row.Attribute("id")!;
            string name = commanders[id]?.GetValue<string>() ?? throw new InvalidDataException("manifest 缺少将领: " + id);
            if (!atlases.Any(pair => pair.Value?.AsObject()[name + ".png"] != null))
                throw new InvalidDataException("将领头像图集缺少: " + id + "/" + name);
        }

        var capitals = manifest["capitals"] as JsonObject ?? throw new InvalidDataException("manifest 缺少首都映射");
        foreach (var row in ModFiles.Xml(read("original/def_capital.xml")).Root!.Elements())
        {
            string id = (string)row.Attribute("id")!;
            string image = capitals[id]?["image"]?.GetValue<string>() ?? throw new InvalidDataException("manifest 缺少首都: " + id);
            if (atlases["buildings"]?[image] == null && atlases["buildings_hd"]?[image] == null)
                throw new InvalidDataException("首都图集缺少: " + id + "/" + image);
        }

        if (files.Contains("client/countries.json"))
        {
            foreach (var (id, country) in CountryCatalog.Load(read).Countries)
            {
                if (country.FlagImage != null) { Need(country.FlagImage); _ = Raster.Decode(read(country.FlagImage)); }
                else if (country.Flag != null)
                {
                    string path = "client/ui/image_flag_hd/" + country.Flag + "1.png";
                    Need(path); _ = Raster.Decode(read(path));
                    for (int frame = 1; frame <= 4; frame++)
                        if (atlases["buildings"]?[country.Flag + frame + ".png"] == null)
                            throw new InvalidDataException("国家缺少国旗动画帧: " + id + "/" + frame);
                }
            }
            var countries = ModFiles.Object(read("client/countries.json"))["countries"] as JsonObject
                ?? throw new InvalidDataException("国家名称资源缺少 countries");
            foreach (var (id, value) in countries)
                if (value?["name"]?.GetValue<string>() is not { Length: > 0 } name || name.Any(char.IsControl))
                    throw new InvalidDataException("国家名称无效: " + id);
        }
        foreach (var row in ModFiles.Xml(read("original/def_areaname.xml")).Root!.Elements())
            if (string.IsNullOrWhiteSpace((string?)row.Attribute("name"))) throw new InvalidDataException("城市名称为空");
    }
}
