//! Unsaved Files-tab recovery store. Written on a normal window close, read on the next start.
//! Kept apart from Folder Sessions; shares its atomic temp-file-then-replace write.
use crate::error::AppError;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

/// Drafts hold whole documents, so the limit is generous but finite.
pub const MAX_BYTES: u64 = 256 * 1024 * 1024;
const MAX_DOCUMENTS: usize = 400;
const MAX_TABS: usize = 200;

fn invalid() -> AppError {
    AppError::new(
        "DRAFTS_FORMAT",
        "Invalid or unsupported recovery file; original preserved",
        None,
    )
}

fn text_within(value: &Value, max: usize) -> bool {
    value.as_str().is_some_and(|s| s.len() <= max)
}

fn non_empty_within(value: &Value, max: usize) -> bool {
    value.as_str().is_some_and(|s| !s.is_empty() && s.len() <= max)
}

fn non_negative(value: &Value) -> bool {
    value.as_f64().is_some_and(|n| n.is_finite() && n >= 0.0)
}

pub fn empty() -> Value {
    json!({"version":1,"savedAtMs":0,"active":null,"documents":[],"tabs":[]})
}

fn validate(value: &Value) -> Result<(), AppError> {
    if value["version"] != 1 || !non_negative(&value["savedAtMs"]) {
        return Err(invalid());
    }
    let documents = value["documents"].as_array().ok_or_else(invalid)?;
    let tabs = value["tabs"].as_array().ok_or_else(invalid)?;
    if documents.len() > MAX_DOCUMENTS || tabs.len() > MAX_TABS {
        return Err(invalid());
    }
    match &value["active"] {
        Value::Null => {}
        active => {
            if !active.as_u64().is_some_and(|i| (i as usize) < tabs.len()) {
                return Err(invalid());
            }
        }
    }
    let mut ids = HashSet::new();
    for doc in documents {
        if !non_empty_within(&doc["id"], 128) || !ids.insert(doc["id"].as_str().unwrap()) {
            return Err(invalid());
        }
        if !doc["path"].is_null() && !non_empty_within(&doc["path"], 32768) {
            return Err(invalid());
        }
        // `text` is present only for documents with unsaved edits; clean files are re-read from `path`.
        if !doc["text"].is_null() && !doc["text"].is_string() {
            return Err(invalid());
        }
        if !non_empty_within(&doc["encoding"], 64)
            || !doc["bom"].is_boolean()
            || !matches!(doc["eol"].as_str(), Some("LF" | "CRLF"))
            || !(doc["language"].is_null() || non_empty_within(&doc["language"], 64))
            || !non_negative(&doc["size"])
            || !non_negative(&doc["mtimeMs"])
        {
            return Err(invalid());
        }
    }
    for tab in tabs {
        for key in ["left", "right"] {
            if !tab[key].as_str().is_some_and(|id| ids.contains(id)) {
                return Err(invalid());
            }
        }
        let options = &tab["options"];
        if !matches!(tab["focused"].as_str(), Some("left" | "right"))
            || !matches!(options["viewMode"].as_str(), Some("all" | "diffs" | "context"))
            || !options["ignoreWs"].is_boolean()
            || !options["wrap"].is_boolean()
        {
            return Err(invalid());
        }
        let rules = tab["regexRules"].as_array().ok_or_else(invalid)?;
        if rules.len() > 100
            || rules.iter().any(|rule| {
                !non_empty_within(&rule["id"], 128)
                    || !text_within(&rule["pattern"], 4096)
                    || !rule["enabled"].is_boolean()
            })
        {
            return Err(invalid());
        }
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<Value, AppError> {
    if !path.exists() {
        return Ok(empty());
    }
    let meta = fs::metadata(path).map_err(|e| AppError::new("DRAFTS_READ", e, Some(path)))?;
    if meta.len() > MAX_BYTES {
        return Err(AppError::new(
            "DRAFTS_FORMAT",
            "Recovery file is too large; original preserved",
            Some(path),
        ));
    }
    let value: Value =
        serde_json::from_slice(&fs::read(path).map_err(|e| AppError::new("DRAFTS_READ", e, Some(path)))?)
            .map_err(|e| AppError::new("DRAFTS_FORMAT", e, Some(path)))?;
    validate(&value)?;
    Ok(value)
}

fn corrupt_name(path: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!("{name}.unreadable-{stamp}"))
}

/// Replaces the previous recovery data atomically: a failed write leaves it readable.
/// An existing file that cannot be read is set aside, never overwritten, so closing is not blocked by it.
pub fn save(path: &Path, value: &Value) -> Result<(), AppError> {
    validate(value)?;
    let bytes = serde_json::to_vec(value).map_err(|e| AppError::new("DRAFTS_FORMAT", e, None))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(AppError::new(
            "DRAFTS_TOO_LARGE",
            "Unsaved text is too large to store for recovery. Save some of the files first.",
            Some(path),
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("DRAFTS_WRITE", "Missing parent", Some(path)))?;
    fs::create_dir_all(parent).map_err(|e| AppError::new("DRAFTS_WRITE", e, Some(parent)))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| AppError::new("DRAFTS_WRITE", e, Some(parent)))?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| AppError::new("DRAFTS_WRITE", e, Some(path)))?;
    if path.exists() && load(path).is_err() {
        fs::rename(path, corrupt_name(path))
            .map_err(|e| AppError::new("DRAFTS_WRITE", e, Some(path)))?;
    }
    temp.persist(path)
        .map_err(|e| AppError::new("DRAFTS_WRITE", e.error, Some(path)))?;
    Ok(())
}

/// Forget stored drafts (nothing left to recover, or the user resolved every one).
pub fn clear(path: &Path) -> Result<(), AppError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::new("DRAFTS_WRITE", e, Some(path))),
    }
}
