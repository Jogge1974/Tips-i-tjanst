using TipsAdmin.Models;

namespace TipsAdmin.Services;

/// <summary>
/// Generates all row combinations and reduces them to guarantee 12 correct.
/// Uses a greedy covering code algorithm with covering radius 1.
/// </summary>
public class ReductionService
{
    /// <summary>
    /// Smart reduction: auto-detects whether to use single-group or combined reduction.
    /// Returns the reduced system and info about the reduction.
    /// </summary>
    public (List<string> rows, int grupper, int garantiNiva) SmartReduce(MatchSelection[] selections)
    {
        // Identify variable positions
        var variablePositions = new List<int>();
        for (int i = 0; i < selections.Length; i++)
        {
            if (selections[i].IsHalvgardering || selections[i].IsHelgardering)
                variablePositions.Add(i);
        }

        if (variablePositions.Count == 0)
        {
            return (GenerateAllRows(selections), 0, 13);
        }

        // Calculate mathematical rows for variable positions
        int variabelMatematiskt = 1;
        foreach (var pos in variablePositions)
            variabelMatematiskt *= selections[pos].AntalTecken;

        // Find minimum groups where balanced round-robin distribution
        // gives each sub-group ≤ 243 mathematical rows
        int antalGrupper = 1;
        if (variabelMatematiskt > 243)
        {
            for (int tryGroups = 2; tryGroups <= 4; tryGroups++)
            {
                // Round-robin assignment: distribute positions cyclically
                var testGroupMat = new int[tryGroups];
                Array.Fill(testGroupMat, 1);
                for (int i = 0; i < variablePositions.Count; i++)
                    testGroupMat[i % tryGroups] *= selections[variablePositions[i]].AntalTecken;

                if (testGroupMat.All(m => m <= 243))
                {
                    antalGrupper = tryGroups;
                    break;
                }
            }
            if (antalGrupper == 1) antalGrupper = 4; // fallback
        }

        if (antalGrupper == 1)
        {
            var rows = ReduceSystem(selections);
            return (rows, 1, 12);
        }
        else
        {
            // Round-robin assignment: distributes hel/halv evenly across groups
            var groupAssignment = new int[selections.Length];
            for (int i = 0; i < variablePositions.Count; i++)
                groupAssignment[variablePositions[i]] = (i % antalGrupper) + 1;

            var rows = ReduceCombinedSystem(selections, groupAssignment, antalGrupper);
            return (rows, antalGrupper, 13 - antalGrupper);
        }
    }

    /// <summary>
    /// Generate all mathematical rows from the selections (full expansion)
    /// </summary>
    public List<string> GenerateAllRows(MatchSelection[] selections)
    {
        var rows = new List<string> { "" };

        foreach (var sel in selections)
        {
            var tecken = sel.GetTecken();
            var newRows = new List<string>();

            foreach (var row in rows)
            {
                foreach (var t in tecken)
                {
                    newRows.Add(row + t);
                }
            }
            rows = newRows;
        }

        return rows;
    }

    /// <summary>
    /// Reduce rows to guarantee 12 correct (covering radius 1 among reduced matches).
    /// Only matches that are halvgardering or helgardering (not matematik) are reduced.
    /// </summary>
    public List<string> ReduceSystem(MatchSelection[] selections)
    {
        // Identify which positions are subject to reduction
        var reducedPositions = new List<int>();
        for (int i = 0; i < selections.Length; i++)
        {
            if (selections[i].IsHalvgardering || selections[i].IsHelgardering)
                reducedPositions.Add(i);
        }

        if (reducedPositions.Count == 0)
        {
            // No reduction needed - all are enkeltecken or matematik
            return GenerateAllRows(selections);
        }

        // Sort reduced positions: helgarderingar first, then halvgarderingar
        // This ensures consistent outcome ordering regardless of physical match positions
        reducedPositions = reducedPositions
            .OrderByDescending(i => selections[i].AntalTecken)
            .ThenBy(i => i)
            .ToList();

        // Generate all possible outcomes for the reduced positions only
        var reducedSelections = reducedPositions.Select(i => selections[i]).ToArray();
        var allReducedOutcomes = GenerateAllRows(reducedSelections);

        // Find minimal covering set using greedy algorithm
        var coveringSet = GreedyCoveringCode(allReducedOutcomes, reducedSelections);

        // Now expand with mathematical garderingar
        var fullRows = ExpandWithMatematiska(selections, reducedPositions, coveringSet);

        return fullRows;
    }

