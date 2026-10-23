use o_compare_rust::folders::compare_folders;
use std::{path::Path, sync::atomic::AtomicBool};

/// CLI harness สำหรับทดสอบ core จริงด้วย filesystem จริง ไม่ได้เพิ่ม command line mode ให้แอป
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 {
        eprintln!("Expected left and right directory");
        std::process::exit(2);
    }
    match compare_folders(
        Path::new(&args[0]),
        Path::new(&args[1]),
        "harness",
        &AtomicBool::new(false),
        &mut |_| {},
    ) {
        Ok(result) => println!(
            "{}",
            serde_json::to_string(&result).expect("serializable folder result")
        ),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
