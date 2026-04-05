use std::path::{Path, PathBuf};

pub const DEFAULT_HOST: &str = "0.0.0.0:7878";
pub const STATIC_DIR: &str = "static";
pub const COMMENT_STORE_DIR: &str = ".wysiwyg_md";
pub const PLUGIN_SESSION_DIR: &str = "plugin_sessions";

pub fn comment_store_dir() -> PathBuf {
    Path::new(COMMENT_STORE_DIR).to_path_buf()
}

pub fn plugin_session_dir() -> PathBuf {
    comment_store_dir().join(PLUGIN_SESSION_DIR)
}
