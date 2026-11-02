//! Delimiter-separated text rewritten as comma-separated rows with minimal quoting.
use super::{check_output, position};

struct Fail {
    offset: usize,
    message: &'static str,
}

/// Comma, semicolon or tab: whichever is most frequent outside quotes on the first non-empty line.
fn detect_delimiter(text: &str) -> char {
    let (mut commas, mut semicolons, mut tabs) = (0, 0, 0);
    let (mut quoted, mut started) = (false, false);
    for character in text.chars() {
        match character {
            '"' => {
                started = true;
                quoted = !quoted;
            }
            '\n' | '\r' if !quoted => {
                if started {
                    break;
                }
            }
            ',' if !quoted => {
                started = true;
                commas += 1;
            }
            ';' if !quoted => {
                started = true;
                semicolons += 1;
            }
            '\t' if !quoted => {
                started = true;
                tabs += 1;
            }
            _ => started = true,
        }
    }
    if semicolons > commas && semicolons >= tabs {
        ';'
    } else if tabs > commas && tabs > semicolons {
        '\t'
    } else {
        ','
    }
}

/// Rows of fields; a blank line is an empty row, distinct from a row holding one empty field.
fn parse(text: &str, delimiter: char) -> Result<Vec<Vec<String>>, Fail> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut field_open = false;
    let mut characters = text.char_indices().peekable();
    while let Some((offset, character)) = characters.next() {
        match character {
            '"' if !field_open => {
                field_open = true;
                loop {
                    match characters.next() {
                        None => {
                            return Err(Fail {
                                offset,
                                message: "unterminated quoted field",
                            })
                        }
                        Some((_, '"')) => {
                            if characters.peek().is_some_and(|&(_, next)| next == '"') {
                                characters.next();
                                field.push('"');
                            } else {
                                break;
                            }
                        }
                        Some((_, '\r')) => {
                            if characters.peek().is_some_and(|&(_, next)| next == '\n') {
                                characters.next();
                            }
                            field.push('\n');
                        }
                        Some((_, other)) => field.push(other),
                    }
                }
            }
            '\n' | '\r' => {
                if character == '\r' && characters.peek().is_some_and(|&(_, next)| next == '\n') {
                    characters.next();
                }
                if field_open || !row.is_empty() {
                    row.push(std::mem::take(&mut field));
                }
                rows.push(std::mem::take(&mut row));
                field_open = false;
            }
            other if other == delimiter => {
                row.push(std::mem::take(&mut field));
                field_open = false;
            }
            other => {
                field_open = true;
                field.push(other);
            }
        }
    }
    if field_open || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    Ok(rows)
}

fn write_field(field: &str, only_field: bool, out: &mut String) {
    let needs_quotes = (only_field && field.is_empty())
        || field.contains([',', '"', '\n', '\r']);
    if needs_quotes {
        out.push('"');
        out.push_str(&field.replace('"', "\"\""));
        out.push('"');
    } else {
        out.push_str(field);
    }
}

pub fn canonicalize(text: &str) -> Result<String, String> {
    let rows = parse(text, detect_delimiter(text)).map_err(|fail| {
        let (line, column) = position(text, fail.offset);
        format!("CSV parse error at line {line}, column {column}: {}", fail.message)
    })?;
    let mut out = String::new();
    for row in &rows {
        for (index, field) in row.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            write_field(field, row.len() == 1, &mut out);
        }
        out.push('\n');
        check_output(&out)?;
    }
    Ok(out)
}
