//! Automatic history of completed comparisons (one entry per run, Files and Folders).
//!
//! Stored as one JSON file written atomically. A corrupt or future-version file is
//! never overwritten. Appends are serialized across windows/processes by an OS lock.
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const MAX_ENTRIES: usize = 1000;
const MAX_BYTES: usize = 1024 * 1024;
const MAX_TEXT: usize = 32768;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Folder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Identical,
    Different,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FolderResult {
    pub files: u64,
    pub directories: u64,
    pub identical: u64,
    pub minor: u64,
    pub different: u64,
    pub left_only: u64,
    pub right_only: u64,
    pub errors: u64,
    pub skipped: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileResult {
    pub status: FileStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules_applied: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EntryResult {
    Folder(FolderResult),
    File(FileResult),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryEntry {
    pub id: String,
    pub created_at_ms: u64,
    pub kind: EntryKind,
    /// A display label ("Pasted text") when that side was text with no file behind it.
    pub left_path: String,
    pub right_path: String,
    /// The left/right side was pasted text; its content is kept as a snapshot next to the history file.
    #[serde(default, skip_serializing_if = "is_false")]
    pub left_text: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub right_text: bool,
    pub result: EntryResult,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompareHistory {
    pub version: u32,
    pub entries: Vec<HistoryEntry>,
}

impl CompareHistory {
    pub fn empty() -> Self {
        Self {
            version: 1,
            entries: Vec::new(),
        }
    }
}

fn invalid(why: &str) -> AppError {
    AppError::new(
        "HISTORY_FORMAT",
        format!("Invalid or unsupported compare history ({why}); original preserved"),
        None,
    )
}

fn validate_entry(entry: &HistoryEntry) -> Result<(), AppError> {
    // The id names snapshot files, so it must never contain path syntax.
    if entry.id.is_empty()
        || entry.id.len() > 128
        || !entry
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(invalid("id"));
    }
    if (entry.left_text || entry.right_text) && entry.kind != EntryKind::File {
        return Err(invalid("text snapshots are only for file comparisons"));
    }
    for path in [&entry.left_path, &entry.right_path] {
        if path.is_empty() || path.len() > MAX_TEXT {
            return Err(invalid("path"));
        }
    }
    match (&entry.kind, &entry.result) {
        (EntryKind::Folder, EntryResult::Folder(_)) => Ok(()),
        (EntryKind::File, EntryResult::File(file)) => match (file.status, file.change_count) {
            (FileStatus::Identical, Some(n)) if n != 0 => Err(invalid("identical with changes")),
            _ => Ok(()),
        },
        _ => Err(invalid("kind does not match result")),
    }
}

fn validate(history: &CompareHistory) -> Result<(), AppError> {
    if history.version != 1 {
        return Err(invalid("version"));
    }
    if history.entries.len() > MAX_ENTRIES {
        return Err(invalid("too many entries"));
    }
    let mut ids = HashSet::new();
    for entry in &history.entries {
        validate_entry(entry)?;
        if !ids.insert(entry.id.as_str()) {
            return Err(invalid("duplicate id"));
        }
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<CompareHistory, AppError> {
    if !path.exists() {
        return Ok(CompareHistory::empty());
    }
    let meta = fs::metadata(path).map_err(|e| AppError::new("HISTORY_READ", e, Some(path)))?;
    if meta.len() as usize > MAX_BYTES {
        return Err(AppError::new(
            "HISTORY_FORMAT",
            "Compare history exceeds 1 MiB; original preserved",
            Some(path),
        ));
    }
    let bytes = fs::read(path).map_err(|e| AppError::new("HISTORY_READ", e, Some(path)))?;
    let history: CompareHistory = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::new("HISTORY_FORMAT", format!("{e}; original preserved"), Some(path)))?;
    validate(&history)?;
    Ok(history)
}

/// Never overwrites a corrupt or future-version file; the valid file is replaced atomically.
pub fn save(path: &Path, history: &CompareHistory) -> Result<(), AppError> {
    validate(history)?;
    let bytes = serde_json::to_vec(history).map_err(|e| AppError::new("HISTORY_FORMAT", e, None))?;
    if bytes.len() > MAX_BYTES {
        return Err(AppError::new(
            "HISTORY_FORMAT",
            "Compare history exceeds 1 MiB; original preserved",
            Some(path),
        ));
    }
    if path.exists() {
        load(path)?;
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("HISTORY_WRITE", "Missing parent", Some(path)))?;
    fs::create_dir_all(parent).map_err(|e| AppError::new("HISTORY_WRITE", e, Some(parent)))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| AppError::new("HISTORY_WRITE", e, Some(parent)))?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| AppError::new("HISTORY_WRITE", e, Some(path)))?;
    temp.persist(path)
        .map_err(|e| AppError::new("HISTORY_WRITE", e.error, Some(path)))?;
    Ok(())
}

static PROCESS_LOCK: Mutex<()> = Mutex::new(());

fn lock_path(path: &Path) -> PathBuf {
    path.with_extension("lock")
}

/// Largest text kept for one pasted side.
pub const MAX_SNAPSHOT_BYTES: usize = 10 * 1024 * 1024;

fn snapshot_dir(path: &Path) -> PathBuf {
    path.with_extension("snapshots")
}

fn snapshot_file(path: &Path, id: &str, side: &str) -> PathBuf {
    snapshot_dir(path).join(format!("{id}.{side}.txt"))
}

fn write_snapshot(path: &Path, id: &str, side: &str, text: &str) -> Result<PathBuf, AppError> {
    let target = snapshot_file(path, id, side);
    let parent = snapshot_dir(path);
    fs::create_dir_all(&parent).map_err(|e| AppError::new("HISTORY_WRITE", e, Some(&parent)))?;
    let mut temp = tempfile::NamedTempFile::new_in(&parent)
        .map_err(|e| AppError::new("HISTORY_WRITE", e, Some(&parent)))?;
    temp.write_all(text.as_bytes())
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| AppError::new("HISTORY_WRITE", e, Some(&target)))?;
    temp.persist(&target)
        .map_err(|e| AppError::new("HISTORY_WRITE", e.error, Some(&target)))?;
    Ok(target)
}

fn remove_snapshots(path: &Path, entry: &HistoryEntry) {
    for (flag, side) in [(entry.left_text, "left"), (entry.right_text, "right")] {
        if flag {
            let _ = fs::remove_file(snapshot_file(path, &entry.id, side));
        }
    }
}

/// Adds one entry without any text snapshots.
pub fn append(path: &Path, entry: HistoryEntry) -> Result<(), AppError> {
    append_with_texts(path, entry, None, None)
}

/// Text of a pasted side, only for an entry that is listed and flagged as having it.
pub fn read_snapshot(path: &Path, id: &str, side: &str) -> Result<String, AppError> {
    if !matches!(side, "left" | "right") {
        return Err(invalid("side"));
    }
    let history = load(path)?;
    let entry = history
        .entries
        .iter()
        .find(|entry| entry.id == id)
        .filter(|entry| if side == "left" { entry.left_text } else { entry.right_text })
        .ok_or_else(|| AppError::new("HISTORY_SNAPSHOT", "No saved text for this history entry", None))?;
    let file = snapshot_file(path, &entry.id, side);
    fs::read_to_string(&file).map_err(|e| AppError::new("HISTORY_SNAPSHOT", e, Some(&file)))
}

/// Adds one entry, dropping the oldest ones (and their snapshots) beyond the entry/size limits.
/// A side flagged as text must come with its text, which is stored beside the history file before
/// the entry is listed, so a listed entry can always be reopened. Serialized in-process and across
/// app instances (each launch is its own process).
pub fn append_with_texts(
    path: &Path,
    entry: HistoryEntry,
    left_text: Option<&str>,
    right_text: Option<&str>,
) -> Result<(), AppError> {
    validate_entry(&entry)?;
    for (flag, text, side) in [
        (entry.left_text, left_text, "left"),
        (entry.right_text, right_text, "right"),
    ] {
        match (flag, text) {
            (true, Some(text)) if text.len() > MAX_SNAPSHOT_BYTES => {
                return Err(AppError::new(
                    "HISTORY_SNAPSHOT",
                    format!("The {side} text is larger than 10 MB and cannot be kept in history"),
                    None,
                ))
            }
            (true, Some(_)) | (false, None) => {}
            _ => return Err(invalid("text snapshot does not match its flag")),
        }
    }
    let _guard = PROCESS_LOCK
        .lock()
        .map_err(|e| AppError::new("HISTORY_LOCK", e, None))?;
    let lock_file = lock_path(path);
    if let Some(parent) = lock_file.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::new("HISTORY_LOCK", e, Some(parent)))?;
    }
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_file)
        .map_err(|e| AppError::new("HISTORY_LOCK", e, Some(&lock_file)))?;
    lock.lock()
        .map_err(|e| AppError::new("HISTORY_LOCK", e, Some(&lock_file)))?;
    let mut history = load(path)?;
    if history.entries.iter().any(|existing| existing.id == entry.id) {
        return Err(invalid("duplicate id"));
    }
    let added = entry.clone();
    let mut written = Vec::new();
    let result = (|| {
        for (text, side) in [(left_text, "left"), (right_text, "right")] {
            if let Some(text) = text {
                written.push(write_snapshot(path, &entry.id, side, text)?);
            }
        }
        history.entries.push(entry);
        let mut dropped = Vec::new();
        if history.entries.len() > MAX_ENTRIES {
            let excess = history.entries.len() - MAX_ENTRIES;
            dropped.extend(history.entries.drain(..excess));
        }
        loop {
            let size = serde_json::to_vec(&history)
                .map_err(|e| AppError::new("HISTORY_FORMAT", e, None))?
                .len();
            if size <= MAX_BYTES || history.entries.len() <= 1 {
                break;
            }
            dropped.push(history.entries.remove(0));
        }
        save(path, &history)?;
        Ok::<_, AppError>(dropped)
    })();
    match result {
        Ok(dropped) => {
            // Best effort: a leftover snapshot is garbage, never a broken entry.
            for old in &dropped {
                remove_snapshots(path, old);
            }
            Ok(())
        }
        Err(error) => {
            remove_snapshots(path, &added);
            for file in written {
                let _ = fs::remove_file(file);
            }
            Err(error)
        }
    }
}
