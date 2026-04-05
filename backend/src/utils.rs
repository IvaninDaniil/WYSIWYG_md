use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn normalize_plantuml_source(input: &str) -> String {
    input
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

pub fn escape_json(input: &str) -> String {
    let mut output = String::new();
    for ch in input.chars() {
        match ch {
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            _ => output.push(ch),
        }
    }
    output
}

pub fn file_kind(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("puml") => "puml",
        _ => "md",
    }
}

pub fn mime_type_for(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

pub fn content_type_for(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

pub fn is_visible_entry(path: &Path) -> bool {
    if path.is_dir() {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        return !matches!(name, ".git" | ".wysiwyg_md" | "target");
    }

    matches!(
        path.extension().and_then(|ext| ext.to_str()),
        Some("md" | "puml")
    )
}

pub fn default_root() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn url_encode(input: &str) -> String {
    let mut output = String::new();
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                output.push(byte as char)
            }
            b' ' => output.push('+'),
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}

pub fn percent_decode(input: &str) -> String {
    let mut result = Vec::new();
    let mut chars = input.as_bytes().iter().copied();
    while let Some(ch) = chars.next() {
        match ch {
            b'+' => result.push(b' '),
            b'%' => {
                let hi = chars.next().unwrap_or(b'0');
                let lo = chars.next().unwrap_or(b'0');
                let hex = [hi, lo];
                if let Ok(value) = u8::from_str_radix(&String::from_utf8_lossy(&hex), 16) {
                    result.push(value);
                }
            }
            _ => result.push(ch),
        }
    }
    String::from_utf8_lossy(&result).to_string()
}

pub fn sanitize_file_name(name: &str) -> String {
    let filtered = name
        .chars()
        .map(|ch| if ch.is_whitespace() { '_' } else { ch })
        .filter(|ch| !matches!(ch, ':' | '\\' | '/' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect::<String>();
    if filtered.is_empty() {
        "image.png".to_string()
    } else {
        filtered
    }
}

pub fn split_data_url(data_url: &str) -> Option<(&str, &str)> {
    let header_end = data_url.find(',')?;
    let (header, data) = data_url.split_at(header_end);
    let payload = &data[1..];
    let extension = if header.contains("image/jpeg") {
        "jpg"
    } else if header.contains("image/gif") {
        "gif"
    } else if header.contains("image/webp") {
        "webp"
    } else {
        "png"
    };
    Some((extension, payload))
}

pub fn ensure_extension(file_name: &str, extension: &str) -> String {
    if Path::new(file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some()
    {
        file_name.to_string()
    } else {
        format!("{file_name}.{extension}")
    }
}

pub fn unique_file_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image")
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();

    for index in 1..1000 {
        let candidate_name = if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    path
}

pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut chunk = Vec::new();
    for ch in input.chars().filter(|ch| !ch.is_whitespace()) {
        if ch == '=' {
            chunk.push(64);
        } else if let Some(value) = base64_value(ch) {
            chunk.push(value);
        } else {
            return Err(format!("unexpected base64 character: {ch}"));
        }

        if chunk.len() == 4 {
            output.push((chunk[0] << 2) | (chunk[1] >> 4));
            if chunk[2] != 64 {
                output.push((chunk[1] << 4) | (chunk[2] >> 2));
            }
            if chunk[3] != 64 && chunk[2] != 64 {
                output.push((chunk[2] << 6) | chunk[3]);
            }
            chunk.clear();
        }
    }
    Ok(output)
}

pub fn tree_json(path: &Path, root: &Path) -> String {
    let metadata = fs::metadata(path).ok();
    let is_dir = metadata.as_ref().is_some_and(|meta| meta.is_dir());
    let name = if path == root {
        path.to_string_lossy().to_string()
    } else {
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string()
    };

    if !is_dir {
        return format!(
            "{{\"name\":\"{}\",\"path\":\"{}\",\"kind\":\"file\",\"fileType\":\"{}\"}}",
            escape_json(&name),
            escape_json(&path.to_string_lossy()),
            escape_json(file_kind(path))
        );
    }

    let mut children = Vec::new();
    if let Ok(read_dir) = fs::read_dir(path) {
        let mut entries = read_dir
            .filter_map(Result::ok)
            .filter(|entry| is_visible_entry(&entry.path()))
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| {
            (
                !entry.path().is_dir(),
                entry.file_name().to_string_lossy().to_lowercase(),
            )
        });
        for entry in entries {
            children.push(tree_json(&entry.path(), root));
        }
    }

    format!(
        "{{\"name\":\"{}\",\"path\":\"{}\",\"kind\":\"folder\",\"children\":[{}]}}",
        escape_json(&name),
        escape_json(&path.to_string_lossy()),
        children.join(",")
    )
}

fn base64_value(ch: char) -> Option<u8> {
    match ch {
        'A'..='Z' => Some(ch as u8 - b'A'),
        'a'..='z' => Some(ch as u8 - b'a' + 26),
        '0'..='9' => Some(ch as u8 - b'0' + 52),
        '+' => Some(62),
        '/' => Some(63),
        _ => None,
    }
}
