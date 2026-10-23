use o_compare_rust::watcher::{Side, WatchService};
use std::{
    fs,
    sync::{mpsc, Arc},
    time::Duration,
};

#[test]
fn external_writes_and_atomic_replace_are_detected() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("file.txt");
    fs::write(&path, "before").unwrap();
    let service = WatchService::default();
    let (tx, rx) = mpsc::channel();
    service
        .watch(
            Side::Left,
            Some(path.clone()),
            Arc::new(move |e| {
                let _ = tx.send(e);
            }),
        )
        .unwrap();
    fs::write(&path, "after").unwrap();
    let event = rx.recv_timeout(Duration::from_secs(4)).unwrap();
    assert_eq!(event.side, Side::Left);
    let replacement = temp.path().join("temp.txt");
    fs::write(&replacement, "replacement").unwrap();
    fs::remove_file(&path).unwrap();
    fs::rename(replacement, &path).unwrap();
    rx.recv_timeout(Duration::from_secs(4)).unwrap();
}

#[test]
fn own_save_is_suppressed_but_immediate_external_edit_is_reported() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("file.txt");
    fs::write(&path, "before").unwrap();
    let service = WatchService::default();
    let (tx, rx) = mpsc::channel();
    service
        .watch(
            Side::Right,
            Some(path.clone()),
            Arc::new(move |e| {
                let _ = tx.send(e);
            }),
        )
        .unwrap();
    service.record_save(&path, b"ours".to_vec());
    fs::write(&path, "ours").unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(600)).is_err());
    fs::write(&path, "external").unwrap();
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(4)).unwrap().side,
        Side::Right
    );
    // การย้อนกลับไปเป็น bytes เดียวกับ save เก่าก็ยังเป็น external edit
    fs::write(&path, "ours").unwrap();
    rx.recv_timeout(Duration::from_secs(4)).unwrap();
}

#[test]
fn switching_and_cancelling_watchers_drops_old_events() {
    let temp = tempfile::tempdir().unwrap();
    let left = temp.path().join("left.txt");
    let right = temp.path().join("right.txt");
    fs::write(&left, "left").unwrap();
    fs::write(&right, "right").unwrap();
    let service = WatchService::default();
    let (tx, rx) = mpsc::channel();
    let callback: Arc<dyn Fn(o_compare_rust::watcher::WatchEvent) + Send + Sync> =
        Arc::new(move |e| {
            let _ = tx.send(e);
        });
    let first = service
        .watch(Side::Left, Some(left.clone()), callback.clone())
        .unwrap();
    fs::write(&left, "pending").unwrap();
    let second = service
        .watch(Side::Left, Some(right.clone()), callback.clone())
        .unwrap();
    assert!(second > first);
    fs::write(&right, "new").unwrap();
    let event = rx.recv_timeout(Duration::from_secs(4)).unwrap();
    assert_eq!(event.generation, second);
    assert_eq!(std::path::Path::new(&event.path), right);
    service.watch(Side::Left, None, callback).unwrap();
    fs::write(&right, "cancelled").unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(500)).is_err());
}

#[test]
fn same_file_on_both_sides_suppresses_own_save_and_reports_external_edit() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("shared.txt");
    fs::write(&path, "before").unwrap();
    let service = WatchService::default();
    let (tx, rx) = mpsc::channel();
    let callback: Arc<dyn Fn(o_compare_rust::watcher::WatchEvent) + Send + Sync> =
        Arc::new(move |e| {
            let _ = tx.send(e);
        });
    service
        .watch(Side::Left, Some(path.clone()), callback.clone())
        .unwrap();
    service
        .watch(Side::Right, Some(path.clone()), callback)
        .unwrap();
    service.record_save(&path, b"ours".to_vec());
    fs::write(&path, "ours").unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(600)).is_err());
    fs::write(&path, "external").unwrap();
    let first = rx.recv_timeout(Duration::from_secs(4)).unwrap();
    let second = rx.recv_timeout(Duration::from_secs(4)).unwrap();
    assert_ne!(first.side, second.side);
}

#[test]
#[cfg(windows)]
fn windows_case_insensitive_filename_changes_are_detected() {
    let temp = tempfile::tempdir().unwrap();
    let actual = temp.path().join("MixedCase.txt");
    fs::write(&actual, "before").unwrap();
    let service = WatchService::default();
    let (tx, rx) = mpsc::channel();
    service
        .watch(
            Side::Left,
            Some(temp.path().join("MIXEDCASE.TXT")),
            Arc::new(move |e| {
                let _ = tx.send(e);
            }),
        )
        .unwrap();
    fs::write(actual, "after").unwrap();
    rx.recv_timeout(Duration::from_secs(3)).unwrap();
}
