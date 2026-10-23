//! JSON-line bridge used by the browser regression harness for the real Rust engine.
use o_compare_rust::comparison_rules::{normalize_pair, RegexRule};
use serde::Deserialize;
use std::io::Read;

#[derive(Deserialize)]
struct Input {
    left: String,
    right: String,
    rules: Vec<RegexRule>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let input: Input = serde_json::from_str(&input)?;
    let result = normalize_pair(&input.left, &input.right, &input.rules)?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
