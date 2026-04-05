use std::net::TcpStream;

use crate::handlers;
use crate::http::{parse_request, write_response};

pub fn handle_connection(mut stream: TcpStream) -> std::io::Result<()> {
    let request = match parse_request(&mut stream) {
        Some(request) => request,
        None => {
            write_response(&mut stream, 400, "text/plain; charset=utf-8", b"Bad request")?;
            return Ok(());
        }
    };

    let route = request.path.clone();
    match (request.method.as_str(), route.as_str()) {
        ("GET", "/") => handlers::serve_app_shell(&mut stream),
        ("GET", "/api/tree") => handlers::handle_tree(&mut stream, &request),
        ("GET", "/api/file") => handlers::handle_read_file(&mut stream, &request),
        ("GET", "/api/raw-file") => handlers::handle_raw_file(&mut stream, &request),
        ("GET", "/api/comments") => handlers::handle_list_comments(&mut stream, &request),
        ("GET", "/api/plantuml-url") => handlers::handle_plantuml_url(&mut stream, &request),
        ("GET", "/api/plugin-session") => handlers::handle_get_plugin_session(&mut stream, &request),
        ("POST", "/api/plugin-session/create") => {
            handlers::handle_create_plugin_session(&mut stream, &request)
        }
        ("POST", "/api/plugin-session/save") => handlers::handle_save_plugin_session(&mut stream, &request),
        ("POST", "/api/save") => handlers::handle_save_file(&mut stream, &request),
        ("POST", "/api/create") => handlers::handle_create_entry(&mut stream, &request),
        ("POST", "/api/delete") => handlers::handle_delete_entry(&mut stream, &request),
        ("POST", "/api/move") => handlers::handle_move_entry(&mut stream, &request),
        ("POST", "/api/upload-image") => handlers::handle_upload_image(&mut stream, &request),
        ("POST", "/api/pick-folder") => handlers::handle_pick_folder(&mut stream),
        ("POST", "/api/comments/add") => handlers::handle_add_comment(&mut stream, &request),
        ("POST", "/api/comments/delete") => handlers::handle_delete_comment(&mut stream, &request),
        ("GET", path) => handlers::serve_frontend_route(&mut stream, path),
        _ => write_response(
            &mut stream,
            404,
            "text/plain; charset=utf-8",
            b"Not found",
        ),
    }
}
