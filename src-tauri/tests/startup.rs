use o_compare_rust::startup::{parse_paths, StartupComparison};
use std::ffi::OsString;

#[test]
fn routes_files_folders_and_rejects_invalid_pairs() {
    let dir = tempfile::tempdir().unwrap();
    let left = dir.path().join("ซ้าย & left.txt");
    let right = dir.path().join("ขวา % right.txt");
    std::fs::write(&left, "left").unwrap();
    std::fs::write(&right, "right").unwrap();
    let args = |a: &std::path::Path, b: &std::path::Path| {
        vec![OsString::from("--compare"), a.into(), b.into()]
    };
    assert!(
        matches!(parse_paths(args(&left, &right)).unwrap(), Some(StartupComparison { mode, .. }) if mode == "files")
    );
    assert!(
        matches!(parse_paths(args(dir.path(), dir.path())).unwrap(), Some(StartupComparison { mode, .. }) if mode == "folders")
    );
    assert!(parse_paths(args(&left, dir.path())).is_err());
    assert!(parse_paths(args(&left, &dir.path().join("missing"))).is_err());
    assert!(parse_paths(vec![OsString::from("--compare")]).is_err());
    assert!(parse_paths(Vec::<OsString>::new()).unwrap().is_none());
    #[cfg(windows)]
    assert_eq!(
        parse_paths(args(
            std::path::Path::new("C:\\"),
            std::path::Path::new("C:\\")
        ))
        .unwrap()
        .unwrap()
        .mode,
        "folders"
    );
    assert_eq!(
        parse_paths(vec![left.into_os_string()])
            .unwrap()
            .unwrap()
            .paths
            .len(),
        1
    );
}
