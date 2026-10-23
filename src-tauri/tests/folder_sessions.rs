use o_compare_rust::folder_sessions::{load, save};
use std::fs;
#[test]
fn corrupt_and_future_sessions_are_preserved() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("sessions.json");
    let empty = load(&path).unwrap();
    assert_eq!(empty["version"], 1);
    save(&path, &empty).unwrap();
    assert_eq!(load(&path).unwrap(), empty);
    for content in ["{broken", "{\"version\":2,\"sessions\":[],\"history\":[]}"] {
        fs::write(&path, content).unwrap();
        assert!(load(&path).is_err());
        assert!(save(&path, &empty).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
    }
}

#[test]
fn sessions_roundtrip_and_failed_save_preserves_valid_store() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("sessions.json");
    let store = serde_json::json!({"version":1,"history":["E:\\ซ้าย"],"sessions":[{"id":"one","name":"งานไทย","leftPath":"E:\\ซ้าย","rightPath":"E:\\right","rules":{"ignoreEol":true,"ignoreWhitespace":false},"view":{"include":"*.sql;*.cs","exclude":"bin/**","structure":"tree","peek":false,"showMinor":true,"statuses":["minor","different"],"sort":"size","sortSide":"right","descending":true,"split":55,"columns":[88,156,100,140]}}]});
    save(&path, &store).unwrap();
    assert_eq!(load(&path).unwrap(), store);
    let original = fs::read(&path).unwrap();
    let mut invalid = store.clone();
    invalid["sessions"][0]["view"]["split"] = serde_json::json!(90);
    assert!(save(&path, &invalid).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(save(&path, &store).is_err());
    assert_eq!(fs::read(&path).unwrap(), original);
}
