//! Serializes app writes/history transactions; recovery never prevents read-only comparisons.
use crate::{
    backups::{atomic_replace, BackupStore},
    error::AppError,
    fileio::{file_stat, FileStat},
};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
pub struct WriteService {
    state: Mutex<BackupStore>,
    lock_path: PathBuf,
}
impl WriteService {
    pub fn new(root: PathBuf) -> Self {
        Self {
            lock_path: root.with_extension("lock"),
            state: Mutex::new(BackupStore::new(root)),
        }
    }
    pub fn with_store<T>(
        &self,
        work: impl FnOnce(&BackupStore) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let state = self
            .state
            .lock()
            .map_err(|e| AppError::new("WRITE_STATE", e, None))?;
        if let Some(parent) = self.lock_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::new("WRITE_LOCK", e, Some(parent)))?;
        }
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&self.lock_path)
            .map_err(|e| AppError::new("WRITE_LOCK", e, Some(&self.lock_path)))?;
        lock.lock()
            .map_err(|e| AppError::new("WRITE_LOCK", e, Some(&self.lock_path)))?;
        // The OS lock prevents another app instance from recovering a live transaction.
        state.recover_pending()?;
        work(&state)
    }
    pub fn save(&self, path: &Path, bytes: &[u8]) -> Result<FileStat, AppError> {
        self.with_store(|store| {
            if std::fs::read(path).is_ok_and(|old| old == bytes) {
                return file_stat(path);
            }
            let prepared = store.prepare(path, "Save")?;
            let expected = prepared.as_ref().map(|p| p.entry().sha256.as_str());
            atomic_replace(path, bytes, expected)?;
            if let Some(prepared) = prepared {
                prepared.commit()?;
            }
            file_stat(path)
        })
    }
}