    /// <summary>
    /// Covering code algorithm with multiple greedy restarts, local search, and redundancy removal.
    /// Finds a minimal set of codewords such that every possible outcome has at least one
    /// codeword within Hamming distance 1 (guaranteeing at most 1 wrong = 12 rätt).
    /// </summary>
    private List<string> GreedyCoveringCode(List<string> allOutcomes, MatchSelection[] selections)
    {
        var rng = new Random(42); // deterministic seed for reproducibility
        List<string>? bestResult = null;

        // More restarts for smaller problems (they're fast anyway)
        int restarts = allOutcomes.Count <= 100 ? 200
                     : allOutcomes.Count <= 300 ? 100
                     : allOutcomes.Count <= 1000 ? 40
                     : 15;

        for (int attempt = 0; attempt < restarts; attempt++)
        {
            var candidates = allOutcomes.ToList();
            if (attempt > 0)
            {
                // Shuffle candidates for different greedy paths
                for (int i = candidates.Count - 1; i > 0; i--)
                {
                    int j = rng.Next(i + 1);
                    (candidates[i], candidates[j]) = (candidates[j], candidates[i]);
                }
            }

            var coveringSet = GreedyPass(candidates, allOutcomes);

            // Remove redundant codewords
            coveringSet = RemoveRedundant(coveringSet, allOutcomes);

            if (bestResult == null || coveringSet.Count < bestResult.Count)
                bestResult = coveringSet;
        }

        // Apply local search only to the best result found
        bestResult = LocalSearch(bestResult!, allOutcomes, rng);

        return bestResult;
    }

    /// <summary>
    /// Local search improvement: try removing each codeword and see if a different
    /// single codeword can cover all the outcomes that become uncovered.
    /// If successful, we might enable further redundancy removal.
    /// </summary>
    private List<string> LocalSearch(List<string> coveringSet, List<string> allOutcomes, Random rng)
    {
        var best = coveringSet;

        // Multiple passes of local improvement
        for (int pass = 0; pass < 3; pass++)
        {
            bool improved = false;

            for (int i = best.Count - 1; i >= 0; i--)
            {
                // Remove codeword i, find which outcomes become uncovered
                var without = best.Where((_, idx) => idx != i).ToList();

                var uncoveredByRemoval = new List<int>();
                for (int o = 0; o < allOutcomes.Count; o++)
                {
                    bool covered = false;
                    foreach (var cw in without)
                    {
                        if (HammingDistance(cw, allOutcomes[o]) <= 1) { covered = true; break; }
                    }
                    if (!covered) uncoveredByRemoval.Add(o);
                }

                if (uncoveredByRemoval.Count == 0)
                {
                    // Can simply remove it
                    best = without;
                    improved = true;
                    continue;
                }

                // Try to find a single replacement that covers all uncovered outcomes
                foreach (var candidate in allOutcomes)
                {
                    if (without.Contains(candidate)) continue;
                    bool coversAll = true;
                    foreach (var uidx in uncoveredByRemoval)
                    {
                        if (HammingDistance(candidate, allOutcomes[uidx]) > 1) { coversAll = false; break; }
                    }
                    if (coversAll)
                    {
                        // Replace: use 'without' + candidate, then try removing redundant again
                        without.Add(candidate);
                        without = RemoveRedundant(without, allOutcomes);
                        if (without.Count < best.Count)
                        {
                            best = without;
                            improved = true;
                        }
                        break;
                    }
                }
            }

            if (!improved) break;
        }

        return best;
    }

