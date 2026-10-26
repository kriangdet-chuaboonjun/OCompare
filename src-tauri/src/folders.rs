use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FolderStatus {
    Identical,
    Minor,
    Different,
    LeftOnly,
    RightOnly,
    Error,
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryMetadata {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
    pub mtime_ms: f64,
    pub size_partial: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub relative_path: String,
    pub kind: String,
    pub left: Option<EntryMetadata>,
    pub right: Option<EntryMetadata>,
    pub status: FolderStatus,
    pub error: Option<String>,
    pub minor_reason: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSummary {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderComparison {
    pub request_id: String,
    pub left_path: String,
    pub right_path: String,
    pub entries: Vec<FolderEntry>,
    pub summary: FolderSummary,
}

pub fn compare_folders(
    left: &Path,
    right: &Path,
    request_id: &str,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64),
) -> Result<FolderComparison, AppError> {
    compare_with_options(
        left,
        right,
        request_id,
        &FolderCompareOptions::default(),
        cancel,
        progress,
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FolderCompareOptions {
    pub ignore_whitespace: bool,
    pub ignore_eol: bool,
    pub regex_rules: Vec<crate::comparison_rules::RegexRule>,
    /// Root-relative folder paths (`src/generated`) skipped on both sides, with their subtrees.
    pub ignored_folders: Vec<String>,
}
impl Default for FolderCompareOptions {
    fn default() -> Self {
        Self {
            ignore_whitespace: true,
            ignore_eol: true,
            regex_rules: vec![],
            ignored_folders: vec![],
        }
    }
}

const MAX_IGNORED_FOLDERS: usize = 1000;

/// Comparison key for a root-relative path; Windows paths are case-insensitive.
pub(crate) fn path_key(path: &str) -> String {
    if cfg!(windows) {
        path.to_lowercase()
    } else {
        path.into()
    }
}

/// Accept only clean `a/b` paths inside the root: no absolute paths, drive letters, `..` or empty parts.
pub fn validate_ignored_folders(paths: &[String]) -> Result<HashSet<String>, AppError> {
    let invalid = |path: &str, why: &str| {
        AppError::new(
            "IGNORED_FOLDER",
            format!("Invalid ignored folder “{path}”: {why}"),
            None,
        )
    };
    if paths.len() > MAX_IGNORED_FOLDERS {
        return Err(AppError::new("IGNORED_FOLDER", "Too many ignored folders", None));
    }
    let mut keys = HashSet::new();
    for path in paths {
        if path.is_empty() || path.len() > 4096 {
            return Err(invalid(path, "empty or too long"));
        }
        if path.starts_with('/') || path.contains(['\\', ':', '\0']) {
            return Err(invalid(path, "must be a relative path using /"));
        }
        if path.split('/').any(|part| matches!(part, "" | "." | "..")) {
            return Err(invalid(path, "must stay inside the comparison root"));
        }
        keys.insert(path_key(path));
    }
    Ok(keys)
}

pub fn compare_with_options(
    left: &Path,
    right: &Path,
    request_id: &str,
    options: &FolderCompareOptions,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64),
) -> Result<FolderComparison, AppError> {
    crate::folder_scan::compare(left, right, request_id, options, cancel, progress)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum JobKind {
    Compare,
    Copy,
}

/// Jobs are keyed by request ID so tabs never cancel each other. Copy is exclusive app-wide.
#[derive(Default)]
pub struct FolderJobs {
    active: Mutex<HashMap<String, (JobKind, Arc<AtomicBool>)>>,
}

impl FolderJobs {
    pub fn begin(&self, id: &str) -> Result<Arc<AtomicBool>, AppError> {
        self.start(id, JobKind::Compare)
    }

    /// Planning and executing a copy need every other folder job to be idle.
    pub fn begin_copy(&self, id: &str) -> Result<Arc<AtomicBool>, AppError> {
        self.start(id, JobKind::Copy)
    }

    fn start(&self, id: &str, kind: JobKind) -> Result<Arc<AtomicBool>, AppError> {
        let mut active = self
            .active
            .lock()
            .map_err(|e| AppError::new("FOLDER_JOB", e, None))?;
        if active.contains_key(id) {
            return Err(AppError::new("FOLDER_JOB", "Request is already running", None));
        }
        if active.values().any(|(k, _)| *k == JobKind::Copy) {
            return Err(AppError::new(
                "FOLDER_JOB",
                "A copy is running; wait for it to finish",
                None,
            ));
        }
        if kind == JobKind::Copy && !active.is_empty() {
            return Err(AppError::new(
                "FOLDER_JOB",
                "Wait for running comparisons to finish before copying",
                None,
            ));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        active.insert(id.into(), (kind, cancel.clone()));
        Ok(cancel)
    }

    pub fn cancel(&self, id: &str) -> Result<(), AppError> {
        let active = self
            .active
            .lock()
            .map_err(|e| AppError::new("FOLDER_JOB", e, None))?;
        if let Some((_, flag)) = active.get(id) {
            flag.store(true, Ordering::SeqCst);
        }
        Ok(())
    }

    pub fn finish(&self, id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(id);
        }
    }
}
