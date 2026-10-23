//! Byte-preserving preimage history. Callers serialize writes and history operations.
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_VERSIONS: usize = 20;
pub const MAX_BYTES: u64 = 1_000_000_000;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub id: String,
    pub path: String,
    pub created_at_ms: u64,
    pub size: u64,
    pub sha256: String,
    pub reason: String,
}

#[derive(Clone)]
pub struct BackupStore {
    root: PathBuf,
    max_versions: usize,
    max_bytes: u64,
}

/// Uncommitted snapshots are excluded from History and removed on failure/drop.
/// Commit only after the destination replacement has succeeded.
pub struct PreparedBackup {
    store: BackupStore,
    entry: BackupEntry,
    committed: bool,
}

fn error(code: &str, value: impl ToString, path: &Path) -> AppError {
    AppError::new(code, value, Some(path))
}

fn is_link(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    meta.file_type().is_symlink()
}

/// Reject every existing symlink/junction component, including parent folders.
fn check_path(path: &Path) -> Result<(), AppError> {
    let absolute = std::path::absolute(path).map_err(|e| error("BACKUP_PATH", e, path))?;
    let mut part = PathBuf::new();
    for component in absolute.components() {
        part.push(component.as_os_str());
        if matches!(component, std::path::Component::Prefix(_)) {
            continue;
        }
        match fs::symlink_metadata(&part) {
            Ok(meta) if is_link(&meta) => {
                return Err(error(
                    "BACKUP_LINK",
                    "Links and junctions are not followed",
                    &part,
                ));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(error("BACKUP_PATH", e, &part)),
        }
    }
    Ok(())
}

fn canonical_target(path: &Path) -> Result<PathBuf, AppError> {
    check_path(path)?;
    if path.exists() {
        return fs::canonicalize(path).map_err(|e| error("BACKUP_PATH", e, path));
    }
    let absolute = std::path::absolute(path).map_err(|e| error("BACKUP_PATH", e, path))?;
    let parent = absolute
        .parent()
        .ok_or_else(|| error("BACKUP_PATH", "Missing parent", path))?;
    let parent = fs::canonicalize(parent).map_err(|e| error("BACKUP_PATH", e, parent))?;
    let name = absolute
        .file_name()
        .ok_or_else(|| error("BACKUP_PATH", "Missing filename", path))?;
    Ok(parent.join(name))
}

fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

fn open_read(path: &Path) -> Result<File, AppError> {
    check_path(path)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Refuse replacement while reading and open reparse points themselves.
        options.share_mode(1).custom_flags(0x00200000);
    }
    let file = options
        .open(path)
        .map_err(|e| error("BACKUP_READ", e, path))?;
    let meta = file.metadata().map_err(|e| error("BACKUP_READ", e, path))?;
    if is_link(&meta) || !meta.is_file() {
        return Err(error(
            "BACKUP_LINK",
            "Only ordinary files can be backed up",
            path,
        ));
    }
    Ok(file)
}

fn hash_reader(reader: &mut impl Read, path: &Path) -> Result<(String, u64), AppError> {
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut buffer = [0; 65536];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|e| error("BACKUP_READ", e, path))?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
        size += count as u64;
    }
    Ok((format!("{:x}", hash.finalize()), size))
}

fn target_hash(path: &Path) -> Result<Option<String>, AppError> {
    match fs::symlink_metadata(path) {
        Ok(_) => hash_reader(&mut open_read(path)?, path).map(|v| Some(v.0)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            check_path(path)?;
            Ok(None)
        }
        Err(e) => Err(error("BACKUP_READ", e, path)),
    }
}

impl BackupStore {
    pub fn new(root: PathBuf) -> Self {
        Self::with_limits(root, MAX_VERSIONS, MAX_BYTES)
    }

    pub fn with_limits(root: PathBuf, max_versions: usize, max_bytes: u64) -> Self {
        Self {
            root,
            max_versions: max_versions.max(1),
            max_bytes,
        }
    }

