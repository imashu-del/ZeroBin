pub mod knowledge;
pub mod scanner;
pub mod engine;

use knowledge::load_knowledge_base;
use scanner::{scan_directories, FoundItem};
use std::env;
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton};
use tauri::menu::{Menu, MenuItem};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_shell::ShellExt;

#[derive(serde::Serialize)]
pub struct ScanResultPayload {
    pub caches: Vec<FoundItem>,
    pub recommendations: Vec<engine::Recommendation>,
}

#[derive(serde::Serialize)]
pub struct SearchResult {
    pub path: String,
    pub size_bytes: u64,
}

#[tauri::command]
fn start_scan(target_path: Option<String>) -> Result<ScanResultPayload, String> {
    // Determine the knowledge base path
    let current_dir = env::current_dir().unwrap_or_default();
    
    // Tauri dev usually runs in `src-tauri`, but production runs wherever the exe is.
    let mut kb_path = current_dir.join("knowledge");
    if !kb_path.exists() {
        kb_path = current_dir.join("../knowledge");
    }
    let mut rules_path = current_dir.join("rules");
    if !rules_path.exists() {
        rules_path = current_dir.join("../rules");
    }
    
    let rules = load_knowledge_base(&kb_path.to_string_lossy());
    
    let paths_to_scan = match target_path {
        Some(p) if !p.is_empty() => vec![p],
        _ => {
            let home_dir = dirs::home_dir().unwrap_or_default();
            vec![home_dir.to_string_lossy().to_string()]
        }
    };
    
    let caches = scan_directories(paths_to_scan.iter().map(|s| s.as_str()).collect(), &rules)?;
    let recommendations = engine::run_rule_engine(&rules_path.to_string_lossy());
    
    Ok(ScanResultPayload {
        caches,
        recommendations,
    })
}

#[tauri::command]
fn clean_up_path(path: String, safe_delete: bool) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".to_string());
    }
    
    if safe_delete {
        trash::delete(p).map_err(|e| format!("Failed to move to recycle bin: {}", e))?;
    } else {
        if p.is_dir() {
            std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(p).map_err(|e| e.to_string())?;
        }
    }
    
    Ok(())
}

#[tauri::command]
fn search_files(query: String) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    
    let home_dir = dirs::home_dir().unwrap_or_default();
    let q = query.to_lowercase();
    let mut results = Vec::new();
    
    // Quick scan of home directory
    for entry in jwalk::WalkDir::new(home_dir).into_iter().filter_map(Result::ok) {
        if entry.file_type().is_file() {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.to_lowercase().contains(&q) {
                    if let Ok(meta) = entry.metadata() {
                        results.push(SearchResult {
                            path: entry.path().to_string_lossy().to_string(),
                            size_bytes: meta.len(),
                        });
                        
                        // Limit to 50 results to keep it blazing fast
                        if results.len() >= 50 {
                            break;
                        }
                    }
                }
            }
        }
    }
    
    Ok(results)
}

#[tauri::command]
fn open_path_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let win_path = path.replace("/", "\\");
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&win_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_drives() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let mut drives = Vec::new();
        // Check letters D through Z (Skip C as requested)
        for letter in b'D'..=b'Z' {
            let path = format!("{}:\\", letter as char);
            if std::path::Path::new(&path).exists() {
                drives.push(path);
            }
        }
        return Ok(drives);
    }
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(Vec::new());
    }
}

#[tauri::command]
async fn compress_and_backup(app_handle: tauri::AppHandle, source_paths: Vec<String>, destination: String) -> Result<String, String> {
    let sidecar = app_handle.shell().sidecar("7za")
        .map_err(|e| format!("Failed to find 7-Zip sidecar: {}", e))?;

    let mut args = vec![
        "a".to_string(), 
        "-t7z".to_string(), 
        "-mx=5".to_string(), 
        "-y".to_string(),     // Assume Yes on all queries (prevents hanging if file exists)
        "-bsp0".to_string(),  // Disable progress output stream to prevent pipe buffer issues
        destination.clone()
    ];
    for path in source_paths {
        args.push(path);
    }
    
    let command = sidecar.args(args);
    
    let output = command.output().await
        .map_err(|e| format!("Failed to execute 7-Zip: {}", e))?;
        
    if output.status.success() {
        Ok(format!("Successfully backed up to {}", destination))
    } else {
        let err_msg = String::from_utf8_lossy(&output.stderr).into_owned();
        let out_msg = String::from_utf8_lossy(&output.stdout).into_owned();
        Err(format!("7-Zip Error: {} \n {}", err_msg, out_msg))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Setup Tray Icon Menu
            let quit_i = MenuItem::with_id(app, "quit", "Quit ZeroBin", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;

            // Setup Tray Icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("ZeroBin")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        let app_handle = tray.app_handle();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Setup silent background scanner thread
            let app_handle = app.handle().clone();
            thread::spawn(move || {
                // Use Option to avoid underflow if system uptime is < 2 days
                let mut last_notification: Option<std::time::Instant> = None;
                
                loop {
                    thread::sleep(Duration::from_secs(43200)); // 12 hours
                    
                    let current_dir = std::env::current_dir().unwrap_or_default();
                    let mut kb_path = current_dir.join("knowledge");
                    if !kb_path.exists() { kb_path = current_dir.join("../knowledge"); }
                    let mut rules_path = current_dir.join("rules");
                    if !rules_path.exists() { rules_path = current_dir.join("../rules"); }
                    
                    let rules = crate::knowledge::load_knowledge_base(&kb_path.to_string_lossy());
                    let home_dir = dirs::home_dir().unwrap_or_default();
                    let paths_to_scan = vec![home_dir.to_str().unwrap_or("C:\\")];
                    
                    let mut total_savings = 0;
                    if let Ok(caches) = crate::scanner::scan_directories(paths_to_scan, &rules) {
                        for c in caches {
                            total_savings += c.size_bytes;
                        }
                    }
                    
                    let recs = crate::engine::run_rule_engine(&rules_path.to_string_lossy());
                    for r in recs {
                        total_savings += r.size_bytes;
                    }
                    
                    // Threshold: 5GB
                    if total_savings > 5_000_000_000 {
                        if last_notification.map_or(true, |last| last.elapsed() > Duration::from_secs(172800)) { // 2-day notification limit
                            let size_mb = total_savings / (1024 * 1024);
                            let app_handle_clone = app_handle.clone();
                            
                            std::thread::spawn(move || {
                                if let Ok(handle) = notify_rust::Notification::new()
                                    .summary("ZeroBin")
                                    .body(&format!("{} MB is a lot of storage! Clean it up with ZeroBin.", size_mb))
                                    .show()
                                {
                                    handle.wait_for_action(|action| {
                                        if action == "default" {
                                            if let Some(window) = app_handle_clone.get_webview_window("main") {
                                                let _ = window.show();
                                                let _ = window.set_focus();
                                            }
                                        }
                                    });
                                }
                            });
                            
                            last_notification = Some(std::time::Instant::now());
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Instead of fully quitting, just hide it to the system tray
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![start_scan, clean_up_path, open_path_in_explorer, search_files, get_drives, compress_and_backup])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
