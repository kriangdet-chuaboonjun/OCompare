//! Verify packaged update signatures with the same library as the runtime updater.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use std::{error::Error, fs};

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("Usage: verify-update <tauri.conf.json> <installer> <signature>".into());
    }
    let config: serde_json::Value = serde_json::from_slice(&fs::read(&args[0])?)?;
    let key = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or("Missing updater public key")?;
    let key = String::from_utf8(STANDARD.decode(key.trim())?)?;
    let signature = String::from_utf8(STANDARD.decode(fs::read_to_string(&args[2])?.trim())?)?;
    let signature = Signature::decode(&signature)?;
    PublicKey::decode(&key)?.verify(&fs::read(&args[1])?, &signature, true)?;
    // Trust the comment only after the global signature above has been verified.
    let signed_version = signature
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"))
        .ok_or("Updater signature does not bind a release version")?;
    if config["version"].as_str() != Some(signed_version) {
        return Err("Signed updater version differs from release configuration".into());
    }
    println!("Updater signature verified.");
    Ok(())
}
