use o_compare_rust::fileio::{read_text_file, write_text_file};
use serde::Deserialize;
use std::{io::Read, path::Path};

#[derive(Deserialize)]
struct Request {
    action: String,
    path: String,
    text: Option<String>,
    encoding: Option<String>,
    bom: Option<bool>,
}

/// Test transport เท่านั้น: ใช้ fileio จริงให้ browser harness เรียกผ่าน local server
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let request: Request = serde_json::from_str(&input)?;
    let result = if request.action == "read" {
        read_text_file(Path::new(&request.path))
            .map(|data| serde_json::to_value(data).expect("serializable FileData"))
    } else if request.action == "save" {
        write_text_file(
            Path::new(&request.path),
            request.text.as_deref().unwrap_or(""),
            request.encoding.as_deref().unwrap_or("utf-8"),
            request.bom.unwrap_or(false),
        )
        .map(|stat| serde_json::to_value(stat).expect("serializable FileStat"))
    } else {
        return Err("Unknown test action".into());
    };
    println!(
        "{}",
        match result {
            Ok(data) => serde_json::json!({ "data": data }),
            Err(error) => serde_json::json!({ "error": error }),
        }
    );
    Ok(())
}
