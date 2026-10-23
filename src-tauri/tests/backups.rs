use o_compare_rust::backups::{atomic_replace, BackupStore};
use std::fs;

#[test]
fn snapshots_preserve_exact_encoded_bytes_and_restore_backs_up_current() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("ไทย.txt");
    let store = BackupStore::new(dir.path().join("history"));
    for bytes in [
        &b"\xef\xbb\xbfhello\r\n"[..],
        &b"\xff\xfeh\0i\0\r\0\n\0"[..],
        &b"\xa1\xa2\r\n"[..],
    ] {
        fs::write(&file, bytes).unwrap();
        let prepared = store.prepare(&file, "Save").unwrap().unwrap();
        let hash = prepared.entry().sha256.clone();
        atomic_replace(&file, b"changed", Some(&hash)).unwrap();
        prepared.commit().unwrap();
        let entry = store.list(&file).unwrap().remove(0);
        assert_eq!(
            fs::read(store.snapshot_path(&file, &entry.id).unwrap()).unwrap(),
            bytes
        );
        store.restore(&file, &entry.id).unwrap();
        assert_eq!(fs::read(&file).unwrap(), bytes);
        let current = store.list(&file).unwrap().remove(0);
        assert_eq!(current.reason, "Restore");
        assert_eq!(
            fs::read(store.snapshot_path(&file, &current.id).unwrap()).unwrap(),
            b"changed"
        );
    }
}

#[test]
fn abandoned_and_failed_writes_keep_original_history_and_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.txt");
    fs::write(&file, b"one").unwrap();
    let store = BackupStore::with_limits(dir.path().join("history"), 1, 3);
    store
        .prepare(&file, "Save")
        .unwrap()
        .unwrap()
        .commit()
        .unwrap();
    let id = store.list(&file).unwrap()[0].id.clone();
    {
        let _abandoned = store.prepare(&file, "Save").unwrap();
    }
    assert_eq!(store.list(&file).unwrap()[0].id, id);
    assert_eq!(fs::read(&file).unwrap(), b"one");
    fs::write(&file, b"oversize").unwrap();
    assert!(store.prepare(&file, "Save").is_err());
    assert_eq!(store.list(&file).unwrap()[0].id, id);
}

#[test]
fn committed_retention_applies_per_path_and_total_quota() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a");
    let b = dir.path().join("b");
    let store = BackupStore::with_limits(dir.path().join("history"), 2, 9);
    for value in [b"one", b"two", b"tri"] {
        fs::write(&a, value).unwrap();
        store
            .prepare(&a, "Save")
            .unwrap()
            .unwrap()
            .commit()
            .unwrap();
    }
    assert_eq!(store.list(&a).unwrap().len(), 2);
    fs::write(&b, b"123456").unwrap();
    store
        .prepare(&b, "Copy")
        .unwrap()
        .unwrap()
        .commit()
        .unwrap();
    assert_eq!(store.list(&a).unwrap().len(), 1);
    assert_eq!(store.list(&b).unwrap().len(), 1);
}

#[test]
fn corrupt_snapshot_and_wrong_path_never_restore() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a");
    let other = dir.path().join("b");
    fs::write(&file, b"original").unwrap();
    fs::write(&other, b"other").unwrap();
    let store = BackupStore::new(dir.path().join("history"));
    store
        .prepare(&file, "Save")
        .unwrap()
        .unwrap()
        .commit()
        .unwrap();
    let entry = store.list(&file).unwrap().remove(0);
    assert!(store.restore(&other, &entry.id).is_err());
    assert!(store.restore(&file, "../outside").is_err());
    let snapshot = store.snapshot_path(&file, &entry.id).unwrap();
    fs::write(snapshot, b"corrupt").unwrap();
    assert!(store.restore(&file, &entry.id).is_err());
    assert_eq!(fs::read(file).unwrap(), b"original");
}

#[test]
fn stale_target_is_preserved_and_no_backup_for_new_file() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a");
    let store = BackupStore::new(dir.path().join("history"));
    assert!(store.prepare(&file, "Save").unwrap().is_none());
    atomic_replace(&file, b"original", None).unwrap();
    let prepared = store.prepare(&file, "Save").unwrap().unwrap();
    fs::write(&file, b"external").unwrap();
    assert!(atomic_replace(&file, b"overwrite", Some(&prepared.entry().sha256)).is_err());
    drop(prepared);
    assert_eq!(fs::read(file).unwrap(), b"external");
    assert!(store.list(&dir.path().join("a")).unwrap().is_empty());
}

