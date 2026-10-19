use reelio_ffmpeg::{Ffmpeg, MediaBackend};
use std::{fs, path::Path, process::Command};

fn ffmpeg(args: &[&str], path: &Path) {
    let output = Command::new("ffmpeg")
        .args(["-v", "error", "-nostdin", "-n"])
        .args(args)
        .arg(path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
#[test]
fn fragmented_preview_is_verified_seekable_and_source_safe() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fragmented.mp4");
    ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=96x64:rate=12",
            "-t",
            "3",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-threads",
            "1",
            "-g",
            "12",
            "-movflags",
            "+frag_keyframe+empty_moov+default_base_moof",
        ],
        &path,
    );
    let original = fs::read(&path).unwrap();
    let backend = Ffmpeg::default();
    let preview = backend.seekable_preview(&path).unwrap().unwrap();
    assert_eq!(fs::read(&path).unwrap(), original);
    assert!(backend.seekable_preview(preview.path()).unwrap().is_none());
    let actual = backend.probe(preview.path()).unwrap();
    assert_eq!(actual.streams[0].codec, "h264");
    assert_eq!(actual.duration_ms, Some(3000));
    let prepared_path = preview.path().to_owned();
    drop(preview);
    assert!(!prepared_path.exists());
}
#[test]
fn avif_is_a_bounded_image_not_a_movie() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cover.avif");
    ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=c=red:size=32x24",
            "-frames:v",
            "1",
            "-c:v",
            "libaom-av1",
            "-still-picture",
            "1",
            "-cpu-used",
            "8",
            "-threads",
            "1",
        ],
        &path,
    );
    let original = fs::read(&path).unwrap();
    let backend = Ffmpeg::default();
    let asset = backend.probe(&path).unwrap();
    assert!(asset.is_still_image());
    assert_eq!(
        asset.streams[0]
            .properties
            .get("still_image")
            .map(String::as_str),
        Some("1")
    );
    let png = backend.cover_image_bytes(&asset).unwrap();
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(fs::read(&path).unwrap(), original);
    let mut bomb = asset.clone();
    bomb.streams[0]
        .properties
        .insert("width".into(), "9000".into());
    assert!(backend.cover_image_bytes(&bomb).is_err());
    let mut movie = asset;
    movie.metadata.clear();
    movie.streams[0].properties.remove("still_image");
    assert!(backend.cover_image_bytes(&movie).is_err());
}

#[test]
fn oversized_single_images_are_rejected_before_probing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("large.jpg");
    fs::write(&path, [0xff, 0xd8, 0xff, 0xe0]).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_len(8 * 1024 * 1024 + 1)
        .unwrap();
    assert!(Ffmpeg::default()
        .probe(&path)
        .unwrap_err()
        .contains("8 MiB"));
}
#[test]
#[ignore = "explicit user-authorized local image fixture"]
fn explicit_image_fixture_is_source_safe() {
    let path = std::path::PathBuf::from(
        std::env::var_os("REELIO_IMAGE_FIXTURE").expect("Set REELIO_IMAGE_FIXTURE"),
    );
    assert!(fs::metadata(&path).unwrap().len() <= 8 * 1024 * 1024);
    let before = fs::read(&path).unwrap();
    let backend = Ffmpeg::default();
    let asset = backend.probe(&path).unwrap();
    assert!(asset.is_still_image());
    let png = backend.cover_image_bytes(&asset).unwrap();
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(fs::read(&path).unwrap(), before);
    println!(
        "Verified single-image probe and bounded cover decode: {} / {}",
        asset.format, asset.streams[0].codec
    );
}

#[test]
fn single_images_use_signature_selected_literal_demuxers() {
    let dir = tempfile::tempdir().unwrap();
    let backend = Ffmpeg::default();
    for (extension, format) in [
        ("jpg", "jpeg_pipe"),
        ("png", "png_pipe"),
        ("webp", "webp_pipe"),
    ] {
        let generated = dir.path().join(format!("cover.{extension}"));
        ffmpeg(
            &[
                "-f",
                "lavfi",
                "-i",
                "color=c=red:size=32x24",
                "-frames:v",
                "1",
                "-threads",
                "1",
            ],
            &generated,
        );
        let original = fs::read(&generated).unwrap();
        // Neither a numeric name nor a sequence-looking name may activate image2.
        for name in [
            format!("ffc20984298414f59c045a0d954fe9c1.{extension}"),
            format!("cover%03d.{extension}"),
            format!("renamed-{extension}.bin"),
        ] {
            let path = dir.path().join(name);
            fs::write(&path, &original).unwrap();
            let asset = backend.probe(&path).unwrap();
            assert_eq!(asset.format, format);
            assert!(asset.is_still_image());
            let png = backend.cover_image_bytes(&asset).unwrap();
            assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
            assert_eq!(fs::read(path).unwrap(), original);
        }
    }
}
