use o_compare_rust::compare_history::{
    append, append_with_texts, load, read_snapshot, save, CompareHistory, EntryKind, EntryResult,
    FileResult, FileStatus, FolderResult, HistoryEntry, MAX_ENTRIES, MAX_SNAPSHOT_BYTES,
};
use std::fs;

fn file_entry(id: &str, status: FileStatus) -> HistoryEntry {
    HistoryEntry {
        id: id.into(),
        created_at_ms: 1_700_000_000_000,
        kind: EntryKind::File,
        left_path: "E:\\ซ้าย\\a.txt".into(),
        right_path: "E:\\right\\a.txt".into(),
        left_text: false,
        right_text: false,
        result: EntryResult::File(FileResult {
            status,
            change_count: Some(if status == FileStatus::Identical { 0 } else { 3 }),
            rules_applied: None,
        }),
    }
}

fn folder_entry(id: &str) -> HistoryEntry {
    HistoryEntry {
        id: id.into(),
        created_at_ms: 1_700_000_000_001,
        kind: EntryKind::Folder,
        left_path: "E:\\left".into(),
        right_path: "E:\\right".into(),
        left_text: false,
        right_text: false,
        result: EntryResult::Folder(FolderResult {
            files: 9,
            directories: 2,
            identical: 4,
            minor: 1,
            different: 2,
            left_only: 1,
            right_only: 1,
            errors: 0,
            skipped: 0,
        }),
    }
}

#[test]
fn missing_file_is_empty_and_entries_roundtrip_in_order() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("compare-history.json");
    assert_eq!(load(&path).unwrap(), CompareHistory::empty());
    append(&path, file_entry("a", FileStatus::Different)).unwrap();
    append(&path, file_entry("b", FileStatus::Identical)).unwrap();
    append(&path, folder_entry("c")).unwrap();
    let history = load(&path).unwrap();
    let ids: Vec<_> = history.entries.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, ["a", "b", "c"]);
    assert_eq!(history.entries[0], file_entry("a", FileStatus::Different));
    assert_eq!(history.entries[2], folder_entry("c"));
    let json: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(json["entries"][2]["result"]["leftOnly"], 1);
    assert_eq!(json["entries"][0]["result"]["status"], "different");
    assert_eq!(json["entries"][0]["kind"], "file");
}

#[test]
fn same_pair_appended_twice_creates_two_entries() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("compare-history.json");
    append(&path, folder_entry("one")).unwrap();
    append(&path, folder_entry("two")).unwrap();
    assert_eq!(load(&path).unwrap().entries.len(), 2);
    assert!(append(&path, folder_entry("two")).is_err(), "duplicate ids are rejected");
}

#[test]
fn oldest_entries_are_dropped_beyond_the_limit() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("compare-history.json");
    for i in 0..MAX_ENTRIES + 5 {
        append(&path, folder_entry(&format!("id-{i}"))).unwrap();
    }
    let history = load(&path).unwrap();
    assert_eq!(history.entries.len(), MAX_ENTRIES);
    assert_eq!(history.entries[0].id, "id-5");
    assert_eq!(history.entries.last().unwrap().id, format!("id-{}", MAX_ENTRIES + 4));
}

#[test]
fn corrupt_and_future_files_are_preserved() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("compare-history.json");
    for content in ["{broken", "{\"version\":2,\"entries\":[]}"] {
        fs::write(&path, content).unwrap();
        assert!(load(&path).is_err());
        assert!(append(&path, file_entry("x", FileStatus::Identical)).is_err());
        assert!(save(&path, &CompareHistory::empty()).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
    }
}

#[test]
fn invalid_entries_are_rejected_without_touching_the_file() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("compare-history.json");
    append(&path, file_entry("good", FileStatus::Different)).unwrap();
    let original = fs::read(&path).unwrap();
    let mut mismatched = folder_entry("bad");
    mismatched.kind = EntryKind::File;
    assert!(append(&path, mismatched).is_err());
    let mut empty_path = file_entry("bad2", FileStatus::Different);
    empty_path.left_path.clear();
    assert!(append(&path, empty_path).is_err());
    let mut contradictory = file_entry("bad3", FileStatus::Identical);
    contradictory.result = EntryResult::File(FileResult {
        status: FileStatus::Identical,
        change_count: Some(2),
        rules_applied: None,
    });
    assert!(append(&path, contradictory).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
}

#[test]
fn json_from_the_renderer_deserializes_and_unknown_fields_fail() {
    let ok = r#"{"id":"1","createdAtMs":5,"kind":"file","leftPath":"a","rightPath":"b","result":{"status":"identical","changeCount":0,"rulesApplied":true}}"#;
    let entry: HistoryEntry = serde_json::from_str(ok).unwrap();
    assert_eq!(entry.kind, EntryKind::File);
    let folder = r#"{"id":"2","createdAtMs":5,"kind":"folder","leftPath":"a","rightPath":"b","result":{"files":1,"directories":0,"identical":1,"minor":0,"different":0,"leftOnly":0,"rightOnly":0,"errors":0,"skipped":0}}"#;
    assert!(matches!(
        serde_json::from_str::<HistoryEntry>(folder).unwrap().result,
        EntryResult::Folder(_)
    ));
    let extra = ok.replace("\"kind\":\"file\"", "\"kind\":\"file\",\"surprise\":1");
    assert!(serde_json::from_str::<HistoryEntry>(&extra).is_err());
}

