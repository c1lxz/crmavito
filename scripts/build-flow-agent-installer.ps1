$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$downloadsRoot = Join-Path $repoRoot "public\downloads"
$scriptPath = Join-Path $downloadsRoot "install-flow-agent.ps1"
$packagePath = Join-Path $downloadsRoot "flow-agent.zip"
$exePath = Join-Path $downloadsRoot "install-flow-agent.exe"
$buildRoot = Join-Path $repoRoot ".flow-agent-installer-build"
$sourcePath = Join-Path $buildRoot "Installer.cs"

foreach ($required in @($scriptPath, $packagePath)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required installer asset was not found: $required" }
}
if (Test-Path -LiteralPath $buildRoot) { Remove-Item -LiteralPath $buildRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null

$scriptEncoding = New-Object Text.UTF8Encoding($true)
$scriptText = Get-Content -LiteralPath $scriptPath -Raw -Encoding UTF8
$scriptBytes = $scriptEncoding.GetPreamble() + $scriptEncoding.GetBytes($scriptText)
$scriptBase64 = [Convert]::ToBase64String($scriptBytes)
$packageBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($packagePath))
$source = @"
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;

internal static class FlowInstallerProgram
{
    private const string ScriptBase64 = "$scriptBase64";
    private const string PackageBase64 = "$packageBase64";
    private static readonly Color Canvas = Color.FromArgb(244, 247, 250);
    private static readonly Color Muted = Color.FromArgb(91, 111, 132);
    private static readonly Color Accent = Color.FromArgb(53, 103, 232);
    private static readonly Color Success = Color.FromArgb(21, 138, 91);
    private static readonly Color Danger = Color.FromArgb(181, 58, 72);
    private static string installerDetails = "";

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Any(x => String.Equals(x, "/quiet", StringComparison.OrdinalIgnoreCase) || String.Equals(x, "--quiet", StringComparison.OrdinalIgnoreCase))) {
            var error = RunInstaller(null, Environment.GetEnvironmentVariable("FLOW_AGENT_ENROLLMENT_CODE"));
            Environment.Exit(String.IsNullOrWhiteSpace(error) ? 0 : 1);
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(CreateInstallerForm());
    }

    private static Form CreateInstallerForm()
    {
        var form = new Form {
            Text = "CRM Avito Flow Agent",
            ClientSize = new Size(560, 330),
            MinimumSize = new Size(576, 369),
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            BackColor = Canvas,
            Font = new Font("Segoe UI", 9.5f)
        };

        var header = new Panel { Dock = DockStyle.Top, Height = 108, BackColor = Color.FromArgb(8, 23, 39) };
        var mark = new Label {
            Text = "F",
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI", 17, FontStyle.Bold),
            ForeColor = Color.White,
            BackColor = Accent,
            Location = new Point(28, 25),
            Size = new Size(48, 48)
        };
        var title = new Label {
            Text = "Локальный агент Flow",
            Font = new Font("Segoe UI", 19, FontStyle.Bold),
            ForeColor = Color.White,
            AutoSize = true,
            Location = new Point(94, 22)
        };
        var subtitle = new Label {
            Text = "Связывает этот компьютер с Контент-машиной CRM Avito",
            Font = new Font("Segoe UI", 9.5f),
            ForeColor = Color.FromArgb(184, 199, 211),
            AutoSize = true,
            Location = new Point(96, 62)
        };
        header.Controls.Add(mark);
        header.Controls.Add(title);
        header.Controls.Add(subtitle);

        var codeLabel = new Label {
            Text = "Одноразовый код из Контент-машины",
            ForeColor = Muted,
            AutoSize = true,
            Location = new Point(28, 126)
        };
        var codeInput = new TextBox {
            CharacterCasing = CharacterCasing.Upper,
            Font = new Font("Consolas", 12, FontStyle.Bold),
            Location = new Point(28, 148),
            Size = new Size(504, 30)
        };

        var statusDot = new Label {
            Text = "●",
            ForeColor = Accent,
            AutoSize = true,
            Location = new Point(28, 199)
        };
        var status = new Label {
            Text = "Готово к установке",
            ForeColor = Muted,
            AutoSize = false,
            Location = new Point(48, 197),
            Size = new Size(320, 23)
        };
        var progress = new ProgressBar {
            Visible = false,
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 22,
            Location = new Point(28, 231),
            Size = new Size(504, 4)
        };
        var details = new Button {
            Text = "Подробности",
            Visible = false,
            FlatStyle = FlatStyle.Flat,
            ForeColor = Danger,
            BackColor = Canvas,
            Size = new Size(112, 38),
            Location = new Point(28, 268)
        };
        details.FlatAppearance.BorderColor = Color.FromArgb(217, 226, 234);
        var install = new Button {
            Text = "Установить агент",
            FlatStyle = FlatStyle.Flat,
            ForeColor = Color.White,
            BackColor = Accent,
            Font = new Font("Segoe UI Semibold", 9.5f),
            Size = new Size(154, 40),
            Location = new Point(378, 264)
        };
        install.FlatAppearance.BorderSize = 0;
        var installationComplete = false;
        details.Click += delegate {
            MessageBox.Show(installerDetails, "Журнал установки", MessageBoxButtons.OK, MessageBoxIcon.Information);
        };
        install.Click += delegate {
            if (installationComplete) {
                form.Close();
                return;
            }
            if (String.IsNullOrWhiteSpace(codeInput.Text)) {
                statusDot.ForeColor = Danger;
                status.ForeColor = Danger;
                status.Text = "Введите одноразовый код из Контент-машины";
                codeInput.Focus();
                return;
            }
            install.Enabled = false;
            codeInput.Enabled = false;
            details.Visible = false;
            progress.Visible = true;
            statusDot.ForeColor = Accent;
            status.Text = "Устанавливаю зависимости и настраиваю автозапуск…";
            var worker = new BackgroundWorker();
            worker.DoWork += delegate(object sender, DoWorkEventArgs eventArgs) {
                eventArgs.Result = RunInstaller(null, codeInput.Text.Trim());
            };
            worker.RunWorkerCompleted += delegate(object sender, RunWorkerCompletedEventArgs eventArgs) {
                progress.Visible = false;
                installerDetails = eventArgs.Error != null ? eventArgs.Error.ToString() : Convert.ToString(eventArgs.Result);
                if (String.IsNullOrWhiteSpace(installerDetails)) {
                    statusDot.ForeColor = Success;
                    status.ForeColor = Success;
                    status.Text = "Агент установлен и уже работает";
                    install.Text = "Закрыть";
                    install.Enabled = true;
                    codeInput.Enabled = true;
                    installationComplete = true;
                } else {
                    statusDot.ForeColor = Danger;
                    status.ForeColor = Danger;
                    status.Text = "Установка не завершена";
                    details.Visible = true;
                    install.Text = "Повторить";
                    install.Enabled = true;
                    codeInput.Enabled = true;
                }
            };
            worker.RunWorkerAsync();
        };

        form.Controls.Add(header);
        form.Controls.Add(codeLabel);
        form.Controls.Add(codeInput);
        form.Controls.Add(statusDot);
        form.Controls.Add(status);
        form.Controls.Add(progress);
        form.Controls.Add(details);
        form.Controls.Add(install);
        form.AcceptButton = install;
        return form;
    }

    private static string RunInstaller(string crmUrl, string enrollmentCode)
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), "crm-avito-flow-installer-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempRoot);
        var scriptPath = Path.Combine(tempRoot, "install-flow-agent.ps1");
        var packagePath = Path.Combine(tempRoot, "flow-agent.zip");
        File.WriteAllBytes(scriptPath, Convert.FromBase64String(ScriptBase64));
        File.WriteAllBytes(packagePath, Convert.FromBase64String(PackageBase64));
        try {
            var start = new ProcessStartInfo {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = false,
                RedirectStandardError = false
            };
            start.EnvironmentVariables["FLOW_AGENT_PACKAGE_PATH"] = packagePath;
            var logRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CRM Avito", "Flow Agent Installer");
            Directory.CreateDirectory(logRoot);
            var logPath = Path.Combine(logRoot, "install.log");
            start.EnvironmentVariables["FLOW_AGENT_INSTALLER_LOG"] = logPath;
            if (!String.IsNullOrWhiteSpace(crmUrl)) start.EnvironmentVariables["FLOW_AGENT_CRM_URL"] = crmUrl;
            if (!String.IsNullOrWhiteSpace(enrollmentCode)) start.EnvironmentVariables["FLOW_AGENT_ENROLLMENT_CODE"] = enrollmentCode;
            using (var process = Process.Start(start)) {
                process.WaitForExit();
                if (process.ExitCode == 0) return "";
                var message = File.Exists(logPath) ? File.ReadAllText(logPath) : "";
                return String.IsNullOrWhiteSpace(message) ? "Установщик завершился с кодом " + process.ExitCode + "." : message.Trim();
            }
        } catch (Exception error) {
            return error.ToString();
        } finally {
            try { Directory.Delete(tempRoot, true); } catch { }
        }
    }
}
"@

