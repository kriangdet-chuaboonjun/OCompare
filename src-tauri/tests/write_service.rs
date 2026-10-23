use o_compare_rust::write_service::WriteService;
use std::fs;
#[test]
fn save_backs_up_previous_bytes_and_unchanged_save_adds_no_version() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("ไทย.sql");
    fs::write(&path, b"old\r\n").unwrap();
    let service = WriteService::new(temp.path().join("history"));
    service.save(&path, b"new\n").unwrap();
    service.save(&path, b"new\n").unwrap();
    service
        .with_store(|store| {
            let entries = store.list(&path)?;
            assert_eq!(entries.len(), 1);
            assert_eq!(
                fs::read(store.snapshot_path(&path, &entries[0].id)?).unwrap(),
                b"old\r\n"
            );
            Ok(())
        })
        .unwrap();
}

#[test]
fn independent_services_serialize_history_transactions_using_os_lock() {
    use std::{sync::mpsc, time::Duration};
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("history");
    let first = WriteService::new(root.clone());
    let second = WriteService::new(root);
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let (second_tx, second_rx) = mpsc::channel();
    let one = std::thread::spawn(move || {
        first
            .with_store(|_| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
            .unwrap()
    });
    started_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    let two = std::thread::spawn(move || {
        second
            .with_store(|_| {
                second_tx.send(()).unwrap();
                Ok(())
            })
            .unwrap()
    });
    assert!(second_rx.recv_timeout(Duration::from_millis(100)).is_err());
    release_tx.send(()).unwrap();
    second_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    one.join().unwrap();
    two.join().unwrap();
}
