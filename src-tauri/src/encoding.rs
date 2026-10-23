use crate::error::AppError;
use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::Encoding;

/// ตรวจ BOM ก่อน UTF-8 และใช้ detector เฉพาะไฟล์ legacy
pub fn decode(bytes: &[u8]) -> Result<(String, String, bool), AppError> {
    if let Some(rest) = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        return std::str::from_utf8(rest)
            .map(|s| (s.to_owned(), "utf-8".into(), true))
            .map_err(|e| AppError::new("DECODE", e, None));
    }
    for (bom, little, name) in [
        ([0xff, 0xfe], true, "utf-16le"),
        ([0xfe, 0xff], false, "utf-16be"),
    ] {
        if let Some(rest) = bytes.strip_prefix(&bom) {
            if rest.len() % 2 != 0 {
                return Err(AppError::new("DECODE", "Incomplete UTF-16 code unit", None));
            }
            let units: Vec<u16> = rest
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| {
                    if little {
                        u16::from_le_bytes([p[0], p[1]])
                    } else {
                        u16::from_be_bytes([p[0], p[1]])
                    }
                })
                .collect();
            return String::from_utf16(&units)
                .map(|s| (s, name.into(), true))
                .map_err(|e| AppError::new("DECODE", e, None));
        }
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok((text.into(), "utf-8".into(), false));
    }
    let mut detector = EncodingDetector::new(Iso2022JpDetection::Allow);
    detector.feed(bytes, true);
    let enc = detector.guess(None, Utf8Detection::Deny);
    let text = enc
        .decode_without_bom_handling_and_without_replacement(bytes)
        .ok_or_else(|| AppError::new("DECODE", "Invalid bytes for detected encoding", None))?;
    let name = if enc == encoding_rs::WINDOWS_874 {
        "cp874".into()
    } else {
        enc.name().to_ascii_lowercase()
    };
    Ok((text.into_owned(), name, false))
}

/// เข้ารหัสให้เสร็จก่อนเปิดไฟล์เขียน เพื่อป้องกันข้อมูลเดิมเสียเมื่อ encode ไม่ได้
pub fn encode(text: &str, encoding: &str, bom: bool) -> Result<Vec<u8>, AppError> {
    let name = encoding.to_ascii_lowercase();
    let mut bytes = Vec::new();
    match name.as_str() {
        "utf-8" | "utf8" => {
            if bom {
                bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
            }
            bytes.extend_from_slice(text.as_bytes());
        }
        "utf-16le" | "utf-16be" => {
            let little = name == "utf-16le";
            if bom {
                bytes.extend_from_slice(if little { &[0xff, 0xfe] } else { &[0xfe, 0xff] });
            }
            for unit in text.encode_utf16() {
                bytes.extend_from_slice(&if little {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
        }
        _ => {
            let label = if matches!(name.as_str(), "tis-620" | "cp874") {
                "windows-874"
            } else {
                &name
            };
            let enc = Encoding::for_label(label.as_bytes()).ok_or_else(|| {
                AppError::new(
                    "ENCODING",
                    format!("Unsupported encoding: {encoding}"),
                    None,
                )
            })?;
            // UTF-16 aliases must never silently select encoding_rs's UTF-8 encoder.
            if enc == encoding_rs::UTF_16LE || enc == encoding_rs::UTF_16BE {
                return Err(AppError::new(
                    "ENCODING",
                    "Use utf-16le or utf-16be explicitly",
                    None,
                ));
            }
            let (encoded, _, had_errors) = enc.encode(text);
            if had_errors {
                return Err(AppError::new(
                    "ENCODE",
                    format!("Text contains characters not representable in {encoding}"),
                    None,
                ));
            }
            bytes.extend_from_slice(&encoded);
        }
    }
    Ok(bytes)
}
