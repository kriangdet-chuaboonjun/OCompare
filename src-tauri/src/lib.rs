pub mod backups;
#[cfg(feature = "desktop")]
mod commands;
pub mod comparison_rules;
pub mod encoding;
pub mod error;
pub mod fileio;
pub mod folder_copy;
mod folder_scan;
pub mod folder_sessions;
pub mod folder_watch;
pub mod folders;
pub mod startup;
pub mod watcher;
pub mod write_service;

#[cfg(feature = "desktop")]
pub fn run() {
    use tauri::Manager;
    tauri::Builder::default()
        .setup(|app| {
            app.manage(std::sync::Arc::new(write_service::WriteService::new(
                app.path().app_data_dir()?.join("history"),
            )));
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(std::sync::Arc::new(watcher::WatchService::default()))
        .manage(std::sync::Arc::new(folders::FolderJobs::default()))
        .manage(std::sync::Arc::new(folder_copy::CopyService::default()))
        .manage(std::sync::Arc::new(
            folder_watch::FolderWatchService::default(),
        ))
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::save_file,
            commands::watch_file,
            commands::watch_folders,
            commands::stop_folder_watch,
            commands::validate_comparison_rules,
            commands::normalize_comparison_pair,
            commands::list_backup_history,
            commands::read_backup_snapshot,
            commands::restore_backup,
            commands::get_startup_files,
            commands::get_startup_comparison,
            commands::is_portable,
            commands::open_release_page,
            commands::compare_folders,
            commands::cancel_folder_compare,
            commands::load_folder_sessions,
            commands::save_folder_sessions,
            commands::folder_disk_space,
            commands::plan_folder_copy,
            commands::execute_folder_copy,
            commands::discard_folder_copy
        ])
        .run(tauri::generate_context!())
        .expect("Could not run OCompare");
}
