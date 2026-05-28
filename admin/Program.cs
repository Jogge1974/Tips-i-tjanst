using TipsAdmin.Models;
using TipsAdmin.Services;

namespace TipsAdmin;

static class Program
{
    /// <summary>
    ///  The main entry point for the application.
    /// </summary>
    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "test")
        {
            RunTest();
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new Form1());
    }

    static void RunTest()
    {
        var sw = new StreamWriter("test_output.txt");
        var reduction = new ReductionService();

        sw.WriteLine("=== Test 3-3 system (alla varianter) ===");

        // All different sign combinations for halvgarderingar
        string[][] halvVariants = new[] {
            new[] { "1X", "1X", "1X" },
            new[] { "12", "12", "12" },
            new[] { "X2", "X2", "X2" },
            new[] { "1X", "12", "X2" },
            new[] { "X2", "1X", "12" },
        };

        foreach (var variant in halvVariants)
        {
            var selections = new MatchSelection[13];
            for (int i = 0; i < 13; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };

            // Hel pos 1-3
            for (int i = 0; i < 3; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true, Tvaa = true };

            // Halv pos 4-6 with variant signs
            for (int i = 0; i < 3; i++)
            {
                selections[i + 3] = new MatchSelection { MatchNr = i + 4 };
                foreach (char c in variant[i])
                {
                    if (c == '1') selections[i + 3].Etta = true;
                    if (c == 'X') selections[i + 3].Kryss = true;
                    if (c == '2') selections[i + 3].Tvaa = true;
                }
            }

            var rows = reduction.ReduceSystem(selections);
            bool ok = reduction.VerifyGaranti(rows, selections);
            sw.WriteLine($"  Halv=[{string.Join(",", variant)}]: {rows.Count} rader {(ok ? "✓" : "✗ FAIL")}");
        }

        // Different positions
        sw.WriteLine("\n  Olika positioner:");
        int[][] posVariants = new[] {
            new[] { 0,1,2, 3,4,5 },   // hel 1-3, halv 4-6
            new[] { 4,5,6, 9,10,11 }, // hel 5-7, halv 10-12
            new[] { 7,8,9, 0,1,2 },   // hel 8-10, halv 1-3
            new[] { 10,11,12, 3,6,9 }, // hel 11-13, halv 4,7,10
            new[] { 0,4,8, 1,5,9 },   // spread out
        };

        foreach (var pos in posVariants)
        {
            var selections = new MatchSelection[13];
            for (int i = 0; i < 13; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };

            for (int i = 0; i < 3; i++)
                selections[pos[i]] = new MatchSelection { MatchNr = pos[i] + 1, Etta = true, Kryss = true, Tvaa = true };
            for (int i = 3; i < 6; i++)
                selections[pos[i]] = new MatchSelection { MatchNr = pos[i] + 1, Etta = true, Kryss = true };

            var rows = reduction.ReduceSystem(selections);
            bool ok = reduction.VerifyGaranti(rows, selections);
            sw.WriteLine($"  Hel=[{pos[0]+1},{pos[1]+1},{pos[2]+1}] Halv=[{pos[3]+1},{pos[4]+1},{pos[5]+1}]: {rows.Count} rader {(ok ? "✓" : "✗ FAIL")}");
        }

        sw.WriteLine("\n=== Test 4-0 system ===");
        int[][] hel4Variants = new[] {
            new[] {0,1,2,3}, new[] {3,6,9,12}, new[] {1,5,8,11}, new[] {0,4,8,12}, new[] {2,3,10,11}
        };
        foreach (var pos in hel4Variants)
        {
            var selections = new MatchSelection[13];
            for (int i = 0; i < 13; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };
            foreach (var p in pos)
                selections[p] = new MatchSelection { MatchNr = p + 1, Etta = true, Kryss = true, Tvaa = true };

            var rows = reduction.ReduceSystem(selections);
            bool ok = reduction.VerifyGaranti(rows, selections);
            sw.WriteLine($"  Hel=[{string.Join(",", pos.Select(p => p+1))}]: {rows.Count} rader {(ok ? "✓" : "✗ FAIL")}");
        }

        // Test 6-6 system (should auto-detect as 2 groups × 3-3 = 11-rätt)
        sw.WriteLine("\n=== Test 6-6 system (ska bli 2 × 3-3 = 11 rätt) ===");
        {
            var selections = new MatchSelection[13];
            for (int i = 0; i < 13; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };
            for (int i = 0; i < 6; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true, Tvaa = true };
            for (int i = 6; i < 12; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true };

            var result = reduction.SmartReduce(selections);
            sw.WriteLine($"  6 hel + 6 halv: {result.rows.Count} rader, {result.grupper} grupper, {result.garantiNiva}-rätt");
        }

        // Test 8-0 system (should auto-detect as 2 groups × 4-0 = 11-rätt)
        sw.WriteLine("\n=== Test 8-0 system (ska bli 2 × 4-0 = 11 rätt) ===");
        {
            var selections = new MatchSelection[13];
            for (int i = 0; i < 13; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };
            for (int i = 0; i < 8; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true, Tvaa = true };

            var result = reduction.SmartReduce(selections);
            sw.WriteLine($"  8 hel: {result.rows.Count} rader, {result.grupper} grupper, {result.garantiNiva}-rätt");
        }

        // Test 12-0 system (should auto-detect as 3 groups × 4-0 = 10-rätt)
        sw.WriteLine("\n=== Test 12-0 system (ska bli 3 × 4-0 = 10 rätt) ===");
        {
            var selections = new MatchSelection[13];
            for (int i = 0; i < 13; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };
            for (int i = 0; i < 12; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true, Tvaa = true };

            var result = reduction.SmartReduce(selections);
            sw.WriteLine($"  12 hel: {result.rows.Count} rader, {result.grupper} grupper, {result.garantiNiva}-rätt");
        }

        // Test 0-7 system (should give 16 rows with 12-rätt garanti)
        sw.WriteLine("\n=== Test 0-7 system (ska bli 16 rader, 12 rätt) ===");
        {
            var selections = new MatchSelection[13];
            for (int i = 0; i < 13; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };
            // 7 halvgarderingar (1,X)
            for (int i = 0; i < 7; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true };

            var rows = reduction.ReduceSystem(selections);
            bool ok = reduction.VerifyGaranti(rows, selections);
            sw.WriteLine($"  7 halv(1,X): {rows.Count} rader {(ok ? "✓" : "✗")} (mål: 16)");
        }
        // Test with different signs
        {
            var selections = new MatchSelection[13];
            for (int i = 0; i < 13; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };
            for (int i = 0; i < 7; i++)
                selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Tvaa = true };

            var rows = reduction.ReduceSystem(selections);
            bool ok = reduction.VerifyGaranti(rows, selections);
            sw.WriteLine($"  7 halv(1,2): {rows.Count} rader {(ok ? "✓" : "✗")} (mål: 16)");
        }

        sw.Flush();
        sw.Close();
    }

    static MatchSelection[] MakeSelections(int[] hel, int[] halv, string halvSigns = "1X")
    {
        var selections = new MatchSelection[13];
        for (int i = 0; i < 13; i++)
            selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true };

        foreach (var i in hel)
            selections[i] = new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true, Tvaa = true };

        foreach (var i in halv)
        {
            selections[i] = halvSigns switch
            {
                "1X" => new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true },
                "12" => new MatchSelection { MatchNr = i + 1, Etta = true, Tvaa = true },
                _ => new MatchSelection { MatchNr = i + 1, Etta = true, Kryss = true },
            };
        }

        return selections;
    }
}