use o_compare_rust::comparison_rules::{normalize_pair, CompiledRules, RegexRule};

fn rule(pattern: &str) -> RegexRule {
    RegexRule {
        id: pattern.into(),
        pattern: pattern.into(),
        enabled: true,
    }
}

#[test]
fn unions_matches_on_original_lines_and_preserves_newlines() {
    let rules = CompiledRules::compile(&[rule("abc"), rule("cde"), rule("(?s).+\\n.+")]).unwrap();
    assert_eq!(rules.normalize("abcdef\r\nabc\n").text, "f\r\n\n");
}

#[test]
fn maps_unicode_boundaries_without_losing_original_columns() {
    let result = CompiledRules::compile(&[rule("[0-9]+")])
        .unwrap()
        .normalize("ไทย😀123X");
    assert_eq!(result.text, "ไทย😀X");
    assert_eq!(result.lines[0].start_columns[5], 9);
    assert_eq!(result.lines[0].end_columns[5], 6);
    assert_eq!(result.lines[0].start_columns[6], 10);
}

#[test]
fn validates_disabled_rules_and_rejects_unsupported_syntax() {
    let mut disabled = rule("(?=a)");
    disabled.enabled = false;
    assert!(CompiledRules::compile(&[disabled]).is_err());
    assert!(CompiledRules::compile(&vec![rule("x"); 21]).is_err());
    assert!(CompiledRules::compile(&[rule(&"x".repeat(1025))]).is_err());
}

#[test]
fn zero_width_matches_do_not_delete_text() {
    assert_eq!(
        CompiledRules::compile(&[rule("^")])
            .unwrap()
            .normalize("abc\ndef")
            .text,
        "abc\ndef"
    );
}

#[test]
fn standalone_cr_is_a_preserved_line_separator() {
    let rules = CompiledRules::compile(&[rule("(?s).+")]).unwrap();
    let result = rules.normalize("a\rb\r\nc\n");
    assert_eq!(result.text, "\r\r\n\n");
    assert_eq!(result.lines.len(), 4);
}

#[test]
fn oversized_input_explicitly_falls_back_to_original_text() {
    let large = "x".repeat(10 * 1024 * 1024 + 1);
    let result = normalize_pair(&large, "123", &[rule("[0-9]+")]).unwrap();
    assert!(!result.applied);
    assert!(result.reason.is_some());
    assert_eq!(result.left.text, large);
}
