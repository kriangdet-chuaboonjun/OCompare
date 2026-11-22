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

/// Per-window recovery files in one directory. Each window owns `<id>.json`, written when it
/// closes, and holds an exclusive OS lock on `<id>.lock` for as long as it runs. On start a
/// window takes over only the files whose owner has exited (its lock is free), so windows never
/// delete, overwrite or both restore each other's drafts. A crash releases the lock, so a file
/// claimed by a window that then crashed is claimed again by the next start.
pub struct DraftSlots {
    dir: PathBuf,
    legacy: Option<PathBuf>,
    id: String,
    _lock: fs::File,
    claimed: std::sync::Mutex<Vec<PathBuf>>,
}

fn owner_of(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    if !name.ends_with(".json") {
        return None;
    }
    name.split('.').next().filter(|s| !s.is_empty()).map(str::to_owned)
}

/// Appends `value` to `merged`, renaming document ids so stores from several windows never clash.
fn append(merged: &mut Value, value: &Value, file: usize) {
    let mut ids = std::collections::HashMap::new();
    if let Some(documents) = merged["documents"].as_array_mut() {
        for (index, doc) in value["documents"].as_array().into_iter().flatten().enumerate() {
            let id = format!("r{file}.{index}");
            ids.insert(doc["id"].as_str().unwrap_or_default().to_owned(), id.clone());
            let mut doc = doc.clone();
            doc["id"] = json!(id);
            documents.push(doc);
        }
    }
    let mut offset = 0;
    if let Some(tabs) = merged["tabs"].as_array_mut() {
        offset = tabs.len();
        for tab in value["tabs"].as_array().into_iter().flatten() {
            let mut tab = tab.clone();
            for key in ["left", "right"] {
                tab[key] = json!(ids.get(tab[key].as_str().unwrap_or_default()));
            }
            tabs.push(tab);
        }
    }
    if merged["active"].is_null() {
        if let Some(active) = value["active"].as_u64() {
            merged["active"] = json!(offset as u64 + active);
        }
    }
    if value["savedAtMs"].as_f64() > merged["savedAtMs"].as_f64() {
        merged["savedAtMs"] = value["savedAtMs"].clone();
    }
}

fn fits(merged: &Value, value: &Value) -> bool {
    let count = |v: &Value, key: &str| v[key].as_array().map_or(0, Vec::len);
    count(merged, "documents") + count(value, "documents") <= MAX_DOCUMENTS
        && count(merged, "tabs") + count(value, "tabs") <= MAX_TABS
}

impl DraftSlots {
    /// `legacy` is the single shared file used by older versions; it is claimed like any other.
    pub fn open(dir: PathBuf, legacy: Option<PathBuf>) -> Result<Self, AppError> {
        fs::create_dir_all(&dir).map_err(|e| AppError::new("DRAFTS_WRITE", e, Some(&dir)))?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let id = format!("w{}-{stamp}", std::process::id());
        let lock_path = dir.join(format!("{id}.lock"));
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&lock_path)
            .map_err(|e| AppError::new("DRAFTS_LOCK", e, Some(&lock_path)))?;
        lock.try_lock()
            .map_err(|e| AppError::new("DRAFTS_LOCK", e, Some(&lock_path)))?;
        Ok(Self {
            dir,
            legacy,
            id,
            _lock: lock,
            claimed: Default::default(),
        })
    }

    fn own_path(&self) -> PathBuf {
        self.dir.join(format!("{}.json", self.id))
    }

    /// An owner is gone when nobody holds its lock. Unknown states count as alive: never steal.
    fn owner_gone(&self, owner: &str) -> bool {
        if owner == self.id {
            return false;
        }
        let lock_path = self.dir.join(format!("{owner}.lock"));
        let file = match fs::OpenOptions::new().write(true).open(&lock_path) {
            Ok(file) => file,
            Err(e) => return e.kind() == std::io::ErrorKind::NotFound,
        };
        if file.try_lock().is_err() {
            return false;
        }
        drop(file);
        let _ = fs::remove_file(&lock_path);
        true
    }

    /// Takes over every store left by windows that have exited and returns them as one store.
    pub fn load(&self) -> Result<Value, AppError> {
        let claim_path = self.dir.join("claim.lock");
        let claim = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&claim_path)
            .map_err(|e| AppError::new("DRAFTS_LOCK", e, Some(&claim_path)))?;
        claim
            .lock()
            .map_err(|e| AppError::new("DRAFTS_LOCK", e, Some(&claim_path)))?;
        let mut candidates: Vec<PathBuf> =
            self.legacy.iter().filter(|p| p.exists()).cloned().collect();
        let entries = fs::read_dir(&self.dir)
            .map_err(|e| AppError::new("DRAFTS_READ", e, Some(&self.dir)))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if owner_of(&path).is_some_and(|owner| self.owner_gone(&owner)) {
                candidates.push(path);
            } else if let Some(owner) = path
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| n.strip_suffix(".lock"))
                .filter(|owner| *owner != "claim")
            {
                // Windows that closed with nothing to recover leave only their lock behind.
                self.owner_gone(owner);
            }
        }
        candidates.sort_by_key(|p| fs::metadata(p).and_then(|m| m.modified()).ok());
        let mut claimed = self
            .claimed
            .lock()
            .map_err(|e| AppError::new("DRAFTS_STATE", e, None))?;
        let mut merged = empty();
        let mut failure = None;
        for path in candidates {
            match load(&path) {
                Ok(value) if fits(&merged, &value) => {
                    let target = self
                        .dir
                        .join(format!("{}.claimed-{}.json", self.id, claimed.len()));
                    if fs::rename(&path, &target).is_ok() {
                        append(&mut merged, &value, claimed.len());
                        claimed.push(target);
                    }
                }
                // More than one window can show: left for the next start.
                Ok(_) => {}
                Err(error) => {
                    let _ = fs::rename(&path, corrupt_name(&path));
                    failure.get_or_insert(error);
                }
            }
        }
        match failure {
            Some(error) if merged["tabs"].as_array().is_none_or(Vec::is_empty) => Err(error),
            _ => Ok(merged),
        }
    }

    /// Stores this window's drafts; the stores it took over are now part of them.
    pub fn save(&self, value: &Value) -> Result<(), AppError> {
        save(&self.own_path(), value)?;
        self.forget_claimed()
    }

    /// Forgets this window's drafts and the stores it took over; other windows are untouched.
    pub fn clear(&self) -> Result<(), AppError> {
        clear(&self.own_path())?;
        self.forget_claimed()
    }

    fn forget_claimed(&self) -> Result<(), AppError> {
        let mut claimed = self
            .claimed
            .lock()
            .map_err(|e| AppError::new("DRAFTS_STATE", e, None))?;
        for path in claimed.iter() {
            clear(path)?;
        }
        claimed.clear();
        Ok(())
    }
}
