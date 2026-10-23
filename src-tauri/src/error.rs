use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl AppError {
    pub fn new(code: &str, message: impl ToString, path: Option<&Path>) -> Self {
        Self {
            code: code.into(),
            message: message.to_string(),
            path: path.map(|p| p.to_string_lossy().into_owned()),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for AppError {}
