use std::fs;
use std::net::TcpStream;
use std::path::{Path, PathBuf};

use crate::config::STATIC_DIR;
use crate::http::{parse_body_form, write_response};
use crate::models::{CommentRecord, HttpRequest, PluginSessionRecord};
use crate::storage::{
    comment_to_json, load_comments, load_plugin_session, new_plugin_session_id, plugin_session_to_json,
    save_comments, save_plugin_session,
};
use crate::utils::{
    content_type_for, decode_base64, default_root, ensure_extension, escape_json, file_kind, mime_type_for,
    normalize_plantuml_source, now_unix, sanitize_file_name, split_data_url, tree_json, unique_file_path,
};

pub fn handle_tree(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let root = request
        .query
        .get("root")
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .unwrap_or_else(default_root);

    let json = tree_json(&root, &root);
    write_response(stream, 200, "application/json; charset=utf-8", json.as_bytes())
}

pub fn handle_read_file(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let Some(path) = request.query.get("path") else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Missing path");
    };
    let file_path = PathBuf::from(path);
    match fs::read_to_string(&file_path) {
        Ok(content) => {
            let body = format!(
                "{{\"path\":\"{}\",\"kind\":\"{}\",\"content\":\"{}\"}}",
                escape_json(&file_path.to_string_lossy()),
                escape_json(file_kind(&file_path)),
                escape_json(&content)
            );
            write_response(stream, 200, "application/json; charset=utf-8", body.as_bytes())
        }
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to read file: {error}").as_bytes(),
        ),
    }
}

pub fn handle_raw_file(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let Some(path) = request.query.get("path") else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Missing path");
    };
    let file_path = PathBuf::from(path);
    match fs::read(&file_path) {
        Ok(content) => write_response(stream, 200, mime_type_for(&file_path), &content),
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to read binary file: {error}").as_bytes(),
        ),
    }
}

pub fn handle_save_file(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let form = parse_body_form(request);
    let Some(path) = form.get("path") else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Missing path");
    };
    let Some(content) = form.get("content") else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Missing content");
    };

    let file_path = PathBuf::from(path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).ok();
    }

    match fs::write(&file_path, content) {
        Ok(_) => write_response(
            stream,
            200,
            "application/json; charset=utf-8",
            b"{\"ok\":true}",
        ),
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to save file: {error}").as_bytes(),
        ),
    }
}

pub fn handle_create_entry(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let form = parse_body_form(request);
    let parent = form
        .get("parent")
        .map(PathBuf::from)
        .unwrap_or_else(default_root);
    let name = form.get("name").cloned().unwrap_or_default();
    let entry_type = form.get("entryType").cloned().unwrap_or_default();
    let target = parent.join(name);

    let result = match entry_type.as_str() {
        "folder" => fs::create_dir_all(&target),
        "md" | "puml" => {
            if let Some(parent_dir) = target.parent() {
                fs::create_dir_all(parent_dir).ok();
            }
            fs::write(&target, "")
        }
        _ => Err(std::io::Error::other("Unsupported entry type")),
    };

    match result {
        Ok(_) => write_response(
            stream,
            200,
            "application/json; charset=utf-8",
            b"{\"ok\":true}",
        ),
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to create entry: {error}").as_bytes(),
        ),
    }
}

pub fn handle_delete_entry(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let form = parse_body_form(request);
    let Some(path) = form.get("path") else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Missing path");
    };
    let target = PathBuf::from(path);

    let result = if target.is_dir() {
        fs::remove_dir_all(&target)
    } else {
        fs::remove_file(&target)
    };

    match result {
        Ok(_) => write_response(
            stream,
            200,
            "application/json; charset=utf-8",
            b"{\"ok\":true}",
        ),
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to delete entry: {error}").as_bytes(),
        ),
    }
}

pub fn handle_move_entry(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let form = parse_body_form(request);
    let Some(from) = form.get("from") else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Missing source path");
    };
    let Some(to) = form.get("to") else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Missing target path");
    };

    let from_path = PathBuf::from(from);
    let to_path = PathBuf::from(to);
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).ok();
    }

    match fs::rename(&from_path, &to_path) {
        Ok(_) => write_response(
            stream,
            200,
            "application/json; charset=utf-8",
            b"{\"ok\":true}",
        ),
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to move entry: {error}").as_bytes(),
        ),
    }
}

