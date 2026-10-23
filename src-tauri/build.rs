fn main() {
    if std::env::var_os("CARGO_FEATURE_DESKTOP").is_some() {
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "read_file",
                "save_file",
                "watch_file",
                "watch_folders",
                "stop_folder_watch",
                "validate_comparison_rules",
                "normalize_comparison_pair",
                "list_backup_history",
                "read_backup_snapshot",
                "restore_backup",
                "get_startup_files",
                "get_startup_comparison",
                "compare_folders",
                "cancel_folder_compare",
                "load_folder_sessions",
                "save_folder_sessions",
                "folder_disk_space",
                "plan_folder_copy",
                "execute_folder_copy",
                "discard_folder_copy",
            ]),
        ))
        .expect("Tauri build configuration failed");
    }
}