#[test]
fn failed_catalog_commit_preserves_preimage_for_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a");
    let root = dir.path().join("history");
    let store = BackupStore::new(root.clone());
    fs::write(&file, b"original").unwrap();
    let prepared = store.prepare(&file, "Save").unwrap().unwrap();
    let id = prepared.entry().id.clone();
    atomic_replace(&file, b"new", Some(&prepared.entry().sha256)).unwrap();
    let obstruction = root.join(format!("{id}.json"));
    fs::create_dir(&obstruction).unwrap();
    assert!(prepared.commit().is_err());
    assert_eq!(
        fs::read(root.join(format!("{id}.bin"))).unwrap(),
        b"original"
    );
    fs::remove_dir(obstruction).unwrap();
    store.recover_pending().unwrap();
    assert_eq!(store.list(&file).unwrap()[0].id, id);
    store.restore(&file, &id).unwrap();
    assert_eq!(fs::read(file).unwrap(), b"original");
}

#[test]
fn restore_retention_can_remove_selected_snapshot_after_replacement() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a");
    let store = BackupStore::with_limits(dir.path().join("history"), 1, 20);
    fs::write(&file, b"original").unwrap();
    store
        .prepare(&file, "Save")
        .unwrap()
        .unwrap()
        .commit()
        .unwrap();
    let id = store.list(&file).unwrap()[0].id.clone();
    fs::write(&file, b"new").unwrap();
    store.restore(&file, &id).unwrap();
    assert_eq!(fs::read(&file).unwrap(), b"original");
    let entries = store.list(&file).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].reason, "Restore");
}

#[test]
fn backup_failure_does_not_modify_original_or_existing_versions() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a");
    let root = dir.path().join("not-a-directory");
    fs::write(&file, b"original").unwrap();
    fs::write(&root, b"blocked").unwrap();
    let store = BackupStore::new(root);
    assert!(store.prepare(&file, "Save").is_err());
    assert_eq!(fs::read(file).unwrap(), b"original");
}

#[cfg(windows)]
#[test]
fn readonly_destination_replacement_fails_without_losing_bytes_or_history() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("readonly");
    fs::write(&file, b"original").unwrap();
    let store = BackupStore::new(dir.path().join("history"));
    let prepared = store.prepare(&file, "Save").unwrap().unwrap();
    let original_permissions = fs::metadata(&file).unwrap().permissions();
    let mut permissions = original_permissions.clone();
    permissions.set_readonly(true);
    fs::set_permissions(&file, permissions).unwrap();
    let result = atomic_replace(&file, b"overwrite", Some(&prepared.entry().sha256));
    fs::set_permissions(&file, original_permissions).unwrap();
    assert!(result.is_err());
    prepared.abort();
    assert_eq!(fs::read(&file).unwrap(), b"original");
    assert!(store.list(&file).unwrap().is_empty());
    assert_eq!(
        fs::read_dir(dir.path()).unwrap().count(),
        2,
        "Failed write left temporary files"
    );
}

#[test]
fn versions_for_other_paths_cannot_be_selected() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a");
    let b = dir.path().join("b");
    fs::write(&a, b"a").unwrap();
    fs::write(&b, b"b").unwrap();
    let store = BackupStore::new(dir.path().join("history"));
    store
        .prepare(&a, "Save")
        .unwrap()
        .unwrap()
        .commit()
        .unwrap();
    store
        .prepare(&b, "Copy")
        .unwrap()
        .unwrap()
        .commit()
        .unwrap();
    assert_eq!(store.list(&a).unwrap().len(), 1);
    assert_eq!(store.list(&b).unwrap().len(), 1);
    assert!(store
        .snapshot_path(&a, &store.list(&b).unwrap()[0].id)
        .is_err());
}

#[cfg(windows)]
#[test]
fn junction_parent_is_rejected_for_backup_and_restore() {
    let dir = tempfile::tempdir().unwrap();
    let real = dir.path().join("real");
    let junction = dir.path().join("junction");
    fs::create_dir(&real).unwrap();
    let target = real.join("a");
    fs::write(&target, b"original").unwrap();
    let store = BackupStore::new(dir.path().join("history"));
    store
        .prepare(&target, "Save")
        .unwrap()
        .unwrap()
        .commit()
        .unwrap();
    let id = store.list(&target).unwrap()[0].id.clone();
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&real)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let linked = junction.join("a");
    let backup_result = store.prepare(&linked, "Save");
    let restore_result = store.restore(&linked, &id);
    fs::remove_dir(&junction).unwrap();
    assert!(backup_result.is_err());
    assert!(restore_result.is_err());
    assert_eq!(fs::read(target).unwrap(), b"original");
}