pub fn handle_upload_image(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let form = parse_body_form(request);
    let target_dir = form
        .get("targetDir")
        .map(PathBuf::from)
        .unwrap_or_else(default_root);
    let file_name = sanitize_file_name(
        form.get("fileName")
            .map(String::as_str)
            .unwrap_or("image.png"),
    );
    let Some(data_url) = form.get("dataUrl") else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Missing image data");
    };

    let Some((extension, payload)) = split_data_url(data_url) else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Invalid data URL");
    };
    let bytes = match decode_base64(payload) {
        Ok(bytes) => bytes,
        Err(error) => {
            return write_response(
                stream,
                400,
                "text/plain; charset=utf-8",
                format!("Failed to decode image: {error}").as_bytes(),
            )
        }
    };

    fs::create_dir_all(&target_dir).ok();
    let final_name = ensure_extension(&file_name, extension);
    let final_path = unique_file_path(target_dir.join(final_name));

    match fs::write(&final_path, bytes) {
        Ok(_) => {
            let body = format!(
                "{{\"ok\":true,\"path\":\"{}\"}}",
                escape_json(&final_path.to_string_lossy())
            );
            write_response(stream, 200, "application/json; charset=utf-8", body.as_bytes())
        }
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to store image: {error}").as_bytes(),
        ),
    }
}

pub fn handle_pick_folder(stream: &mut TcpStream) -> std::io::Result<()> {
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-STA",
            "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Выберите папку'; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
        ])
        .output();

    match output {
        Ok(output) => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let body = format!("{{\"path\":\"{}\"}}", escape_json(&path));
            write_response(stream, 200, "application/json; charset=utf-8", body.as_bytes())
        }
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to open folder dialog: {error}").as_bytes(),
        ),
    }
}

pub fn handle_list_comments(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let Some(path) = request.query.get("path") else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Missing path");
    };
    let comments = load_comments(path);
    let mut json = String::from("[");
    for (index, comment) in comments.iter().enumerate() {
        if index > 0 {
            json.push(',');
        }
        json.push_str(&comment_to_json(comment));
    }
    json.push(']');
    write_response(stream, 200, "application/json; charset=utf-8", json.as_bytes())
}

pub fn handle_add_comment(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let form = parse_body_form(request);
    let file_path = form.get("path").cloned().unwrap_or_default();
    let comment = CommentRecord {
        id: format!("{}", now_unix()),
        file_path: file_path.clone(),
        text: form.get("text").cloned().unwrap_or_default(),
        selected_text: form.get("selectedText").cloned().unwrap_or_default(),
        range_start: form
            .get("rangeStart")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        range_end: form
            .get("rangeEnd")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0),
        created_at: now_unix(),
    };

    let mut comments = load_comments(&file_path);
    comments.push(comment.clone());
    match save_comments(&file_path, &comments) {
        Ok(_) => write_response(
            stream,
            200,
            "application/json; charset=utf-8",
            comment_to_json(&comment).as_bytes(),
        ),
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to save comment: {error}").as_bytes(),
        ),
    }
}

pub fn handle_delete_comment(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let form = parse_body_form(request);
    let file_path = form.get("path").cloned().unwrap_or_default();
    let comment_id = form.get("id").cloned().unwrap_or_default();
    let mut comments = load_comments(&file_path);
    comments.retain(|comment| comment.id != comment_id);

    match save_comments(&file_path, &comments) {
        Ok(_) => write_response(
            stream,
            200,
            "application/json; charset=utf-8",
            b"{\"ok\":true}",
        ),
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to delete comment: {error}").as_bytes(),
        ),
    }
}

pub fn handle_plantuml_url(stream: &mut TcpStream, request: &HttpRequest) -> std::io::Result<()> {
    let text = normalize_plantuml_source(&request.query.get("text").cloned().unwrap_or_default());
    let hex = text
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let body = format!(
        "{{\"url\":\"https://www.plantuml.com/plantuml/svg/~h{}\"}}",
        hex
    );
    write_response(stream, 200, "application/json; charset=utf-8", body.as_bytes())
}

