use crate::{encoding, error::AppError};
use serde::Serialize;
use std::{fs, path::Path, time::UNIX_EPOCH};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileData {
    pub path: String,
    pub text: String,
    pub encoding: String,
    pub bom: bool,
    pub eol: String,
    pub size: u64,
    pub mtime_ms: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub size: u64,
    pub mtime_ms: f64,
}

pub fn read_text_file(path: &Path) -> Result<FileData, AppError> {
    let bytes = fs::read(path).map_err(|e| AppError::new("READ", e, Some(path)))?;
    let stat = file_stat(path)?;
    let (text, encoding, bom) = encoding::decode(&bytes).map_err(|mut e| {
        e.path = Some(path.to_string_lossy().into_owned());
        e
    })?;
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count() - crlf;
    Ok(FileData {
        path: path.to_string_lossy().into_owned(),
        text,
        encoding,
        bom,
        eol: if crlf > lf { "CRLF" } else { "LF" }.into(),
        size: stat.size,
        mtime_ms: stat.mtime_ms,
    })
}

/// รักษา encoding/BOM และปล่อยให้ Monaco ส่ง EOL ตาม model เดิม
pub fn write_text_file(
    path: &Path,
    text: &str,
    encoding: &str,
    bom: bool,
) -> Result<FileStat, AppError> {
    let bytes = encoding::encode(text, encoding, bom).map_err(|mut e| {
        e.path = Some(path.to_string_lossy().into_owned());
        e
    })?;
    write_encoded_file(path, &bytes)
}

pub fn write_encoded_file(path: &Path, bytes: &[u8]) -> Result<FileStat, AppError> {
    fs::write(path, bytes).map_err(|e| AppError::new("WRITE", e, Some(path)))?;
    file_stat(path)
}

pub fn file_stat(path: &Path) -> Result<FileStat, AppError> {
    let metadata = fs::metadata(path).map_err(|e| AppError::new("STAT", e, Some(path)))?;
    let modified = metadata
        .modified()
        .map_err(|e| AppError::new("STAT", e, Some(path)))?;
    Ok(FileStat {
        size: metadata.len(),
        mtime_ms: modified
            .duration_since(UNIX_EPOCH)
            .map_err(|e| AppError::new("STAT", e, Some(path)))?
            .as_secs_f64()
            * 1000.0,
    })
}
