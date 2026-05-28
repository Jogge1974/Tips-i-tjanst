using MySqlConnector;
using TipsAdmin.Models;

namespace TipsAdmin.Services;

public class DatabaseService
{
    private const string ConnectionString =
        "Server=mysql76.unoeuro.com;Database=liveidrott_se_db;User=liveidrott_se;Password=kd4EawG2znc6hpBRHF5m;";

    /// <summary>
    /// Upload system rows to TIT_systemrader table
    /// </summary>
    public async Task UploadSystemRows(string drawNumber, List<string> rows)
    {
        await using var conn = new MySqlConnection(ConnectionString);
        await conn.OpenAsync();

        // Delete existing rows for this draw
        await using (var delCmd = new MySqlCommand(
            "DELETE FROM TIT_systemrader WHERE drawNumber = @drawNumber", conn))
        {
            delCmd.Parameters.AddWithValue("@drawNumber", drawNumber);
            await delCmd.ExecuteNonQueryAsync();
        }

        // Insert new rows
        for (int rowIdx = 0; rowIdx < rows.Count; rowIdx++)
        {
            var row = rows[rowIdx];
            var sql = @"INSERT INTO TIT_systemrader (drawNumber, radNr, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13)
                        VALUES (@drawNumber, @radNr, @m1, @m2, @m3, @m4, @m5, @m6, @m7, @m8, @m9, @m10, @m11, @m12, @m13)";

            await using var cmd = new MySqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("@drawNumber", drawNumber);
            cmd.Parameters.AddWithValue("@radNr", rowIdx + 1);

            for (int i = 0; i < 13; i++)
            {
                string tecken = i < row.Length ? row[i].ToString() : "";
                cmd.Parameters.AddWithValue($"@m{i + 1}", tecken);
            }

            await cmd.ExecuteNonQueryAsync();
        }
    }

    /// <summary>
    /// Get current spelomgang from TIT_ekonomi
    /// </summary>
    public async Task<string> GetCurrentSpelomgang()
    {
        await using var conn = new MySqlConnection(ConnectionString);
        await conn.OpenAsync();

        await using var cmd = new MySqlCommand(
            "SELECT spelomgang FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1", conn);

        var result = await cmd.ExecuteScalarAsync();
        return result?.ToString() ?? "";
    }
}
