use crate::{
    encoding,
    error::AppError,
    fileio::{self, FileData, FileStat},
    folders::{FolderComparison, FolderJobs},
    watcher::{absolute_path, Side, WatchService},
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Emitter, Manager, State};

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| AppError::new("TASK", e, None))?
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<FileData, AppError> {
    blocking(move || {
        let path = absolute_path(Path::new(&path))?;
        // แสดง path แบบปกติบน Windows ไม่แสดง verbatim prefix จาก canonicalize
        let mut data = fileio::read_text_file(&path)?;
        data.path = display_path(&path);
        Ok(data)
    })
    .await
}

fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
    }
}

/// งาน filesystem ทำใน blocking worker เพื่อไม่ขวาง WebView/main loop
#[tauri::command]
pub async fn compare_folders(
    left_path: String,
    right_path: String,
    request_id: String,
    options: Option<crate::folders::FolderCompareOptions>,
    app: tauri::AppHandle,
    jobs: State<'_, Arc<FolderJobs>>,
) -> Result<FolderComparison, AppError> {
    if request_id.is_empty() || request_id.len() > 128 {
        return Err(AppError::new("FOLDER_JOB", "Invalid request ID", None));
    }
    let jobs = jobs.inner().clone();
    let cancel = jobs.begin(&request_id)?;
    let complete_id = request_id.clone();
    let result = blocking(move || {
        let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
        crate::folders::compare_with_options(
            Path::new(&left_path),
            Path::new(&right_path),
            &request_id,
            &options.unwrap_or_default(),
            &cancel,
            &mut |visited| {
                if last.elapsed() >= std::time::Duration::from_millis(100) {
                    let payload =
                        serde_json::json!({ "requestId": request_id, "visited": visited });
                    if let Err(error) = app.emit_to("main", "folder:progress", payload) {
                        eprintln!("Folder progress event failed: {error}");
                    }
                    last = std::time::Instant::now();
                }
            },
        )
    })
    .await;
    jobs.finish(&complete_id);
    result
}

#[tauri::command]
pub async fn load_folder_sessions(app: tauri::AppHandle) -> Result<serde_json::Value, AppError> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::new("APP_DATA", e, None))?
        .join("folder-sessions.json");
    blocking(move || crate::folder_sessions::load(&path)).await
}
#[tauri::command]
pub async fn save_folder_sessions(
    app: tauri::AppHandle,
    store: serde_json::Value,
) -> Result<(), AppError> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::new("APP_DATA", e, None))?
        .join("folder-sessions.json");
    blocking(move || crate::folder_sessions::save(&path, &store)).await
}
#[tauri::command]
pub async fn folder_disk_space(path: String) -> Result<u64, AppError> {
    blocking(move || crate::folder_copy::disk_space(Path::new(&path))).await
}

#[tauri::command]
pub async fn plan_folder_copy(
    left_path: String,
    right_path: String,
    direction: String,
    paths: Vec<String>,
    request_id: String,
    jobs: State<'_, Arc<FolderJobs>>,
    service: State<'_, Arc<crate::folder_copy::CopyService>>,
) -> Result<crate::folder_copy::CopyPlan, AppError> {
    let jobs = jobs.inner().clone();
    let service = service.inner().clone();
    let cancel = jobs.begin(&request_id)?;
    let id = request_id.clone();
    let result = blocking(move || {
        service.plan(
            Path::new(&left_path),
            Path::new(&right_path),
            &direction,
            &paths,
            &cancel,
        )
    })
    .await;
    jobs.finish(&id);
    result
}
#[tauri::command]
pub async fn execute_folder_copy(
    plan_id: String,
    request_id: String,
    app: tauri::AppHandle,
    jobs: State<'_, Arc<FolderJobs>>,
    service: State<'_, Arc<crate::folder_copy::CopyService>>,
    writes: State<'_, Arc<crate::write_service::WriteService>>,
) -> Result<crate::folder_copy::CopyReport, AppError> {
    let jobs = jobs.inner().clone();
    let service = service.inner().clone();
    let writes = writes.inner().clone();
    let cancel = jobs.begin(&request_id)?;
    let id = request_id.clone();
    let result=blocking(move||{
        let mut last=std::time::Instant::now()-std::time::Duration::from_secs(1);
        writes.with_store(|store| service.execute_with_backups(&plan_id,&cancel,&mut |completed,total,path|{
            if completed==total || last.elapsed()>=std::time::Duration::from_millis(100) {
                let payload=serde_json::json!({"requestId":request_id,"completed":completed,"total":total,"relativePath":path});
                if let Err(e)=app.emit_to("main","folder:copy-progress",payload){eprintln!("Copy progress failed: {e}");}
                last=std::time::Instant::now();
            }
        }, store))
    }).await;
    jobs.finish(&id);
    result
}
#[tauri::command]
pub fn discard_folder_copy(
    plan_id: String,
    service: State<'_, Arc<crate::folder_copy::CopyService>>,
) -> Result<(), AppError> {
    service.discard(&plan_id)
}