    /// <summary>
    /// Single greedy pass: pick the candidate covering most uncovered outcomes each step.
    /// </summary>
    private List<string> GreedyPass(List<string> candidates, List<string> allOutcomes)
    {
        var coveringSet = new List<string>();
        var uncovered = new HashSet<int>(Enumerable.Range(0, allOutcomes.Count));

        while (uncovered.Count > 0)
        {
            string bestRow = "";
            int bestCoverage = -1;

            foreach (var candidate in candidates)
            {
                int coverage = 0;
                foreach (var idx in uncovered)
                {
                    if (HammingDistance(candidate, allOutcomes[idx]) <= 1)
                        coverage++;
                }
                if (coverage > bestCoverage)
                {
                    bestCoverage = coverage;
                    bestRow = candidate;
                }
            }

            coveringSet.Add(bestRow);

            var nowCovered = new List<int>();
            foreach (var idx in uncovered)
            {
                if (HammingDistance(bestRow, allOutcomes[idx]) <= 1)
                    nowCovered.Add(idx);
            }
            foreach (var idx in nowCovered)
                uncovered.Remove(idx);
        }

        return coveringSet;
    }

    /// <summary>
    /// Remove redundant codewords: try removing each one and check if coverage holds.
    /// </summary>
    private List<string> RemoveRedundant(List<string> coveringSet, List<string> allOutcomes)
    {
        var result = new List<string>(coveringSet);

        // Try removing each codeword (from last to first to avoid index issues)
        for (int i = result.Count - 1; i >= 0; i--)
        {
            var without = result.Where((_, idx) => idx != i).ToList();
            if (IsCovering(without, allOutcomes))
            {
                result = without;
            }
        }

        return result;
    }

    /// <summary>
    /// Check if a set of codewords covers all outcomes (Hamming distance ≤ 1).
    /// </summary>
    private bool IsCovering(List<string> coveringSet, List<string> allOutcomes)
    {
        foreach (var outcome in allOutcomes)
        {
            bool covered = false;
            foreach (var codeword in coveringSet)
            {
                if (HammingDistance(outcome, codeword) <= 1)
                {
                    covered = true;
                    break;
                }
            }
            if (!covered) return false;
        }
        return true;
    }

    /// <summary>
    /// Expand reduced covering set with matematiska garderingar and enkeltecken
    /// </summary>
    private List<string> ExpandWithMatematiska(MatchSelection[] selections, List<int> reducedPositions, List<string> coveringSet)
    {
        // First, build the base rows from covering set with enkeltecken filled in
        var baseRows = new List<string>();

        foreach (var reducedRow in coveringSet)
        {
            var fullRow = new char[13];

            for (int i = 0; i < selections.Length; i++)
            {
                int idxInReduced = reducedPositions.IndexOf(i);
                if (idxInReduced >= 0)
                {
                    fullRow[i] = reducedRow[idxInReduced];
                }
                else if (selections[i].IsEnkeltecken)
                {
                    fullRow[i] = selections[i].GetTecken()[0];
                }
                else
                {
                    // Placeholder for matematiska garderingar - will be expanded
                    fullRow[i] = '0';
                }
            }
            baseRows.Add(new string(fullRow));
        }

        // Now expand matematiska garderingar
        var matematiskaPositions = new List<int>();
        for (int i = 0; i < selections.Length; i++)
        {
            if (selections[i].IsMatematisk)
                matematiskaPositions.Add(i);
        }

        if (matematiskaPositions.Count == 0)
            return baseRows;

        // For each base row, create copies with all matematiska combinations
        var expandedRows = new List<string>();
        foreach (var baseRow in baseRows)
        {
            var expanded = new List<string> { baseRow };

            foreach (var pos in matematiskaPositions)
            {
                var tecken = selections[pos].GetTecken();
                var newExpanded = new List<string>();

                foreach (var row in expanded)
                {
                    foreach (var t in tecken)
                    {
                        var chars = row.ToCharArray();
                        chars[pos] = t;
                        newExpanded.Add(new string(chars));
                    }
                }
                expanded = newExpanded;
            }
            expandedRows.AddRange(expanded);
        }

        return expandedRows;
    }

