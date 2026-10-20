use super::*;
use std::{fs, io::Cursor};
fn release(tag: &str, revision: u32) -> Release {
    let core = Version::parse(tag).unwrap().core();
    let name = format!("reelio-{core}-{revision}-x86_64.pkg.tar.zst");
    Release {
        tag_name: tag.into(),
        draft: false,
        prerelease: false,
        assets: vec![Asset {
            name: name.clone(),
            browser_download_url: format!(
                "https://github.com/vcsoc/reelio/releases/download/{tag}/{name}"
            ),
            size: 7,
            digest: Some(format!("sha256:{}", "a".repeat(64))),
        }],
    }
}
#[test]
fn appimage_assets_are_bound_to_the_release_version_and_architecture() {
    let version = Version::parse("v0.2.0-3").unwrap();
    assert_eq!(
        Target::AppImageX64.asset_version("Reelio_0.2.0_amd64.AppImage", version),
        Some(version)
    );
    for name in [
        "Reelio_0.2.0_aarch64.AppImage",
        "Reelio_0.1.0_amd64.AppImage",
        "Reelio_0.2.0_amd64.deb",
    ] {
        assert!(Target::AppImageX64.asset_version(name, version).is_none());
    }
}
#[test]
fn versions_are_numeric_and_preserve_legacy_builds() {
    assert!(Version::parse("v0.10.0").unwrap() > Version::parse("0.9.99-99").unwrap());
    assert!(Version::parse("0.2.0-10").unwrap() > Version::parse("0.2.0-9").unwrap());
    assert_eq!(
        Version::parse("v0.2.0-1+build.42"),
        Version::parse("0.2.0-1")
    );
    for invalid in [
        "0.2",
        "0.2.0-rc.1",
        "0.2.0-beta",
        "01.2.0",
        "0.2.0--1",
        "0.2.0-01",
        "0.2.0+",
        "0.2.0+foo..bar",
        "0.2.0.1",
        "0.2.0-9999999999999999999",
    ] {
        assert!(Version::parse(invalid).is_none(), "{invalid}");
    }
}
#[test]
fn highest_version_wins_not_api_creation_order() {
    let releases = [
        release("v0.9.0", 1),
        release("v0.11.0", 1),
        release("v0.10.0", 1),
    ];
    let (r, o) = select(&releases, "0.2.0-1", Target::ArchX64).unwrap();
    assert_eq!(r.latest_version.as_deref(), Some("0.11.0-1"));
    assert_eq!(r.status, "available");
    assert!(o.is_some());
}
#[test]
fn empty_and_prerelease_results_are_not_up_to_date() {
    let (r, _) = select(&[], "0.2.0-1", Target::ArchX64).unwrap();
    assert_eq!(r.status, "no_releases");
    let mut draft = release("v9.0.0", 1);
    draft.draft = true;
    let mut pre = release("v8.0.0", 1);
    pre.prerelease = true;
    let (r, _) = select(&[draft, pre], "0.2.0-1", Target::ArchX64).unwrap();
    assert_eq!(r.status, "no_releases");
}
#[test]
fn same_version_and_newer_local_build_are_current() {
    for current in ["0.2.0-1", "0.2.0-2", "0.3.0-1"] {
        let (r, o) = select(&[release("v0.2.0", 1)], current, Target::ArchX64).unwrap();
        assert_eq!(r.status, "up_to_date");
        assert!(o.is_none());
    }
    let (r, _) = select(&[release("v0.2.0", 2)], "0.2.0-1", Target::ArchX64).unwrap();
    assert_eq!(r.status, "available");
}
#[test]
fn latest_release_without_platform_asset_is_not_hidden() {
    let (r, o) = select(
        &[release("v0.3.0", 1), release("v0.2.0", 1)],
        "0.1.0-27",
        Target::WindowsX64,
    )
    .unwrap();
    assert_eq!(r.status, "unsupported");
    assert_eq!(r.latest_version.as_deref(), Some("0.3.0"));
    assert!(o.is_none());
    assert!(Target::ArchX64
        .asset_version(
            "reelio-0.4.0-1-x86_64.pkg.tar.zst",
            Version::parse("0.3.0").unwrap()
        )
        .is_none());
}
#[test]
fn missing_or_invalid_verification_never_offers_a_download() {
    let mut r = release("v0.3.0", 1);
    r.assets[0].digest = None;
    let (report, offer) = select(&[r.clone()], "0.2.0-1", Target::ArchX64).unwrap();
    assert_eq!(report.status, "unverified");
    assert!(offer.is_none());
    r.assets[0].digest = Some("md5:123".into());
    assert!(select(&[r], "0.2.0-1", Target::ArchX64).is_err());
}
#[test]
fn checksums_are_exact_and_unambiguous() {
    let hash = "a".repeat(64);
    assert_eq!(
        checksum(format!("{hash}  package.zst\n").as_bytes(), "package.zst").unwrap(),
        hash
    );
    assert!(checksum(format!("{hash}  other.zst\n").as_bytes(), "package.zst").is_err());
    assert!(checksum(
        format!("{hash}  package.zst\n{hash}  package.zst\n").as_bytes(),
        "package.zst"
    )
    .is_err());
    assert!(checksum(
        format!("{}é  package.zst", "a".repeat(63)).as_bytes(),
        "package.zst"
    )
    .is_err());
}
#[test]
fn endpoints_reject_private_hosts_credentials_and_other_repositories() {
    for value in [
        "http://github.com/vcsoc/reelio",
        "https://127.0.0.1/a",
        "https://github.com.evil.test/a",
        "https://user@github.com/a",
        "https://github.com:8443/a",
        "https://example.com/a",
    ] {
        assert!(secure_url(value).is_err(), "{value}");
    }
    let mut asset = release("v0.3.0", 1).assets.remove(0);
    asset.browser_download_url = asset
        .browser_download_url
        .replace("/vcsoc/reelio/", "/other/repo/");
    assert!(validate_asset(&asset).is_err());
}
fn bytes_hash() -> String {
    format!("{:x}", Sha256::digest(b"package"))
}
#[test]
fn verified_package_publishes_without_changing_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("package.zst");
    publish_verified(
        Cursor::new(b"package"),
        7,
        &bytes_hash(),
        &path,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(fs::read(path).unwrap(), b"package");
}
#[test]
fn wrong_hash_truncation_and_overrun_publish_nothing() {
    for (data, size, hash) in [
        (b"package".as_slice(), 7, "0".repeat(64)),
        (b"short".as_slice(), 7, bytes_hash()),
        (b"package-extra".as_slice(), 7, bytes_hash()),
    ] {
        let dir = tempfile::tempdir().unwrap();
        assert!(publish_verified(
            Cursor::new(data),
            size,
            &hash,
            &dir.path().join("package"),
            &AtomicBool::new(false)
        )
        .is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
#[test]
fn cancellation_removes_partial_download() {
    let dir = tempfile::tempdir().unwrap();
    assert!(publish_verified(
        Cursor::new(b"package"),
        7,
        &bytes_hash(),
        &dir.path().join("package"),
        &AtomicBool::new(true)
    )
    .is_err());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}
#[test]
fn existing_destination_is_preserved() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("package");
    fs::write(&path, b"keep").unwrap();
    assert!(publish_verified(
        Cursor::new(b"package"),
        7,
        &bytes_hash(),
        &path,
        &AtomicBool::new(false)
    )
    .is_err());
    assert_eq!(fs::read(path).unwrap(), b"keep");
}
#[test]
fn publication_race_cannot_overwrite_a_destination() {
    struct Race<'a> {
        path: &'a Path,
        reader: Cursor<&'a [u8]>,
        started: bool,
    }
    impl Read for Race<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if !self.started {
                self.started = true;
                fs::write(self.path, b"other process")?;
            }
            self.reader.read(buffer)
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("package");
    assert!(publish_verified(
        Race {
            path: &path,
            reader: Cursor::new(b"package"),
            started: false
        },
        7,
        &bytes_hash(),
        &path,
        &AtomicBool::new(false)
    )
    .is_err());
    assert_eq!(fs::read(&path).unwrap(), b"other process");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}
#[test]
fn metadata_reads_and_package_sizes_are_bounded() {
    assert!(limited(Cursor::new(b"12345"), 4).is_err());
    let dir = tempfile::tempdir().unwrap();
    assert!(publish_verified(
        Cursor::new(b""),
        MAX_PACKAGE + 1,
        &bytes_hash(),
        &dir.path().join("package"),
        &AtomicBool::new(false)
    )
    .is_err());
}
#[test]
fn stale_offers_and_concurrent_operations_are_rejected() {
    let service = UpdateService::default();
    assert!(service.filename("made-up").is_err());
    let _busy = service.enter(2).unwrap();
    assert!(service.downloading());
    assert!(service.enter(1).is_err());
}
#[test]
fn platform_assets_require_matching_version_and_architecture() {
    let tag = Version::parse("v0.3.0").unwrap();
    for (target, name) in [
        (Target::DebianX64, "Reelio_0.3.0_amd64.deb"),
        (Target::WindowsX64, "Reelio_0.3.0_x64-setup.exe"),
        (Target::MacX64, "Reelio_0.3.0_x64.dmg"),
        (Target::MacArm64, "Reelio_0.3.0_aarch64.dmg"),
    ] {
        assert!(target.asset_version(name, tag).is_some());
        assert!(target
            .asset_version(&name.replace("0.3.0", "0.2.0"), tag)
            .is_none());
    }
    assert!(Target::ArchX64
        .asset_version("reelio-0.3.0-x86_64.pkg.tar.zst", tag)
        .is_none());
    assert!(Target::ArchX64
        .asset_version("reelio-0.3.0-0-x86_64.pkg.tar.zst", tag)
        .is_none());
}
#[test]
fn checksum_manifest_is_a_supported_verification_fallback() {
    let mut release = release("v0.3.0", 1);
    release.assets[0].digest = None;
    release.assets.push(Asset {
        name: "SHA256SUMS".into(),
        browser_download_url: "https://github.com/vcsoc/reelio/releases/download/v0.3.0/SHA256SUMS"
            .into(),
        size: 128,
        digest: None,
    });
    let (report, offer) = select(&[release], "0.2.0-1", Target::ArchX64).unwrap();
    assert_eq!(report.status, "available");
    assert!(offer.unwrap().sums.is_some());
}
#[test]
#[ignore = "explicit public GitHub network qualification"]
fn live_github_release_check() {
    let report = UpdateService::default()
        .check("0.2.0-1", Target::current())
        .unwrap();
    assert!([
        "no_releases",
        "up_to_date",
        "available",
        "unsupported",
        "unverified"
    ]
    .contains(&report.status.as_str()));
    println!("{}", serde_json::to_string(&report).unwrap());
}
