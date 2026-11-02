use o_compare_rust::structural::{canonicalize, Format};

fn json(text: &str) -> Result<String, String> {
    canonicalize(text, Format::Json)
}

#[test]
fn json_key_order_and_indent_do_not_matter() {
    let left = json(r#"{"b":{"y":2,"x":1},"a":1}"#).unwrap();
    let right = json("{ \"a\": 1,\n  \"b\": {\"x\":1,\n\"y\":2} }").unwrap();
    assert_eq!(left, right);
    assert_eq!(
        left,
        "{\n  \"a\": 1,\n  \"b\": {\n    \"x\": 1,\n    \"y\": 2\n  }\n}\n"
    );
}

#[test]
fn json_value_change_changes_output() {
    assert_ne!(json(r#"{"a":1}"#).unwrap(), json(r#"{"a":2}"#).unwrap());
}

#[test]
fn json_array_order_is_preserved() {
    assert_eq!(json("[3,1,2]").unwrap(), "[\n  3,\n  1,\n  2\n]\n");
}

#[test]
fn json_empty_containers_stay_compact() {
    assert_eq!(
        json(r#"{"a":{},"b":[]}"#).unwrap(),
        "{\n  \"a\": {},\n  \"b\": []\n}\n"
    );
}

#[test]
fn json_keeps_unicode_unescaped() {
    let output = json(r#"{"ชื่อ":"ไทย😀 \u0041"}"#).unwrap();
    assert!(output.contains("\"ชื่อ\": \"ไทย😀 A\""), "{output}");
    assert!(!output.contains("\\u"), "{output}");
}

#[test]
fn json_preserves_number_text() {
    let output = json(r#"{"big":12345678901234567890123,"f":1.0,"e":1e2}"#).unwrap();
    assert!(output.contains("12345678901234567890123"), "{output}");
    assert!(output.contains("\"f\": 1.0"), "{output}");
    assert!(output.contains("\"e\": 1e2"), "{output}");
    assert_ne!(json(r#"{"n":1}"#).unwrap(), json(r#"{"n":1.0}"#).unwrap());
}

#[test]
fn json_duplicate_key_is_error() {
    let error = json("{\"a\":1,\n\"a\":2}").unwrap_err();
    assert!(error.contains("duplicate key"), "{error}");
    assert!(error.contains("\"a\""), "{error}");
    assert!(error.starts_with("JSON parse error at line 2, column"), "{error}");
}

#[test]
fn json_parse_error_reports_line_and_column() {
    let error = json("{\n  \"a\": }").unwrap_err();
    assert!(error.starts_with("JSON parse error at line 2, column 8"), "{error}");
}

#[test]
fn json_rejects_comments_and_trailing_commas() {
    assert!(json("{\"a\":1,}").is_err());
    assert!(json("// c\n{}").is_err());
    assert!(json("{} {}").is_err());
}

#[test]
fn json_rejects_malformed_scalars() {
    for text in ["01", "1.", "-", "\"a\nb\"", "\"\\x\"", "tru", "nul", "[1 2]"] {
        assert!(json(text).is_err(), "{text:?} should fail");
    }
}

#[test]
fn json_leading_bom_is_ignored() {
    assert_eq!(json("\u{feff}{\"a\":1}").unwrap(), json("{\"a\":1}").unwrap());
}

#[test]
fn json_too_deep_is_error_not_a_crash() {
    let text = format!("{}{}", "[".repeat(100_000), "]".repeat(100_000));
    let error = json(&text).unwrap_err();
    assert!(error.contains("nested too deeply"), "{error}");
}

#[test]
fn blank_input_is_error() {
    assert_eq!(json("").unwrap_err(), "No content");
    assert_eq!(json("  \n").unwrap_err(), "No content");
}

#[test]
fn oversized_input_is_error() {
    let text = " ".repeat(10 * 1024 * 1024 + 1);
    assert_eq!(json(&text).unwrap_err(), "Input exceeds 10 MiB");
}

#[test]
fn oversized_output_is_error() {
    // ~8 MB of input whose pretty-printed form is hundreds of MB.
    let element = format!("{}1{}", "[".repeat(100), "]".repeat(100));
    let text = format!("[{}]", vec![element; 40_000].join(","));
    assert!(text.len() < 10 * 1024 * 1024);
    assert_eq!(json(&text).unwrap_err(), "Output exceeds 64 MiB");
}

fn xml(text: &str) -> Result<String, String> {
    canonicalize(text, Format::Xml)
}

#[test]
fn xml_pretty_prints_sorted_attributes_and_empty_elements() {
    let text = r#"<?xml version="1.0"?><root b="2" a="1"><!--c--><child>text</child><empty></empty></root>"#;
    assert_eq!(
        xml(text).unwrap(),
        "<root a=\"1\" b=\"2\">\n  <child>text</child>\n  <empty/>\n</root>\n"
    );
}

#[test]
fn xml_self_closing_equals_empty_pair() {
    assert_eq!(xml("<a/>").unwrap(), xml("<a></a>").unwrap());
    assert_eq!(xml("<a/>").unwrap(), xml("<a>  \n </a>").unwrap());
}

#[test]
fn xml_attribute_order_does_not_matter() {
    assert_eq!(xml(r#"<a x="1" y='2'/>"#).unwrap(), xml(r#"<a y="2" x="1"/>"#).unwrap());
    assert_ne!(xml(r#"<a x="1"/>"#).unwrap(), xml(r#"<a x="2"/>"#).unwrap());
}

#[test]
fn xml_declaration_and_comments_are_dropped() {
    let plain = xml("<a><b/></a>").unwrap();
    assert_eq!(xml("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!-- top --><a><!-- in --><b/></a>").unwrap(), plain);
}

#[test]
fn xml_cdata_equals_escaped_text() {
    assert_eq!(xml("<a><![CDATA[x<y & z]]></a>").unwrap(), xml("<a>x&lt;y &amp; z</a>").unwrap());
}

#[test]
fn xml_char_reference_equals_entity() {
    let expected = xml("<a>&amp;</a>").unwrap();
    assert_eq!(xml("<a>&#38;</a>").unwrap(), expected);
    assert_eq!(xml("<a>&#x26;</a>").unwrap(), expected);
    assert_eq!(xml(r#"<a v="&#34;&amp;"/>"#).unwrap(), xml(r#"<a v='"&amp;'/>"#).unwrap());
}

#[test]
fn xml_whitespace_between_elements_ignored() {
    assert_eq!(xml("<a>\n  <b/>\n\t<c/>\n</a>").unwrap(), xml("<a><b/><c/></a>").unwrap());
    assert_eq!(xml("<a>  text \n</a>").unwrap(), xml("<a>text</a>").unwrap());
}

#[test]
fn xml_element_order_is_preserved() {
    assert_ne!(xml("<a><b/><c/></a>").unwrap(), xml("<a><c/><b/></a>").unwrap());
}

#[test]
fn xml_doctype_and_processing_instructions_are_kept() {
    let with = xml("<?xml version=\"1.0\"?><!DOCTYPE a [<!ENTITY e \"v\">]><?target data?><a/>").unwrap();
    assert!(with.contains("<!DOCTYPE a"), "{with}");
    assert!(with.contains("<?target data?>"), "{with}");
    assert_ne!(with, xml("<a/>").unwrap());
}

#[test]
fn xml_mixed_content_text_is_kept() {
    assert_eq!(xml("<p>a <b>x</b> c</p>").unwrap(), "<p>a <b>x</b> c</p>\n");
    assert_ne!(xml("<p>a <b>x</b> c</p>").unwrap(), xml("<p>a<b>x</b>c</p>").unwrap());
}

#[test]
fn xml_text_next_to_processing_instruction_is_not_dropped() {
    assert_ne!(
        xml("<a>hello<?pi x?></a>").unwrap(),
        xml("<a>bye<?pi x?></a>").unwrap()
    );
    assert!(xml("<a>hello<?pi x?></a>").unwrap().contains("hello"));
}

#[test]
fn xml_space_preserve_subtree_untouched() {
    assert_ne!(
        xml(r#"<a xml:space="preserve"> x </a>"#).unwrap(),
        xml(r#"<a xml:space="preserve">x</a>"#).unwrap()
    );
    assert_ne!(
        xml("<a xml:space=\"preserve\"><b>  </b></a>").unwrap(),
        xml("<a xml:space=\"preserve\"><b/></a>").unwrap()
    );
    assert_eq!(xml("<a> x </a>").unwrap(), xml("<a>x</a>").unwrap());
}

#[test]
fn xml_namespace_declarations_sorted_with_attributes() {
    assert_eq!(
        xml(r#"<a xmlns:x="urn:u" b="1"/>"#).unwrap(),
        xml(r#"<a b="1" xmlns:x="urn:u"/>"#).unwrap()
    );
}

#[test]
fn xml_keeps_unicode_and_escapes_markup_characters() {
    assert_eq!(xml("<a>ไทย😀 &lt;&gt;</a>").unwrap(), "<a>ไทย😀 &lt;&gt;</a>\n");
}

#[test]
fn xml_parse_errors_report_line_and_column() {
    let error = xml("<a>\n<b></a>").unwrap_err();
    assert!(error.starts_with("XML parse error at line 2, column"), "{error}");
}

#[test]
fn xml_rejects_invalid_documents() {
    for text in ["<a>", "<a/><b/>", "text<a/>", "<a>&nbsp;</a>", "<a x=\"1\" x=\"2\"/>", "<a></b>", "<>"] {
        let error = xml(text).unwrap_err();
        assert!(error.starts_with("XML parse error at line"), "{text:?}: {error}");
    }
}

#[test]
fn xml_blank_and_oversized_inputs_are_errors() {
    assert_eq!(xml(" \n").unwrap_err(), "No content");
    assert_eq!(xml(&" ".repeat(10 * 1024 * 1024 + 1)).unwrap_err(), "Input exceeds 10 MiB");
}

fn csv(text: &str) -> Result<String, String> {
    canonicalize(text, Format::Csv)
}

#[test]
fn csv_semicolon_and_tab_delimiters_normalize_to_comma() {
    let expected = csv("a,b,c\n1,2,3\n").unwrap();
    assert_eq!(expected, "a,b,c\n1,2,3\n");
    assert_eq!(csv("a;b;c\n1;2;3\n").unwrap(), expected);
    assert_eq!(csv("a\tb\tc\n1\t2\t3\n").unwrap(), expected);
    // A comma inside a semicolon file is data, and gets quoted in the comma form.
    assert_eq!(csv("a;\"b,1\"\n").unwrap(), "a,\"b,1\"\n");
}

#[test]
fn csv_unneeded_quotes_removed_and_needed_quotes_kept() {
    assert_eq!(
        csv("\"a\",\"b,c\",\"d\"\"e\",\"f\ng\"\n").unwrap(),
        "a,\"b,c\",\"d\"\"e\",\"f\ng\"\n"
    );
}

#[test]
fn csv_crlf_equals_lf() {
    assert_eq!(csv("a,b\r\n1,2\r\n").unwrap(), csv("a,b\n1,2\n").unwrap());
    assert_eq!(csv("a,b\r1,2").unwrap(), csv("a,b\n1,2\n").unwrap());
    assert_eq!(csv("\"x\r\ny\",1\r\n").unwrap(), csv("\"x\ny\",1\n").unwrap());
}

#[test]
fn csv_final_newline_is_optional() {
    assert_eq!(csv("a,b").unwrap(), csv("a,b\n").unwrap());
}

#[test]
fn csv_bom_is_stripped() {
    assert_eq!(csv("\u{feff}a,b\n").unwrap(), csv("a,b\n").unwrap());
}

#[test]
fn csv_blank_lines_are_kept_as_empty_rows() {
    assert_eq!(csv("a\n\nb\n").unwrap(), "a\n\nb\n");
    assert_ne!(csv("a\n\nb\n").unwrap(), csv("a\nb\n").unwrap());
    // A row whose only field is empty is not the same as a blank line.
    assert_ne!(csv("a\n\"\"\nb\n").unwrap(), csv("a\n\nb\n").unwrap());
}

#[test]
fn csv_ragged_rows_are_not_an_error() {
    assert_eq!(csv("a,b,c\n1\n1,2,3,4\n").unwrap(), "a,b,c\n1\n1,2,3,4\n");
}

#[test]
fn csv_header_is_an_ordinary_row() {
    assert_ne!(csv("id,name\n1,x\n").unwrap(), csv("name,id\n1,x\n").unwrap());
}

#[test]
fn csv_row_and_column_order_preserved() {
    assert_ne!(csv("a,b\n").unwrap(), csv("b,a\n").unwrap());
    assert_ne!(csv("1\n2\n").unwrap(), csv("2\n1\n").unwrap());
}

#[test]
fn csv_keeps_unicode_empty_fields_and_spaces() {
    assert_eq!(csv("ไทย😀,, x \n").unwrap(), "ไทย😀,, x \n");
}

#[test]
fn csv_unterminated_quote_is_error() {
    let error = csv("a,b\n1,\"oops\n2,3\n").unwrap_err();
    assert!(error.starts_with("CSV parse error at line 2, column 3"), "{error}");
}

#[test]
fn csv_blank_and_oversized_inputs_are_errors() {
    assert_eq!(csv("\n\n").unwrap_err(), "No content");
    assert_eq!(csv(&" ".repeat(10 * 1024 * 1024 + 1)).unwrap_err(), "Input exceeds 10 MiB");
}
