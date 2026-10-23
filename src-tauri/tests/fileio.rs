use o_compare_rust::fileio::{read_text_file, write_text_file};
use serde::Deserialize;
use std::{fs, path::PathBuf};

#[derive(Deserialize)]
struct Fixture {
    file: String,
    text: String,
    encoding: String,
    bom: bool,
    eol: String,
}

#[test]
fn legacy_oracle_and_byte_roundtrip() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures");
    let fixtures: Vec<Fixture> =
        serde_json::from_slice(&fs::read(root.join("oracle.json")).unwrap()).unwrap();
    let temp = tempfile::tempdir().unwrap();
    for expected in fixtures {
        let input = root.join(&expected.file);
        let actual = read_text_file(&input).expect(&expected.file);
        assert_eq!(actual.text, expected.text, "{} text", expected.file);
        assert_eq!(
            actual.encoding, expected.encoding,
            "{} encoding",
            expected.file
        );
        assert_eq!(actual.bom, expected.bom, "{} BOM", expected.file);
        assert_eq!(actual.eol, expected.eol, "{} EOL", expected.file);
        let output = temp.path().join(&expected.file);
        write_text_file(&output, &actual.text, &actual.encoding, actual.bom).unwrap();
        assert_eq!(
            fs::read(input).unwrap(),
            fs::read(output).unwrap(),
            "{} bytes",
            expected.file
        );
    }
}

#[test]
fn thai_path_and_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("ทดสอบ มีช่องว่าง.sql");
    let stat = write_text_file(&path, "ไทย 😀\r\n", "utf-8", true).unwrap();
    let actual = read_text_file(&path).unwrap();
    assert_eq!(actual.text, "ไทย 😀\r\n");
    assert_eq!(stat.size, fs::metadata(path).unwrap().len());
    assert!(stat.mtime_ms > 0.0);
}

#[test]
fn unencodable_save_leaves_existing_file_untouched() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("thai.txt");
    fs::write(&path, b"original").unwrap();
    assert!(write_text_file(&path, "emoji 😀", "windows-874", false).is_err());
    assert_eq!(fs::read(path).unwrap(), b"original");
}

#[test]
fn invalid_unicode_and_missing_paths_return_errors() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("broken.txt");
    for bytes in [
        vec![0xef, 0xbb, 0xbf, 0xff],
        vec![0xff, 0xfe, 0x00],
        vec![0xfe, 0xff, 0xd8, 0x00],
    ] {
        fs::write(&path, bytes).unwrap();
        assert!(read_text_file(&path).is_err());
    }
    assert!(read_text_file(&temp.path().join("missing")).is_err());
    assert!(read_text_file(temp.path()).is_err());
    assert!(write_text_file(&temp.path().join("missing/file"), "x", "utf-8", false).is_err());
    assert!(write_text_file(&path, "x", "invented-encoding", false).is_err());
}

#[test]
fn read_only_file_is_not_changed() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("readonly.txt");
    fs::write(&path, b"before").unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    let original_permissions = permissions.clone();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(write_text_file(&path, "after", "utf-8", false).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"before");
    #[cfg(windows)]
    {
        fs::set_permissions(path, original_permissions).unwrap();
    }
}