#[test]
fn concurrent_appends_do_not_lose_entries() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("compare-history.json");
    let handles: Vec<_> = (0..8)
        .map(|t| {
            let path = path.clone();
            std::thread::spawn(move || {
                for i in 0..10 {
                    append(&path, folder_entry(&format!("t{t}-{i}"))).unwrap();
                }
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
    assert_eq!(load(&path).unwrap().entries.len(), 80);
}

#[test]
fn failed_save_keeps_the_previous_file() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("compare-history.json");
    append(&path, file_entry("a", FileStatus::Different)).unwrap();
    let original = fs::read(&path).unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(append(&path, file_entry("b", FileStatus::Identical)).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
}

fn text_entry(id: &str, left: bool, right: bool) -> HistoryEntry {
    let mut entry = file_entry(id, FileStatus::Different);
    if left {
        entry.left_path = "Pasted text".into();
        entry.left_text = true;
    }
    if right {
        entry.right_path = "Pasted text".into();
        entry.right_text = true;
    }
    entry
}

#[test]
fn pasted_text_is_kept_as_a_snapshot_and_reads_back_after_reopening() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("compare-history.json");
    let left = "สวัสดี 😀\nline two\r\nend";
    append_with_texts(&path, text_entry("t1", true, true), Some(left), Some("right\n")).unwrap();
    append_with_texts(&path, text_entry("t2", false, true), None, Some("only right")).unwrap();
    let history = load(&path).unwrap();
    assert!(history.entries[0].left_text && history.entries[0].right_text);
    assert!(!history.entries[1].left_text && history.entries[1].right_text);
    assert_eq!(read_snapshot(&path, "t1", "left").unwrap(), left);
    assert_eq!(read_snapshot(&path, "t1", "right").unwrap(), "right\n");
    assert_eq!(read_snapshot(&path, "t2", "right").unwrap(), "only right");
    assert!(read_snapshot(&path, "t2", "left").is_err(), "a file side has no snapshot");
    assert!(read_snapshot(&path, "missing", "left").is_err());
    assert!(read_snapshot(&path, "t1", "up").is_err());
    let json: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(json["entries"][0]["leftText"], true);
    assert!(json["entries"][1].get("leftText").is_none(), "false flags are not written");
}

#[test]
fn text_flags_and_texts_must_match_and_ids_cannot_escape() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("compare-history.json");
    assert!(append_with_texts(&path, text_entry("a", true, false), None, None).is_err());
    assert!(append_with_texts(&path, file_entry("b", FileStatus::Different), Some("x"), None).is_err());
    let mut folder = folder_entry("c");
    folder.left_text = true;
    assert!(append_with_texts(&path, folder, Some("x"), None).is_err());
    for bad in [r"..\evil", "a/b", "a.b", ""] {
        assert!(append_with_texts(&path, text_entry(bad, true, false), Some("x"), None).is_err(), "{bad}");
    }
    assert!(load(&path).unwrap().entries.is_empty());
    assert!(!root.path().join("compare-history.snapshots").exists() || fs::read_dir(root.path().join("compare-history.snapshots")).unwrap().next().is_none());
}

#[test]
fn oversized_text_is_rejected_without_leaving_files() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("compare-history.json");
    let big = "x".repeat(MAX_SNAPSHOT_BYTES + 1);
    assert!(append_with_texts(&path, text_entry("big", true, false), Some(&big), None).is_err());
    assert!(load(&path).unwrap().entries.is_empty());
    let dir = root.path().join("compare-history.snapshots");
    assert!(!dir.exists() || fs::read_dir(dir).unwrap().next().is_none());
}

#[test]
fn trimmed_entries_delete_their_snapshots_and_failed_saves_clean_up() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("compare-history.json");
    let dir = root.path().join("compare-history.snapshots");
    append_with_texts(&path, text_entry("oldest", true, true), Some("l"), Some("r")).unwrap();
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
    for i in 0..MAX_ENTRIES {
        append(&path, folder_entry(&format!("f-{i}"))).unwrap();
    }
    let history = load(&path).unwrap();
    assert_eq!(history.entries.len(), MAX_ENTRIES);
    assert!(history.entries.iter().all(|e| e.id != "oldest"));
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 0, "snapshots of dropped entries are removed");
    assert!(read_snapshot(&path, "oldest", "left").is_err());

    // A failed save leaves neither a listed entry nor orphaned snapshot files.
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(append_with_texts(&path, text_entry("late", true, true), Some("l"), Some("r")).is_err());
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
}
