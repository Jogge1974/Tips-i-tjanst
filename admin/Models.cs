namespace TipsAdmin.Models;

public class Match
{
    public int MatchNr { get; set; }
    public string Description { get; set; } = "";
    public string Home { get; set; } = "";
    public string Away { get; set; } = "";
    public string League { get; set; } = "";
    public decimal Odds1 { get; set; }
    public decimal OddsX { get; set; }
    public decimal Odds2 { get; set; }
    public int Procent1 { get; set; }
    public int ProcentX { get; set; }
    public int Procent2 { get; set; }
}

public class Kupong
{
    public string DrawNumber { get; set; } = "";
    public string CloseTime { get; set; } = "";
    public List<Match> Matches { get; set; } = new();
}

/// <summary>
/// Represents the user's selection for one match
/// </summary>
public class MatchSelection
{
    public int MatchNr { get; set; }
    public bool Etta { get; set; }
    public bool Kryss { get; set; }
    public bool Tvaa { get; set; }
    public bool Matematik { get; set; } // Mathematical gardering (not reduced)

    public int AntalTecken => (Etta ? 1 : 0) + (Kryss ? 1 : 0) + (Tvaa ? 1 : 0);

    /// <summary>
    /// Single pick (1 sign selected)
    /// </summary>
    public bool IsEnkeltecken => AntalTecken == 1;

    /// <summary>
    /// Half gardering (2 signs, not mathematical)
    /// </summary>
    public bool IsHalvgardering => AntalTecken == 2 && !Matematik;

    /// <summary>
    /// Full gardering (3 signs, not mathematical)
    /// </summary>
    public bool IsHelgardering => AntalTecken == 3 && !Matematik;

    /// <summary>
    /// Mathematical gardering (multiple signs with Matematik checked - not reduced)
    /// </summary>
    public bool IsMatematisk => AntalTecken >= 2 && Matematik;

    /// <summary>
    /// Returns the selected signs as characters
    /// </summary>
    public char[] GetTecken()
    {
        var tecken = new List<char>();
        if (Etta) tecken.Add('1');
        if (Kryss) tecken.Add('X');
        if (Tvaa) tecken.Add('2');
        return tecken.ToArray();
    }
}
