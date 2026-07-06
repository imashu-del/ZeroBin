pub mod knowledge;
pub mod scanner;

use knowledge::load_knowledge_base;
use scanner::{scan_directories, FoundItem};
use std::env;

#[tauri::command]
fn start_scan() -> Result<Vec<FoundItem>, String> {
    // Determine the knowledge base path
    let current_dir = env::current_dir().unwrap_or_default();
    
    // Tauri dev usually runs in `src-tauri`, but production runs wherever the exe is.
    let mut kb_path = current_dir.join("knowledge");
    if !kb_path.exists() {
        kb_path = current_dir.join("../knowledge");
    }
    
    let rules = load_knowledge_base(&kb_path.to_string_lossy());
    
    let home_dir = dirs::home_dir().unwrap_or_default();
    let paths_to_scan = vec![home_dir.to_str().unwrap_or("C:\\")];
    
    scan_directories(paths_to_scan, &rules)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![start_scan])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
