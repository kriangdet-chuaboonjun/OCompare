use crate::error::AppError;
use serde_json::{json, Value};
use std::{fs, io::Write, path::Path};

fn validate(value: &Value) -> Result<(), AppError> {
    let invalid = || {
        AppError::new(
            "SESSIONS_FORMAT",
            "Invalid or unsupported sessions file; original preserved",
            None,
        )
    };
    if value["version"] != 1 {
        return Err(invalid());
    }
    let sessions = value["sessions"].as_array().ok_or_else(invalid)?;
    let history = value["history"].as_array().ok_or_else(invalid)?;
    if sessions.len() > 200
        || history.len() > 50
        || history
            .iter()
            .any(|v| v.as_str().is_none_or(|v| v.len() > 32768))
    {
        return Err(invalid());
    }
    let mut ids = std::collections::HashSet::new();
    for s in sessions {
        for key in ["id", "name", "leftPath", "rightPath"] {
            if s[key]
                .as_str()
                .is_none_or(|s| s.is_empty() || s.len() > 32768)
            {
                return Err(invalid());
            }
        }
        if !ids.insert(s["id"].as_str().unwrap()) {
            return Err(invalid());
        }
        for key in ["ignoreWhitespace", "ignoreEol"] {
            if !s["rules"][key].is_boolean() {
                return Err(invalid());
            }
        }
        if let Some(rules) = s["rules"].get("regexRules") {
            let rules: Vec<crate::comparison_rules::RegexRule> =
                serde_json::from_value(rules.clone()).map_err(|_| invalid())?;
            crate::comparison_rules::CompiledRules::compile(&rules).map_err(|_| invalid())?;
        }
        if let Some(ignored) = s["rules"].get("ignoredFolders") {
            let ignored: Vec<String> = serde_json::from_value(ignored.clone()).map_err(|_| invalid())?;
            crate::folders::validate_ignored_folders(&ignored).map_err(|_| invalid())?;
        }
        let v = &s["view"];
        for key in ["include", "exclude"] {
            if v[key].as_str().is_none_or(|s| s.len() > 4096) {
                return Err(invalid());
            }
        }
        for key in ["peek", "showMinor", "descending"] {
            if !v[key].is_boolean() {
                return Err(invalid());
            }
        }
        if !matches!(v["structure"].as_str(), Some("tree" | "flat"))
            || !matches!(v["sort"].as_str(), Some("name" | "size" | "modified"))
            || !matches!(v["sortSide"].as_str(), Some("left" | "right"))
        {
            return Err(invalid());
        }
        if v["split"]
            .as_f64()
            .is_none_or(|n| !(25.0..=75.0).contains(&n))
        {
            return Err(invalid());
        }
        let cols = v["columns"].as_array().ok_or_else(invalid)?;
        if cols.len() != 4
            || cols
                .iter()
                .any(|v| v.as_f64().is_none_or(|n| !(55.0..=320.0).contains(&n)))
        {
            return Err(invalid());
        }
        let statuses = v["statuses"].as_array().ok_or_else(invalid)?;
        if statuses.len() > 7
            || statuses.iter().any(|v| {
                !matches!(
                    v.as_str(),
                    Some(
                        "identical"
                            | "minor"
                            | "different"
                            | "left-only"
                            | "right-only"
                            | "error"
                            | "skipped"
                    )
                )
            })
        {
            return Err(invalid());
        }
    }
    Ok(())
}
pub fn load(path: &Path) -> Result<Value, AppError> {
    if !path.exists() {
        return Ok(json!({"version":1,"sessions":[],"history":[]}));
    }
    let meta = fs::metadata(path).map_err(|e| AppError::new("SESSIONS_READ", e, Some(path)))?;
    if meta.len() > 1024 * 1024 {
        return Err(AppError::new(
            "SESSIONS_FORMAT",
            "Sessions file exceeds 1 MiB; original preserved",
            Some(path),
        ));
    }
    let value: Value = serde_json::from_slice(
        &fs::read(path).map_err(|e| AppError::new("SESSIONS_READ", e, Some(path)))?,
    )
    .map_err(|e| AppError::new("SESSIONS_FORMAT", e, Some(path)))?;
    validate(&value)?;
    Ok(value)
}
/// Never overwrite corrupt settings; persist replaces the valid file atomically.
pub fn save(path: &Path, value: &Value) -> Result<(), AppError> {
    validate(value)?;
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|e| AppError::new("SESSIONS_FORMAT", e, None))?;
    if bytes.len() > 1024 * 1024 {
        return Err(AppError::new(
            "SESSIONS_FORMAT",
            "Sessions exceed 1 MiB; original preserved",
            Some(path),
        ));
    }
    if path.exists() {
        load(path)?;
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::new("SESSIONS_WRITE", "Missing parent", Some(path)))?;
    fs::create_dir_all(parent).map_err(|e| AppError::new("SESSIONS_WRITE", e, Some(parent)))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| AppError::new("SESSIONS_WRITE", e, Some(parent)))?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| AppError::new("SESSIONS_WRITE", e, Some(path)))?;
    temp.persist(path)
        .map_err(|e| AppError::new("SESSIONS_WRITE", e.error, Some(path)))?;
    Ok(())
}
