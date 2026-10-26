use o_compare_rust::{
    folder_copy::CopyService,
    folder_sessions,
    folders::{compare_with_options, validate_ignored_folders, FolderCompareOptions},
};
use std::{fs, path::Path, sync::atomic::AtomicBool};

fn fixture() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let (left, right) = (root.path().join("l"), root.path().join("r"));
    for side in [&left, &right] {
        for dir in ["build/obj", "builder", "src/generated", "other/generated", "ไทย/ผลลัพธ์"] {
            fs::create_dir_all(side.join(dir)).unwrap();
        }
    }
    let files = [
        "build/obj/a.o",
        "build/b.txt",
        "builder/keep.txt",
        "src/generated/g.cs",
        "src/real.cs",
        "other/generated/g.cs",
        "ไทย/ผลลัพธ์/x.txt",
    ];
    for file in files {
        fs::write(left.join(file), "left").unwrap();
        fs::write(right.join(file), "right").unwrap();
    }
    // Present on one side only: still ignorable.
    fs::create_dir_all(left.join("only-left/cache")).unwrap();
    fs::write(left.join("only-left/cache/c.txt"), "c").unwrap();
    (root, left, right)
}

fn compare(left: &Path, right: &Path, ignored: &[&str]) -> Vec<String> {
    let options = FolderCompareOptions {
        ignored_folders: ignored.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    };
    let result = compare_with_options(left, right, "t", &options, &AtomicBool::new(false), &mut |_| {})
        .unwrap();
    result.entries.into_iter().map(|e| e.relative_path).collect()
}

#[test]
fn ignored_subtree_is_removed_without_touching_similar_names_or_locations() {
    let (_root, left, right) = fixture();
    let all = compare(&left, &right, &[]);
    assert!(all.contains(&"build/obj/a.o".to_string()));
    let ignored = compare(&left, &right, &["build", "src/generated", "ไทย/ผลลัพธ์", "only-left/cache"]);
    assert!(!ignored.iter().any(|p| p == "build" || p.starts_with("build/")));
    assert!(ignored.contains(&"builder/keep.txt".to_string()), "`builder` is not `build`");
    assert!(!ignored.iter().any(|p| p.starts_with("src/generated")));
    assert!(ignored.contains(&"src/real.cs".to_string()));
    assert!(ignored.contains(&"other/generated/g.cs".to_string()), "other location with the same name stays");
    assert!(!ignored.iter().any(|p| p.starts_with("ไทย/ผลลัพธ์")));
    assert!(ignored.contains(&"ไทย".to_string()));
    assert!(ignored.contains(&"only-left".to_string()));
    assert!(!ignored.contains(&"only-left/cache".to_string()), "one-sided folder ignored");
}

#[test]
fn nested_ignore_inside_ignored_parent_and_summary_exclude_the_subtree() {
    let (_root, left, right) = fixture();
    let options = FolderCompareOptions {
        ignored_folders: vec!["build/obj".into(), "build".into()],
        ..Default::default()
    };
    let result = compare_with_options(&left, &right, "t", &options, &AtomicBool::new(false), &mut |_| {}).unwrap();
    assert!(result
        .entries
        .iter()
        .all(|e| e.relative_path != "build" && !e.relative_path.starts_with("build/")));
    let files = result.entries.iter().filter(|e| e.kind == "file").count() as u64;
    assert_eq!(result.summary.files, files);
    let only = compare(&left, &right, &["build/obj"]);
    assert!(only.contains(&"build/b.txt".to_string()));
    assert!(!only.contains(&"build/obj".to_string()));
}

#[test]
#[cfg(windows)]
fn windows_ignore_matches_case_insensitively() {
    let (_root, left, right) = fixture();
    let ignored = compare(&left, &right, &["SRC/Generated"]);
    assert!(!ignored.iter().any(|p| p.starts_with("src/generated")));
}

#[test]
fn unsafe_paths_are_rejected_before_scanning() {
    for bad in ["", "/abs", "C:\\x", "C:/x", "..", "a/../b", "../a", "a//b", "a/", "./a", "a\\b", "\\\\server\\share"] {
        assert!(validate_ignored_folders(&[bad.to_string()]).is_err(), "{bad:?} must be rejected");
    }
    assert!(validate_ignored_folders(&["ไทย/โฟลเดอร์ ย่อย".into(), "a/b".into()]).is_ok());
    let (_root, left, right) = fixture();
    let options = FolderCompareOptions {
        ignored_folders: vec!["../x".into()],
        ..Default::default()
    };
    assert!(compare_with_options(&left, &right, "t", &options, &AtomicBool::new(false), &mut |_| {}).is_err());
}

#[test]
fn copying_a_parent_does_not_include_ignored_descendants() {
    let (_root, left, right) = fixture();
    fs::create_dir_all(left.join("fresh/generated")).unwrap();
    fs::write(left.join("fresh/a.txt"), "a").unwrap();
    fs::write(left.join("fresh/generated/g.txt"), "g").unwrap();
    let service = CopyService::default();
    let cancel = AtomicBool::new(false);
    let ignored = vec!["fresh/generated".to_string()];
    let all: Vec<String> = compare(&left, &right, &["fresh/generated"])
        .into_iter()
        .filter(|p| p.starts_with("fresh"))
        .collect();
    let plan = service
        .plan_with_ignored(&left, &right, "left", &all, &ignored, &cancel)
        .unwrap();
    assert!(plan.items.iter().all(|i| !i.relative_path.starts_with("fresh/generated")));
    assert!(plan.items.iter().any(|i| i.relative_path == "fresh/a.txt"));
    // A path inside the ignored subtree is outside the comparison, so it cannot be planned.
    assert!(service
        .plan_with_ignored(&left, &right, "left", &["fresh/generated/g.txt".into()], &ignored, &cancel)
        .is_err());
}

#[test]
fn sessions_accept_old_files_and_reject_invalid_ignored_paths() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("sessions.json");
    let session = |rules: serde_json::Value| {
        serde_json::json!({"version":1,"history":[],"sessions":[{"id":"one","name":"n","leftPath":"L","rightPath":"R","rules":rules,"view":{"include":"*.*","exclude":"","structure":"tree","peek":false,"showMinor":true,"statuses":[],"sort":"name","sortSide":"left","descending":false,"split":50,"columns":[88,156,88,156]}}]})
    };
    let old = session(serde_json::json!({"ignoreEol":true,"ignoreWhitespace":true}));
    folder_sessions::save(&path, &old).unwrap();
    let with = session(serde_json::json!({"ignoreEol":true,"ignoreWhitespace":true,"ignoredFolders":["src/generated","ไทย"]}));
    folder_sessions::save(&path, &with).unwrap();
    assert_eq!(folder_sessions::load(&path).unwrap(), with);
    let original = fs::read(&path).unwrap();
    for bad in [serde_json::json!(["/abs"]), serde_json::json!(["a/../b"]), serde_json::json!("src"), serde_json::json!([1])] {
        let invalid = session(serde_json::json!({"ignoreEol":true,"ignoreWhitespace":true,"ignoredFolders":bad}));
        assert!(folder_sessions::save(&path, &invalid).is_err());
    }
    assert_eq!(fs::read(&path).unwrap(), original);
}
