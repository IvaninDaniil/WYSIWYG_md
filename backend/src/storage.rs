use std::fs;
use std::path::{Path, PathBuf};

use crate::config::{comment_store_dir, plugin_session_dir};
use crate::models::{CommentRecord, PluginSessionRecord};
use crate::utils::{escape_json, now_millis, percent_decode, url_encode};

pub fn comment_store_path(file_path: &str) -> PathBuf {
    let file_name = file_path
        .chars()
        .map(|ch| match ch {
            ':' | '\\' | '/' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect::<String>();
    Path::new(crate::config::COMMENT_STORE_DIR).join(format!("{file_name}.txt"))
}

pub fn plugin_session_store_path(session_id: &str) -> PathBuf {
    let file_name = session_id
        .chars()
        .map(|ch| match ch {
            ':' | '\\' | '/' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect::<String>();
    plugin_session_dir().join(format!("{file_name}.txt"))
}

pub fn new_plugin_session_id() -> String {
    let base = format!("session-{}-{}", now_millis(), std::process::id());
    let mut candidate = base.clone();
    let mut suffix = 1_u32;
    while plugin_session_store_path(&candidate).exists() {
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
    candidate
}

pub fn load_plugin_session(session_id: &str) -> Option<PluginSessionRecord> {
    let store_path = plugin_session_store_path(session_id);
    let Ok(content) = fs::read_to_string(store_path) else {
        return None;
    };

    let parts = content.trim_end().split('\t').collect::<Vec<_>>();
    if parts.len() != 6 {
        return None;
    }

    Some(PluginSessionRecord {
        id: percent_decode(parts[0]),
        module_id: percent_decode(parts[1]),
        source: percent_decode(parts[2]),
        revision: percent_decode(parts[3]).parse().unwrap_or(0),
        status: percent_decode(parts[4]),
        updated_at: percent_decode(parts[5]).parse().unwrap_or(0),
    })
}

pub fn save_plugin_session(record: &PluginSessionRecord) -> std::io::Result<()> {
    fs::create_dir_all(plugin_session_dir()).ok();
    let body = [
        url_encode(&record.id),
        url_encode(&record.module_id),
        url_encode(&record.source),
        url_encode(&record.revision.to_string()),
        url_encode(&record.status),
        url_encode(&record.updated_at.to_string()),
    ]
    .join("\t");
    fs::write(plugin_session_store_path(&record.id), body)
}

pub fn plugin_session_to_json(record: &PluginSessionRecord) -> String {
    format!(
        "{{\"id\":\"{}\",\"moduleId\":\"{}\",\"source\":\"{}\",\"revision\":{},\"status\":\"{}\",\"updatedAt\":{}}}",
        escape_json(&record.id),
        escape_json(&record.module_id),
        escape_json(&record.source),
        record.revision,
        escape_json(&record.status),
        record.updated_at
    )
}

pub fn load_comments(file_path: &str) -> Vec<CommentRecord> {
    let store_path = comment_store_path(file_path);
    let Ok(content) = fs::read_to_string(store_path) else {
        return Vec::new();
    };

    content
        .lines()
        .filter_map(|line| {
            let parts = line.split('\t').collect::<Vec<_>>();
            if parts.len() != 7 {
                return None;
            }
            Some(CommentRecord {
                id: percent_decode(parts[0]),
                file_path: percent_decode(parts[1]),
                text: percent_decode(parts[2]),
                selected_text: percent_decode(parts[3]),
                range_start: percent_decode(parts[4]).parse().unwrap_or(0),
                range_end: percent_decode(parts[5]).parse().unwrap_or(0),
                created_at: percent_decode(parts[6]).parse().unwrap_or(0),
            })
        })
        .collect()
}

pub fn save_comments(file_path: &str, comments: &[CommentRecord]) -> std::io::Result<()> {
    fs::create_dir_all(comment_store_dir()).ok();
    fs::create_dir_all(plugin_session_dir()).ok();
    let store_path = comment_store_path(file_path);
    let lines = comments
        .iter()
        .map(|comment| {
            [
                url_encode(&comment.id),
                url_encode(&comment.file_path),
                url_encode(&comment.text),
                url_encode(&comment.selected_text),
                url_encode(&comment.range_start.to_string()),
                url_encode(&comment.range_end.to_string()),
                url_encode(&comment.created_at.to_string()),
            ]
            .join("\t")
        })
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(store_path, lines)
}

pub fn comment_to_json(comment: &CommentRecord) -> String {
    format!(
        "{{\"id\":\"{}\",\"filePath\":\"{}\",\"text\":\"{}\",\"selectedText\":\"{}\",\"rangeStart\":{},\"rangeEnd\":{},\"createdAt\":{}}}",
        escape_json(&comment.id),
        escape_json(&comment.file_path),
        escape_json(&comment.text),
        escape_json(&comment.selected_text),
        comment.range_start,
        comment.range_end,
        comment.created_at
    )
}