    /// <summary>
    /// Calculate Hamming distance between two strings
    /// </summary>
    private int HammingDistance(string a, string b)
    {
        int dist = 0;
        for (int i = 0; i < a.Length; i++)
        {
            if (a[i] != b[i]) dist++;
        }
        return dist;
    }

    /// <summary>
    /// Verify that a system has 12-rätts garanti.
    /// Returns true if for every possible outcome, at least one row has ≤1 wrong
    /// among the reduced positions.
    /// </summary>
    public bool VerifyGaranti(List<string> systemRows, MatchSelection[] selections)
    {
        var reducedPositions = new List<int>();
        for (int i = 0; i < selections.Length; i++)
        {
            if (selections[i].IsHalvgardering || selections[i].IsHelgardering)
                reducedPositions.Add(i);
        }

        if (reducedPositions.Count == 0) return true;

        // Generate all possible outcomes for reduced positions
        var reducedSelections = reducedPositions.Select(i => selections[i]).ToArray();
        var allOutcomes = GenerateAllRows(reducedSelections);

        // Extract reduced positions from system rows
        var systemReduced = systemRows.Select(row =>
            new string(reducedPositions.Select(p => row[p]).ToArray())
        ).Distinct().ToList();

        // Check every outcome is covered
        foreach (var outcome in allOutcomes)
        {
            bool covered = false;
            foreach (var sysRow in systemReduced)
            {
                if (HammingDistance(outcome, sysRow) <= 1)
                {
                    covered = true;
                    break;
                }
            }
            if (!covered) return false;
        }

        return true;
    }

    /// <summary>
    /// Reduce a combined system: split variable matches into N groups,
    /// reduce each independently, then combine via Cartesian product.
    /// Guarantees (13 - N) rätt (covering radius 1 per group, max N total errors).
    /// </summary>
    public List<string> ReduceCombinedSystem(MatchSelection[] selections, int[] groupAssignment, int antalGrupper)
    {
        // Collect positions per group
        var groupPositions = new List<int>[antalGrupper];
        for (int g = 0; g < antalGrupper; g++)
            groupPositions[g] = new List<int>();

        for (int i = 0; i < selections.Length; i++)
        {
            if (groupAssignment[i] >= 1 && groupAssignment[i] <= antalGrupper)
                groupPositions[groupAssignment[i] - 1].Add(i);
        }

        // Reduce each group independently
        var coveringSets = new List<string>[antalGrupper];
        for (int g = 0; g < antalGrupper; g++)
        {
            var groupSel = groupPositions[g].Select(i => selections[i]).ToArray();
            var allOutcomes = GenerateAllRows(groupSel);
            coveringSets[g] = GreedyCoveringCode(allOutcomes, groupSel);
        }

        // Cartesian product of all covering sets
        var combined = CartesianProduct(coveringSets);

        // Build full 13-char rows
        var matematiskaPositions = new List<int>();
        var baseRows = new List<string>();

        foreach (var combo in combined)
        {
            var fullRow = new char[13];
            var groupIdx = new int[antalGrupper];

            for (int i = 0; i < selections.Length; i++)
            {
                int g = groupAssignment[i];
                if (g >= 1 && g <= antalGrupper)
                {
                    fullRow[i] = coveringSets[g - 1][0][0]; // placeholder, overwrite below
                }
            }

            // Place group characters
            for (int i = 0; i < selections.Length; i++)
            {
                int g = groupAssignment[i];
                if (g >= 1 && g <= antalGrupper)
                {
                    int posInGroup = groupPositions[g - 1].IndexOf(i);
                    fullRow[i] = combo[g - 1][posInGroup];
                }
                else if (selections[i].IsEnkeltecken)
                {
                    fullRow[i] = selections[i].GetTecken()[0];
                }
                else if (selections[i].IsMatematisk)
                {
                    fullRow[i] = '0'; // placeholder
                }
            }
            baseRows.Add(new string(fullRow));
        }

        // Expand matematiska garderingar
        for (int i = 0; i < selections.Length; i++)
        {
            if (selections[i].IsMatematisk)
                matematiskaPositions.Add(i);
        }

        if (matematiskaPositions.Count == 0)
            return baseRows;

        var expandedRows = new List<string>();
        foreach (var baseRow in baseRows)
        {
            var expanded = new List<string> { baseRow };
            foreach (var pos in matematiskaPositions)
            {
                var tecken = selections[pos].GetTecken();
                var newExpanded = new List<string>();
                foreach (var row in expanded)
                {
                    foreach (var t in tecken)
                    {
                        var chars = row.ToCharArray();
                        chars[pos] = t;
                        newExpanded.Add(new string(chars));
                    }
                }
                expanded = newExpanded;
            }
            expandedRows.AddRange(expanded);
        }

        return expandedRows;
    }

