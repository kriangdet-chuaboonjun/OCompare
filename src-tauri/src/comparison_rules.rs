//! One bounded Rust regex engine for folder and editor comparisons.
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

pub const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexRule {
    pub id: String,
    pub pattern: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedLine {
    pub start_columns: Vec<u32>,
    pub end_columns: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NormalizedText {
    pub text: String,
    pub lines: Vec<NormalizedLine>,
}

#[derive(Debug, Serialize)]
pub struct NormalizedPair {
    pub left: NormalizedText,
    pub right: NormalizedText,
    pub applied: bool,
    pub reason: Option<String>,
}

pub struct CompiledRules(Vec<Regex>);

/// Keep CRLF, LF and standalone CR outside the regex input.
fn original_lines(text: &str) -> Vec<(&str, &str)> {
    let bytes = text.as_bytes();
    let mut lines = Vec::new();
    let (mut start, mut offset) = (0, 0);
    while offset < bytes.len() {
        if bytes[offset] == b'\r' || bytes[offset] == b'\n' {
            let end = offset;
            offset += 1;
            if bytes[end] == b'\r' && bytes.get(offset) == Some(&b'\n') {
                offset += 1;
            }
            lines.push((&text[start..end], &text[end..offset]));
            start = offset;
        } else {
            offset += 1;
        }
    }
    lines.push((&text[start..], ""));
    lines
}

impl CompiledRules {
    /// Validate even disabled rows so Apply cannot preserve an invalid rule.
    pub fn compile(rules: &[RegexRule]) -> Result<Self, String> {
        if rules.len() > 20 {
            return Err("At most 20 Regex rules are allowed".into());
        }
        let mut compiled = Vec::new();
        for (index, rule) in rules.iter().enumerate() {
            if rule.pattern.chars().count() > 1024 {
                return Err(format!("Rule {} exceeds 1,024 characters", index + 1));
            }
            let regex = RegexBuilder::new(&rule.pattern)
                .size_limit(2 * 1024 * 1024)
                .dfa_size_limit(2 * 1024 * 1024)
                .build()
                .map_err(|error| format!("Rule {}: {}", index + 1, error))?;
            if rule.enabled {
                compiled.push(regex);
            }
        }
        Ok(Self(compiled))
    }

    /// Match each original line independently; overlapping rules form a union.
    pub fn normalize(&self, text: &str) -> NormalizedText {
        let mut output = String::with_capacity(text.len());
        let mut lines = Vec::new();
        for (line, separator) in original_lines(text) {
            // A byte mask bounds memory even for millions of overlapping matches.
            let mut ignored = vec![false; line.len()];
            for regex in &self.0 {
                for found in regex.find_iter(line) {
                    ignored[found.start()..found.end()].fill(true);
                }
            }
            let mut mapping = NormalizedLine {
                start_columns: vec![1],
                end_columns: vec![1],
            };
            let mut column = 1u32;
            for (offset, character) in line.char_indices() {
                let removed = ignored[offset];
                let units = character.len_utf16() as u32;
                if removed {
                    column += units;
                    *mapping.start_columns.last_mut().unwrap() = column;
                } else {
                    output.push(character);
                    for _ in 0..units {
                        column += 1;
                        mapping.start_columns.push(column);
                        mapping.end_columns.push(column);
                    }
                }
            }
            output.push_str(separator);
            lines.push(mapping);
        }
        NormalizedText {
            text: output,
            lines,
        }
    }
}

/// Oversized inputs return explicit fallback status without expensive maps.
pub fn normalize_pair(
    left: &str,
    right: &str,
    rules: &[RegexRule],
) -> Result<NormalizedPair, String> {
    let compiled = CompiledRules::compile(rules)?;
    if left.len() > MAX_TEXT_BYTES || right.len() > MAX_TEXT_BYTES {
        let raw = |text: &str| NormalizedText {
            text: text.into(),
            lines: Vec::new(),
        };
        return Ok(NormalizedPair {
            left: raw(left),
            right: raw(right),
            applied: false,
            reason: Some(
                "Regex rules were not applied: input exceeds 10 MiB; showing original differences"
                    .into(),
            ),
        });
    }
    Ok(NormalizedPair {
        left: compiled.normalize(left),
        right: compiled.normalize(right),
        applied: rules.iter().any(|r| r.enabled),
        reason: None,
    })
}
