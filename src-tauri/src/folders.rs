use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::{
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
}
impl Default for FolderCompareOptions {
    fn default() -> Self {
        Self {
            ignore_whitespace: true,
            ignore_eol: true,
            regex_rules: vec![],
        }
    }
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

/// หน้าต่างหนึ่งมีงานล่าสุดหนึ่งงาน ยกเลิก request เก่าโดยไม่กระทบงานใหม่
#[derive(Default)]
pub struct FolderJobs {
    active: Mutex<Option<(String, Arc<AtomicBool>)>>,
}

impl FolderJobs {
    pub fn begin(&self, id: &str) -> Result<Arc<AtomicBool>, AppError> {
        let mut active = self
            .active
            .lock()
            .map_err(|e| AppError::new("FOLDER_JOB", e, None))?;
        if let Some((_, cancel)) = active.take() {
            cancel.store(true, Ordering::SeqCst);
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *active = Some((id.into(), cancel.clone()));
        Ok(cancel)
    }

    pub fn cancel(&self, id: &str) -> Result<(), AppError> {
        let active = self
            .active
            .lock()
            .map_err(|e| AppError::new("FOLDER_JOB", e, None))?;
        if let Some((current, flag)) = &*active {
            if current == id {
                flag.store(true, Ordering::SeqCst);
            }
        }
        Ok(())
    }

    pub fn finish(&self, id: &str) {
        if let Ok(mut active) = self.active.lock() {
            if active.as_ref().is_some_and(|(current, _)| current == id) {
                *active = None;
            }
        }
    }
}
