//! Element-by-element rewrite: sorted attributes, no insignificant whitespace, one layout per tree.
use super::{check_output, position};
use quick_xml::events::Event;
use quick_xml::Reader;

const MAX_DEPTH: usize = 256;

struct Element {
    name: String,
    attributes: Vec<(String, String)>,
    children: Vec<Node>,
    preserve: bool,
}

enum Node {
    Element(Element),
    Text(String),
    Instruction(String),
}

struct Fail {
    offset: usize,
    message: String,
}

fn fail(offset: u64, message: impl ToString) -> Fail {
    Fail {
        offset: offset as usize,
        message: message.to_string(),
    }
}

const fn is_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r')
}

fn is_blank(text: &str) -> bool {
    text.chars().all(is_space)
}

/// Line endings in source text are normalized as the XML specification requires.
fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn push_text(children: &mut Vec<Node>, text: &str) {
    match children.last_mut() {
        Some(Node::Text(existing)) => existing.push_str(text),
        _ => children.push(Node::Text(text.to_string())),
    }
}

struct Document {
    before: Vec<String>,
    root: Element,
    after: Vec<String>,
}

fn parse(text: &str) -> Result<Document, Fail> {
    let mut reader = Reader::from_str(text);
    reader.config_mut().expand_empty_elements = true;
    let mut stack: Vec<Element> = Vec::new();
    let (mut before, mut after) = (Vec::new(), Vec::new());
    let mut root: Option<Element> = None;
    loop {
        let event = match reader.read_event() {
            Ok(event) => event,
            Err(error) => return Err(fail(reader.error_position(), error)),
        };
        let here = reader.buffer_position();
        match event {
            Event::Eof => break,
            Event::Decl(_) | Event::Comment(_) => {}
            // `expand_empty_elements` reports `<a/>` as Start + End, so this cannot occur.
            Event::Empty(_) => return Err(fail(here, "unexpected empty element")),
            Event::Start(start) => {
                if root.is_some() && stack.is_empty() {
                    return Err(fail(here, "multiple root elements"));
                }
                if stack.len() >= MAX_DEPTH {
                    return Err(fail(here, "nested too deeply"));
                }
                let name = String::from_utf8_lossy(start.name().as_ref()).into_owned();
                let mut attributes = Vec::new();
                let mut preserve = stack.last().is_some_and(|parent| parent.preserve);
                for attribute in start.attributes() {
                    let attribute = attribute.map_err(|e| fail(here, e))?;
                    let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
                    let value = attribute
                        .unescape_value()
                        .map_err(|e| fail(here, e))?
                        .into_owned();
                    if key == "xml:space" {
                        match value.as_str() {
                            "preserve" => preserve = true,
                            "default" => preserve = false,
                            _ => {}
                        }
                    }
                    attributes.push((key, value));
                }
                stack.push(Element {
                    name,
                    attributes,
                    children: Vec::new(),
                    preserve,
                });
            }
            Event::End(_) => {
                let element = stack
                    .pop()
                    .ok_or_else(|| fail(here, "unexpected end tag"))?;
                match stack.last_mut() {
                    Some(parent) => parent.children.push(Node::Element(element)),
                    None => root = Some(element),
                }
            }
            Event::Text(content) => {
                let value = content.decode().map_err(|e| fail(here, e))?;
                let value = normalize_newlines(&value);
                match stack.last_mut() {
                    Some(parent) => push_text(&mut parent.children, &value),
                    None if is_blank(&value) => {}
                    None => return Err(fail(here, "text outside the root element")),
                }
            }
            Event::CData(content) => {
                let value = content.decode().map_err(|e| fail(here, e))?;
                let value = normalize_newlines(&value);
                match stack.last_mut() {
                    Some(parent) => push_text(&mut parent.children, &value),
                    None => return Err(fail(here, "text outside the root element")),
                }
            }
            Event::GeneralRef(reference) => {
                let parent = stack
                    .last_mut()
                    .ok_or_else(|| fail(here, "text outside the root element"))?;
                if let Some(character) = reference.resolve_char_ref().map_err(|e| fail(here, e))? {
                    push_text(&mut parent.children, character.encode_utf8(&mut [0; 4]));
                } else {
                    let name = reference.decode().map_err(|e| fail(here, e))?;
                    match quick_xml::escape::resolve_xml_entity(&name) {
                        Some(value) => push_text(&mut parent.children, value),
                        None => return Err(fail(here, format!("unknown entity &{name};"))),
                    }
                }
            }
            Event::PI(instruction) => {
                let content = String::from_utf8_lossy(&instruction).into_owned();
                match stack.last_mut() {
                    Some(parent) => parent.children.push(Node::Instruction(content)),
                    None if root.is_none() => before.push(format!("<?{content}?>")),
                    None => after.push(format!("<?{content}?>")),
                }
            }
            Event::DocType(content) => {
                let value = content.decode().map_err(|e| fail(here, e))?;
                if !stack.is_empty() || root.is_some() {
                    return Err(fail(here, "unexpected DOCTYPE"));
                }
                before.push(format!("<!DOCTYPE {}>", value.trim()));
            }
        }
    }
    if let Some(open) = stack.last() {
        return Err(fail(
            text.len() as u64,
            format!("unclosed element <{}>", open.name),
        ));
    }
    let root = root.ok_or_else(|| fail(text.len() as u64, "no root element"))?;
    Ok(Document {
        before,
        root,
        after,
    })
}

