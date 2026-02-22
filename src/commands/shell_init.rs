use colored::Colorize;
use std::env;

use crate::utils::{read_config, write_config};

const BASH_ZSH_FUNCTION: &str = r#"grove() {
  local grove_bin=""
  if command -v whence >/dev/null 2>&1; then
    grove_bin=$(whence -p grove 2>/dev/null)
  fi
  if [[ -z "$grove_bin" ]] && command -v type >/dev/null 2>&1; then
    grove_bin=$(type -P grove 2>/dev/null)
  fi
  if [[ -z "$grove_bin" ]]; then
    grove_bin=$(command -v grove 2>/dev/null)
  fi
  if [[ -z "$grove_bin" ]]; then
    grove_bin="grove"
  fi

  if [[ "$1" == "go" ]]; then
    if [[ $# -gt 1 ]]; then
      local output
      output=$("$grove_bin" go "${@:2}" -p 2>&1)
      local exit_code=$?
      if [[ $exit_code -eq 0 && -d "$output" ]]; then
        cd "$output"
      else
        echo "$output"
        return $exit_code
      fi
    else
      "$grove_bin" go
      return $?
    fi
  else
    "$grove_bin" "$@"
  fi
}"#;

const FISH_FUNCTION: &str = r#"function grove
  set -l grove_bin (command -s grove 2>/dev/null)
  if test -z "$grove_bin"
    set grove_bin grove
  end

  if test "$argv[1]" = "go"
    if test (count $argv) -gt 1
      set -l output ($grove_bin go $argv[2..-1] -p 2>&1)
      set -l exit_code $status
      if test $exit_code -eq 0 -a -d "$output"
        cd "$output"
      else
        echo "$output"
        return $exit_code
      end
    else
      $grove_bin go
      return $status
    end
  else
    $grove_bin $argv
  end
end"#;

const POWERSHELL_FUNCTION: &str = r#"function grove {
    $groveCmd = Get-Command grove.exe -ErrorAction SilentlyContinue
    $groveBin = if ($null -ne $groveCmd) { $groveCmd.Source } else { 'grove.exe' }

    if ($args.Count -gt 0 -and $args[0] -eq 'go') {
        if ($args.Count -gt 1) {
            $goArgs = @('go') + $args[1..($args.Count-1)] + @('-p')
            $output = & $groveBin @goArgs 2>&1
            $exitCode = $LASTEXITCODE
            if ($exitCode -eq 0 -and (Test-Path $output -PathType Container)) {
                Set-Location $output
            } else {
                Write-Output $output
                return $exitCode
            }
        } else {
            & $groveBin go
            return $LASTEXITCODE
        }
    } else {
        & $groveBin @args
    }
}"#;

pub fn run(shell: &str) {
    let normalized = shell.to_lowercase();

    match normalized.as_str() {
        "bash" | "zsh" => println!("{}", BASH_ZSH_FUNCTION),
        "fish" => println!("{}", FISH_FUNCTION),
        "pwsh" | "powershell" => println!("{}", POWERSHELL_FUNCTION),
        _ => {
            eprintln!(
                "{} Unsupported shell: {}\nSupported shells: bash, zsh, fish, pwsh, powershell",
                "Error:".red(),
                shell
            );
            std::process::exit(1);
        }
    }
}

/// Check if we should show the shell setup tip.
pub fn should_show_shell_tip() -> bool {
    let config = read_config();
    config.shell_tip_shown != Some(true)
}

/// Mark the shell tip as shown so it won't appear again.
pub fn mark_shell_tip_shown() {
    let mut config = read_config();
    config.shell_tip_shown = Some(true);
    write_config(&config);
}

/// Get the shell integration setup instructions for the detected shell.
pub fn get_shell_setup_instructions() -> Option<String> {
    let detected = detect_shell()?;

    let instructions = if detected.shell == "pwsh" {
        format!(
            "\n{} Add shell integration to change directories automatically.\nAdd this line to your PowerShell profile ({}):\n\n  {}\n\nTo edit your profile, run: {}\nThen restart PowerShell.",
            "Tip:".bold(),
            detected.config_file.cyan(),
            "Invoke-Expression (grove shell-init pwsh)".cyan(),
            "notepad $PROFILE".cyan()
        )
    } else {
        format!(
            "\n{} Add shell integration to change directories automatically.\nRun this command to set it up:\n\n  {}\n\nThen restart your shell or run: {}",
            "Tip:".bold(),
            format!(
                "echo 'eval \"$(grove shell-init {})\"' >> {}",
                detected.shell, detected.config_file
            )
            .cyan(),
            format!("source {}", detected.config_file).cyan()
        )
    };

    Some(instructions)
}

struct ShellInfo {
    shell: String,
    config_file: String,
}

fn detect_shell() -> Option<ShellInfo> {
    let shell_path = env::var("SHELL").unwrap_or_default();

    if shell_path.contains("zsh") {
        return Some(ShellInfo {
            shell: "zsh".to_string(),
            config_file: "~/.zshrc".to_string(),
        });
    }
    if shell_path.contains("bash") {
        return Some(ShellInfo {
            shell: "bash".to_string(),
            config_file: "~/.bashrc".to_string(),
        });
    }
    if shell_path.contains("fish") {
        return Some(ShellInfo {
            shell: "fish".to_string(),
            config_file: "~/.config/fish/config.fish".to_string(),
        });
    }

    // Fallback checks
    if env::var("FISH_VERSION").is_ok() {
        return Some(ShellInfo {
            shell: "fish".to_string(),
            config_file: "~/.config/fish/config.fish".to_string(),
        });
    }
    if env::var("ZSH_VERSION").is_ok() {
        return Some(ShellInfo {
            shell: "zsh".to_string(),
            config_file: "~/.zshrc".to_string(),
        });
    }
    if env::var("BASH_VERSION").is_ok() {
        return Some(ShellInfo {
            shell: "bash".to_string(),
            config_file: "~/.bashrc".to_string(),
        });
    }

    None
}
