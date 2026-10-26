use o_compare_rust::folders::{compare_folders, FolderComparison, FolderStatus as S};
use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

fn compare(left: &Path, right: &Path) -> FolderComparison {
    compare_folders(left, right, "test", &AtomicBool::new(false), &mut |_| {}).unwrap()
}

fn status(result: &FolderComparison, name: &str) -> S {
    result
        .entries
        .iter()
        .find(|e| e.relative_path == name)
        .unwrap_or_else(|| panic!("Missing {name}"))
        .status
}

#[test]
fn compares_real_bytes_including_binary_and_same_size_differences() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    for root in [left.path(), right.path()] {
        fs::write(root.join("same.bin"), [0, 255, 1, 0, 2]).unwrap();
        fs::write(root.join("empty.txt"), []).unwrap();
    }
    fs::write(left.path().join("changed.txt"), "left").unwrap();
    fs::write(right.path().join("changed.txt"), "rght").unwrap();
    fs::write(left.path().join("size.txt"), "small").unwrap();
    fs::write(right.path().join("size.txt"), "larger").unwrap();
    fs::write(left.path().join("left.txt"), "left").unwrap();
    fs::write(right.path().join("right.txt"), "right").unwrap();
    let result = compare(left.path(), right.path());
    assert_eq!(status(&result, "same.bin"), S::Identical);
    assert_eq!(status(&result, "empty.txt"), S::Identical);
    assert_eq!(status(&result, "changed.txt"), S::Different);
    assert_eq!(status(&result, "size.txt"), S::Different);
    assert_eq!(status(&result, "left.txt"), S::LeftOnly);
    assert_eq!(status(&result, "right.txt"), S::RightOnly);
    assert_eq!(result.summary.files, 6);
    assert_eq!(result.summary.identical, 2);
    assert_eq!(result.summary.different, 2);
}

#[test]
fn nested_and_empty_directories_aggregate_without_double_counting_files() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    for root in [left.path(), right.path()] {
        fs::create_dir_all(root.join("ภาษาไทย มีช่องว่าง/empty")).unwrap();
        fs::write(root.join("ภาษาไทย มีช่องว่าง/same.sql"), "SELECT 1;").unwrap();
    }
    fs::create_dir_all(left.path().join("only-left/sub")).unwrap();
    fs::write(left.path().join("only-left/sub/a"), "a").unwrap();
    fs::create_dir_all(right.path().join("only-right/empty")).unwrap();
    let result = compare(left.path(), right.path());
    assert_eq!(status(&result, "ภาษาไทย มีช่องว่าง"), S::Identical);
    assert_eq!(status(&result, "ภาษาไทย มีช่องว่าง/empty"), S::Identical);
    assert_eq!(status(&result, "only-left/sub/a"), S::LeftOnly);
    assert_eq!(status(&result, "only-right/empty"), S::RightOnly);
    assert_eq!(result.summary.files, 2);
    assert_eq!(result.entries[0].kind, "directory");
}

#[test]
fn file_directory_conflict_and_directory_child_differences_are_visible() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    fs::write(left.path().join("conflict"), "file").unwrap();
    fs::create_dir_all(right.path().join("conflict")).unwrap();
    fs::write(right.path().join("conflict/child"), "file").unwrap();
    for root in [left.path(), right.path()] {
        fs::create_dir(root.join("shared")).unwrap();
    }
    fs::write(left.path().join("shared/one"), "one").unwrap();
    let result = compare(left.path(), right.path());
    assert_eq!(status(&result, "conflict"), S::Different);
    assert_eq!(status(&result, "conflict/child"), S::RightOnly);
    assert_eq!(status(&result, "shared"), S::Different);
}

#[test]
fn metadata_timestamps_do_not_change_content_equality() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    fs::write(left.path().join("same"), "same").unwrap();
    fs::write(right.path().join("same"), "same").unwrap();
    let file = fs::OpenOptions::new()
        .write(true)
        .open(right.path().join("same"))
        .unwrap();
    file.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1000))
        .unwrap();
    assert_eq!(
        status(&compare(left.path(), right.path()), "same"),
        S::Identical
    );
}

#[test]
fn bad_roots_fail_and_cancellation_does_not_return_partial_results() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    let cancel = AtomicBool::new(false);
    assert!(compare_folders(
        &left.path().join("missing"),
        right.path(),
        "test",
        &cancel,
        &mut |_| {}
    )
    .is_err());
    for i in 0..20 {
        fs::write(left.path().join(format!("file{i}")), "x").unwrap();
    }
    let error = compare_folders(left.path(), right.path(), "test", &cancel, &mut |_| {
        cancel.store(true, Ordering::SeqCst);
    })
    .unwrap_err();
    assert_eq!(error.code, "CANCELED");
}

