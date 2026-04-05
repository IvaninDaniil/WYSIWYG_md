use std::fs;
use std::net::TcpListener;

mod config;
mod handlers;
mod http;
mod models;
mod server;
mod storage;
mod utils;

fn main() {
    fs::create_dir_all(config::comment_store_dir()).ok();
    fs::create_dir_all(config::plugin_session_dir()).ok();

    let host = std::env::var("HOST").unwrap_or_else(|_| config::DEFAULT_HOST.to_string());
    let listener = TcpListener::bind(&host).expect("failed to bind HTTP server");
    println!("WYSIWYG Markdown editor is running at http://{host}");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                if let Err(error) = server::handle_connection(stream) {
                    eprintln!("request failed: {error}");
                }
            }
            Err(error) => eprintln!("incoming connection failed: {error}"),
        }
    }
}