#[tauri::command]
pub fn cancel_folder_compare(
    request_id: String,
    jobs: State<'_, Arc<FolderJobs>>,
) -> Result<(), AppError> {
    jobs.cancel(&request_id)
}

#[tauri::command]
pub async fn save_file(
    path: String,
    text: String,
    encoding: String,
    bom: bool,
    service: State<'_, Arc<WatchService>>,
    writes: State<'_, Arc<crate::write_service::WriteService>>,
) -> Result<FileStat, AppError> {
    let service = service.inner().clone();
    let writes = writes.inner().clone();
    blocking(move || {
        let path = Path::new(&path);
        let bytes = encoding::encode(&text, &encoding, bom)?;
        let stat = writes.save(path, &bytes)?;
        service.record_save(path, bytes);
        Ok(stat)
    })
    .await
}

#[tauri::command]
pub async fn watch_file(
    document_id: String,
    path: Option<String>,
    app: tauri::AppHandle,
    service: State<'_, Arc<WatchService>>,
) -> Result<u64, AppError> {
    let service = service.inner().clone();
    blocking(move || {
        service.watch_document(
            document_id,
            Side::Left,
            path.map(PathBuf::from),
            Arc::new(move |event| {
                if let Err(err) = app.emit_to("main", "file:changed", event) {
                    eprintln!("File event failed: {err}");
                }
            }),
        )
    })
    .await
}

#[tauri::command]
pub async fn watch_folders(
    left_path: String,
    right_path: String,
    app: tauri::AppHandle,
    service: State<'_, Arc<crate::folder_watch::FolderWatchService>>,
) -> Result<u64, AppError> {
    let service = service.inner().clone();
    blocking(move || {
        service.watch(
            vec![PathBuf::from(left_path), PathBuf::from(right_path)],
            Arc::new(move |event| {
                if let Err(error) = app.emit_to("main", "folder:changed", event) {
                    eprintln!("Folder watch event: {error}");
                }
            }),
        )
    })
    .await
}

#[tauri::command]
pub fn stop_folder_watch(
    service: State<'_, Arc<crate::folder_watch::FolderWatchService>>,
) -> Result<(), AppError> {
    service.stop()
}

#[tauri::command]
pub async fn validate_comparison_rules(
    rules: Vec<crate::comparison_rules::RegexRule>,
) -> Result<(), AppError> {
    blocking(move || {
        crate::comparison_rules::CompiledRules::compile(&rules)
            .map(|_| ())
            .map_err(|e| AppError::new("REGEX_RULES", e, None))
    })
    .await
}

#[tauri::command]
pub async fn normalize_comparison_pair(
    left: String,
    right: String,
    rules: Vec<crate::comparison_rules::RegexRule>,
) -> Result<crate::comparison_rules::NormalizedPair, AppError> {
    blocking(move || {
        crate::comparison_rules::normalize_pair(&left, &right, &rules)
            .map_err(|e| AppError::new("REGEX_RULES", e, None))
    })
    .await
}

#[tauri::command]
pub async fn list_backup_history(
    path: String,
    writes: State<'_, Arc<crate::write_service::WriteService>>,
) -> Result<Vec<crate::backups::BackupEntry>, AppError> {
    let writes = writes.inner().clone();
    blocking(move || writes.with_store(|store| store.list(Path::new(&path)))).await
}

#[tauri::command]
pub async fn read_backup_snapshot(
    path: String,
    id: String,
    writes: State<'_, Arc<crate::write_service::WriteService>>,
) -> Result<FileData, AppError> {
    let writes = writes.inner().clone();
    blocking(move || {
        writes.with_store(|store| {
            let snapshot = store.snapshot_path(Path::new(&path), &id)?;
            let mut data = fileio::read_text_file(&snapshot)?;
            let name = Path::new(&path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy();
            data.path = format!("history://{id}/{name}");
            Ok(data)
        })
    })
    .await
}

#[tauri::command]
pub async fn restore_backup(
    path: String,
    id: String,
    writes: State<'_, Arc<crate::write_service::WriteService>>,
) -> Result<(), AppError> {
    let writes = writes.inner().clone();
    blocking(move || writes.with_store(|store| store.restore(Path::new(&path), &id))).await
}

#[tauri::command]
pub fn get_startup_comparison() -> Result<Option<crate::startup::StartupComparison>, AppError> {
    crate::startup::parse_paths(std::env::args_os().skip(1))
}

#[tauri::command]
pub fn get_startup_files() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .filter(|a| !a.to_string_lossy().starts_with('-'))
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .filter_map(|p| absolute_path(&p).ok())
        .take(2)
        .map(|p| display_path(&p))
        .collect()
}
