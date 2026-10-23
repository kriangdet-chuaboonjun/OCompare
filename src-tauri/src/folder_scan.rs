use crate::{
    error::AppError,
    folders::{EntryMetadata, FolderComparison, FolderEntry, FolderStatus as S, FolderSummary},
};
use std::{
    collections::BTreeMap,
    fs::{self, File, Metadata},
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::UNIX_EPOCH,
};

const CHUNK: usize = 64 * 1024;

struct LocalEntry {
    metadata: Option<Metadata>,
    info: EntryMetadata,
    error: Option<String>,
}

struct Scan<'a> {
    options: &'a crate::folders::FolderCompareOptions,
    regex: crate::comparison_rules::CompiledRules,
    cancel: &'a AtomicBool,
    progress: &'a mut dyn FnMut(u64),
    visited: u64,
    entries: Vec<FolderEntry>,
}

/// คืน path ที่อ่านได้บน Windows โดยยังเก็บ PathBuf จริงไว้สำหรับ filesystem
fn display(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).into()
    }
}

fn check_cancel(cancel: &AtomicBool) -> Result<(), AppError> {
    if cancel.load(Ordering::SeqCst) {
        Err(AppError::new(
            "CANCELED",
            "Folder comparison canceled",
            None,
        ))
    } else {
        Ok(())
    }
}

fn name_key(name: &str) -> String {
    if cfg!(windows) {
        name.to_lowercase()
    } else {
        name.into()
    }
}

fn kind(metadata: &Metadata) -> &'static str {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return "symlink";
        }
    }
    if metadata.file_type().is_symlink() {
        "symlink"
    } else if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        "file"
    } else {
        "other"
    }
}

fn list(
    path: Option<&Path>,
    cancel: &AtomicBool,
) -> Result<BTreeMap<String, Vec<LocalEntry>>, AppError> {
    let mut result: BTreeMap<String, Vec<LocalEntry>> = BTreeMap::new();
    let Some(path) = path else {
        return Ok(result);
    };
    let listing = fs::read_dir(path).map_err(|e| AppError::new("FOLDER_READ", e, Some(path)))?;
    for item in listing {
        check_cancel(cancel)?;
        let item = item.map_err(|e| AppError::new("FOLDER_READ", e, Some(path)))?;
        let name = item.file_name();
        let invalid_name = name.to_str().is_none();
        let name = name.to_string_lossy().into_owned();
        let metadata = fs::symlink_metadata(item.path());
        let error = if invalid_name {
            Some("Filename cannot be represented as Unicode".into())
        } else {
            metadata.as_ref().err().map(ToString::to_string)
        };
        let info = EntryMetadata {
            path: display(&item.path()),
            name: name.clone(),
            kind: metadata.as_ref().map_or("other", kind).into(),
            size: metadata.as_ref().map_or(0, |m| m.len()),
            mtime_ms: metadata
                .as_ref()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0.0, |d| d.as_secs_f64() * 1000.0),
            size_partial: false,
        };
        result.entry(name_key(&name)).or_default().push(LocalEntry {
            metadata: metadata.ok(),
            info,
            error,
        });
    }
    Ok(result)
}

fn unchanged(path: &Path, expected: &Metadata) -> bool {
    fs::metadata(path).is_ok_and(|actual| {
        actual.len() == expected.len() && actual.modified().ok() == expected.modified().ok()
    })
}