    /// Call before each history transaction under the application's process and OS locks.
    /// An interrupted transaction may have saved the original successfully even if
    /// its catalog rename failed. Recover these versions rather than discard them.
    pub fn recover_pending(&self) -> Result<(), AppError> {
        check_path(&self.root)?;
        let directory = match fs::read_dir(&self.root) {
            Ok(directory) => directory,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(error("BACKUP_HISTORY", e, &self.root)),
        };
        for item in directory {
            let path = item
                .map_err(|e| error("BACKUP_HISTORY", e, &self.root))?
                .path();
            if !path.extension().is_some_and(|ext| ext == "pending") {
                continue;
            }
            let entry: BackupEntry = serde_json::from_reader(open_read(&path)?)
                .map_err(|e| error("BACKUP_HISTORY", e, &path))?;
            if !valid_id(&entry.id) || self.location(&entry.id, "pending") != path {
                return Err(error(
                    "BACKUP_HISTORY",
                    "Invalid pending history metadata",
                    &path,
                ));
            }
            let snapshot = self.location(&entry.id, "bin");
            let (hash, size) = hash_reader(&mut open_read(&snapshot)?, &snapshot)?;
            if hash != entry.sha256 || size != entry.size {
                return Err(error(
                    "BACKUP_VERIFY",
                    "Interrupted backup is damaged; snapshot retained for inspection",
                    &snapshot,
                ));
            }
            fs::rename(&path, self.location(&entry.id, "json"))
                .map_err(|e| error("BACKUP_COMMIT", e, &path))?;
        }
        // A previous commit may have persisted its catalog but failed during
        // retention. Retry even when there are no interrupted pending catalogs.
        if let Some(latest) = self.entries()?.last() {
            self.prune(&latest.id)?;
        }
        // A crash between persisting bytes and their metadata (or between
        // deleting a catalog and its bytes) leaves an uncatalogued snapshot.
        // No live transaction can exist while the caller holds the OS lock.
        for item in fs::read_dir(&self.root).map_err(|e| error("BACKUP_HISTORY", e, &self.root))? {
            let path = item
                .map_err(|e| error("BACKUP_HISTORY", e, &self.root))?
                .path();
            if !path.extension().is_some_and(|ext| ext == "bin") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|name| name.to_str()) else {
                continue;
            };
            if !valid_id(id) {
                continue;
            }
            let meta =
                fs::symlink_metadata(&path).map_err(|e| error("BACKUP_HISTORY", e, &path))?;
            if !meta.is_file() || is_link(&meta) {
                continue;
            }
            let mut catalogued = false;
            for extension in ["json", "pending"] {
                match fs::symlink_metadata(self.location(id, extension)) {
                    Ok(_) => catalogued = true,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(error("BACKUP_HISTORY", e, &path)),
                }
            }
            if !catalogued {
                fs::remove_file(&path).map_err(|e| error("BACKUP_PRUNE", e, &path))?;
            }
        }
        Ok(())
    }

    fn location(&self, id: &str, extension: &str) -> PathBuf {
        self.root.join(format!("{id}.{extension}"))
    }

    fn entries(&self) -> Result<Vec<BackupEntry>, AppError> {
        check_path(&self.root)?;
        let directory = match fs::read_dir(&self.root) {
            Ok(directory) => directory,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(error("BACKUP_HISTORY", e, &self.root)),
        };
        let mut entries = Vec::new();
        for item in directory {
            let item = item.map_err(|e| error("BACKUP_HISTORY", e, &self.root))?;
            let path = item.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                let entry: BackupEntry = serde_json::from_reader(open_read(&path)?)
                    .map_err(|e| error("BACKUP_HISTORY", e, &path))?;
                if !valid_id(&entry.id) || self.location(&entry.id, "json") != path {
                    return Err(error("BACKUP_HISTORY", "Invalid history metadata", &path));
                }
                entries.push(entry);
            }
        }
        entries.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(entries)
    }

    /// Newest first; callers never receive a filesystem path for snapshot storage.
    pub fn list(&self, path: &Path) -> Result<Vec<BackupEntry>, AppError> {
        let key = canonical_target(path)?.to_string_lossy().into_owned();
        let mut entries: Vec<_> = self
            .entries()?
            .into_iter()
            .filter(|e| same_path(&e.path, &key))
            .collect();
        entries.reverse();
        Ok(entries)
    }

    /// Capture the existing bytes before a write. No existing versions are pruned here.
    pub fn prepare(&self, path: &Path, reason: &str) -> Result<Option<PreparedBackup>, AppError> {
        if !matches!(reason, "Save" | "Copy" | "Restore") {
            return Err(error("BACKUP_REASON", "Invalid backup reason", path));
        }
        let path = canonical_target(path)?;
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(error("BACKUP_READ", e, &path)),
        };
        if !meta.is_file() || is_link(&meta) {
            return Err(error(
                "BACKUP_LINK",
                "Only ordinary files can be backed up",
                &path,
            ));
        }
        if meta.len() > self.max_bytes {
            return Err(error(
                "BACKUP_QUOTA",
                "File is larger than the backup history quota; original preserved",
                &path,
            ));
        }
        // Fail closed on damaged metadata before replacing the original file.
        self.entries()?;
        check_path(&self.root)?;
        fs::create_dir_all(&self.root).map_err(|e| error("BACKUP_WRITE", e, &self.root))?;
        let mut original = open_read(&path)?;
        let before = original
            .metadata()
            .map_err(|e| error("BACKUP_READ", e, &path))?;
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root)
            .map_err(|e| error("BACKUP_WRITE", e, &self.root))?;
        let size = std::io::copy(
            &mut (&mut original).take(self.max_bytes.saturating_add(1)),
            temporary.as_file_mut(),
        )
        .map_err(|e| error("BACKUP_WRITE", e, &path))?;
        if size > self.max_bytes {
            return Err(error(
                "BACKUP_QUOTA",
                "File grew beyond the backup history quota",
                &path,
            ));
        }
        let after = original
            .metadata()
            .map_err(|e| error("BACKUP_READ", e, &path))?;
        if before.len() != size
            || before.modified().ok() != after.modified().ok()
            || after.len() != size
        {
            return Err(error(
                "BACKUP_STALE",
                "File changed while being backed up; original preserved",
                &path,
            ));
        }
        original
            .seek(SeekFrom::Start(0))
            .map_err(|e| error("BACKUP_READ", e, &path))?;
        let (original_hash, _) = hash_reader(&mut original, &path)?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|e| error("BACKUP_WRITE", e, &path))?;
        temporary
            .seek(SeekFrom::Start(0))
            .map_err(|e| error("BACKUP_READ", e, &path))?;
        let (sha256, verified_size) = hash_reader(&mut temporary, &path)?;
        if sha256 != original_hash || verified_size != size {
            return Err(error(
                "BACKUP_VERIFY",
                "Backup verification failed; original preserved",
                &path,
            ));
        }
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| error("BACKUP_TIME", e, &path))?;
        let id = format!(
            "{:032x}-{:08x}-{:016x}",
            now.as_nanos(),
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let entry = BackupEntry {
            id: id.clone(),
            path: path.to_string_lossy().into_owned(),
            created_at_ms: now.as_millis() as u64,
            size,
            sha256,
            reason: reason.into(),
        };
        temporary
            .persist_noclobber(self.location(&id, "bin"))
            .map_err(|e| error("BACKUP_WRITE", e.error, &path))?;
        let prepared = PreparedBackup {
            store: self.clone(),
            entry,
            committed: false,
        };
        let mut metadata = tempfile::NamedTempFile::new_in(&self.root)
            .map_err(|e| error("BACKUP_WRITE", e, &self.root))?;
        serde_json::to_writer(metadata.as_file_mut(), &prepared.entry)
            .map_err(|e| error("BACKUP_WRITE", e, &path))?;
        metadata
            .as_file()
            .sync_all()
            .map_err(|e| error("BACKUP_WRITE", e, &path))?;
        metadata
            .persist_noclobber(self.location(&id, "pending"))
            .map_err(|e| error("BACKUP_WRITE", e.error, &path))?;
        Ok(Some(prepared))
    }

    /// Validate opaque ID, original path and SHA-256 before opening or restoring a version.
    pub fn snapshot_path(&self, path: &Path, id: &str) -> Result<PathBuf, AppError> {
        if !valid_id(id) {
            return Err(error("BACKUP_ID", "Invalid history ID", path));
        }
        let entry = self
            .list(path)?
            .into_iter()
            .find(|e| e.id == id)
            .ok_or_else(|| error("BACKUP_ID", "History version not found for this file", path))?;
        let location = self.location(id, "bin");
        let (hash, size) = hash_reader(&mut open_read(&location)?, &location)?;
        if hash != entry.sha256 || size != entry.size {
            return Err(error(
                "BACKUP_VERIFY",
                "Backup is damaged; original preserved",
                path,
            ));
        }
        Ok(location)
    }

    /// The current file is itself backed up before the chosen bytes replace it.
    pub fn restore(&self, path: &Path, id: &str) -> Result<(), AppError> {
        let snapshot = self.snapshot_path(path, id)?;
        let prepared = self.prepare(path, "Restore")?;
        let expected = prepared.as_ref().map(|p| p.entry.sha256.as_str());
        let mut input = open_read(&snapshot)?;
        atomic_replace_reader(path, &mut input, expected)?;
        drop(input);
        if let Some(prepared) = prepared {
            prepared.commit()?;
        }
        Ok(())
    }

    fn prune(&self, keep_id: &str) -> Result<(), AppError> {
        let mut entries = self.entries()?;
        let mut counts = std::collections::HashMap::<String, usize>::new();
        let mut total: u64 = entries.iter().map(|e| e.size).sum();
        for entry in &entries {
            let key = if cfg!(windows) {
                entry.path.to_ascii_lowercase()
            } else {
                entry.path.clone()
            };
            *counts.entry(key).or_default() += 1;
        }
        for entry in entries.drain(..) {
            let key = if cfg!(windows) {
                entry.path.to_ascii_lowercase()
            } else {
                entry.path.clone()
            };
            if entry.id == keep_id || (counts[&key] <= self.max_versions && total <= self.max_bytes)
            {
                continue;
            }
            // Remove the catalog record first. An interrupted cleanup leaves an orphan,
            // never a history row pointing at deleted bytes.
            fs::remove_file(self.location(&entry.id, "json"))
                .map_err(|e| error("BACKUP_PRUNE", e, &self.root))?;
            fs::remove_file(self.location(&entry.id, "bin"))
                .map_err(|e| error("BACKUP_PRUNE", e, &self.root))?;
            total -= entry.size;
            *counts.get_mut(&key).unwrap() -= 1;
        }
        Ok(())
    }
}

