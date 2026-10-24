using System.Text.Json.Nodes;
using Ew4.Core;
using Ew4.Mods;
using Ew4.Persistence;

internal static class JurisdictionCompatibility
{
    internal static void Run(string root)
    {
        byte[] Read(string path) => File.ReadAllBytes(Path.Combine(root,".local/rewrite/data",path));
        var hashes=JsonNode.Parse(File.ReadAllBytes(Path.Combine(root,".local/baseline.json")))!["files"]!.AsObject();
        var baseline=new ModBase(Read,hashes.Where(p=>p.Key.StartsWith("data/")).Select(p=>p.Key[5..]));
        byte[] edited=File.ReadAllBytes(Path.Combine(root,".local/runtime-compatibility/jurisdictions.btl"));
        var fixture=JsonNode.Parse(File.ReadAllBytes(Path.Combine(root,".local/runtime-compatibility/jurisdictions.json")))!;
        int cell=(int)fixture["cell"]!,target=(int)fixture["target"]!;
        var content=baseline.Content(p=>p=="original/conquest1.btl"?edited:Read(p),["conquest1"]);
        var session=content.Start("conquest1",content.Battle("conquest1").Factions[0].CountryId).Session;
        Require(session.World.Jurisdictions?.CellCenters[cell]==target,"runtime manual assignment");
        Require(session.World.Jurisdictions!.CellCenters[target]==target,"center points to itself");
        var restored=SessionSave.Decode(SessionSave.Encode(session),new(session.ContentRevision,session.World.ContentRevision,session.Account.ContentRevision));
        Require(restored.World.Jurisdictions?.CellCenters[cell]==target,"save restore manual assignment");
        Console.WriteLine("JURI original BTL export: real Rewrite startup and save restore passed");
    }
    private static void Require(bool condition,string message) {if(!condition)throw new Exception(message);}
}
