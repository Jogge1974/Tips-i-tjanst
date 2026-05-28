using TipsAdmin.Models;
using TipsAdmin.Services;

namespace TipsAdmin;

public partial class Form1 : Form
{
    private readonly SvenskaSpelService _svenskaSpel = new();
    private readonly ReductionService _reduction = new();
    private readonly DatabaseService _database = new();

    private Kupong? _kupong;
    private List<string> _systemRows = new();
    private MatchSelection[] _selections = new MatchSelection[13];

    // UI controls for the coupon
    private CheckBox[,] _teckenBoxes = new CheckBox[13, 3]; // [match, tecken(1/X/2)]
    private CheckBox[] _matematikBoxes = new CheckBox[13];
    private Label[] _matchLabels = new Label[13];

    // Status & info labels
    private Label[] _dotLabels = new Label[13];
    private Label _lblTeckenStatus = new();
    private Label _lblInfo = new();
    private Label _lblRows = new();
    private Label _lblGaranti = new();
    private TextBox _txtOutput = new();
    private TextBox _txtFilePath = new();

    // Action buttons (class-level for enable/disable)
    private Button _btnReducera = new();
    private Button _btnMatematiskt = new();
    private Button _btnSaveFile = new();
    private Button _btnUploadDb = new();

    private const string DefaultFilePath = @"C:\Users\jgran\OneDrive\Dokument\Svenska Spel\SvenskaSpelRader.txt";

    public Form1()
    {
        InitializeComponent();
        InitializeSelections();
        BuildUI();
        UpdateTeckenStatus();
        this.Load += async (s, e) => await LoadKupong();
    }

    private void InitializeSelections()
    {
        for (int i = 0; i < 13; i++)
            _selections[i] = new MatchSelection { MatchNr = i + 1 };
    }

