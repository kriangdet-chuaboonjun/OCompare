use o_compare_rust::folder_copy::CopyService;
#[test]
fn copy_overwrites_are_backed_up_and_backup_failure_preserves_destination() {
    use o_compare_rust::backups::BackupStore;
    let (root, l, r) = fixture();
    fs::write(l.join("file"), "new").unwrap();
    fs::write(r.join("file"), "old").unwrap();
    let service = CopyService::default();
    let cancel = AtomicBool::new(false);
    let store = BackupStore::new(root.path().join("history"));
    let plan = service
        .plan(&l, &r, "left", &["file".into()], &cancel)
        .unwrap();
    let report = service
        .execute_with_backups(&plan.plan_id, &cancel, &mut |_, _, _| {}, &store)
        .unwrap();
    assert_eq!(report.items[0].status, "copied");
    let history = store.list(&r.join("file")).unwrap();
    assert_eq!(
        fs::read(
            store
                .snapshot_path(&r.join("file"), &history[0].id)
                .unwrap()
        )
        .unwrap(),
        b"old"
    );
    fs::write(l.join("file"), "newer").unwrap();
    let tiny = BackupStore::with_limits(root.path().join("tiny"), 20, 1);
    let plan = service
        .plan(&l, &r, "left", &["file".into()], &cancel)
        .unwrap();
    let report = service
        .execute_with_backups(&plan.plan_id, &cancel, &mut |_, _, _| {}, &tiny)
        .unwrap();
    assert_eq!(report.items[0].status, "failed");
    assert_eq!(fs::read(r.join("file")).unwrap(), b"new");
}
use std::{fs, sync::atomic::AtomicBool};
fn fixture() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let l = root.path().join("ซ้าย left");
    let r = root.path().join("right");
    fs::create_dir(&l).unwrap();
    fs::create_dir(&r).unwrap();
    (root, l, r)
}
#[test]
fn preview_is_read_only_and_copy_preserves_unselected_files() {
    let (_root, l, r) = fixture();
    fs::write(l.join("file.txt"), "new").unwrap();
    fs::write(r.join("file.txt"), "old").unwrap();
    fs::write(r.join("extra"), "keep").unwrap();
    let service = CopyService::default();
    let cancel = AtomicBool::new(false);
    let plan = service
        .plan(
            &l,
            &r,
            "left",
            &["file.txt".into(), "file.txt".into()],
            &cancel,
        )
        .unwrap();
    assert_eq!(plan.items.len(), 1);
    assert_eq!(plan.items[0].action, "overwrite");
    assert_eq!(fs::read(r.join("file.txt")).unwrap(), b"old");
    let result = service
        .execute(&plan.plan_id, &cancel, &mut |_, _, _| {})
        .unwrap();
    assert_eq!(result.items[0].status, "copied");
    assert_eq!(fs::read(r.join("file.txt")).unwrap(), b"new");
    assert_eq!(fs::read(r.join("extra")).unwrap(), b"keep");
    assert!(service
        .execute(&plan.plan_id, &cancel, &mut |_, _, _| {})
        .is_err());
}
#[test]
fn stale_destination_cancel_and_overlap_do_not_overwrite() {
    let (_root, l, r) = fixture();
    fs::write(l.join("a"), "new").unwrap();
    fs::write(r.join("a"), "old").unwrap();
    let s = CopyService::default();
    let c = AtomicBool::new(false);
    let p = s.plan(&l, &r, "left", &["a".into()], &c).unwrap();
    fs::write(r.join("a"), "external").unwrap();
    let result = s.execute(&p.plan_id, &c, &mut |_, _, _| {}).unwrap();
    assert_eq!(result.items[0].status, "skipped");
    assert_eq!(fs::read(r.join("a")).unwrap(), b"external");
    let p = s.plan(&l, &r, "left", &["a".into()], &c).unwrap();
    c.store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(
        s.execute(&p.plan_id, &c, &mut |_, _, _| {})
            .unwrap()
            .canceled
    );
    assert_eq!(fs::read(r.join("a")).unwrap(), b"external");
    c.store(false, std::sync::atomic::Ordering::SeqCst);
    assert!(s.plan(&l, &l, "left", &[], &c).is_err());
    fs::create_dir(l.join("nested")).unwrap();
    assert!(s.plan(&l, &l.join("nested"), "left", &[], &c).is_err());
    assert!(s.plan(&l, &r, "left", &["../outside".into()], &c).is_err());
}
#[test]
fn conflict_and_links_are_skipped_and_source_changes_are_rejected() {
    let (_root, l, r) = fixture();
    fs::write(l.join("conflict"), "file").unwrap();
    fs::create_dir(r.join("conflict")).unwrap();
    fs::write(l.join("a"), "old source").unwrap();
    let s = CopyService::default();
    let c = AtomicBool::new(false);
    let p = s
        .plan(&l, &r, "left", &["conflict".into(), "a".into()], &c)
        .unwrap();
    fs::write(l.join("a"), "new source").unwrap();
    let report = s.execute(&p.plan_id, &c, &mut |_, _, _| {}).unwrap();
    assert!(report.items.iter().all(|i| i.status == "skipped"));
    assert!(!r.join("a").exists());
    assert!(r.join("conflict").is_dir());
}

