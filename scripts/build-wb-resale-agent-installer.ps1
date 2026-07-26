$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$downloadsDir = Join-Path $root "public\downloads"
$buildDir = Join-Path $root ".wbr-installer-build"
$scriptSource = Join-Path $downloadsDir "install-wb-resale-agent.ps1"
$exeTarget = Join-Path $downloadsDir "install-wb-resale-agent.exe"
$sourcePath = Join-Path $buildDir "Installer.cs"

if (-not (Test-Path $scriptSource)) {
  throw "Installer script was not found: $scriptSource"
}

if (Test-Path $buildDir) {
  Remove-Item -LiteralPath $buildDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$scriptBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($scriptSource))
$source = @"
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

internal static class InstallerProgram
{
    private const string ScriptBase64 = "$scriptBase64";
    private static string installerDetails = "";

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var form = new Form {
            Text = "WB Resale Agent",
            ClientSize = new Size(540, 220),
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            BackColor = Color.FromArgb(247, 248, 250)
        };
        var title = new Label {
            Text = "Установка WB Resale Agent",
            Font = new Font("Segoe UI", 16, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(28, 24)
        };
        var status = new Label {
            Text = "Скачиваю и устанавливаю свежую версию агента...",
            Font = new Font("Segoe UI", 10),
            AutoSize = false,
            Size = new Size(484, 44),
            Location = new Point(30, 77)
        };
        var progress = new ProgressBar {
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 24,
            Size = new Size(480, 18),
            Location = new Point(30, 130)
        };
        var close = new Button {
            Text = "Закрыть",
            Enabled = false,
            Size = new Size(110, 34),
            Location = new Point(400, 166)
        };
        var details = new Button {
            Text = "Показать ошибку",
            Visible = false,
            Size = new Size(150, 34),
            Location = new Point(30, 166)
        };
        details.Click += (sender, args) => MessageBox.Show(
            installerDetails,
            "Ошибка установки WB Resale Agent",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error
        );
        close.Click += (sender, args) => form.Close();
        form.Controls.Add(title);
        form.Controls.Add(status);
        form.Controls.Add(progress);
        form.Controls.Add(details);
        form.Controls.Add(close);

        var worker = new BackgroundWorker();
        worker.DoWork += (sender, args) => args.Result = RunInstaller();
        worker.RunWorkerCompleted += (sender, args) => {
            progress.Style = ProgressBarStyle.Continuous;
            progress.Value = 100;
            close.Enabled = true;
            installerDetails = args.Error != null
                ? args.Error.Message
                : Convert.ToString(args.Result);
            if (!String.IsNullOrWhiteSpace(installerDetails)) {
                status.Text = "Установка не завершена: " + ShortMessage(installerDetails);
                status.ForeColor = Color.Firebrick;
                progress.Value = 0;
                details.Visible = true;
            } else {
                status.Text = "Готово. Агент установлен, запущен и добавлен в автозапуск.";
                status.ForeColor = Color.FromArgb(20, 115, 70);
            }
            close.Focus();
        };
        form.Shown += (sender, args) => worker.RunWorkerAsync();
        Application.Run(form);
    }

    private static string ShortMessage(string value)
    {
        var singleLine = (value ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
        return singleLine.Length <= 150 ? singleLine : singleLine.Substring(0, 147) + "...";
    }

    private static string RunInstaller()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "wb-resale-installer-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var scriptPath = Path.Combine(tempDir, "install-wb-resale-agent.ps1");
        File.WriteAllBytes(scriptPath, Convert.FromBase64String(ScriptBase64));
        try {
            var start = new ProcessStartInfo {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            start.EnvironmentVariables["WBR_HEADLESS"] = "1";
            using (var process = Process.Start(start)) {
                var stdout = process.StandardOutput.ReadToEnd();
                var stderr = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode == 0) return "";
                var message = String.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
                if (String.IsNullOrWhiteSpace(message)) {
                    message = "PowerShell завершился с кодом " + process.ExitCode + ".";
                }
                var logDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "WB Resale Agent"
                );
                Directory.CreateDirectory(logDir);
                File.WriteAllText(Path.Combine(logDir, "install.log"), message);
                return message.Trim();
            }
        } finally {
            try { Directory.Delete(tempDir, true); } catch {}
        }
    }
}
"@

$source = [regex]::Replace($source, '[^\x00-\x7F]', {
  param($match)
  return "\u{0:X4}" -f [int][char]$match.Value
})
[IO.File]::WriteAllText($sourcePath, $source, (New-Object Text.UTF8Encoding($true)))

if (Test-Path $exeTarget) {
  Remove-Item -LiteralPath $exeTarget -Force
}

Add-Type -AssemblyName Microsoft.CSharp
$provider = New-Object Microsoft.CSharp.CSharpCodeProvider
$parameters = New-Object System.CodeDom.Compiler.CompilerParameters
$parameters.GenerateExecutable = $true
$parameters.GenerateInMemory = $false
$parameters.OutputAssembly = $exeTarget
$parameters.CompilerOptions = "/target:winexe /optimize+"
$parameters.ReferencedAssemblies.Add("System.dll") | Out-Null
$parameters.ReferencedAssemblies.Add("System.Drawing.dll") | Out-Null
$parameters.ReferencedAssemblies.Add("System.Windows.Forms.dll") | Out-Null
$results = $provider.CompileAssemblyFromSource($parameters, $source)
if ($results.Errors.HasErrors) {
  $messages = $results.Errors | ForEach-Object { $_.ToString() }
  throw ($messages -join [Environment]::NewLine)
}

Remove-Item -LiteralPath $buildDir -Recurse -Force
Write-Host "Created $exeTarget"
