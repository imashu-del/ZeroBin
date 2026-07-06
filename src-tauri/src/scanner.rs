use crate::knowledge::KnowledgeRule;
use globset::{Glob, GlobSet, GlobSetBuilder};
use jwalk::WalkDir;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FoundItem {
    pub path: String,
    pub size_bytes: u64,
    pub rule_name: String,
    pub category: String,
    pub safe_to_delete: bool,
    pub risk: String,
    pub description: String,
    pub impact: String,
}

pub fn scan_directories(
    roots: Vec<&str>,
    knowledge_rules: &[KnowledgeRule],
) -> Result<Vec<FoundItem>, String> {
    let mut builder = GlobSetBuilder::new();
    let mut rule_mapping = Vec::new();

    // Build the GlobSet
    for (i, rule) in knowledge_rules.iter().enumerate() {
        for pattern in &rule.path_patterns {
            // Convert simple glob pattern to one that globset understands
            // e.g. "*\\AppData\\Local\\Temp\\*" -> "**/AppData/Local/Temp/**"
            let normalized = pattern.replace("\\\\", "/").replace("\\", "/");
            let glob_pattern = normalized.replace("*", "**");

            if let Ok(glob) = Glob::new(&glob_pattern) {
                builder.add(glob);
                rule_mapping.push(i);
            }
            
            // Also add a pattern that strips the trailing /* so we match the root directory itself.
            if normalized.ends_with("/*") {
                let dir_pattern = normalized.trim_end_matches("/*").replace("*", "**");
                if let Ok(glob) = Glob::new(&dir_pattern) {
                    builder.add(glob);
                    rule_mapping.push(i);
                }
            }
        }
    }

    let glob_set = builder.build().map_err(|e| e.to_string())?;
    
    let found_items = Arc::new(Mutex::new(std::collections::HashMap::new()));
    
    for root in roots {
        for entry in WalkDir::new(root)
            .skip_hidden(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            let path = entry.path();
            let path_str = path.to_string_lossy().replace("\\", "/");

            let matches = glob_set.matches(&path_str);
            if !matches.is_empty() {
                // We just take the first matched rule
                let rule_idx = rule_mapping[matches[0]];
                let rule = &knowledge_rules[rule_idx];
                
                let metadata = entry.metadata().ok();
                let size = metadata.map(|m| m.len()).unwrap_or(0);
                
                // If it's a directory match, we should technically sum its contents, but for now
                // we'll just track the files or folder itself. 
                // A better approach for MVP: track the matched root path.
                let mut items = found_items.lock().unwrap();
                
                // Group by rule name to aggregate all files in a cache into a single UI item
                let key = rule.name.clone();
                
                let entry = items.entry(key).or_insert(FoundItem {
                    path: path_str.clone(), // Initial path
                    size_bytes: 0,
                    rule_name: rule.name.clone(),
                    category: rule.category.clone(),
                    safe_to_delete: rule.safe_to_delete,
                    risk: rule.risk.clone(),
                    description: rule.description.clone(),
                    impact: rule.impact.clone(),
                });
                
                // Keep the shortest path as the representative root path
                if path_str.len() < entry.path.len() {
                    entry.path = path_str.clone();
                }
                
                entry.size_bytes += size;
            }
        }
    }

    let results = found_items.lock().unwrap().values().cloned().collect();
    Ok(results)
}
