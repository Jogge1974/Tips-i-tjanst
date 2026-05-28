// Quick test script to verify consistent reduction sizes
#r "bin/Debug/net10.0-windows/TipsAdmin.dll"
using TipsAdmin.Models;
using TipsAdmin.Services;

var reduction = new ReductionService();

// Test: 3-3 system (3 helgarderingar, 3 halvgarderingar, 7 enkeltecken)
Console.WriteLine("=== Test 3-3 system ===");

for (int trial = 0; trial < 3; trial++)
{
    var selections = new MatchSelection[13];
    
    // First 3: helgarderingar (1,X,2)
    for (int i = 0; i < 3; i++)
        selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true, Tvaa = true };
    
    // Next 3: halvgarderingar (1,X)
    for (int i = 3; i < 6; i++)
        selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true };
    
    // Rest: enkeltecken
    for (int i = 6; i < 13; i++)
        selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };

    var rows = reduction.ReduceSystem(selections);
    Console.WriteLine($"  Trial {trial + 1}: 3 hel + 3 halv (pos 1-3, 4-6) => {rows.Count} rader");
}

// Same structure but different positions
for (int trial = 0; trial < 3; trial++)
{
    var selections = new MatchSelection[13];
    
    // Positions 5-7: helgarderingar
    for (int i = 0; i < 13; i++)
        selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };
    
    for (int i = 4; i < 7; i++)
        selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true, Tvaa = true };
    
    // Positions 10-12: halvgarderingar (1,2)
    for (int i = 9; i < 12; i++)
        selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Tvaa = true };

    var rows = reduction.ReduceSystem(selections);
    Console.WriteLine($"  Trial {trial + 1}: 3 hel + 3 halv (pos 5-7, 10-12) => {rows.Count} rader");
}

// Test 4-0 system
Console.WriteLine("\n=== Test 4-0 system ===");
for (int trial = 0; trial < 3; trial++)
{
    var selections = new MatchSelection[13];
    for (int i = 0; i < 13; i++)
        selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };
    
    // Different positions for helgarderingar
    int[] helPos = trial == 0 ? new[]{0,1,2,3} : trial == 1 ? new[]{3,6,9,12} : new[]{1,5,8,11};
    foreach (var p in helPos)
        selections[p] = new MatchSelection { MatchNr = p + 1, Etta = true, Kryss = true, Tvaa = true };

    var rows = reduction.ReduceSystem(selections);
    Console.WriteLine($"  Trial {trial + 1}: 4 hel (pos {string.Join(",", helPos.Select(p => p+1))}) => {rows.Count} rader");
}

Console.WriteLine("\nDone!");
