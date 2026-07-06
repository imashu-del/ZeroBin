pub mod knowledge;
pub mod scanner;
pub mod engine;

use knowledge::load_knowledge_base;
use scanner::{scan_directories, FoundItem};
use std::env;

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
fn start_scan() -> Result<ScanResultPayload, String> {
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
    
    let home_dir = dirs::home_dir().unwrap_or_default();
    let paths_to_scan = vec![home_dir.to_str().unwrap_or("C:\\")];
    
    let caches = scan_directories(paths_to_scan, &rules)?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![start_scan, clean_up_path, open_path_in_explorer, search_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
