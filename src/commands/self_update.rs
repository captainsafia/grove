use colored::Colorize;
use std::process::Command;

use crate::utils::get_self_update_command;

pub fn run(version: Option<&str>, pr: Option<u64>) {
    let base_url = "https://i.safia.sh/captainsafia/grove";
    let install_url = if let Some(pr_num) = pr {
        format!("{}/pr/{}", base_url, pr_num)
    } else if let Some(ver) = version {
        let version_tag = if ver.starts_with('v') {
            ver.to_string()
        } else {
            format!("v{}", ver)
        };
        format!("{}/{}", base_url, version_tag)
    } else {
        base_url.to_string()
    };

    let (command, args) = get_self_update_command(&install_url);

    let status = Command::new(command).args(args).status();

    match status {
        Ok(s) if s.success() => {
            println!();
            println!("{}", "✓ Update completed successfully".green());
        }
        Ok(s) => {
            let code = s.code().unwrap_or(1);
            eprintln!("{} Update failed with exit code {}", "Error:".red(), code);
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            std::process::exit(1);
        }
    }
}