# Windows PowerShell 5.1 reads UTF-8 scripts without a BOM through the legacy
# ANSI code page. Repair the C# here-string before converting it to ASCII
# Unicode escapes so the generated EXE always shows correct Russian labels.
if (-not $source.Contains([string][char]0x041B)) {
  $source = [Text.Encoding]::UTF8.GetString([Text.Encoding]::GetEncoding(1251).GetBytes($source))
}

$source = [regex]::Replace($source, '[^\x00-\x7F]', {
  param($match)
  return "\u{0:X4}" -f [int][char]$match.Value
})
[IO.File]::WriteAllText($sourcePath, $source, (New-Object Text.UTF8Encoding($true)))

if (Test-Path -LiteralPath $exePath) { Remove-Item -LiteralPath $exePath -Force }
Add-Type -AssemblyName Microsoft.CSharp
$provider = New-Object Microsoft.CSharp.CSharpCodeProvider
$parameters = New-Object System.CodeDom.Compiler.CompilerParameters
$parameters.GenerateExecutable = $true
$parameters.GenerateInMemory = $false
$parameters.OutputAssembly = $exePath
$parameters.CompilerOptions = "/target:winexe /optimize+"
$parameters.ReferencedAssemblies.Add("System.dll") | Out-Null
$parameters.ReferencedAssemblies.Add("System.Core.dll") | Out-Null
$parameters.ReferencedAssemblies.Add("System.Drawing.dll") | Out-Null
$parameters.ReferencedAssemblies.Add("System.Windows.Forms.dll") | Out-Null
$results = $provider.CompileAssemblyFromSource($parameters, $source)
if ($results.Errors.HasErrors) {
  throw (($results.Errors | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine)
}

Remove-Item -LiteralPath $buildRoot -Recurse -Force
Get-Item -LiteralPath $exePath | Select-Object FullName, Length, LastWriteTime
