fn main() {
    let revision_file = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packaging/arch/PKGBUILD.in");
    println!("cargo:rerun-if-changed={}", revision_file.display());
    let recipe = std::fs::read_to_string(revision_file).expect("read package revision");
    let revision = recipe
        .lines()
        .find_map(|line| line.strip_prefix("pkgrel="))
        .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .expect("numeric package revision");
    println!(
        "cargo:rustc-env=REELIO_BUILD_VERSION={}-{}",
        env!("CARGO_PKG_VERSION"),
        revision
    );
    tauri_build::build()
}
