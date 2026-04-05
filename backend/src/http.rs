use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;

use crate::models::HttpRequest;
use crate::utils::percent_decode;

pub fn parse_request(stream: &mut TcpStream) -> Option<HttpRequest> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let mut header_end = None;
    let mut content_length = 0_usize;

    loop {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if header_end.is_none() {
            if let Some(index) = find_subsequence(&buffer, b"\r\n\r\n") {
                header_end = Some(index + 4);
                let header_text = String::from_utf8_lossy(&buffer[..index]);
                for line in header_text.lines().skip(1) {
                    if let Some((name, value)) = line.split_once(':') {
                        if name.eq_ignore_ascii_case("Content-Length") {
                            content_length = value.trim().parse().unwrap_or(0);
                        }
                    }
                }
            }
        }

        if let Some(end) = header_end {
            if buffer.len() >= end + content_length {
                break;
            }
        }
    }

    let header_end = header_end?;
    let header_bytes = &buffer[..header_end - 4];
    let body = buffer[header_end..].to_vec();
    let header_text = String::from_utf8(header_bytes.to_vec()).ok()?;
    let mut lines = header_text.lines();
    let request_line = lines.next()?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next()?.to_string();
    let raw_target = request_parts.next()?.to_string();
    let (path, query) = split_path_and_query(&raw_target);

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    Some(HttpRequest {
        method,
        path,
        query,
        headers,
        body,
    })
}

pub fn split_path_and_query(raw: &str) -> (String, HashMap<String, String>) {
    if let Some((path, query)) = raw.split_once('?') {
        (path.to_string(), parse_form(query))
    } else {
        (raw.to_string(), HashMap::new())
    }
}

pub fn write_response(
    stream: &mut TcpStream,
    status_code: u16,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let status_text = match status_code {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };

    let headers = format!(
        "HTTP/1.1 {status_code} {status_text}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        body.len()
    );

    stream.write_all(headers.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

pub fn parse_body_form(request: &HttpRequest) -> HashMap<String, String> {
    let content_type = request
        .headers
        .get("content-type")
        .map(String::as_str)
        .unwrap_or_default();
    if content_type.starts_with("application/x-www-form-urlencoded") {
        parse_form(&String::from_utf8_lossy(&request.body))
    } else {
        HashMap::new()
    }
}

pub fn parse_form(input: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in input.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        map.insert(percent_decode(key), percent_decode(value));
    }
    map
}

fn find_subsequence(buffer: &[u8], needle: &[u8]) -> Option<usize> {
    buffer.windows(needle.len()).position(|window| window == needle)
}
