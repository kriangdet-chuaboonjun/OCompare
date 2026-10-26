use o_compare_rust::folder_watch::FolderWatchService;
use std::{
    fs,
    sync::{mpsc, Arc},
    time::Duration,
};

#[test]
fn recursive_changes_are_debounced_and_old_generation_is_stopped() {
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join("nested")).unwrap();
    let service = FolderWatchService::default();
    let (tx, rx) = mpsc::channel();
    let generation = service
        .watch(
            "tab-a",
            vec![root.path().to_owned()],
            Arc::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .unwrap();
    let path = root.path().join("nested/ภาษาไทย.txt");
    for index in 0..8 {
        fs::write(&path, index.to_string()).unwrap();
    }
    let event = rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(event.generation, generation);
    assert_eq!(event.tab_id, "tab-a");
    assert!(event.error.is_none());
    assert!(rx.recv_timeout(Duration::from_millis(700)).is_err());
    service.stop("tab-a").unwrap();
    fs::remove_file(path).unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(800)).is_err());
}

#[test]
fn invalid_root_is_reported_without_panicking() {
    let root = tempfile::tempdir().unwrap();
    let service = FolderWatchService::default();
    assert!(service
        .watch("tab-a", vec![root.path().join("missing")], Arc::new(|_| {}))
        .is_err());
}

#[test]
fn read_only_comparison_does_not_report_directory_modify_noise() {
    let root = tempfile::tempdir().unwrap();
    let left = root.path().join("left");
    let right = root.path().join("right");
    for dir in [&left, &right] {
        fs::create_dir_all(dir.join("many")).unwrap();
        for i in 0..2000 {
            fs::write(dir.join(format!("many/{i}.txt")), "same").unwrap();
        }
    }
    let service = FolderWatchService::default();
    let (tx, rx) = mpsc::channel();
    service
        .watch(
            "tab-a",
            vec![left.clone(), right.clone()],
            Arc::new(move |event| {
                let _ = tx.send(event);
            }),
        )
        .unwrap();
    o_compare_rust::folders::compare_folders(
        &left,
        &right,
        "read-only",
        &std::sync::atomic::AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    assert!(
        rx.recv_timeout(Duration::from_millis(900)).is_err(),
        "Read-only scan must not invalidate itself"
    );
}

#[test]
fn tabs_have_independent_watches_and_stopping_one_keeps_the_other() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    let service = FolderWatchService::default();
    let (tx, rx) = mpsc::channel();
    let watch = |tab: &str, root: &std::path::Path| {
        let tx = tx.clone();
        service
            .watch(
                tab,
                vec![root.to_owned()],
                Arc::new(move |event| {
                    let _ = tx.send(event);
                }),
            )
            .unwrap()
    };
    let first_generation = watch("tab-1", first.path());
    let second_generation = watch("tab-2", second.path());
    assert_ne!(first_generation, second_generation);
    service.stop("tab-1").unwrap();
    fs::write(first.path().join("ignored.txt"), "x").unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(900)).is_err(), "stopped tab stays silent");
    fs::write(second.path().join("seen.txt"), "x").unwrap();
    let event = rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!((event.tab_id.as_str(), event.generation), ("tab-2", second_generation));
    // Re-watching a tab replaces only that tab's watcher and issues a new generation.
    assert!(watch("tab-2", second.path()) > second_generation);
}
