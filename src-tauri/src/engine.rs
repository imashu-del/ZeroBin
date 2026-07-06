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
    pub extensions: Option<Vec<String>>,
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
                    let mut size_bytes = (size_kb as u64) * 1024;
                    let install_location: String = app_key.get_value("InstallLocation").unwrap_or_default();

                    // Fallback 1: Calculate actual size from InstallLocation if registry size is missing
                    if size_bytes == 0 && !install_location.is_empty() {
                        let loc_path = std::path::Path::new(&install_location);
                        if loc_path.exists() && loc_path.is_dir() {
                            let mut total = 0;
                            for entry in WalkDir::new(loc_path).into_iter().filter_map(Result::ok) {
                                if let Ok(meta) = entry.metadata() {
                                    total += meta.len();
                                }
                            }
                            size_bytes = total;
                        }
                    }

                    if size_bytes >= min_size_bytes {
                        // InstallDate format is typically YYYYMMDD
                        let mut inactive_days = -1;
                        if let Ok(install_date) = app_key.get_value::<String, _>("InstallDate") {
                            if install_date.len() == 8 {
                                if let Ok(parsed_date) = NaiveDate::parse_from_str(&install_date, "%Y%m%d") {
                                    let datetime = parsed_date.and_hms_opt(0, 0, 0).unwrap().and_utc();
                                    inactive_days = (now - datetime).num_days().max(0);
                                }
                            }
                        }

                        // Fallback 2: Calculate inactive days from InstallLocation's .exe files
                        if inactive_days == -1 {
                            if !install_location.is_empty() {
                                let loc_path = std::path::Path::new(&install_location);
                                if loc_path.exists() && loc_path.is_dir() {
                                    let mut most_recent_time = std::time::SystemTime::UNIX_EPOCH;
                                    let mut found_exe = false;
                                    
                                    for entry in WalkDir::new(loc_path).into_iter().filter_map(Result::ok) {
                                        if entry.path().extension().and_then(|s| s.to_str()) == Some("exe") {
                                            if let Ok(meta) = entry.metadata() {
                                                let time = meta.accessed().unwrap_or_else(|_| meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH));
                                                if time > most_recent_time {
                                                    most_recent_time = time;
                                                    found_exe = true;
                                                }
                                            }
                                        }
                                    }
                                    
                                    if found_exe {
                                        if let Ok(duration) = most_recent_time.elapsed() {
                                            inactive_days = (duration.as_secs() / (24 * 3600)) as i64;
                                        }
                                    } else {
                                        inactive_days = 0;
                                    }
                                } else {
                                    inactive_days = 0;
                                }
                            } else {
                                inactive_days = 0;
                            }
                        }

                        let final_inactive_days = inactive_days.max(0);

                        if final_inactive_days >= min_days {
                            results.push(Recommendation {
                                id: format!("{}-{}", rule.id, app_name),
                                target: display_name,
                                description: rule.message.clone(),
                                size_bytes,
                                rule_type: rule.r#type.clone(),
                                action: rule.action.clone(),
                                inactive_days: final_inactive_days as u64,
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
                // Extension filter check
                let mut matches_ext = true;
                if let Some(ref exts) = rule.conditions.extensions {
                    matches_ext = false;
                    if let Some(ext) = entry.path().extension().and_then(|s| s.to_str()) {
                        let ext_lower = ext.to_lowercase();
                        if exts.iter().any(|e| e.to_lowercase() == ext_lower || e.to_lowercase() == format!(".{}", ext_lower)) {
                            matches_ext = true;
                        }
                    }
                }

                if !matches_ext {
                    continue;
                }

                if let Ok(metadata) = entry.metadata() {
                    let size = metadata.len();
                    if size >= min_size_bytes {
                        // Calculate age using the older of created date or modified date
                        let created = metadata.created().unwrap_or(SystemTime::now());
                        let modified = metadata.modified().unwrap_or(SystemTime::now());
                        
                        // We want to see how long it's been untouched.
                        // If it was created 14 days ago and modified 14 days ago, it's 14 days old.
                        // We use the most recent of the two (the max) to represent its last interaction.
                        // But wait! The plan says: "using whichever is oldest" - actually we want to know
                        // how long it has been sitting completely untouched. So we use the MAX of created and modified,
                        // and see if THAT time was > 14 days ago. (i.e. it hasn't been created OR modified recently).
                        let last_interaction = created.max(modified);
                        
                        if let Ok(duration) = last_interaction.elapsed() {
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
