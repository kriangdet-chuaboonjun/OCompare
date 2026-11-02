//! Canonical text for structure-aware (formatting-insensitive) comparison.
use crate::comparison_rules::MAX_TEXT_BYTES;
use serde::Deserialize;

pub const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Json,
    Xml,
    Csv,
}

/// Rewrite `text` into the format's canonical form; errors are ready to show to the user.
pub fn canonicalize(text: &str, format: Format) -> Result<String, String> {
    if text.len() > MAX_TEXT_BYTES {
        return Err("Input exceeds 10 MiB".into());
    }
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    if text.trim().is_empty() {
        return Err("No content".into());
    }
    match format {
        Format::Json => json::canonicalize(text),
        Format::Xml => xml::canonicalize(text),
        Format::Csv => csv::canonicalize(text),
    }
}

/// 1-based line and column (in characters) of a byte offset.
fn position(text: &str, offset: usize) -> (usize, usize) {
    let mut offset = offset.min(text.len());
    while !text.is_char_boundary(offset) {
        offset -= 1;
    }
    let before = &text[..offset];
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
    (line, column)
}

fn check_output(out: &str) -> Result<(), String> {
    if out.len() > MAX_OUTPUT_BYTES {
        Err("Output exceeds 64 MiB".into())
    } else {
        Ok(())
    }
}

mod csv;
mod xml;

/// A strict RFC 8259 reader: numbers keep their exact text, duplicate keys are errors.
mod json {
    use super::{check_output, position};
    use std::collections::BTreeMap;

    const MAX_DEPTH: usize = 256;

    enum Node {
        Null,
        Bool(bool),
        Number(String),
        Str(String),
        Array(Vec<Node>),
        Object(BTreeMap<String, Node>),
    }

    struct Fail {
        offset: usize,
        message: String,
    }

