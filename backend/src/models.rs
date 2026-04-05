use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub query: HashMap<String, String>,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct PluginSessionRecord {
    pub id: String,
    pub module_id: String,
    pub source: String,
    pub revision: u64,
    pub status: String,
    pub updated_at: u64,
}

#[derive(Clone, Debug)]
pub struct CommentRecord {
    pub id: String,
    pub file_path: String,
    pub text: String,
    pub selected_text: String,
    pub range_start: usize,
    pub range_end: usize,
    pub created_at: u64,
}