pub fn handle_create_plugin_session(
    stream: &mut TcpStream,
    request: &HttpRequest,
) -> std::io::Result<()> {
    let form = parse_body_form(request);
    let record = PluginSessionRecord {
        id: new_plugin_session_id(),
        module_id: form
            .get("moduleId")
            .cloned()
            .unwrap_or_else(|| "plantuml_studio".to_string()),
        source: form.get("source").cloned().unwrap_or_default(),
        revision: 0,
        status: "draft".to_string(),
        updated_at: now_unix(),
    };

    match save_plugin_session(&record) {
        Ok(_) => write_response(
            stream,
            200,
            "application/json; charset=utf-8",
            plugin_session_to_json(&record).as_bytes(),
        ),
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to create plugin session: {error}").as_bytes(),
        ),
    }
}

pub fn handle_get_plugin_session(
    stream: &mut TcpStream,
    request: &HttpRequest,
) -> std::io::Result<()> {
    let Some(id) = request.query.get("id") else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Missing id");
    };

    match load_plugin_session(id) {
        Some(record) => write_response(
            stream,
            200,
            "application/json; charset=utf-8",
            plugin_session_to_json(&record).as_bytes(),
        ),
        None => write_response(
            stream,
            404,
            "text/plain; charset=utf-8",
            b"Plugin session not found",
        ),
    }
}

pub fn handle_save_plugin_session(
    stream: &mut TcpStream,
    request: &HttpRequest,
) -> std::io::Result<()> {
    let form = parse_body_form(request);
    let Some(id) = form.get("id") else {
        return write_response(stream, 400, "text/plain; charset=utf-8", b"Missing id");
    };

    let Some(mut record) = load_plugin_session(id) else {
        return write_response(
            stream,
            404,
            "text/plain; charset=utf-8",
            b"Plugin session not found",
        );
    };

    if let Some(source) = form.get("source") {
        record.source = source.clone();
    }
    record.status = form
        .get("status")
        .cloned()
        .unwrap_or_else(|| "saved".to_string());
    record.revision += 1;
    record.updated_at = now_unix();

    match save_plugin_session(&record) {
        Ok(_) => write_response(
            stream,
            200,
            "application/json; charset=utf-8",
            plugin_session_to_json(&record).as_bytes(),
        ),
        Err(error) => write_response(
            stream,
            500,
            "text/plain; charset=utf-8",
            format!("Failed to save plugin session: {error}").as_bytes(),
        ),
    }
}

pub fn serve_app_shell(stream: &mut TcpStream) -> std::io::Result<()> {
    if frontend_index_path().exists() {
        return serve_file(stream, &frontend_index_path());
    }
    serve_file(stream, &Path::new(STATIC_DIR).join("index.html"))
}

pub fn serve_frontend_route(stream: &mut TcpStream, route: &str) -> std::io::Result<()> {
    if let Some(path) = resolve_static_asset(route) {
        return serve_file(stream, &path);
    }

    if frontend_index_path().exists() {
        return serve_file(stream, &frontend_index_path());
    }

    write_response(stream, 404, "text/plain; charset=utf-8", b"Missing asset")
}

fn frontend_index_path() -> PathBuf {
    Path::new("frontend").join("dist").join("index.html")
}

fn resolve_static_asset(route: &str) -> Option<PathBuf> {
    let normalized = route.trim_start_matches('/');
    let frontend_candidate = Path::new("frontend").join("dist").join(normalized);
    if frontend_candidate.is_file() {
        return Some(frontend_candidate);
    }

    if normalized.starts_with("static/") {
        let legacy_candidate = Path::new(STATIC_DIR).join(normalized.trim_start_matches("static/"));
        if legacy_candidate.is_file() {
            return Some(legacy_candidate);
        }
    }

    None
}

fn serve_file(stream: &mut TcpStream, file_path: &Path) -> std::io::Result<()> {
    match fs::read(file_path) {
        Ok(body) => write_response(stream, 200, content_type_for(file_path), &body),
        Err(_) => write_response(stream, 404, "text/plain; charset=utf-8", b"Missing asset"),
    }
}
