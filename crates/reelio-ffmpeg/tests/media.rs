use reelio_domain::*;
use reelio_ffmpeg::{build_args, Ffmpeg, MediaBackend};
use std::{
    fs,
    path::Path,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};
fn generate(path: &Path) {
    let status = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=128x72:rate=12:duration=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-metadata:s:a:0",
            "language=eng",
            "-disposition:v:0",
            "default",
            "-disposition:a:0",
            "default",
            "-y",
        ])
        .arg(path)
        .status()
        .expect("FFmpeg must be installed for media integration tests");
    assert!(status.success());
}
fn project(path: &Path) -> Project {
    let mut p = Project {
        container: Container::Matroska,
        ..Project::default()
    };
    p.add_asset(Ffmpeg::default().probe(path).unwrap()).unwrap();
    p
}
fn video_hash(path: &Path) -> String {
    stream_hash(path, "0:v:0")
}
fn stream_hash(path: &Path, selector: &str) -> String {
    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(path)
        .args([
            "-map",
            selector,
            "-c",
            "copy",
            "-f",
            "streamhash",
            "-hash",
            "sha256",
            "-",
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    String::from_utf8(out.stdout).unwrap()
}
#[test]
fn mp4_and_m4v_automatically_resolve_missing_defaults_without_source_changes() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source.mkv");
    generate(&source);
    let original = fs::read(&source).unwrap();
    let original_hash = video_hash(&source);
    for container in [Container::Mp4, Container::M4v] {
        let mut p = project(&source);
        p.container = container;
        p.tracks.iter_mut().for_each(|t| t.default = false);
        assert!(plan(&p).errors.is_empty());
        let output = directory.path().join(if container == Container::Mp4 {
            "auto.mp4"
        } else {
            "auto.m4v"
        });
        Ffmpeg::default()
            .export(&p, &output, false, &AtomicBool::new(false), |_| {})
            .unwrap();
        let actual = Ffmpeg::default().probe(&output).unwrap();
        assert!(actual.streams.iter().all(|s| s.default));
        assert_eq!(video_hash(&output), original_hash);
        assert_eq!(stream_hash(&output, "0:a:0"), stream_hash(&source, "0:a:0"));
        assert_eq!(fs::read(&source).unwrap(), original);
        assert!(p.tracks.iter().all(|t| !t.default));
    }
}
#[test]
fn automatic_audio_default_respects_order_disabled_tracks_and_explicit_selection() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source.mkv");
    generate(&source);
    let original = fs::read(&source).unwrap();
    let mut base = project(&source);
    base.container = Container::Mp4;
    base.tracks.iter_mut().for_each(|t| t.default = false);
    let mut second = base
        .tracks
        .iter()
        .find(|t| base.stream(t).unwrap().kind == StreamKind::Audio)
        .unwrap()
        .clone();
    second.id = id();
    second.title = "Second audio".into();
    second.language = "spa".into();
    base.tracks.push(second);
    for variant in ["first", "reordered", "disabled", "explicit"] {
        let mut p = base.clone();
        match variant {
            "reordered" => p.tracks.swap(1, 2),
            "disabled" => p.tracks[1].enabled = false,
            "explicit" => p.tracks[2].default = true,
            _ => {}
        }
        let output = directory.path().join(format!("{variant}.mp4"));
        Ffmpeg::default()
            .export(&p, &output, false, &AtomicBool::new(false), |_| {})
            .unwrap();
        let actual = Ffmpeg::default().probe(&output).unwrap();
        let audio: Vec<_> = actual
            .streams
            .iter()
            .filter(|s| s.kind == StreamKind::Audio)
            .collect();
        assert_eq!(audio.iter().filter(|s| s.default).count(), 1);
        assert_eq!(
            audio.iter().find(|s| s.default).unwrap().language,
            if variant == "first" { "eng" } else { "spa" }
        );
        assert_eq!(video_hash(&output), video_hash(&source));
        assert_eq!(fs::read(&source).unwrap(), original);
    }
}
#[test]
fn real_remux_preserves_video_payload_and_source() {
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("source.mkv");
    generate(&source);
    let original = fs::read(&source).unwrap();
    let mut p = project(&source);
    p.metadata.clear();
    p.metadata.insert("title".into(), "Round trip title".into());
    p.metadata
        .insert("comment".into(), "Keep this unrelated field".into());
    p.tracks[1].title = "Main audio".into();
    p.chapters = vec![
        Chapter {
            start_ms: 0,
            end_ms: 1000,
            title: "First = part; #1".into(),
        },
        Chapter {
            start_ms: 1000,
            end_ms: 2000,
            title: "Second".into(),
        },
    ];
    // Reordering project tracks must not change stable source stream identity.
    p.tracks.swap(0, 1);
    let output = d.path().join("output.mkv");
    let mut phases = vec![];
    Ffmpeg::default()
        .export(&p, &output, false, &AtomicBool::new(false), |v| {
            phases.push(v.phase)
        })
        .unwrap();
    assert!(phases.contains(&"verifying".into()));
    assert_eq!(video_hash(&source), video_hash(&output));
    assert_eq!(fs::read(&source).unwrap(), original);
    let actual = Ffmpeg::default().probe(&output).unwrap();
    assert_eq!(actual.streams[0].kind, StreamKind::Audio);
    assert_eq!(actual.metadata.get("comment"), p.metadata.get("comment"));
    assert_eq!(actual.chapters.len(), 2);
}
#[test]
fn real_mp4_export_with_explicit_subtitle_approval() {
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("source.mkv");
    generate(&source);
    let subtitles = d.path().join("external.srt");
    fs::write(
        &subtitles,
        "1\n00:00:00,100 --> 00:00:01,500\nHello Reelio\n",
    )
    .unwrap();
    let mut p = project(&source);
    p.metadata.clear();
    p.metadata.insert("title".into(), "Movie".into());
    p.container = Container::Mp4;
    p.add_asset(Ffmpeg::default().probe(&subtitles).unwrap())
        .unwrap();
    let t = p.tracks.last_mut().unwrap();
    t.language = "eng".into();
    t.title = "English".into();
    t.default = false; // The MP4 plan chooses the omitted subtitle default automatically.
    p.chapters = vec![
        Chapter {
            start_ms: 0,
            end_ms: 1000,
            title: "Opening".into(),
        },
        Chapter {
            start_ms: 1000,
            end_ms: 2000,
            title: "Ending".into(),
        },
    ];
    let output = d.path().join("output.mp4");
    let f = Ffmpeg::default();
    assert!(f
        .export(&p, &output, false, &AtomicBool::new(false), |_| {})
        .is_err());
    assert!(!output.exists());
    f.export(&p, &output, true, &AtomicBool::new(false), |_| {})
        .unwrap();
    let actual = f.probe(&output).unwrap();
    assert_eq!(
        actual
            .streams
            .iter()
            .find(|s| s.kind == StreamKind::Subtitle)
            .unwrap()
            .codec,
        "mov_text"
    );
    assert_eq!(actual.streams.last().unwrap().codec, "bin_data");
    assert_eq!(actual.chapters.len(), 2);
    assert_eq!(video_hash(&source), video_hash(&output));
}
#[test]
fn existing_destinations_never_change() {
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("source.mkv");
    generate(&source);
    let p = project(&source);
    let output = d.path().join("existing.mkv");
    fs::write(&output, b"do not replace").unwrap();
    assert!(Ffmpeg::default()
        .export(&p, &output, false, &AtomicBool::new(false), |_| {})
        .is_err());
    assert_eq!(fs::read(&output).unwrap(), b"do not replace");
}
#[test]
fn cancellation_cleans_temporary_files() {
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("source.mkv");
    generate(&source);
    let p = project(&source);
    let output = d.path().join("cancelled.mkv");
    let flag = AtomicBool::new(false);
    let result = Ffmpeg::default().export(&p, &output, false, &flag, |_| {
        flag.store(true, Ordering::SeqCst);
    });
    assert!(result.is_err());
    assert!(!output.exists());
    assert!(source.exists());
    assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
}
#[test]
fn changed_source_is_blocked_and_offsets_require_render_approval() {
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("source.mkv");
    generate(&source);
    let mut p = project(&source);
    p.tracks[1].offset_ms = -100;
    assert!(plan(&p).errors.is_empty());
    assert!(Ffmpeg::default()
        .export(
            &p,
            &d.path().join("needs-approval.mkv"),
            false,
            &AtomicBool::new(false),
            |_| {}
        )
        .unwrap_err()
        .contains("approval"));
    p.tracks[1].offset_ms = 0;
    fs::write(&source, "changed").unwrap();
    assert!(Ffmpeg::default()
        .export(
            &p,
            &d.path().join("out.mkv"),
            false,
            &AtomicBool::new(false),
            |_| {}
        )
        .is_err());
}
#[test]
fn command_is_structured_and_maps_exact_indices() {
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("a ' ; $ source.mkv");
    generate(&source);
    let mut p = project(&source);
    p.tracks.swap(0, 1);
    let args = build_args(&p, &plan(&p), None, None, &d.path().join("out.mkv")).unwrap();
    let strings = args
        .iter()
        .map(|s| s.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert!(strings.contains(&source.to_string_lossy().into_owned()));
    let mappings = strings
        .windows(2)
        .filter(|w| w[0] == "-map")
        .map(|w| w[1].clone())
        .collect::<Vec<_>>();
    assert_eq!(mappings, vec!["0:1", "0:0"]);
    assert!(!strings.contains(&"sh".into()));
}

fn approved_cover(dir: &Path) -> Artwork {
    let path = dir.join("poster.jpg");
    let status = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:size=160x240",
            "-frames:v",
            "1",
            "-threads",
            "1",
        ])
        .arg(&path)
        .status()
        .unwrap();
    assert!(status.success());
    let original = reelio_artwork::prepare(&fs::read(path).unwrap(), "generated poster").unwrap();
    reelio_artwork::edit(
        &original,
        &reelio_artwork::ImageEdits {
            grayscale: true,
            rotation: 90,
            ..Default::default()
        },
    )
    .unwrap()
}
fn artwork_round_trip(container: Container, chapters: bool) {
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("source.mkv");
    generate(&source);
    let before = fs::read(&source).unwrap();
    let mut p = project(&source);
    p.container = container;
    p.metadata.clear();
    p.artwork = Some(approved_cover(d.path()));
    if chapters {
        p.chapters = vec![Chapter {
            start_ms: 0,
            end_ms: 2000,
            title: "Cover and chapter fixture".into(),
        }];
    }
    let output = d.path().join(format!("output.{}", container.extension()));
    Ffmpeg::default()
        .export(&p, &output, false, &AtomicBool::new(false), |_| {})
        .unwrap();
    assert_eq!(video_hash(&source), video_hash(&output));
    assert_eq!(fs::read(&source).unwrap(), before);
    let found = Ffmpeg::default().probe(&output).unwrap();
    let cover = found
        .streams
        .iter()
        .find(|s| s.properties.contains_key("attached_pic"))
        .unwrap();
    assert_eq!(cover.codec, "mjpeg");
    assert_eq!(cover.properties.get("width").unwrap(), "240");
    assert_eq!(cover.properties.get("height").unwrap(), "160");
    assert_eq!(found.chapters.len(), usize::from(chapters));
}
#[test]
fn real_mkv_cover_attachment_preserves_video() {
    artwork_round_trip(Container::Matroska, true);
}
#[test]
fn real_mp4_cover_and_chapters_preserve_video() {
    artwork_round_trip(Container::Mp4, true);
}
#[test]
fn real_m4v_cover_preserves_video() {
    artwork_round_trip(Container::M4v, false);
}
#[test]
fn real_text_subtitle_previews_preserve_originals() {
    let d = tempfile::tempdir().unwrap();
    let source = d.path().join("fixture.srt");
    let content = "1\n00:00:00,200 --> 00:00:01,500\nPreview fixture\n";
    fs::write(&source, content).unwrap();
    let mut paths = vec![source.clone()];
    for ext in ["ass", "vtt"] {
        let path = d.path().join(format!("fixture.{ext}"));
        assert!(Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(&source)
            .arg(&path)
            .status()
            .unwrap()
            .success());
        paths.push(path);
    }
    for path in paths {
        let before = fs::read(&path).unwrap();
        let text = Ffmpeg::default().subtitle_preview(&path, 0).unwrap();
        assert!(text.starts_with("WEBVTT"));
        assert!(text.contains("00:00.200 --> 00:01.500"));
        assert!(text.contains("Preview fixture"));
        assert_eq!(fs::read(&path).unwrap(), before);
    }
}
