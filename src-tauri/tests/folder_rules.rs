use o_compare_rust::folders::{compare_with_options, FolderCompareOptions, FolderStatus};
use std::{fs, sync::atomic::AtomicBool};

#[test]
fn minor_preserves_byte_identity_and_final_newlines() {
    let root = tempfile::tempdir().unwrap();
    let l = root.path().join("l");
    let r = root.path().join("r");
    fs::create_dir_all(l.join("nested")).unwrap();
    fs::create_dir_all(r.join("nested")).unwrap();
    for (name, a, b) in [
        ("same", "same\n", "same\n"),
        ("nested/minor.sql", " SELECT  1;\r\n", "SELECT\t1;\n"),
        ("newline", "a\n", "a"),
        ("case", "A", "a"),
    ] {
        fs::write(l.join(name), a).unwrap();
        fs::write(r.join(name), b).unwrap();
    }
    let result = compare_with_options(
        &l,
        &r,
        "rules",
        &FolderCompareOptions::default(),
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    let status = |name| {
        result
            .entries
            .iter()
            .find(|e| e.relative_path == name)
            .unwrap()
            .status
    };
    assert_eq!(status("same"), FolderStatus::Identical);
    assert_eq!(status("nested/minor.sql"), FolderStatus::Minor);
    assert_eq!(status("nested"), FolderStatus::Minor);
    assert_eq!(status("newline"), FolderStatus::Different);
    assert_eq!(status("case"), FolderStatus::Different);
    assert_eq!(result.summary.minor, 1);
    assert_eq!(
        result
            .entries
            .iter()
            .find(|e| e.relative_path == "nested")
            .unwrap()
            .left
            .as_ref()
            .unwrap()
            .size,
        13
    );
}

#[test]
fn binary_and_disabled_rules_never_become_minor() {
    let root = tempfile::tempdir().unwrap();
    let l = root.path().join("l");
    let r = root.path().join("r");
    fs::create_dir(&l).unwrap();
    fs::create_dir(&r).unwrap();
    fs::write(l.join("binary"), b"\0a b").unwrap();
    fs::write(r.join("binary"), b"\0ab").unwrap();
    fs::write(l.join("text"), b"a b").unwrap();
    fs::write(r.join("text"), b"ab").unwrap();
    let options = FolderCompareOptions {
        ignore_whitespace: false,
        ignore_eol: false,
        regex_rules: vec![],
    };
    let result = compare_with_options(
        &l,
        &r,
        "off",
        &options,
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    assert!(result
        .entries
        .iter()
        .all(|e| e.status == FolderStatus::Different));
}

#[test]
fn regex_only_rules_classify_minor_without_changing_bytes_or_bom() {
    use o_compare_rust::comparison_rules::RegexRule;
    let root = tempfile::tempdir().unwrap();
    let l = root.path().join("left");
    let r = root.path().join("right");
    fs::create_dir(&l).unwrap();
    fs::create_dir(&r).unwrap();
    fs::write(l.join("log"), "ไทย id=123 status=ok\n").unwrap();
    fs::write(r.join("log"), "ไทย id=45678 status=ok\n").unwrap();
    let options = FolderCompareOptions {
        ignore_whitespace: false,
        ignore_eol: false,
        regex_rules: vec![RegexRule {
            id: "id".into(),
            pattern: "[0-9]+".into(),
            enabled: true,
        }],
    };
    let result = compare_with_options(
        &l,
        &r,
        "regex",
        &options,
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(result.entries[0].status, FolderStatus::Minor);
    assert_eq!(
        fs::read_to_string(r.join("log")).unwrap(),
        "ไทย id=45678 status=ok\n"
    );
    fs::write(r.join("log"), "ไทย id=45678 status=failed\n").unwrap();
    let result = compare_with_options(
        &l,
        &r,
        "regex",
        &options,
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(result.entries[0].status, FolderStatus::Different);
}

#[test]
fn encoding_bom_large_files_and_blank_lines_are_not_minor() {
    let root = tempfile::tempdir().unwrap();
    let l = root.path().join("l");
    let r = root.path().join("r");
    fs::create_dir(&l).unwrap();
    fs::create_dir(&r).unwrap();
    for (name, a, b) in [
        ("bom", b"\xef\xbb\xbfab".to_vec(), b"ab".to_vec()),
        (
            "encoding",
            vec![0xff, 0xfe, b'a', 0, b'b', 0],
            b"ab".to_vec(),
        ),
        ("blank", b"a\n\nb".to_vec(), b"a\nb".to_vec()),
        (
            "large",
            vec![b'a'; 10 * 1024 * 1024 + 1],
            vec![b'b'; 10 * 1024 * 1024 + 1],
        ),
    ] {
        fs::write(l.join(name), a).unwrap();
        fs::write(r.join(name), b).unwrap();
    }
    let result = compare_with_options(
        &l,
        &r,
        "limits",
        &FolderCompareOptions::default(),
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    assert!(result
        .entries
        .iter()
        .all(|e| e.status == FolderStatus::Different));
}

#[test]
fn thai_legacy_and_utf16_minor_checks_do_not_modify_files() {
    let root = tempfile::tempdir().unwrap();
    let l = root.path().join("l");
    let r = root.path().join("r");
    fs::create_dir(&l).unwrap();
    fs::create_dir(&r).unwrap();
    for (encoding, bom) in [
        ("utf-8", false),
        ("utf-8", true),
        ("utf-16le", true),
        ("utf-16be", true),
        ("windows-874", false),
    ] {
        let a = o_compare_rust::encoding::encode("ภาษาไทย SELECT  1;\r\n", encoding, bom).unwrap();
        let b = o_compare_rust::encoding::encode("ภาษาไทยSELECT\t1;\n", encoding, bom).unwrap();
        let name = format!("{encoding}-{bom}");
        fs::write(l.join(&name), &a).unwrap();
        fs::write(r.join(&name), &b).unwrap();
        let result = compare_with_options(
            &l,
            &r,
            "thai",
            &FolderCompareOptions::default(),
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(
            result
                .entries
                .iter()
                .find(|e| e.relative_path == name)
                .unwrap()
                .status,
            FolderStatus::Minor
        );
        assert_eq!(fs::read(l.join(name)).unwrap(), a);
    }
}