    struct Parser<'a> {
        text: &'a str,
        bytes: &'a [u8],
        pos: usize,
    }

    impl Parser<'_> {
        fn fail<T>(&self, offset: usize, message: impl Into<String>) -> Result<T, Fail> {
            Err(Fail {
                offset,
                message: message.into(),
            })
        }

        fn peek(&self) -> Option<u8> {
            self.bytes.get(self.pos).copied()
        }

        fn skip_whitespace(&mut self) {
            while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
                self.pos += 1;
            }
        }

        fn value(&mut self, depth: usize) -> Result<Node, Fail> {
            self.skip_whitespace();
            match self.peek() {
                Some(b'{') => self.object(depth),
                Some(b'[') => self.array(depth),
                Some(b'"') => Ok(Node::Str(self.string()?)),
                Some(b't') => self.literal("true", Node::Bool(true)),
                Some(b'f') => self.literal("false", Node::Bool(false)),
                Some(b'n') => self.literal("null", Node::Null),
                Some(b'-' | b'0'..=b'9') => self.number(),
                _ => self.fail(self.pos, "expected value"),
            }
        }

        fn literal(&mut self, word: &str, node: Node) -> Result<Node, Fail> {
            if self.text[self.pos..].starts_with(word) {
                self.pos += word.len();
                Ok(node)
            } else {
                self.fail(self.pos, "expected value")
            }
        }

        fn digits(&mut self) -> bool {
            let start = self.pos;
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
            self.pos > start
        }

        fn number(&mut self) -> Result<Node, Fail> {
            let start = self.pos;
            if self.peek() == Some(b'-') {
                self.pos += 1;
            }
            match self.peek() {
                Some(b'0') => self.pos += 1,
                Some(b'1'..=b'9') => {
                    self.digits();
                }
                _ => return self.fail(self.pos, "invalid number"),
            }
            if self.peek() == Some(b'.') {
                self.pos += 1;
                if !self.digits() {
                    return self.fail(self.pos, "invalid number");
                }
            }
            if matches!(self.peek(), Some(b'e' | b'E')) {
                self.pos += 1;
                if matches!(self.peek(), Some(b'+' | b'-')) {
                    self.pos += 1;
                }
                if !self.digits() {
                    return self.fail(self.pos, "invalid number");
                }
            }
            Ok(Node::Number(self.text[start..self.pos].to_string()))
        }

        fn string(&mut self) -> Result<String, Fail> {
            let start = self.pos;
            self.pos += 1;
            loop {
                match self.bytes.get(self.pos) {
                    None => return self.fail(start, "unterminated string"),
                    Some(b'"') => {
                        self.pos += 1;
                        break;
                    }
                    Some(b'\\') => self.pos += 2,
                    Some(&byte) if byte < 0x20 => {
                        return self.fail(self.pos, "control character in string")
                    }
                    Some(_) => self.pos += 1,
                }
            }
            // The token is now delimited; serde_json validates escapes and surrogate pairs.
            serde_json::from_str::<String>(&self.text[start..self.pos]).or_else(|error| {
                let shown = error.to_string();
                let message = shown.rsplit_once(" at line ").map_or(shown.as_str(), |(m, _)| m);
                self.fail(start, format!("invalid string: {message}"))
            })
        }

        fn object(&mut self, depth: usize) -> Result<Node, Fail> {
            if depth >= MAX_DEPTH {
                return self.fail(self.pos, "nested too deeply");
            }
            self.pos += 1;
            let mut map = BTreeMap::new();
            self.skip_whitespace();
            if self.peek() == Some(b'}') {
                self.pos += 1;
                return Ok(Node::Object(map));
            }
            loop {
                self.skip_whitespace();
                if self.peek() != Some(b'"') {
                    return self.fail(self.pos, "expected string key");
                }
                let key_at = self.pos;
                let key = self.string()?;
                self.skip_whitespace();
                if self.peek() != Some(b':') {
                    return self.fail(self.pos, "expected ':'");
                }
                self.pos += 1;
                let value = self.value(depth + 1)?;
                if map.insert(key.clone(), value).is_some() {
                    return self.fail(key_at, format!("duplicate key \"{key}\""));
                }
                self.skip_whitespace();
                match self.peek() {
                    Some(b',') => self.pos += 1,
                    Some(b'}') => {
                        self.pos += 1;
                        return Ok(Node::Object(map));
                    }
                    _ => return self.fail(self.pos, "expected ',' or '}'"),
                }
            }
        }

        fn array(&mut self, depth: usize) -> Result<Node, Fail> {
            if depth >= MAX_DEPTH {
                return self.fail(self.pos, "nested too deeply");
            }
            self.pos += 1;
            let mut items = Vec::new();
            self.skip_whitespace();
            if self.peek() == Some(b']') {
                self.pos += 1;
                return Ok(Node::Array(items));
            }
            loop {
                items.push(self.value(depth + 1)?);
                self.skip_whitespace();
                match self.peek() {
                    Some(b',') => self.pos += 1,
                    Some(b']') => {
                        self.pos += 1;
                        return Ok(Node::Array(items));
                    }
                    _ => return self.fail(self.pos, "expected ',' or ']'"),
                }
            }
        }
    }

    fn pad(out: &mut String, level: usize) {
        for _ in 0..level {
            out.push_str("  ");
        }
    }

    /// Pretty-print with two-space indentation; stops as soon as the output cap is passed.
    fn write(node: &Node, level: usize, out: &mut String) -> Result<(), String> {
        check_output(out)?;
        let quote = |text: &str| serde_json::to_string(text).map_err(|e| e.to_string());
        match node {
            Node::Null => out.push_str("null"),
            Node::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
            Node::Number(text) => out.push_str(text),
            Node::Str(text) => out.push_str(&quote(text)?),
            Node::Array(items) if items.is_empty() => out.push_str("[]"),
            Node::Array(items) => {
                out.push_str("[\n");
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push_str(",\n");
                    }
                    pad(out, level + 1);
                    write(item, level + 1, out)?;
                }
                out.push('\n');
                pad(out, level);
                out.push(']');
            }
            Node::Object(map) if map.is_empty() => out.push_str("{}"),
            Node::Object(map) => {
                out.push_str("{\n");
                for (index, (key, value)) in map.iter().enumerate() {
                    if index > 0 {
                        out.push_str(",\n");
                    }
                    pad(out, level + 1);
                    out.push_str(&quote(key)?);
                    out.push_str(": ");
                    write(value, level + 1, out)?;
                }
                out.push('\n');
                pad(out, level);
                out.push('}');
            }
        }
        Ok(())
    }

    pub fn canonicalize(text: &str) -> Result<String, String> {
        let mut parser = Parser {
            text,
            bytes: text.as_bytes(),
            pos: 0,
        };
        let parsed = parser.value(0).and_then(|node| {
            parser.skip_whitespace();
            if parser.pos < text.len() {
                parser.fail(parser.pos, "trailing characters")
            } else {
                Ok(node)
            }
        });
        let node = parsed.map_err(|fail| {
            let (line, column) = position(text, fail.offset);
            format!("JSON parse error at line {line}, column {column}: {}", fail.message)
        })?;
        let mut out = String::new();
        write(&node, 0, &mut out)?;
        out.push('\n');
        check_output(&out)?;
        Ok(out)
    }
}