#[test]
fn changed_file_is_not_reported_identical() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    fs::write(left.path().join("file"), "same").unwrap();
    fs::write(right.path().join("file"), "same").unwrap();
    let result = compare_folders(
        left.path(),
        right.path(),
        "test",
        &AtomicBool::new(false),
        &mut |_| {
            fs::write(right.path().join("file"), "changed during comparison").unwrap();
        },
    )
    .unwrap();
    assert_eq!(status(&result, "file"), S::Error);
}

#[test]
#[cfg(windows)]
fn windows_names_pair_case_insensitively() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    fs::write(left.path().join("Name.SQL"), "same").unwrap();
    fs::write(right.path().join("name.sql"), "same").unwrap();
    let result = compare(left.path(), right.path());
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.entries[0].status, S::Identical);
    assert_eq!(result.entries[0].left.as_ref().unwrap().name, "Name.SQL");
    assert_eq!(result.entries[0].right.as_ref().unwrap().name, "name.sql");
}

#[test]
fn jobs_are_tracked_per_request_so_tabs_do_not_cancel_each_other() {
    let jobs = o_compare_rust::folders::FolderJobs::default();
    let first = jobs.begin("first").unwrap();
    let second = jobs.begin("second").unwrap();
    assert!(!first.load(Ordering::SeqCst) && !second.load(Ordering::SeqCst));
    assert!(jobs.begin("first").is_err(), "duplicate request IDs are rejected");
    jobs.cancel("first").unwrap();
    assert!(first.load(Ordering::SeqCst));
    assert!(!second.load(Ordering::SeqCst));
    jobs.finish("first");
    jobs.cancel("first").unwrap();
    jobs.cancel("unknown").unwrap();
    assert!(!second.load(Ordering::SeqCst));
    jobs.cancel("second").unwrap();
    assert!(second.load(Ordering::SeqCst));
}

#[test]
fn copy_is_exclusive_and_waits_for_comparisons() {
    let jobs = o_compare_rust::folders::FolderJobs::default();
    jobs.begin("scan").unwrap();
    assert!(jobs.begin_copy("copy").is_err(), "copy cannot start during a comparison");
    jobs.finish("scan");
    jobs.begin_copy("copy").unwrap();
    assert!(jobs.begin("scan-2").is_err(), "comparison cannot start during a copy");
    assert!(jobs.begin_copy("copy-2").is_err(), "only one copy runs app-wide");
    jobs.finish("copy");
    jobs.begin("scan-2").unwrap();
}

#[test]
fn compares_multiple_chunks_and_detects_difference_at_end() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    let mut bytes = vec![b'x'; 200_000];
    fs::write(left.path().join("large"), &bytes).unwrap();
    fs::write(right.path().join("large"), &bytes).unwrap();
    assert_eq!(
        status(&compare(left.path(), right.path()), "large"),
        S::Identical
    );
    *bytes.last_mut().unwrap() = b'y';
    fs::write(right.path().join("large"), bytes).unwrap();
    assert_eq!(
        status(&compare(left.path(), right.path()), "large"),
        S::Different
    );
}

#[test]
#[cfg(windows)]
fn junction_loop_is_skipped_and_not_followed() {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    fs::create_dir(left.path().join("parent")).unwrap();
    fs::create_dir(right.path().join("parent")).unwrap();
    let link = left.path().join("parent").join("loop");
    let created = std::process::Command::new("cmd.exe")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(left.path())
        .output()
        .unwrap();
    assert!(
        created.status.success(),
        "{}",
        String::from_utf8_lossy(&created.stderr)
    );
    let result = compare(left.path(), right.path());
    assert_eq!(status(&result, "parent/loop"), S::Skipped);
    assert_eq!(status(&result, "parent"), S::Skipped);
    assert_eq!(result.summary.skipped, 1);
    assert_eq!(result.entries.len(), 2);
}

#[test]
#[cfg(windows)]
fn unreadable_file_reports_error_and_other_files_continue() {
    use std::os::windows::fs::OpenOptionsExt;
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    for root in [left.path(), right.path()] {
        fs::write(root.join("locked"), "same").unwrap();
        fs::write(root.join("normal"), "same").unwrap();
    }
    let _locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(left.path().join("locked"))
        .unwrap();
    let result = compare(left.path(), right.path());
    assert_eq!(status(&result, "locked"), S::Error);
    assert_eq!(status(&result, "normal"), S::Identical);
    assert_eq!(result.summary.errors, 1);
}
