use o_compare_rust::tab_drafts::{clear, empty, load, save};
use serde_json::{json, Value};
use std::fs;

fn sample() -> Value {
    json!({
        "version": 1,
        "savedAtMs": 1_700_000_000_000u64,
        "active": 1,
        "documents": [
            {"id":"d1","path":"E:\\งาน\\ซ้าย.txt","text":"สวัสดี\nบรรทัดสอง","encoding":"utf-8","bom":false,"eol":"LF","language":"plaintext","size":24,"mtimeMs":1_699_999_999_123.5},
            {"id":"d2","path":"E:\\งาน\\ขวา.txt","text":null,"encoding":"windows-874","bom":false,"eol":"CRLF","language":null,"size":10,"mtimeMs":1_699_999_999_000.0},
            {"id":"d3","path":null,"text":"ข้อความใหม่ ✓","encoding":"utf-8","bom":false,"eol":"CRLF","language":"json","size":0,"mtimeMs":0}
        ],
        "tabs": [
            {"left":"d1","right":"d2","focused":"left","options":{"viewMode":"all","ignoreWs":false,"wrap":false},"regexRules":[]},
            {"left":"d3","right":"d1","focused":"right","options":{"viewMode":"diffs","ignoreWs":true,"wrap":true},"regexRules":[{"id":"r1","pattern":"\\d+","enabled":true}]}
        ]
    })
}

#[test]
fn missing_file_loads_as_empty() {
    let root = tempfile::tempdir().unwrap();
    let value = load(&root.path().join("tab-drafts.json")).unwrap();
    assert_eq!(value, empty());
    assert_eq!(value["tabs"].as_array().unwrap().len(), 0);
}

#[test]
fn thai_text_roundtrips_and_shared_document_is_stored_once() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("tab-drafts.json");
    save(&path, &sample()).unwrap();
    let loaded = load(&path).unwrap();
    assert_eq!(loaded, sample());
    assert_eq!(loaded["documents"][0]["text"], "สวัสดี\nบรรทัดสอง");
    // Both tabs refer to the same document id rather than carrying separate copies of the text.
    assert_eq!(loaded["tabs"][0]["left"], loaded["tabs"][1]["right"]);
    assert_eq!(loaded["documents"].as_array().unwrap().len(), 3);
}

#[test]
fn clear_forgets_drafts_and_tolerates_a_missing_file() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("tab-drafts.json");
    clear(&path).unwrap();
    save(&path, &sample()).unwrap();
    clear(&path).unwrap();
    assert!(!path.exists());
    assert_eq!(load(&path).unwrap(), empty());
}

#[test]
fn invalid_stores_are_rejected_without_touching_the_previous_file() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("tab-drafts.json");
    save(&path, &sample()).unwrap();
    let original = fs::read(&path).unwrap();
    let mut cases = Vec::new();
    let mut dangling = sample();
    dangling["tabs"][0]["left"] = json!("missing");
    cases.push(dangling);
    let mut duplicate = sample();
    duplicate["documents"][1]["id"] = json!("d1");
    cases.push(duplicate);
    let mut future = sample();
    future["version"] = json!(2);
    cases.push(future);
    let mut active = sample();
    active["active"] = json!(5);
    cases.push(active);
    let mut eol = sample();
    eol["documents"][0]["eol"] = json!("CR");
    cases.push(eol);
    let mut mode = sample();
    mode["tabs"][0]["options"]["viewMode"] = json!("wide");
    cases.push(mode);
    let mut rule = sample();
    rule["tabs"][1]["regexRules"][0]["enabled"] = json!("yes");
    cases.push(rule);
    for case in cases {
        assert!(save(&path, &case).is_err(), "{case}");
        assert_eq!(fs::read(&path).unwrap(), original);
    }
}

#[test]
fn failed_write_keeps_the_previous_recovery_data_readable() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("tab-drafts.json");
    save(&path, &sample()).unwrap();
    let original = fs::read(&path).unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions.clone()).unwrap();
    let mut newer = sample();
    newer["documents"][0]["text"] = json!("ข้อความที่เขียนไม่สำเร็จ");
    let result = save(&path, &newer);
    // Leave no stray temp files behind either.
    let entries: Vec<_> = fs::read_dir(root.path()).unwrap().collect();
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(result.is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
    assert_eq!(load(&path).unwrap(), sample());
    assert_eq!(entries.len(), 1, "temp file was cleaned up");
}

#[test]
fn unreadable_file_is_set_aside_instead_of_blocking_the_next_save() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("tab-drafts.json");
    for content in ["{broken", "{\"version\":2,\"documents\":[],\"tabs\":[]}"] {
        fs::write(&path, content).unwrap();
        assert!(load(&path).is_err(), "an unreadable file is reported, not replaced on load");
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
        save(&path, &sample()).unwrap();
        assert_eq!(load(&path).unwrap(), sample());
        let preserved: Vec<_> = fs::read_dir(root.path())
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.to_string_lossy().contains(".unreadable-"))
            .collect();
        assert_eq!(preserved.len(), 1);
        assert_eq!(fs::read_to_string(&preserved[0]).unwrap(), content);
        fs::remove_file(&preserved[0]).unwrap();
        fs::remove_file(&path).unwrap();
    }
}
