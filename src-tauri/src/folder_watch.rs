//! Debounced, notification-only folder watches. They never initiate file writes.
use crate::error::AppError;
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderWatchEvent {
    pub generation: u64,
    pub error: Option<String>,
}

struct Slot(Arc<AtomicBool>);
impl Drop for Slot {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

#[derive(Default)]
pub struct FolderWatchService {
    slot: Mutex<Option<Slot>>,
    generation: AtomicU64,
}

impl FolderWatchService {
    pub fn stop(&self) -> Result<(), AppError> {
        self.slot
            .lock()
            .map_err(|e| AppError::new("FOLDER_WATCH", e, None))?
            .take();
        Ok(())
    }

    pub fn watch(
        &self,
        roots: Vec<PathBuf>,
        callback: Arc<dyn Fn(FolderWatchEvent) + Send + Sync>,
    ) -> Result<u64, AppError> {
        let mut slot = self
            .slot
            .lock()
            .map_err(|e| AppError::new("FOLDER_WATCH", e, None))?;
        slot.take();
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = mpsc::channel();
        let mut watcher = RecommendedWatcher::new(
            move |event| {
                let _ = tx.send(event);
            },
            Config::default().with_follow_symlinks(false),
        )
        .map_err(|e| AppError::new("FOLDER_WATCH", e, None))?;
        for root in roots {
            if !root.is_dir() {
                return Err(AppError::new(
                    "FOLDER_WATCH",
                    "Folder does not exist; press Refresh after fixing the path",
                    Some(&root),
                ));
            }
            watcher
                .watch(&root, RecursiveMode::Recursive)
                .map_err(|e| AppError::new("FOLDER_WATCH", e, Some(&root)))?;
        }
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        thread::spawn(move || {
            let _watcher = watcher;
            let mut last = None;
            let mut first = None;
            let mut error = None;
            while !worker_stop.load(Ordering::SeqCst) {
                match rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(Ok(event)) if !matches!(event.kind, EventKind::Access(_)) => {
                        if std::env::var_os("O_COMPARE_WATCH_TRACE").is_some() {
                            eprintln!("Folder watch event: {event:?}");
                        }
                        // Windows reports directory Modify(Any) while a scanner reads it.
                        // Structural create/remove/rename and all file writes remain significant.
                        if !event.need_rescan()
                            && !event.paths.is_empty()
                            && matches!(
                                event.kind,
                                EventKind::Modify(
                                    notify::event::ModifyKind::Any
                                        | notify::event::ModifyKind::Metadata(_)
                                        | notify::event::ModifyKind::Data(_)
                                )
                            )
                            && event.paths.iter().all(|path| path.is_dir())
                        {
                            continue;
                        }
                        let now = Instant::now();
                        first.get_or_insert(now);
                        last = Some(now);
                        if event.need_rescan() {
                            error = Some("Watcher events were lost; press Refresh".into());
                        }
                    }
                    Ok(Err(e)) => {
                        error = Some(e.to_string());
                        last = Some(Instant::now());
                        first.get_or_insert(Instant::now());
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    _ => {}
                }
                if last.is_some_and(|v| v.elapsed() >= Duration::from_millis(500))
                    || first.is_some_and(|v| v.elapsed() >= Duration::from_secs(2))
                {
                    last = None;
                    first = None;
                    if !worker_stop.load(Ordering::SeqCst) {
                        callback(FolderWatchEvent {
                            generation,
                            error: error.take(),
                        });
                    }
                }
            }
        });
        *slot = Some(Slot(stop));
        Ok(generation)
    }
}
