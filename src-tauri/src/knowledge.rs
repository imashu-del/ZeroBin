use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KnowledgeRule {
    pub name: String,
    pub category: String,
    pub safe_to_delete: bool,
    pub risk: String,
    pub description: String,
    pub impact: String,
    pub path_patterns: Vec<String>,
}

pub fn load_knowledge_base(knowledge_dir: &str) -> Vec<KnowledgeRule> {
    let mut rules = Vec::new();

    if let Ok(entries) = fs::read_dir(knowledge_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(mut parsed_rules) = serde_json::from_str::<Vec<KnowledgeRule>>(&content) {
                        rules.append(&mut parsed_rules);
                    }
                }
            }
        }
    }

    rules
}