/// เทียบ bytes แบบ streaming และไม่ยืนยัน Identical หากไฟล์เปลี่ยนระหว่างอ่าน
fn content_equal(
    left: &LocalEntry,
    right: &LocalEntry,
    cancel: &AtomicBool,
) -> Result<bool, AppError> {
    let lp = Path::new(&left.info.path);
    let rp = Path::new(&right.info.path);
    let lm = left
        .metadata
        .as_ref()
        .expect("metadata checked before comparing");
    let rm = right
        .metadata
        .as_ref()
        .expect("metadata checked before comparing");
    let changed = || {
        AppError::new(
            "CHANGED_DURING_COMPARE",
            "Changed during comparison; refresh to retry",
            None,
        )
    };
    if !unchanged(lp, lm) || !unchanged(rp, rm) {
        return Err(changed());
    }
    if lm.len() != rm.len() {
        return Ok(false);
    }
    let mut lf = File::open(lp).map_err(|e| AppError::new("READ", e, Some(lp)))?;
    let mut rf = File::open(rp).map_err(|e| AppError::new("READ", e, Some(rp)))?;
    let mut lb = vec![0; CHUNK];
    let mut rb = vec![0; CHUNK];
    let mut remaining = lm.len();
    let mut equal = true;
    while remaining > 0 {
        check_cancel(cancel)?;
        let length = remaining.min(CHUNK as u64) as usize;
        lf.read_exact(&mut lb[..length])
            .map_err(|e| AppError::new("READ", e, Some(lp)))?;
        rf.read_exact(&mut rb[..length])
            .map_err(|e| AppError::new("READ", e, Some(rp)))?;
        if lb[..length] != rb[..length] {
            equal = false;
            break;
        }
        remaining -= length as u64;
    }
    if !unchanged(lp, lm) || !unchanged(rp, rm) {
        return Err(changed());
    }
    Ok(equal)
}

fn aggregate(current: S, child: S) -> S {
    if current == S::Error || child == S::Error {
        S::Error
    } else if current == S::Skipped || child == S::Skipped {
        S::Skipped
    } else if !matches!(current, S::Identical | S::Minor)
        || !matches!(child, S::Identical | S::Minor)
    {
        S::Different
    } else if current == S::Minor || child == S::Minor {
        S::Minor
    } else {
        S::Identical
    }
}

fn minor_equal(
    left: &LocalEntry,
    right: &LocalEntry,
    options: &crate::folders::FolderCompareOptions,
    regex: &crate::comparison_rules::CompiledRules,
) -> Result<bool, String> {
    if !options.ignore_eol
        && !options.ignore_whitespace
        && !options.regex_rules.iter().any(|r| r.enabled)
    {
        return Ok(false);
    }
    if left.info.size > 10 * 1024 * 1024 || right.info.size > 10 * 1024 * 1024 {
        return Err("Minor check limited to 10 MiB per file".into());
    }
    let normalize = |path: &str| -> Result<(String, String, bool), String> {
        let mut bytes = Vec::new();
        File::open(path)
            .and_then(|f| f.take(10 * 1024 * 1024 + 1).read_to_end(&mut bytes))
            .map_err(|e| format!("Minor check unavailable: {e}"))?;
        if bytes.len() > 10 * 1024 * 1024 {
            return Err("Minor check limited to 10 MiB per file".into());
        }
        let (text, encoding, bom) =
            crate::encoding::decode(&bytes).map_err(|e| format!("Minor check unavailable: {e}"))?;
        if text
            .chars()
            .any(|c| c <= '\u{8}' || matches!(c, '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}'))
        {
            return Err("Binary file; Minor not checked".into());
        }
        let text = regex.normalize(&text).text;
        let text = if options.ignore_eol {
            text.replace("\r\n", "\n")
        } else {
            text
        };
        let normalized = if options.ignore_whitespace {
            text.chars().filter(|c| !matches!(c, ' ' | '\t')).collect()
        } else {
            text
        };
        Ok((normalized, encoding, bom))
    };
    let l = normalize(&left.info.path)?;
    let r = normalize(&right.info.path)?;
    if l.1 != r.1 || l.2 != r.2 {
        return Err("Encoding or BOM differs; not a Minor change".into());
    }
    let equal = l.0 == r.0;
    if !unchanged(
        Path::new(&left.info.path),
        left.metadata.as_ref().expect("metadata checked"),
    ) || !unchanged(
        Path::new(&right.info.path),
        right.metadata.as_ref().expect("metadata checked"),
    ) {
        return Err("Changed during Minor check; refresh to retry".into());
    }
    Ok(equal)
}