    private void BuildUI()
    {
        this.Text = "Tips(i)tjänst Admin – Systemreducering";
        this.Size = new Size(1100, 920);
        this.StartPosition = FormStartPosition.CenterScreen;
        this.Font = new Font("Segoe UI", 9.5f);

        // Main layout
        var mainPanel = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            Padding = new Padding(10),
        };
        mainPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 650));
        mainPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        // LEFT: Coupon panel
        var kupongPanel = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
        BuildKupongGrid(kupongPanel);
        mainPanel.Controls.Add(kupongPanel, 0, 0);

        // RIGHT: Output panel
        var rightPanel = new Panel { Dock = DockStyle.Fill };
        BuildOutputPanel(rightPanel);
        mainPanel.Controls.Add(rightPanel, 1, 0);

        this.Controls.Add(mainPanel);
    }

    private void BuildKupongGrid(Panel parent)
    {
        int y = 10;

        // Header
        var header = new Label
        {
            Text = "Kupong – Stryktipset",
            Font = new Font("Segoe UI", 14, FontStyle.Bold),
            Location = new Point(10, y),
            AutoSize = true,
            ForeColor = Color.FromArgb(27, 94, 32)
        };
        parent.Controls.Add(header);
        y += 35;

        // Column headers
        var col1 = new Label { Text = "Match", Location = new Point(10, y), Width = 280, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
        var col2 = new Label { Text = "1", Location = new Point(310, y), Width = 40, TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
        var col3 = new Label { Text = "X", Location = new Point(360, y), Width = 40, TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
        var col4 = new Label { Text = "2", Location = new Point(410, y), Width = 40, TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
        var col5 = new Label { Text = "Mat", Location = new Point(470, y), Width = 40, TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
        var col6 = new Label { Text = "%", Location = new Point(520, y), Width = 100, Font = new Font("Segoe UI", 9, FontStyle.Bold) };
        parent.Controls.AddRange(new Control[] { col1, col2, col3, col4, col5, col6 });
        y += 25;

        // Match rows
        for (int i = 0; i < 13; i++)
        {
            int matchIdx = i;

            _matchLabels[i] = new Label
            {
                Text = $"{i + 1}. Laddar...",
                Location = new Point(10, y + 2),
                Width = 280,
                AutoEllipsis = true,
            };
            parent.Controls.Add(_matchLabels[i]);

            for (int t = 0; t < 3; t++)
            {
                int teckenIdx = t;
                _teckenBoxes[i, t] = new CheckBox
                {
                    Location = new Point(318 + t * 50, y),
                    Size = new Size(20, 20),
                    Tag = (matchIdx, teckenIdx)
                };
                _teckenBoxes[i, t].CheckedChanged += OnTeckenChanged;
                parent.Controls.Add(_teckenBoxes[i, t]);
            }

            _matematikBoxes[i] = new CheckBox
            {
                Location = new Point(478, y),
                Size = new Size(20, 20),
            };
            _matematikBoxes[i].CheckedChanged += OnTeckenChanged;
            parent.Controls.Add(_matematikBoxes[i]);

            y += 30;
        }

        y += 5;

        // Separator line
        var separator = new Label
        {
            Location = new Point(10, y),
            Size = new Size(600, 2),
            BorderStyle = BorderStyle.Fixed3D,
        };
        parent.Controls.Add(separator);
        y += 10;

        // Column checkboxes (select/deselect all in column)
        for (int col = 0; col < 3; col++)
        {
            int colIdx = col;
            var chkCol = new CheckBox
            {
                Location = new Point(318 + col * 50, y),
                Size = new Size(20, 20),
            };
            chkCol.CheckedChanged += (s, e) =>
            {
                bool check = chkCol.Checked;
                for (int i = 0; i < 13; i++)
                    _teckenBoxes[i, colIdx].Checked = check;
            };
            parent.Controls.Add(chkCol);
        }

        // Matematik column checkbox
        var chkAllMat = new CheckBox
        {
            Location = new Point(478, y),
            Size = new Size(20, 20),
        };
        chkAllMat.CheckedChanged += (s, e) =>
        {
            bool check = chkAllMat.Checked;
            for (int i = 0; i < 13; i++)
                _matematikBoxes[i].Checked = check;
        };
        parent.Controls.Add(chkAllMat);

        // "Markera alla tecken" label next to column checkboxes
        var chkSelectAll = new CheckBox
        {
            Text = "Alla",
            Location = new Point(10, y),
            AutoSize = true,
        };
        chkSelectAll.CheckedChanged += (s, e) =>
        {
            bool check = chkSelectAll.Checked;
            for (int i = 0; i < 13; i++)
                for (int t = 0; t < 3; t++)
                    _teckenBoxes[i, t].Checked = check;
        };
        parent.Controls.Add(chkSelectAll);

        y += 30;

        // Match completion dot indicators
        for (int dot = 0; dot < 13; dot++)
        {
            _dotLabels[dot] = new Label
            {
                Text = "●",
                Location = new Point(15 + dot * 42, y),
                Size = new Size(36, 22),
                Font = new Font("Segoe UI", 14f),
                ForeColor = Color.FromArgb(224, 224, 224),
                TextAlign = ContentAlignment.MiddleCenter,
            };
            parent.Controls.Add(_dotLabels[dot]);
        }
        y += 25;

        _lblTeckenStatus = new Label
        {
            Text = "",
            Location = new Point(10, y),
            Width = 600,
            AutoSize = false,
            Height = 22,
            Font = new Font("Segoe UI", 10f, FontStyle.Bold),
        };
        parent.Controls.Add(_lblTeckenStatus);
        y += 35;

        // Buttons
        _btnReducera = new Button
        {
            Text = "Reducera system",
            Location = new Point(10, y),
            Size = new Size(280, 40),
            BackColor = Color.FromArgb(27, 94, 32),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 10, FontStyle.Bold),
            Enabled = false,
        };
        _btnReducera.Click += async (s, e) => await OnReducera();
        parent.Controls.Add(_btnReducera);

        _btnMatematiskt = new Button
        {
            Text = "Visa alla rader (matematiskt)",
            Location = new Point(310, y),
            Size = new Size(220, 40),
            FlatStyle = FlatStyle.Flat,
            Enabled = false,
        };
        _btnMatematiskt.Click += OnVisaAlla;
        parent.Controls.Add(_btnMatematiskt);

        y += 55;

        _lblInfo = new Label
        {
            Text = "",
            Location = new Point(10, y),
            Width = 600,
            Height = 60,
            Font = new Font("Segoe UI", 9.5f),
        };
        parent.Controls.Add(_lblInfo);
    }

    private void BuildOutputPanel(Panel parent)
    {
        int y = 10;

        _lblRows = new Label
        {
            Text = "Antal rader: –",
            Location = new Point(10, y),
            AutoSize = true,
            Font = new Font("Segoe UI", 12, FontStyle.Bold),
        };
        parent.Controls.Add(_lblRows);
        y += 30;

        _lblGaranti = new Label
        {
            Text = "",
            Location = new Point(10, y),
            AutoSize = true,
            ForeColor = Color.FromArgb(27, 94, 32),
        };
        parent.Controls.Add(_lblGaranti);
        y += 30;

        // Buttons row
        _btnSaveFile = new Button
        {
            Text = "Spara till fil",
            Location = new Point(10, y),
            Size = new Size(130, 35),
            FlatStyle = FlatStyle.Flat,
            Enabled = false,
        };
        _btnSaveFile.Click += OnSaveFile;
        parent.Controls.Add(_btnSaveFile);

        _btnUploadDb = new Button
        {
            Text = "Ladda upp till DB",
            Location = new Point(150, y),
            Size = new Size(150, 35),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(25, 118, 210),
            ForeColor = Color.White,
            Enabled = false,
        };
        _btnUploadDb.Click += async (s, e) => await OnUploadDb();
        parent.Controls.Add(_btnUploadDb);

        y += 50;

        _txtOutput = new TextBox
        {
            Location = new Point(10, y),
            Multiline = true,
            ScrollBars = ScrollBars.Both,
            Font = new Font("Consolas", 9.5f),
            WordWrap = false,
            ReadOnly = true,
            Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
            Size = new Size(380, 420),
        };
        parent.Controls.Add(_txtOutput);

        // File path selector at bottom
        var lblFilePath = new Label
        {
            Text = "Sparas till:",
            Anchor = AnchorStyles.Bottom | AnchorStyles.Left,
            Location = new Point(10, y + 430),
            AutoSize = true,
        };
        parent.Controls.Add(lblFilePath);

        _txtFilePath = new TextBox
        {
            Text = DefaultFilePath,
            Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
            Location = new Point(10, y + 450),
            Size = new Size(300, 25),
        };
        parent.Controls.Add(_txtFilePath);

        var btnBrowse = new Button
        {
            Text = "...",
            Anchor = AnchorStyles.Bottom | AnchorStyles.Right,
            Location = new Point(315, y + 449),
            Size = new Size(35, 27),
            FlatStyle = FlatStyle.Flat,
        };
        btnBrowse.Click += (s, e) =>
        {
            var dlg = new SaveFileDialog
            {
                Filter = "Textfiler (*.txt)|*.txt",
                FileName = Path.GetFileName(_txtFilePath.Text),
                InitialDirectory = Path.GetDirectoryName(_txtFilePath.Text) ?? ""
            };
            if (dlg.ShowDialog() == DialogResult.OK)
                _txtFilePath.Text = dlg.FileName;
        };
        parent.Controls.Add(btnBrowse);
    }

    private async Task LoadKupong()
    {
        try
        {
            _kupong = await _svenskaSpel.HamtaKupong();

            for (int i = 0; i < _kupong.Matches.Count && i < 13; i++)
            {
                var m = _kupong.Matches[i];
                _matchLabels[i].Text = $"{i + 1}. {m.Description}";

                // Show percentages as tooltip
                var tip = new ToolTip();
                tip.SetToolTip(_matchLabels[i], $"1: {m.Procent1}% X: {m.ProcentX}% 2: {m.Procent2}%  Odds: {m.Odds1:F2}/{m.OddsX:F2}/{m.Odds2:F2}");
            }

            _lblInfo.Text = $"Kupong laddad: Omgång {_kupong.DrawNumber}\nSpelstopp: {_kupong.CloseTime}";
        }
        catch (Exception ex)
        {
            _lblInfo.Text = $"Fel: {ex.Message}";
        }
    }

    private void OnTeckenChanged(object? sender, EventArgs e)
    {
        UpdateSelections();
        UpdateInfoLabel();
        UpdateTeckenStatus();
    }

    private void UpdateSelections()
    {
        for (int i = 0; i < 13; i++)
        {
            _selections[i].Etta = _teckenBoxes[i, 0].Checked;
            _selections[i].Kryss = _teckenBoxes[i, 1].Checked;
            _selections[i].Tvaa = _teckenBoxes[i, 2].Checked;
            _selections[i].Matematik = _matematikBoxes[i].Checked;
        }
    }

    private void UpdateInfoLabel()
    {
        int enkel = _selections.Count(s => s.IsEnkeltecken);
        int halv = _selections.Count(s => s.IsHalvgardering);
        int hel = _selections.Count(s => s.IsHelgardering);
        int mat = _selections.Count(s => s.IsMatematisk);

        int matematisktAntal = 1;
        foreach (var s in _selections)
        {
            if (s.AntalTecken > 0) matematisktAntal *= s.AntalTecken;
        }

        _lblInfo.Text = $"Enkeltecken: {enkel}  |  Halvgard: {halv}  |  Helgard: {hel}  |  Matematik: {mat}\n" +
                        $"Matematiskt antal rader: {matematisktAntal}";
    }

    private void UpdateTeckenStatus()
    {
        int otippade = 0;
        for (int i = 0; i < 13; i++)
        {
            bool harTecken = _selections[i].AntalTecken > 0;
            _dotLabels[i].ForeColor = harTecken
                ? Color.FromArgb(76, 175, 80)
                : Color.FromArgb(224, 224, 224);
            if (!harTecken) otippade++;
        }

        bool redo = otippade == 0;

        if (otippade == 13)
        {
            _lblTeckenStatus.Text = "Fyll i tecken för alla 13 matcher";
            _lblTeckenStatus.ForeColor = Color.Gray;
        }
        else if (redo)
        {
            _lblTeckenStatus.Text = "✓ Alla 13 matcher tippade – redo att reducera!";
            _lblTeckenStatus.ForeColor = Color.FromArgb(27, 94, 32);
        }
        else
        {
            string matchText = otippade == 1 ? "match saknar" : "matcher saknar";
            _lblTeckenStatus.Text = $"● {otippade} {matchText} tecken";
            _lblTeckenStatus.ForeColor = Color.FromArgb(211, 47, 47);
        }

        _btnReducera.Enabled = redo;
        _btnMatematiskt.Enabled = redo;

        // Disable save buttons when selections change (rows are stale)
        if (_systemRows.Count > 0)
        {
            _systemRows.Clear();
            _txtOutput.Text = "";
            _lblRows.Text = "Antal rader: –";
            _lblGaranti.Text = "";
            _btnSaveFile.Enabled = false;
            _btnUploadDb.Enabled = false;
        }
    }

    private async Task OnReducera()
    {
        // Validate that all matches have at least one sign
        for (int i = 0; i < 13; i++)
        {
            if (_selections[i].AntalTecken == 0)
            {
                MessageBox.Show($"Match {i + 1} saknar tecken!", "Fel", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
        }

        _lblRows.Text = "Reducerar...";
        _txtOutput.Text = "";
        this.Cursor = Cursors.WaitCursor;

        try
        {
            int grupper = 0;
            int garantiNiva = 12;

            await Task.Run(() =>
            {
                var result = _reduction.SmartReduce(_selections);
                _systemRows = result.rows;
                grupper = result.grupper;
                garantiNiva = result.garantiNiva;
            });

            int matematisktAntal = 1;
            foreach (var s in _selections)
            {
                if (s.AntalTecken > 0) matematisktAntal *= s.AntalTecken;
            }
            _lblRows.Text = $"Antal rader: {_systemRows.Count} ({matematisktAntal} matematiskt)";

            _lblGaranti.Text = grupper <= 1
                ? $"✓ {garantiNiva}-rätts garanti ({grupper} grupp)"
                : $"✓ {garantiNiva}-rätts garanti ({grupper} grupper)";
            _lblGaranti.ForeColor = Color.FromArgb(27, 94, 32);

            // Display rows
            var sb = new System.Text.StringBuilder();
            for (int i = 0; i < _systemRows.Count; i++)
            {
                var row = _systemRows[i];
                sb.Append($"{i + 1,3}. ");
                for (int j = 0; j < row.Length; j++)
                {
                    sb.Append(row[j]);
                    if (j < row.Length - 1) sb.Append(' ');
                }
                sb.AppendLine();
            }
            _txtOutput.Text = sb.ToString();

            _btnSaveFile.Enabled = true;
            _btnUploadDb.Enabled = true;
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Fel vid reducering: {ex.Message}", "Fel", MessageBoxButtons.OK, MessageBoxIcon.Error);
            _lblRows.Text = "Antal rader: –";
        }
        finally
        {
            this.Cursor = Cursors.Default;
        }
    }

    private void OnVisaAlla(object? sender, EventArgs e)
    {
        for (int i = 0; i < 13; i++)
        {
            if (_selections[i].AntalTecken == 0)
            {
                MessageBox.Show($"Match {i + 1} saknar tecken!", "Fel", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
        }

        _systemRows = _reduction.GenerateAllRows(_selections);
        _lblRows.Text = $"Antal rader: {_systemRows.Count} (oreducerat)";
        _lblGaranti.Text = "Alla kombinationer – ingen reducering";
        _lblGaranti.ForeColor = Color.Gray;

        var sb = new System.Text.StringBuilder();
        for (int i = 0; i < _systemRows.Count; i++)
        {
            var row = _systemRows[i];
            sb.Append($"{i + 1,3}. ");
            for (int j = 0; j < row.Length; j++)
            {
                sb.Append(row[j]);
                if (j < row.Length - 1) sb.Append(' ');
            }
            sb.AppendLine();
        }
        _txtOutput.Text = sb.ToString();

        _btnSaveFile.Enabled = true;
        _btnUploadDb.Enabled = true;
    }

    private void OnSaveFile(object? sender, EventArgs e)
    {
        if (_systemRows.Count == 0)
        {
            MessageBox.Show("Inga rader att spara. Reducera först!", "Info", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        var filePath = _txtFilePath.Text.Trim();
        if (string.IsNullOrEmpty(filePath))
        {
            MessageBox.Show("Ange en filsökväg!", "Fel", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        try
        {
            var dir = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            using var writer = new StreamWriter(filePath);
            writer.WriteLine("Stryktipset");
            foreach (var row in _systemRows)
            {
                writer.Write("E");
                for (int i = 0; i < row.Length; i++)
                {
                    writer.Write("," + row[i]);
                }
                writer.WriteLine();
            }
            MessageBox.Show($"Sparat {_systemRows.Count} rader till:\n{filePath}", "Klart", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Kunde inte spara: {ex.Message}", "Fel", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task OnUploadDb()
    {
        if (_systemRows.Count == 0)
        {
            MessageBox.Show("Inga rader att ladda upp. Reducera först!", "Info", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        if (_kupong == null)
        {
            MessageBox.Show("Ingen kupong laddad!", "Fel", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var result = MessageBox.Show(
            $"Ladda upp {_systemRows.Count} rader till databasen för omgång {_kupong.DrawNumber}?",
            "Bekräfta",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);

        if (result != DialogResult.Yes) return;

        try
        {
            this.Cursor = Cursors.WaitCursor;
            await _database.UploadSystemRows(_kupong.DrawNumber, _systemRows);
            MessageBox.Show($"✓ {_systemRows.Count} rader uppladdade för drawNumber {_kupong.DrawNumber}",
                "Klart", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Fel vid uppladdning: {ex.Message}", "Fel", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            this.Cursor = Cursors.Default;
        }
    }
}

