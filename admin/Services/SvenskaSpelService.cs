using Newtonsoft.Json.Linq;
using TipsAdmin.Models;

namespace TipsAdmin.Services;

public class SvenskaSpelService
{
    private const string BaseUrl = "https://api.www.svenskaspel.se/external/1/draw/stryktipset";
    private const string AccessKey = "45c5fc62-8386-4e59-b8ab-06b7f10f505d";
    private readonly HttpClient _http = new();

    public async Task<Kupong> HamtaKupong()
    {
        var url = $"{BaseUrl}/draws/?accesskey={AccessKey}";
        var json = await _http.GetStringAsync(url);
        var data = JObject.Parse(json);

        var draw = data["draw"] ?? data["draws"]?[0];
        if (draw == null)
            throw new Exception("Kunde inte hämta kupong från Svenska Spel");

        var kupong = new Kupong
        {
            DrawNumber = draw["drawNumber"]?.ToString() ?? "",
            CloseTime = draw["closeTime"]?.ToString() ?? ""
        };

        var events = draw["events"];
        if (events == null) return kupong;

        foreach (var ev in events)
        {
            var match = new Match
            {
                MatchNr = ev["eventNumber"]?.Value<int>() ?? 0,
                Description = ev["description"]?.ToString() ?? "",
                Odds1 = (ev["odds"]?["home"]?.Value<decimal>() ?? 0) / 100m,
                OddsX = (ev["odds"]?["draw"]?.Value<decimal>() ?? 0) / 100m,
                Odds2 = (ev["odds"]?["away"]?.Value<decimal>() ?? 0) / 100m,
                Procent1 = ev["distribution"]?["home"]?.Value<int>() ?? 0,
                ProcentX = ev["distribution"]?["draw"]?.Value<int>() ?? 0,
                Procent2 = ev["distribution"]?["away"]?.Value<int>() ?? 0,
            };

            var parts = match.Description.Split('-');
            match.Home = parts.Length > 0 ? parts[0].Trim() : "";
            match.Away = parts.Length > 1 ? string.Join("-", parts.Skip(1)).Trim() : "";

            kupong.Matches.Add(match);
        }

        return kupong;
    }
}