#[test]
fn write_service_recovers_failed_catalog_on_next_operation() {
    use o_compare_rust::write_service::WriteService;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a");
    let root = dir.path().join("history");
    let service = WriteService::new(root.clone());
    fs::write(&file, b"original").unwrap();
    let mut failed_id = String::new();
    let result = service.with_store(|store| {
        let prepared = store.prepare(&file, "Save")?.unwrap();
        failed_id = prepared.entry().id.clone();
        fs::create_dir(root.join(format!("{failed_id}.json"))).unwrap();
        atomic_replace(&file, b"new", Some(&prepared.entry().sha256))?;
        prepared.commit()
    });
    assert!(result.is_err());
    fs::remove_dir(root.join(format!("{failed_id}.json"))).unwrap();
    let history = service.with_store(|store| store.list(&file)).unwrap();
    assert_eq!(
        history.len(),
        1,
        "Retained preimage should be accessible without restarting"
    );
    assert_eq!(history[0].id, failed_id);
}

#[test]
fn recovery_removes_only_owned_orphan_snapshots() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("history");
    fs::create_dir(&root).unwrap();
    let store = BackupStore::new(root.clone());
    let orphan_id = format!("{:032x}-{:08x}-{:016x}", 1, 2, 3);
    let orphan = root.join(format!("{orphan_id}.bin"));
    let unrelated = root.join("unrelated.bin");
    fs::write(&orphan, b"interrupted before metadata persisted").unwrap();
    fs::write(&unrelated, b"not a history snapshot").unwrap();
    let file = dir.path().join("a");
    fs::write(&file, b"committed").unwrap();
    store
        .prepare(&file, "Save")
        .unwrap()
        .unwrap()
        .commit()
        .unwrap();
    let committed = store.list(&file).unwrap()[0].id.clone();
    store.recover_pending().unwrap();
    assert!(
        !orphan.exists(),
        "Interrupted uncatalogued bytes must not consume quota forever"
    );
    assert!(unrelated.exists());
    assert_eq!(
        fs::read(store.snapshot_path(&file, &committed).unwrap()).unwrap(),
        b"committed"
    );
}

#[cfg(windows)]
#[test]
fn recovery_retries_retention_after_catalog_pruning_failed() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a");
    let root = dir.path().join("history");
    let store = BackupStore::with_limits(root.clone(), 2, 6);
    for bytes in [b"one", b"two"] {
        fs::write(&file, bytes).unwrap();
        store
            .prepare(&file, "Save")
            .unwrap()
            .unwrap()
            .commit()
            .unwrap();
    }
    let oldest = store.list(&file).unwrap().last().unwrap().id.clone();
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(root.join(format!("{oldest}.json")))
        .unwrap();
    fs::write(&file, b"tri").unwrap();
    let prepared = store.prepare(&file, "Save").unwrap().unwrap();
    let newest = prepared.entry().id.clone();
    assert!(prepared.commit().is_err());
    assert_eq!(store.list(&file).unwrap().len(), 3);
    drop(held);
    store.recover_pending().unwrap();
    let entries = store.list(&file).unwrap();
    assert_eq!(
        entries.len(),
        2,
        "Recovery must retry previously failed retention even without pending catalogs"
    );
    assert_eq!(entries[0].id, newest);
    assert!(entries.iter().map(|entry| entry.size).sum::<u64>() <= 6);
}

#[cfg(windows)]
#[test]
fn recovery_cleans_bytes_left_after_prune_removed_catalog() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a");
    let root = dir.path().join("history");
    let store = BackupStore::with_limits(root.clone(), 1, 3);
    fs::write(&file, b"one").unwrap();
    store
        .prepare(&file, "Save")
        .unwrap()
        .unwrap()
        .commit()
        .unwrap();
    let oldest = store.list(&file).unwrap()[0].id.clone();
    let old_bin = root.join(format!("{oldest}.bin"));
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&old_bin)
        .unwrap();
    fs::write(&file, b"two").unwrap();
    assert!(store
        .prepare(&file, "Save")
        .unwrap()
        .unwrap()
        .commit()
        .is_err());
    assert!(!root.join(format!("{oldest}.json")).exists());
    assert!(old_bin.exists());
    drop(held);
    store.recover_pending().unwrap();
    assert!(!old_bin.exists());
    assert_eq!(store.list(&file).unwrap().len(), 1);
}
