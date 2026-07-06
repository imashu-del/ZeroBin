use chrono::{DateTime, Duration, NaiveDate, Utc};
use jwalk::WalkDir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Recommendation {
    pub id: String,
    pub target: String,
    pub description: String,
    pub size_bytes: u64,
    pub rule_type: String,
    pub action: String,
    pub inactive_days: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuleCondition {
    pub min_size_mb: Option<u64>,
    pub min_inactive_days: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EngineRule {
    pub id: String,
    pub name: String,
    pub r#type: String, // "registry_app" or "file_metadata"
    pub target_dir: Option<String>,
    pub conditions: RuleCondition,
    pub action: String,
    pub message: String,
}

pub fn load_rules(rules_dir: &str) -> Vec<EngineRule> {
    let mut rules = Vec::new();
    if let Ok(entries) = fs::read_dir(rules_dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(contents) = fs::read_to_string(&path) {
                    if let Ok(mut parsed) = serde_json::from_str::<Vec<EngineRule>>(&contents) {
                        rules.append(&mut parsed);
                    }
                }
            }
        }
    }
    rules
}

pub fn run_rule_engine(rules_dir: &str) -> Vec<Recommendation> {
    let rules = load_rules(rules_dir);
    let mut recommendations = Vec::new();

    for rule in rules {
        match rule.r#type.as_str() {
            "registry_app" => {
                #[cfg(target_os = "windows")]
                {
                    let apps = scan_installed_apps(&rule);
                    recommendations.extend(apps);
                }
            }
            "file_metadata" => {
                let files = scan_large_files(&rule);
                recommendations.extend(files);
            }
            _ => {}
        }
    }

    recommendations
}

#[cfg(target_os = "windows")]
fn scan_installed_apps(rule: &EngineRule) -> Vec<Recommendation> {
    let mut results = Vec::new();
    let min_size_bytes = rule.conditions.min_size_mb.unwrap_or(0) * 1024 * 1024;
    let min_days = rule.conditions.min_inactive_days.unwrap_or(0) as i64;

    let paths = vec![
        (RegKey::predef(HKEY_LOCAL_MACHINE), "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
        (RegKey::predef(HKEY_LOCAL_MACHINE), "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
        (RegKey::predef(HKEY_CURRENT_USER), "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
    ];

    let now = Utc::now();

    for (root, path) in paths {
        if let Ok(uninstall_key) = root.open_subkey(path) {
            for app_name in uninstall_key.enum_keys().filter_map(Result::ok) {
                if let Ok(app_key) = uninstall_key.open_subkey(&app_name) {
                    let display_name: String = app_key.get_value("DisplayName").unwrap_or_default();
                    if display_name.is_empty() {
                        continue;
                    }

                    // EstimatedSize is usually in KB
                    let size_kb: u32 = app_key.get_value("EstimatedSize").unwrap_or(0);
                    let size_bytes = (size_kb as u64) * 1024;

                    if size_bytes >= min_size_bytes {
                        // InstallDate format is typically YYYYMMDD
                        let mut inactive_days = 0;
                        if let Ok(install_date) = app_key.get_value::<String, _>("InstallDate") {
                            if install_date.len() == 8 {
                                if let Ok(parsed_date) = NaiveDate::parse_from_str(&install_date, "%Y%m%d") {
                                    let datetime = parsed_date.and_hms_opt(0, 0, 0).unwrap().and_utc();
                                    inactive_days = (now - datetime).num_days().max(0);
                                }
                            }
                        }

                        if inactive_days >= min_days {
                            results.push(Recommendation {
                                id: format!("{}-{}", rule.id, app_name),
                                target: display_name,
                                description: rule.message.clone(),
                                size_bytes,
                                rule_type: rule.r#type.clone(),
                                action: rule.action.clone(),
                                inactive_days: inactive_days as u64,
                            });
                        }
                    }
                }
            }
        }
    }

    results
}

fn scan_large_files(rule: &EngineRule) -> Vec<Recommendation> {
    let mut results = Vec::new();
    let min_size_bytes = rule.conditions.min_size_mb.unwrap_or(0) * 1024 * 1024;
    let min_days = rule.conditions.min_inactive_days.unwrap_or(0) as u64;

    let target_dir = match rule.target_dir.as_deref() {
        Some("Downloads") => dirs::download_dir(),
        _ => None,
    };

    if let Some(dir) = target_dir {
        for entry in WalkDir::new(dir).into_iter().filter_map(Result::ok) {
            if entry.file_type().is_file() {
                if let Ok(metadata) = entry.metadata() {
                    let size = metadata.len();
                    if size >= min_size_bytes {
                        // Windows uses last access or modification time
                        let time = metadata.accessed().unwrap_or_else(|_| metadata.modified().unwrap_or(SystemTime::now()));
                        if let Ok(duration) = time.elapsed() {
                            let days = duration.as_secs() / (24 * 3600);
                            if days >= min_days {
                                results.push(Recommendation {
                                    id: format!("{}-{}", rule.id, entry.path().to_string_lossy()),
                                    target: entry.file_name().to_string_lossy().to_string(),
                                    description: rule.message.clone(),
                                    size_bytes: size,
                                    rule_type: rule.r#type.clone(),
                                    action: rule.action.clone(),
                                    inactive_days: days,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    results
}