impl Scan<'_> {
    fn children(
        &mut self,
        left: Option<&Path>,
        right: Option<&Path>,
        parent: &str,
        depth: usize,
    ) -> Result<S, AppError> {
        check_cancel(self.cancel)?;
        if depth > 256 {
            return Err(AppError::new(
                "FOLDER_DEPTH",
                "Directory nesting exceeds 256 levels",
                left.or(right),
            ));
        }
        let mut left_entries = list(left, self.cancel)?;
        let mut right_entries = list(right, self.cancel)?;
        let mut names: Vec<String> = left_entries
            .keys()
            .chain(right_entries.keys())
            .cloned()
            .collect();
        names.sort();
        names.dedup();
        names.sort_by_key(|name| {
            let is_directory = left_entries
                .get(name)
                .into_iter()
                .chain(right_entries.get(name))
                .flatten()
                .any(|e| e.info.kind == "directory");
            (!is_directory, name.clone())
        });
        let mut combined = S::Identical;
        for name in names {
            check_cancel(self.cancel)?;
            let mut ls = left_entries.remove(&name).unwrap_or_default();
            let mut rs = right_entries.remove(&name).unwrap_or_default();
            let ambiguous = ls.len() > 1 || rs.len() > 1;
            let colliding_names = ls
                .iter()
                .chain(&rs)
                .map(|e| e.info.name.clone())
                .collect::<Vec<_>>()
                .join(", ");
            let left = ls.pop();
            let right = rs.pop();
            let first = left
                .as_ref()
                .or(right.as_ref())
                .expect("union of nonempty entry groups");
            let relative = if parent.is_empty() {
                first.info.name.clone()
            } else {
                format!("{parent}/{}", first.info.name)
            };
            let directory = left
                .as_ref()
                .into_iter()
                .chain(right.as_ref())
                .any(|e| e.info.kind == "directory");
            let mut entry = FolderEntry {
                relative_path: relative.clone(),
                kind: if directory {
                    "directory"
                } else {
                    first.info.kind.as_str()
                }
                .into(),
                left: left.as_ref().map(|e| e.info.clone()),
                right: right.as_ref().map(|e| e.info.clone()),
                status: S::Identical,
                error: None,
                minor_reason: None,
            };
            self.visited += 1;
            (self.progress)(self.visited);
            check_cancel(self.cancel)?;
            let local_error = left
                .as_ref()
                .and_then(|e| e.error.clone())
                .or_else(|| right.as_ref().and_then(|e| e.error.clone()));
            let unsafe_kind = left
                .as_ref()
                .into_iter()
                .chain(right.as_ref())
                .any(|e| matches!(e.info.kind.as_str(), "symlink" | "other"));
            let conflict =
                matches!((&left, &right), (Some(l), Some(r)) if l.info.kind != r.info.kind);
            if ambiguous || local_error.is_some() {
                entry.status = S::Error;
                entry.error = Some(local_error.unwrap_or_else(|| {
                    format!("Ambiguous case-insensitive names: {colliding_names}")
                }));
            } else if unsafe_kind {
                entry.status = S::Skipped;
                entry.error =
                    Some("Symbolic link, junction or unsupported entry; not followed".into());
            } else if conflict {
                entry.status = S::Different;
            } else if right.is_none() {
                entry.status = S::LeftOnly;
            } else if left.is_none() {
                entry.status = S::RightOnly;
            } else if let (Some(left), Some(right)) = (&left, &right) {
                if !directory {
                    match content_equal(left, right, self.cancel) {
                        Ok(true) => entry.status = S::Identical,
                        Ok(false) => {
                            entry.status = S::Different;
                            match minor_equal(left, right, self.options, &self.regex) {
                                Ok(true) => entry.status = S::Minor,
                                Ok(false) => {}
                                Err(reason) => entry.minor_reason = Some(reason),
                            }
                        }
                        Err(error) if error.code == "CANCELED" => return Err(error),
                        Err(error) => {
                            entry.status = S::Error;
                            entry.error = Some(error.to_string());
                        }
                    }
                }
            }
            let index = self.entries.len();
            let recurse = directory && !matches!(entry.status, S::Error | S::Skipped);
            self.entries.push(entry);
            if recurse {
                let children_start = self.entries.len();
                let lp = left
                    .as_ref()
                    .filter(|e| e.info.kind == "directory")
                    .map(|e| Path::new(&e.info.path));
                let rp = right
                    .as_ref()
                    .filter(|e| e.info.kind == "directory")
                    .map(|e| Path::new(&e.info.path));
                match self.children(lp, rp, &relative, depth + 1) {
                    Ok(child) => {
                        let status = self.entries[index].status;
                        if child == S::Error || child == S::Skipped || status == S::Identical {
                            self.entries[index].status = child;
                        }
                    }
                    Err(error) if error.code == "CANCELED" => return Err(error),
                    Err(error) => {
                        self.entries[index].status = S::Error;
                        self.entries[index].error = Some(error.to_string());
                    }
                }
                for is_left in [true, false] {
                    let mut size = 0;
                    let mut partial = false;
                    for child in &self.entries[children_start..] {
                        let info = if is_left { &child.left } else { &child.right };
                        if let Some(info) = info {
                            if info.kind == "file" {
                                size += info.size;
                            }
                            if matches!(child.status, S::Error | S::Skipped) {
                                partial = true;
                            }
                        }
                    }
                    partial |= self.entries[index].error.is_some();
                    let info = if is_left {
                        &mut self.entries[index].left
                    } else {
                        &mut self.entries[index].right
                    };
                    if let Some(info) = info {
                        if info.kind == "directory" {
                            info.size = size;
                            info.size_partial = partial;
                        }
                    }
                }
            }
            combined = aggregate(combined, self.entries[index].status);
        }
        Ok(combined)
    }
}

