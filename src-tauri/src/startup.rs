use crate::error::AppError;
use serde::Serialize;
use std::{ffi::OsString, path::PathBuf};

#[derive(Debug, Serialize)]
pub struct StartupComparison {
    pub mode: String,
    pub paths: Vec<String>,
}

/// Validate the entire launch request before loading either side. Each launch owns a new window.
pub fn parse_paths(
    args: impl IntoIterator<Item = OsString>,
) -> Result<Option<StartupComparison>, AppError> {
    let mut args: Vec<_> = args.into_iter().collect();
    let explicit = args.first().is_some_and(|arg| arg == "--compare");
    if explicit {
        args.remove(0);
    }
    if args.is_empty() && !explicit {
        return Ok(None);
    }
    if args.len() > 2 || args.is_empty() || (explicit && args.len() != 2) {
        return Err(AppError::new(
            "STARTUP",
            "Choose two files or two folders to compare",
            None,
        ));
    }
    let mut paths = Vec::new();
    let mut directory = None;
    for arg in args {
        let input = PathBuf::from(arg);
        let path =
            std::path::absolute(&input).map_err(|e| AppError::new("STARTUP", e, Some(&input)))?;
        let meta =
            std::fs::metadata(&path).map_err(|e| AppError::new("STARTUP", e, Some(&path)))?;
        if !meta.is_file() && !meta.is_dir() {
            return Err(AppError::new(
                "STARTUP",
                "Choose a regular file or folder",
                Some(&path),
            ));
        }
        if directory.is_some_and(|kind| kind != meta.is_dir()) {
            return Err(AppError::new(
                "STARTUP",
                "Cannot compare a file with a folder",
                None,
            ));
        }
        directory = Some(meta.is_dir());
        let text = path.to_str().ok_or_else(|| {
            AppError::new("STARTUP", "Path contains invalid Unicode", Some(&path))
        })?;
        paths.push(if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{unc}")
        } else {
            text.strip_prefix(r"\\?\").unwrap_or(text).to_owned()
        });
    }
    if directory == Some(true) && paths.len() != 2 {
        return Err(AppError::new(
            "STARTUP",
            "Choose two folders to compare",
            None,
        ));
    }
    Ok(Some(StartupComparison {
        mode: if directory == Some(true) {
            "folders"
        } else {
            "files"
        }
        .into(),
        paths,
    }))
}
