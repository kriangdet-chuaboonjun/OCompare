use o_compare_rust::{
    error::AppError,
    folder_copy::CopyService,
    folder_sessions,
    folders::{self, FolderCompareOptions, FolderJobs},
};
use serde_json::{json, Value};
use std::{
    io::{self, BufRead},
    path::{Path, PathBuf},
    sync::Arc,
};

/// JSON-lines test transport. Native builds register the same core through Tauri commands.
fn main() {
    let sessions = PathBuf::from(std::env::args_os().nth(1).expect("isolated sessions path"));
    let service = Arc::new(CopyService::default());
    let jobs = Arc::new(FolderJobs::default());
    let writes = Arc::new(o_compare_rust::write_service::WriteService::new(
        sessions.with_extension("history"),
    ));
    let watch = Arc::new(o_compare_rust::folder_watch::FolderWatchService::default());
    let events = Arc::new(std::sync::Mutex::new(Vec::<
        o_compare_rust::folder_watch::FolderWatchEvent,
    >::new()));
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let input: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("{e}");
                continue;
            }
        };
        let service = service.clone();
        let jobs = jobs.clone();
        let sessions = sessions.clone();
        let writes = writes.clone();
        let watch = watch.clone();
        let events = events.clone();
        std::thread::spawn(move || {
            let result = run(&input, &service, &jobs, &sessions, &writes, &watch, &events);
            match result {
                Ok(data) => println!("{}", json!({"id":input["id"],"data":data})),
                Err(error) => println!("{}", json!({"id":input["id"],"error":error})),
            }
        });
    }
}
fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str, AppError> {
    v[key]
        .as_str()
        .ok_or_else(|| AppError::new("TEST_INPUT", format!("Missing {key}"), None))
}
fn run(
    v: &Value,
    service: &CopyService,
    jobs: &FolderJobs,
    sessions: &Path,
    writes: &o_compare_rust::write_service::WriteService,
    watch: &o_compare_rust::folder_watch::FolderWatchService,
    events: &Arc<std::sync::Mutex<Vec<o_compare_rust::folder_watch::FolderWatchEvent>>>,
) -> Result<Value, AppError> {
    let action = string(v, "action")?;
    match action {
        "readFile" => Ok(json!(o_compare_rust::fileio::read_text_file(Path::new(
            string(v, "path")?
        ))?)),
        "saveFile" => {
            let bytes = o_compare_rust::encoding::encode(
                string(v, "text")?,
                string(v, "encoding")?,
                v["bom"].as_bool().unwrap_or(false),
            )?;
            Ok(json!(writes.save(Path::new(string(v, "path")?), &bytes)?))
        }
        "listHistory" => {
            writes.with_store(|store| Ok(json!(store.list(Path::new(string(v, "path")?))?)))
        }
        "restore" => writes.with_store(|store| {
            store.restore(Path::new(string(v, "path")?), string(v, "snapshotId")?)?;
            Ok(Value::Null)
        }),
        "snapshot" => writes.with_store(|store| {
            let path = Path::new(string(v, "path")?);
            let id = string(v, "snapshotId")?;
            let snapshot = store.snapshot_path(path, id)?;
            let mut data = o_compare_rust::fileio::read_text_file(&snapshot)?;
            data.path = format!(
                "history://{id}/{}",
                path.file_name().unwrap_or_default().to_string_lossy()
            );
            Ok(json!(data))
        }),
        "validateRules" | "normalizePair" => {
            let rules: Vec<o_compare_rust::comparison_rules::RegexRule> =
                serde_json::from_value(v["rules"].clone())
                    .map_err(|e| AppError::new("REGEX_RULES", e, None))?;
            if action == "validateRules" {
                o_compare_rust::comparison_rules::CompiledRules::compile(&rules)
                    .map_err(|e| AppError::new("REGEX_RULES", e, None))?;
                Ok(Value::Null)
            } else {
                Ok(json!(o_compare_rust::comparison_rules::normalize_pair(
                    string(v, "left")?,
                    string(v, "right")?,
                    &rules
                )
                .map_err(|e| AppError::new("REGEX_RULES", e, None))?))
            }
        }
        "watchFolders" => {
            let events = events.clone();
            let generation = watch.watch(
                vec![
                    string(v, "leftPath")?.into(),
                    string(v, "rightPath")?.into(),
                ],
                Arc::new(move |event| {
                    if let Ok(mut queue) = events.lock() {
                        queue.push(event);
                    }
                }),
            )?;
            Ok(json!(generation))
        }
        "watchEvents" => Ok(json!(events
            .lock()
            .map_err(|e| AppError::new("WATCH", e, None))?
            .drain(..)
            .collect::<Vec<_>>())),
        "stopWatch" => {
            watch.stop()?;
            Ok(Value::Null)
        }
        "loadSessions" => folder_sessions::load(sessions),
        "saveSessions" => {
            folder_sessions::save(sessions, &v["store"])?;
            Ok(Value::Null)
        }
        "diskSpace" => Ok(json!(o_compare_rust::folder_copy::disk_space(Path::new(
            string(v, "path")?
        ))?)),
        "discardCopy" => {
            service.discard(string(v, "planId")?)?;
            Ok(Value::Null)
        }
        "cancel" => {
            jobs.cancel(string(v, "requestId")?)?;
            Ok(Value::Null)
        }
        "compare" | "planCopy" | "executeCopy" => {
            let id = string(v, "requestId")?;
            let cancel = jobs.begin(id)?;
            let result = (|| match action {
                "compare" => {
                    let options: FolderCompareOptions = serde_json::from_value(
                        v.get("options").cloned().unwrap_or_else(|| json!({})),
                    )
                    .map_err(|e| AppError::new("TEST_INPUT", e, None))?;
                    Ok(json!(folders::compare_with_options(
                        Path::new(string(v, "leftPath")?),
                        Path::new(string(v, "rightPath")?),
                        id,
                        &options,
                        &cancel,
                        &mut |_| {}
                    )?))
                }
                "planCopy" => {
                    let paths: Vec<String> = serde_json::from_value(v["paths"].clone())
                        .map_err(|e| AppError::new("TEST_INPUT", e, None))?;
                    Ok(json!(service.plan(
                        Path::new(string(v, "leftPath")?),
                        Path::new(string(v, "rightPath")?),
                        string(v, "direction")?,
                        &paths,
                        &cancel
                    )?))
                }
                _ => writes.with_store(|store| {
                    Ok(json!(service.execute_with_backups(
                        string(v, "planId")?,
                        &cancel,
                        &mut |_, _, _| {},
                        store
                    )?))
                }),
            })();
            jobs.finish(id);
            result
        }
        _ => Err(AppError::new("TEST_INPUT", "Unknown action", None)),
    }
}