fn root(path: &Path) -> Result<PathBuf, AppError> {
    let path = fs::canonicalize(path).map_err(|e| AppError::new("FOLDER_ROOT", e, Some(path)))?;
    if !path.is_dir() {
        return Err(AppError::new(
            "FOLDER_ROOT",
            "Select a directory",
            Some(&path),
        ));
    }
    Ok(path)
}

pub(crate) fn compare(
    left: &Path,
    right: &Path,
    request_id: &str,
    options: &crate::folders::FolderCompareOptions,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64),
) -> Result<FolderComparison, AppError> {
    check_cancel(cancel)?;
    let left = root(left)?;
    let right = root(right)?;
    let mut scan = Scan {
        options,
        regex: crate::comparison_rules::CompiledRules::compile(&options.regex_rules)
            .map_err(|e| AppError::new("REGEX_RULES", e, None))?,
        cancel,
        progress,
        visited: 0,
        entries: Vec::new(),
    };
    scan.children(Some(&left), Some(&right), "", 0)?;
    check_cancel(cancel)?;
    let mut summary = FolderSummary::default();
    for entry in &scan.entries {
        let is_file = entry
            .left
            .as_ref()
            .into_iter()
            .chain(entry.right.as_ref())
            .any(|e| e.kind == "file");
        if entry.kind == "directory" {
            summary.directories += 1;
        }
        if entry.status == S::Error && entry.error.is_some() {
            summary.errors += 1;
        }
        if entry.status == S::Skipped && entry.error.is_some() {
            summary.skipped += 1;
        }
        if is_file {
            summary.files += 1;
            match entry.status {
                S::Identical => summary.identical += 1,
                S::Minor => summary.minor += 1,
                S::Different => summary.different += 1,
                S::LeftOnly => summary.left_only += 1,
                S::RightOnly => summary.right_only += 1,
                _ => {}
            }
        }
    }
    Ok(FolderComparison {
        request_id: request_id.into(),
        left_path: display(&left),
        right_path: display(&right),
        entries: scan.entries,
        summary,
    })
}