    /// <summary>
    /// Cartesian product of N lists of strings.
    /// Returns list of string arrays (one element per group).
    /// </summary>
    private List<string[]> CartesianProduct(List<string>[] sets)
    {
        var result = new List<string[]> { new string[sets.Length] };

        for (int g = 0; g < sets.Length; g++)
        {
            var newResult = new List<string[]>();
            foreach (var existing in result)
            {
                foreach (var item in sets[g])
                {
                    var copy = (string[])existing.Clone();
                    copy[g] = item;
                    newResult.Add(copy);
                }
            }
            result = newResult;
        }

        return result;
    }

    /// <summary>
    /// Verify N-rätts garanti for a combined system (covering radius = antalGrupper).
    /// </summary>
    public bool VerifyGarantiN(List<string> systemRows, MatchSelection[] selections, int[] groupAssignment, int antalGrupper)
    {
        // Collect all grouped positions
        var allGroupedPositions = new List<int>();
        for (int i = 0; i < selections.Length; i++)
        {
            if (groupAssignment[i] >= 1 && groupAssignment[i] <= antalGrupper)
                allGroupedPositions.Add(i);
        }

        if (allGroupedPositions.Count == 0) return true;

        // Generate all possible outcomes for grouped positions
        var groupedSelections = allGroupedPositions.Select(i => selections[i]).ToArray();
        var allOutcomes = GenerateAllRows(groupedSelections);

        // Extract grouped positions from system rows
        var systemGrouped = systemRows.Select(row =>
            new string(allGroupedPositions.Select(p => row[p]).ToArray())
        ).Distinct().ToList();

        // Check every outcome has a codeword within Hamming distance = antalGrupper
        foreach (var outcome in allOutcomes)
        {
            bool covered = false;
            foreach (var sysRow in systemGrouped)
            {
                if (HammingDistance(outcome, sysRow) <= antalGrupper)
                {
                    covered = true;
                    break;
                }
            }
            if (!covered) return false;
        }

        return true;
    }

    /// <summary>
    /// Get system info: antal hel, halv, rader
    /// </summary>
    public (int hel, int halv, int matematik, int rader) GetSystemInfo(MatchSelection[] selections, List<string> rows)
    {
        int hel = selections.Count(s => s.IsHelgardering);
        int halv = selections.Count(s => s.IsHalvgardering);
        int mat = selections.Count(s => s.IsMatematisk);
        return (hel, halv, mat, rows.Count);
    }
}