impl PreparedBackup {
    pub fn entry(&self) -> &BackupEntry {
        &self.entry
    }

    pub fn commit(mut self) -> Result<(), AppError> {
        // The destination has already been replaced. Never remove its preimage
        // if catalog persistence or retention now fails.
        self.committed = true;
        fs::rename(self.store.location(&self.entry.id, "pending"), self.store.location(&self.entry.id, "json"))
            .map_err(|e| error("BACKUP_COMMIT", format!("File saved, but history catalog commit failed; original snapshot retained for recovery: {e}"), &self.store.root))?;
        self.store.prune(&self.entry.id)
    }

    pub fn abort(self) {
        drop(self);
    }
}

impl Drop for PreparedBackup {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(self.store.location(&self.entry.id, "pending"));
            let _ = fs::remove_file(self.store.location(&self.entry.id, "bin"));
        }
    }
}

fn valid_id(id: &str) -> bool {
    id.len() == 58
        && id.bytes().enumerate().all(|(index, c)| {
            if index == 32 || index == 41 {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}

/// Write to a verified temporary file, then replace only the expected preimage.
/// `None` means the destination must still be absent.
pub fn atomic_replace(
    path: &Path,
    bytes: &[u8],
    expected_sha256: Option<&str>,
) -> Result<(), AppError> {
    atomic_replace_reader(path, &mut std::io::Cursor::new(bytes), expected_sha256)
}

fn atomic_replace_reader(
    path: &Path,
    input: &mut impl Read,
    expected_sha256: Option<&str>,
) -> Result<(), AppError> {
    check_path(path)?;
    let absolute = std::path::absolute(path).map_err(|e| error("BACKUP_PATH", e, path))?;
    let parent = absolute
        .parent()
        .ok_or_else(|| error("WRITE", "Missing parent directory", path))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| error("WRITE", e, path))?;
    let mut expected_new = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let count = input
            .read(&mut buffer)
            .map_err(|e| error("WRITE", e, path))?;
        if count == 0 {
            break;
        }
        temp.write_all(&buffer[..count])
            .map_err(|e| error("WRITE", e, path))?;
        expected_new.update(&buffer[..count]);
    }
    temp.as_file()
        .sync_all()
        .map_err(|e| error("WRITE", e, path))?;
    temp.seek(SeekFrom::Start(0))
        .map_err(|e| error("WRITE", e, path))?;
    let (actual, _) = hash_reader(&mut temp, path)?;
    if actual != format!("{:x}", expected_new.finalize()) {
        return Err(error(
            "WRITE_VERIFY",
            "Temporary file verification failed; original preserved",
            path,
        ));
    }
    if target_hash(path)?.as_deref() != expected_sha256 {
        return Err(error(
            "WRITE_STALE",
            "File changed before replacement; original preserved",
            path,
        ));
    }
    if let Ok(meta) = fs::metadata(path) {
        temp.as_file()
            .set_permissions(meta.permissions())
            .map_err(|e| error("WRITE", e, path))?;
    }
    check_path(path)?;
    temp.persist(path)
        .map_err(|e| error("WRITE", e.error, path))?;
    Ok(())
}
