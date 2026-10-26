use crate::{
    error::AppError,
    folders::{compare_with_options, FolderCompareOptions, FolderStatus},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, FileTimes, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::SystemTime,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyItem {
    pub relative_path: String,
    pub source: String,
    pub destination: String,
    pub size: u64,
    pub action: String,
    pub reason: Option<String>,
    pub directory: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyPlan {
    pub plan_id: String,
    pub items: Vec<CopyItem>,
    pub bytes: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOutcome {
    pub relative_path: String,
    pub status: String,
    pub message: String,
}
#[derive(Debug, Serialize)]
pub struct CopyReport {
    pub items: Vec<CopyOutcome>,
    pub canceled: bool,
}
#[derive(Debug, Clone, PartialEq, Eq)]
struct Fingerprint {
    size: u64,
    modified: Option<SystemTime>,
    hash: Vec<u8>,
    directory: bool,
}
struct StoredPlan {
    preview: CopyPlan,
    source_root: PathBuf,
    destination_root: PathBuf,
    checks: HashMap<String, (Option<Fingerprint>, Option<Fingerprint>)>,
}
#[derive(Default)]
pub struct CopyService {
    plan: Mutex<Option<StoredPlan>>,
}
fn err(code: &str, e: impl ToString, path: &Path) -> AppError {
    AppError::new(code, e, Some(path))
}
fn check(cancel: &AtomicBool) -> Result<(), AppError> {
    if cancel.load(Ordering::SeqCst) {
        Err(AppError::new("CANCELED", "Copy canceled", None))
    } else {
        Ok(())
    }
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
fn open_read(path: &Path) -> Result<File, AppError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1).custom_flags(0x00200000);
    }
    let file = options.open(path).map_err(|e| err("COPY_READ", e, path))?;
    if is_link(&file.metadata().map_err(|e| err("COPY_STAT", e, path))?) {
        return Err(err("COPY_LINK", "Reparse points are not followed", path));
    }
    Ok(file)
}
fn fingerprint(path: &Path, cancel: &AtomicBool) -> Result<Option<Fingerprint>, AppError> {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(err("COPY_STAT", e, path)),
    };
    if is_link(&meta) || (!meta.is_dir() && !meta.is_file()) {
        return Err(err(
            "COPY_LINK",
            "Link or unsupported entry; not followed",
            path,
        ));
    }
    if meta.is_dir() {
        return Ok(Some(Fingerprint {
            size: 0,
            modified: None,
            hash: vec![],
            directory: true,
        }));
    }
    let mut file = open_read(path)?;
    let mut hash = Sha256::new();
    let mut buf = [0; 65536];
    loop {
        check(cancel)?;
        let n = file.read(&mut buf).map_err(|e| err("COPY_READ", e, path))?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    let after = file.metadata().map_err(|e| err("COPY_STAT", e, path))?;
    if meta.len() != after.len() || meta.modified().ok() != after.modified().ok() {
        return Err(err("COPY_STALE", "Changed while reading; refresh", path));
    }
    Ok(Some(Fingerprint {
        size: meta.len(),
        modified: meta.modified().ok(),
        hash: hash.finalize().to_vec(),
        directory: false,
    }))
}
fn root_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}
fn safe_path(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let root_meta = fs::symlink_metadata(root).map_err(|e| err("COPY_ROOT", e, root))?;
    if is_link(&root_meta) || !root_meta.is_dir() {
        return Err(err(
            "COPY_LINK",
            "Copy root changed or became a junction",
            root,
        ));
    }
    let rel = Path::new(relative);
    if relative.is_empty()
        || relative.contains('\\')
        || relative.contains(':')
        || rel.components().any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(err("COPY_PATH", "Invalid relative path", rel));
    }
    // Recheck every existing component, including destination parents created since preview.
    let mut path = root.to_path_buf();
    for part in rel.components() {
        path.push(part.as_os_str());
        match fs::symlink_metadata(&path) {
            Ok(m) if is_link(&m) => {
                return Err(err("COPY_LINK", "Link or junction in copy path", &path))
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(err("COPY_STAT", e, &path)),
        }
    }
    Ok(path)
}
impl CopyService {
    pub fn discard(&self, id: &str) -> Result<(), AppError> {
        let mut slot = self
            .plan
            .lock()
            .map_err(|e| AppError::new("COPY_STATE", e, None))?;
        if slot.as_ref().is_some_and(|p| p.preview.plan_id == id) {
            *slot = None;
        }
        Ok(())
    }
    pub fn plan(
        &self,
        left: &Path,
        right: &Path,
        direction: &str,
        paths: &[String],
        cancel: &AtomicBool,
    ) -> Result<CopyPlan, AppError> {
        self.plan_with_ignored(left, right, direction, paths, &[], cancel)
    }
    /// Ignored folders are excluded from the preview scan, so copying a parent never includes them.
    pub fn plan_with_ignored(
        &self,
        left: &Path,
        right: &Path,
        direction: &str,
        paths: &[String],
        ignored_folders: &[String],
        cancel: &AtomicBool,
    ) -> Result<CopyPlan, AppError> {
        if !matches!(direction, "left" | "right") {
            return Err(AppError::new("COPY_DIRECTION", "Invalid direction", None));
        }
        let left = fs::canonicalize(left).map_err(|e| err("COPY_ROOT", e, left))?;
        let right = fs::canonicalize(right).map_err(|e| err("COPY_ROOT", e, right))?;
        let lk = root_key(&left);
        let rk = root_key(&right);
        if lk == rk || lk.starts_with(&(rk.clone() + "\\")) || rk.starts_with(&(lk + "\\")) {
            return Err(AppError::new(
                "COPY_ROOT",
                "Copy roots must be separate, non-overlapping directories",
                None,
            ));
        }
        let options = FolderCompareOptions {
            ignored_folders: ignored_folders.to_vec(),
            ..Default::default()
        };
        let result = compare_with_options(
            &left,
            &right,
            "copy-preview",
            &options,
            cancel,
            &mut |_| {},
        )?;
        let (source_root, destination_root) = if direction == "left" {
            (left, right)
        } else {
            (right, left)
        };
        let requested: HashSet<_> = paths.iter().cloned().collect();
        let available: HashSet<_> = result
            .entries
            .iter()
            .map(|e| e.relative_path.clone())
            .collect();
        if requested.iter().any(|p| !available.contains(p)) {
            return Err(AppError::new(
                "COPY_PATH",
                "Selection is stale or outside comparison; refresh",
                None,
            ));
        }
        let mut items = Vec::new();
        let mut checks = HashMap::new();
        let mut bytes = 0;
        for entry in result
            .entries
            .iter()
            .filter(|e| requested.contains(&e.relative_path))
        {
            check(cancel)?;
            let relative = &entry.relative_path;
            let source = if direction == "left" {
                &entry.left
            } else {
                &entry.right
            };
            let destination = if direction == "left" {
                &entry.right
            } else {
                &entry.left
            };
            let source_path = source
                .as_ref()
                .map(|i| PathBuf::from(&i.path))
                .unwrap_or_else(|| source_root.join(relative));
            let destination_path = destination
                .as_ref()
                .map(|i| PathBuf::from(&i.path))
                .unwrap_or_else(|| destination_root.join(relative));
            let mut item = CopyItem {
                relative_path: relative.clone(),
                source: source_path.to_string_lossy().into(),
                destination: destination_path.to_string_lossy().into(),
                size: source
                    .as_ref()
                    .map_or(0, |m| if m.kind == "file" { m.size } else { 0 }),
                action: "create".into(),
                reason: None,
                directory: source.as_ref().is_some_and(|i| i.kind == "directory"),
            };
            let reason = if source.is_none() {
                Some("No source on selected side".into())
            } else if matches!(entry.status, FolderStatus::Error | FolderStatus::Skipped) {
                Some(
                    entry
                        .error
                        .clone()
                        .unwrap_or_else(|| "Unsupported entry".into()),
                )
            } else if destination
                .as_ref()
                .is_some_and(|d| d.kind != source.as_ref().unwrap().kind)
            {
                Some("File/directory conflict; not replaced".into())
            } else {
                None
            };
            let pair = if reason.is_none() {
                match (
                    safe_path(&source_root, relative)
                        .and_then(|_| fingerprint(&source_path, cancel)),
                    safe_path(&destination_root, relative)
                        .and_then(|_| fingerprint(&destination_path, cancel)),
                ) {
                    (Ok(a), Ok(b)) => Some((a, b)),
                    (Err(e), _) | (_, Err(e)) => {
                        if e.code == "CANCELED" {
                            return Err(e);
                        }
                        item.reason = Some(e.to_string());
                        None
                    }
                }
            } else {
                item.reason = reason;
                None
            };
            if let Some((a, b)) = pair {
                if a.as_ref().is_some_and(|a| !a.directory)
                    && a.as_ref()
                        .zip(b.as_ref())
                        .is_some_and(|(a, b)| a.hash == b.hash)
                {
                    item.reason = Some("Identical bytes".into());
                }
                if item.reason.is_none() {
                    item.action = if b.is_some() { "overwrite" } else { "create" }.into();
                    bytes += item.size;
                    checks.insert(relative.clone(), (a, b));
                }
            }
            if item.reason.is_some() {
                item.action = "skip".into();
            }
            items.push(item);
        }
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let preview = CopyPlan {
            plan_id: format!(
                "{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ),
            items,
            bytes,
        };
        *self
            .plan
            .lock()
            .map_err(|e| AppError::new("COPY_STATE", e, None))? = Some(StoredPlan {
            preview: preview.clone(),
            source_root,
            destination_root,
            checks,
        });
        Ok(preview)
    }
    pub fn execute(
        &self,
        id: &str,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(usize, usize, &str),
    ) -> Result<CopyReport, AppError> {
        self.execute_inner(id, cancel, progress, None)
    }
    pub fn execute_with_backups(
        &self,
        id: &str,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(usize, usize, &str),
        backups: &crate::backups::BackupStore,
    ) -> Result<CopyReport, AppError> {
        self.execute_inner(id, cancel, progress, Some(backups))
    }
    fn execute_inner(
        &self,
        id: &str,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(usize, usize, &str),
        backups: Option<&crate::backups::BackupStore>,
    ) -> Result<CopyReport, AppError> {
        let plan = {
            let mut slot = self
                .plan
                .lock()
                .map_err(|e| AppError::new("COPY_STATE", e, None))?;
            if !slot.as_ref().is_some_and(|p| p.preview.plan_id == id) {
                return Err(AppError::new(
                    "COPY_PLAN",
                    "Copy plan expired; preview again",
                    None,
                ));
            }
            slot.take().unwrap()
        };
        let mut report = CopyReport {
            items: vec![],
            canceled: false,
        };
        for item in &plan.preview.items {
            if cancel.load(Ordering::SeqCst) {
                report.canceled = true;
                break;
            }
            let outcome = if item.action == "skip" {
                CopyOutcome {
                    relative_path: item.relative_path.clone(),
                    status: "skipped".into(),
                    message: item.reason.clone().unwrap_or_default(),
                }
            } else {
                match copy_one(&plan, item, cancel, backups) {
                    Ok(()) => CopyOutcome {
                        relative_path: item.relative_path.clone(),
                        status: "copied".into(),
                        message: String::new(),
                    },
                    Err(e) => {
                        if e.code == "CANCELED" {
                            report.canceled = true;
                            break;
                        }
                        CopyOutcome {
                            relative_path: item.relative_path.clone(),
                            status: if matches!(e.code.as_str(), "COPY_STALE" | "COPY_LINK") {
                                "skipped"
                            } else {
                                "failed"
                            }
                            .into(),
                            message: e.to_string(),
                        }
                    }
                }
            };
            report.items.push(outcome);
            progress(
                report.items.len(),
                plan.preview.items.len(),
                &item.relative_path,
            );
        }
        Ok(report)
    }
}
fn copy_one(
    plan: &StoredPlan,
    item: &CopyItem,
    cancel: &AtomicBool,
    backups: Option<&crate::backups::BackupStore>,
) -> Result<(), AppError> {
    let source = Path::new(&item.source);
    let destination = Path::new(&item.destination);
    let (expected_source, expected_destination) = &plan.checks[&item.relative_path];
    safe_path(&plan.source_root, &item.relative_path)?;
    safe_path(&plan.destination_root, &item.relative_path)?;
    let stale = || {
        err(
            "COPY_STALE",
            "Source or destination changed since preview; refresh",
            destination,
        )
    };
    if fingerprint(source, cancel)? != *expected_source
        || fingerprint(destination, cancel)? != *expected_destination
    {
        return Err(stale());
    }
    if item.directory {
        fs::create_dir_all(destination).map_err(|e| err("COPY_WRITE", e, destination))?;
        return Ok(());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| err("COPY_PATH", "Missing parent", destination))?;
    fs::create_dir_all(parent).map_err(|e| err("COPY_WRITE", e, parent))?;
    safe_path(&plan.destination_root, &item.relative_path)?;
    let mut input = open_read(source)?;
    let source_meta = input.metadata().map_err(|e| err("COPY_STAT", e, source))?;
    let mut temp =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| err("COPY_WRITE", e, parent))?;
    let mut hash = Sha256::new();
    let mut buf = [0; 65536];
    loop {
        check(cancel)?;
        let n = input
            .read(&mut buf)
            .map_err(|e| err("COPY_READ", e, source))?;
        if n == 0 {
            break;
        }
        temp.write_all(&buf[..n])
            .map_err(|e| err("COPY_WRITE", e, destination))?;
        hash.update(&buf[..n]);
    }
    let expected = expected_source.as_ref().ok_or_else(stale)?;
    if hash.finalize().as_slice() != expected.hash.as_slice()
        || input
            .metadata()
            .map_err(|e| err("COPY_STAT", e, source))?
            .modified()
            .ok()
            != source_meta.modified().ok()
    {
        return Err(stale());
    }
    temp.as_file()
        .sync_all()
        .map_err(|e| err("COPY_WRITE", e, destination))?;
    temp.as_file_mut()
        .seek(SeekFrom::Start(0))
        .map_err(|e| err("COPY_VERIFY", e, destination))?;
    let mut verified = Sha256::new();
    loop {
        check(cancel)?;
        let n = temp
            .as_file_mut()
            .read(&mut buf)
            .map_err(|e| err("COPY_VERIFY", e, destination))?;
        if n == 0 {
            break;
        }
        verified.update(&buf[..n]);
    }
    if verified.finalize().as_slice() != expected.hash.as_slice() {
        return Err(err(
            "COPY_VERIFY",
            "Temporary copy verification failed; destination preserved",
            destination,
        ));
    }
    if let Some(time) = expected.modified {
        temp.as_file()
            .set_times(FileTimes::new().set_modified(time))
            .map_err(|e| err("COPY_TIME", e, destination))?;
    }
    check(cancel)?;
    safe_path(&plan.destination_root, &item.relative_path)?;
    if fingerprint(destination, cancel)? != *expected_destination {
        return Err(stale());
    }
    let prepared = if item.action == "overwrite" {
        backups
            .map(|store| store.prepare(destination, "Copy"))
            .transpose()?
            .flatten()
    } else {
        None
    };
    if fingerprint(destination, cancel)? != *expected_destination {
        return Err(stale());
    }
    check(cancel)?;
    temp.persist(destination)
        .map_err(|e| err("COPY_WRITE", e.error, destination))?;
    if let Some(prepared) = prepared {
        prepared.commit()?;
    }
    Ok(())
}

pub fn disk_space(path: &Path) -> Result<u64, AppError> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let path = fs::canonicalize(path).map_err(|e| err("DISK_SPACE", e, path))?;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut free = 0;
        // The NUL-terminated buffer and output pointer remain valid for the synchronous call.
        let ok = unsafe {
            windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(err("DISK_SPACE", std::io::Error::last_os_error(), &path));
        }
        Ok(free)
    }
    #[cfg(not(windows))]
    {
        Err(err(
            "DISK_SPACE",
            "Disk space currently supported on Windows",
            path,
        ))
    }
}
