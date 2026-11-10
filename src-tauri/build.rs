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
                "canonicalize_structural",
                "list_backup_history",
                "read_backup_snapshot",
                "restore_backup",
                "get_startup_files",
                "get_startup_comparison",
                "is_portable",
                "open_release_page",
                "compare_folders",
                "cancel_folder_compare",
                "load_folder_sessions",
                "save_folder_sessions",
                "list_compare_history",
                "append_compare_history",
                "read_compare_snapshot",
                "list_all_backup_history",
                "folder_disk_space",
                "folder_path_kinds",
                "plan_folder_copy",
                "execute_folder_copy",
                "discard_folder_copy",
            ]),
        ))
        .expect("Tauri build configuration failed");
    }
}
