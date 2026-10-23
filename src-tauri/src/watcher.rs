use crate::error::AppError;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize)]
pub struct WatchEvent {
    pub side: Side,
    #[serde(rename = "documentId")]
    pub document_id: String,
    pub path: String,
    pub generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

type Callback = Arc<dyn Fn(WatchEvent) + Send + Sync>;
type SavedBytes = Arc<Mutex<HashMap<PathBuf, (u64, Arc<Vec<u8>>)>>>;

struct WatchSlot {
    stop: Arc<AtomicBool>,
    target: PathBuf,
}
impl Drop for WatchSlot {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

#[derive(Default)]
pub struct WatchService {
    slots: Mutex<HashMap<String, WatchSlot>>,
    generation: AtomicU64,
    own_writes: SavedBytes,
}

/// ใช้ absolute path โดยไม่บังคับให้ไฟล์ยังมีอยู่ตอนถูกลบหรือแทนที่
pub fn absolute_path(path: &Path) -> Result<PathBuf, AppError> {
    let absolute = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()
            .map_err(|e| AppError::new("PATH", e, Some(path)))?
            .join(path)
    };
    // Canonicalize parent เท่านั้น เพื่อให้ไฟล์ที่ถูก replace ยังใช้ key เดิม
    let parent = absolute
        .parent()
        .ok_or_else(|| AppError::new("PATH", "Missing parent directory", Some(path)))?;
    let parent = fs::canonicalize(parent).map_err(|e| AppError::new("PATH", e, Some(path)))?;
    Ok(parent.join(
        absolute
            .file_name()
            .ok_or_else(|| AppError::new("PATH", "Missing filename", Some(path)))?,
    ))
}

fn watch_key(path: &Path) -> Result<PathBuf, AppError> {
    let path = absolute_path(path)?;
    #[cfg(windows)]
    {
        Ok(PathBuf::from(path.to_string_lossy().to_lowercase()))
    }
    #[cfg(not(windows))]
    {
        Ok(path)
    }
}

impl WatchService {
    pub fn record_save(&self, path: &Path, bytes: Vec<u8>) {
        if let Ok(key) = watch_key(path) {
            if let (Ok(slots), Ok(mut saved)) = (self.slots.lock(), self.own_writes.lock()) {
                saved.retain(|path, _| slots.values().any(|slot| &slot.target == path));
                let sequence = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
                saved.insert(key, (sequence, Arc::new(bytes)));
            }
        }
    }

    /// เปลี่ยน watcher เป็นรุ่นใหม่ และให้ worker เดิมหยุดก่อนส่ง event ที่ค้างอยู่
    pub fn watch(
        &self,
        side: Side,
        path: Option<PathBuf>,
        callback: Callback,
    ) -> Result<u64, AppError> {
        self.watch_document(format!("{side:?}"), side, path, callback)
    }

    /// Document identity stays stable while the user switches comparison tabs.
    pub fn watch_document(
        &self,
        document_id: String,
        side: Side,
        path: Option<PathBuf>,
        callback: Callback,
    ) -> Result<u64, AppError> {
        let mut slots = self
            .slots
            .lock()
            .map_err(|e| AppError::new("WATCH", e, None))?;
        slots.remove(&document_id);
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let Some(path) = path else {
            return Ok(generation);
        };
        let target = watch_key(&path)?;
        let (tx, rx) = mpsc::channel();
        let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |event| {
            let _ = tx.send(event);
        })
        .map_err(|e| AppError::new("WATCH", e, Some(&path)))?;
        watcher
            .watch(
                target.parent().expect("absolute_path has parent"),
                RecursiveMode::NonRecursive,
            )
            .map_err(|e| AppError::new("WATCH", e, Some(&path)))?;
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let saved = self.own_writes.clone();
        let mut previous = fs::read(&target).ok();
        let mut seen_save = saved
            .lock()
            .ok()
            .and_then(|map| map.get(&target).map(|(sequence, _)| *sequence));
        let slot_target = target.clone();
        let event_document_id = document_id.clone();
        thread::spawn(move || {
            let _watcher = watcher;
            let mut changed: Option<Instant> = None;
            let mut error: Option<String> = None;
            while !worker_stop.load(Ordering::SeqCst) {
                match rx.recv_timeout(Duration::from_millis(30)) {
                    Ok(Ok(event)) => {
                        // Access events มาจากการอ่านของเราเอง ไม่ควรสร้าง reload loop
                        if !matches!(event.kind, notify::EventKind::Access(_))
                            && event
                                .paths
                                .iter()
                                .any(|p| watch_key(p).is_ok_and(|p| p == target))
                        {
                            changed = Some(Instant::now());
                        }
                    }
                    Ok(Err(err)) => {
                        error = Some(err.to_string());
                        changed = Some(Instant::now());
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if changed.is_some_and(|when| when.elapsed() >= Duration::from_millis(200)) {
                    changed = None;
                    let current = fs::read(&target).ok();
                    let ours = saved.lock().ok().and_then(|map| map.get(&target).cloned());
                    let sequence = ours.as_ref().map(|(sequence, _)| *sequence);
                    let own_bytes = current.as_ref().is_some_and(|bytes| {
                        ours.as_ref()
                            .is_some_and(|(_, saved)| bytes.as_slice() == saved.as_slice())
                    });
                    let should_emit = error.is_some()
                        || (current != previous && !(own_bytes && sequence != seen_save));
                    seen_save = sequence;
                    previous = current;
                    if should_emit && !worker_stop.load(Ordering::SeqCst) {
                        callback(WatchEvent {
                            side,
                            document_id: event_document_id.clone(),
                            path: path.to_string_lossy().into_owned(),
                            generation,
                            error: error.take(),
                        });
                    }
                }
            }
        });
        slots.insert(
            document_id,
            WatchSlot {
                stop,
                target: slot_target,
            },
        );
        Ok(generation)
    }
}