fn escape_text(text: &str, out: &mut String) {
    for character in text.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            other => out.push(other),
        }
    }
}

fn escape_attribute(text: &str, out: &mut String) {
    for character in text.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '"' => out.push_str("&quot;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            '\t' => out.push_str("&#9;"),
            other => out.push(other),
        }
    }
}

fn open_tag(element: &Element, out: &mut String) {
    out.push('<');
    out.push_str(&element.name);
    let mut attributes: Vec<&(String, String)> = element.attributes.iter().collect();
    attributes.sort_by(|a, b| a.0.cmp(&b.0));
    for (key, value) in attributes {
        out.push(' ');
        out.push_str(key);
        out.push_str("=\"");
        escape_attribute(value, out);
        out.push('"');
    }
}

/// Whole subtree on one line with text kept exactly (mixed content and `xml:space="preserve"`).
fn write_inline(element: &Element, out: &mut String) -> Result<(), String> {
    check_output(out)?;
    open_tag(element, out);
    if element.children.is_empty() {
        out.push_str("/>");
        return Ok(());
    }
    out.push('>');
    for child in &element.children {
        match child {
            Node::Element(inner) => write_inline(inner, out)?,
            Node::Text(text) => escape_text(text, out),
            Node::Instruction(content) => {
                out.push_str("<?");
                out.push_str(content);
                out.push_str("?>");
            }
        }
    }
    out.push_str("</");
    out.push_str(&element.name);
    out.push('>');
    Ok(())
}

fn pad(out: &mut String, level: usize) {
    for _ in 0..level {
        out.push_str("  ");
    }
}

fn write_element(element: &Element, level: usize, out: &mut String) -> Result<(), String> {
    check_output(out)?;
    let has_nested = element
        .children
        .iter()
        .any(|child| !matches!(child, Node::Text(_)));
    let has_text = element
        .children
        .iter()
        .any(|child| matches!(child, Node::Text(text) if !is_blank(text)));
    if element.preserve || (has_text && has_nested) {
        return write_inline(element, out);
    }
    if !has_nested {
        let text = match element.children.first() {
            Some(Node::Text(text)) => text.trim_matches(is_space),
            _ => "",
        };
        open_tag(element, out);
        if text.is_empty() {
            out.push_str("/>");
        } else {
            out.push('>');
            escape_text(text, out);
            out.push_str("</");
            out.push_str(&element.name);
            out.push('>');
        }
        return Ok(());
    }
    open_tag(element, out);
    out.push_str(">\n");
    for child in &element.children {
        match child {
            Node::Element(inner) => {
                pad(out, level + 1);
                write_element(inner, level + 1, out)?;
                out.push('\n');
            }
            Node::Instruction(content) => {
                pad(out, level + 1);
                out.push_str("<?");
                out.push_str(content);
                out.push_str("?>\n");
            }
            Node::Text(_) => {}
        }
    }
    pad(out, level);
    out.push_str("</");
    out.push_str(&element.name);
    out.push('>');
    Ok(())
}

pub fn canonicalize(text: &str) -> Result<String, String> {
    let document = parse(text).map_err(|fail| {
        let (line, column) = position(text, fail.offset);
        format!(
            "XML parse error at line {line}, column {column}: {}",
            fail.message
        )
    })?;
    let mut out = String::new();
    for line in &document.before {
        out.push_str(line);
        out.push('\n');
    }
    write_element(&document.root, 0, &mut out)?;
    out.push('\n');
    for line in &document.after {
        out.push_str(line);
        out.push('\n');
    }
    check_output(&out)?;
    Ok(out)
}