#[test]
fn readonly_destination_failure_preserves_bytes_and_leaves_no_temporary_file() {
    let (_root, l, r) = fixture();
    fs::write(l.join("a"), "new").unwrap();
    fs::write(r.join("a"), "original").unwrap();
    let mut permissions = fs::metadata(r.join("a")).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(r.join("a"), permissions).unwrap();
    let service = CopyService::default();
    let cancel = AtomicBool::new(false);
    let plan = service
        .plan(&l, &r, "left", &["a".into()], &cancel)
        .unwrap();
    let report = service
        .execute(&plan.plan_id, &cancel, &mut |_, _, _| {})
        .unwrap();
    assert_eq!(report.items[0].status, "failed");
    assert_eq!(fs::read(r.join("a")).unwrap(), b"original");
    assert_eq!(fs::read_dir(&r).unwrap().count(), 1);
}

#[test]
fn cancellation_keeps_completed_files_and_reverse_copy_preserves_time() {
    let (_root, l, r) = fixture();
    fs::write(r.join("a"), "first").unwrap();
    fs::write(r.join("b"), "second").unwrap();
    let service = CopyService::default();
    let cancel = AtomicBool::new(false);
    let plan = service
        .plan(&l, &r, "right", &["a".into(), "b".into()], &cancel)
        .unwrap();
    let report = service
        .execute(&plan.plan_id, &cancel, &mut |_, _, _| {
            cancel.store(true, std::sync::atomic::Ordering::SeqCst)
        })
        .unwrap();
    assert!(report.canceled);
    assert_eq!(fs::read(l.join("a")).unwrap(), b"first");
    assert!(!l.join("b").exists());
    assert_eq!(
        fs::metadata(l.join("a")).unwrap().modified().unwrap(),
        fs::metadata(r.join("a")).unwrap().modified().unwrap()
    );
}

#[test]
#[cfg(windows)]
fn junction_inserted_after_preview_cannot_redirect_copy() {
    let (root, l, r) = fixture();
    fs::create_dir(l.join("nested")).unwrap();
    fs::write(l.join("nested/a"), "source").unwrap();
    let outside = root.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("a"), "keep").unwrap();
    let s = CopyService::default();
    let c = AtomicBool::new(false);
    let p = s.plan(&l, &r, "left", &["nested/a".into()], &c).unwrap();
    let link = r.join("nested");
    let output = std::process::Command::new("cmd.exe")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(&outside)
        .output()
        .unwrap();
    assert!(output.status.success());
    let report = s.execute(&p.plan_id, &c, &mut |_, _, _| {}).unwrap();
    assert_eq!(report.items[0].status, "skipped");
    assert_eq!(fs::read(outside.join("a")).unwrap(), b"keep");
}
