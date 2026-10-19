use reelio_domain::*;
use reelio_ffmpeg::{Ffmpeg, MediaBackend};
use std::{fs, path::Path, process::Command, sync::atomic::AtomicBool};

fn generate(path: &Path, args: &[&str]) {
    let result = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(args)
        .arg(path)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}
fn video(path: &Path) {
    generate(
        path,
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=96x64:rate=20:duration=4",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ],
    );
}
fn audio(path: &Path) {
    generate(
        path,
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=8",
            "-c:a",
            "pcm_s16le",
        ],
    );
}
fn add(project: &mut Project, path: &Path) -> usize {
    let index = project.tracks.len();
    project
        .add_asset(Ffmpeg::default().probe(path).unwrap())
        .unwrap();
    index
}
fn hash(path: &Path) -> Vec<u8> {
    let output = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(path)
        .args([
            "-map",
            "0:v:0",
            "-c",
            "copy",
            "-f",
            "streamhash",
            "-hash",
            "sha256",
            "pipe:1",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    output.stdout
}

#[test]
fn real_video_bounded_exports_crop_audio_cues_and_chapters_in_all_containers() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("video.mp4");
    video(&source);
    let music = dir.path().join("long.wav");
    audio(&music);
    let subs = dir.path().join("long.srt");
    fs::write(&subs, "1\n00:00:00,250 --> 00:00:00,750\ninside\n\n2\n00:00:03,500 --> 00:00:05,500\ncrossing\n\n3\n00:00:05,700 --> 00:00:07,000\noutside\n").unwrap();
    let originals: Vec<_> = [&source, &music, &subs]
        .iter()
        .map(|path| fs::read(path).unwrap())
        .collect();
    let backend = Ffmpeg::default();
    for container in [Container::Matroska, Container::Mp4, Container::M4v] {
        let mut project = Project {
            container,
            ..Default::default()
        };
        add(&mut project, &source);
        let a = add(&mut project, &music);
        project.tracks[a].title = "Long audio".into();
        let s = add(&mut project, &subs);
        project.tracks[s].title = "Long subtitles".into();
        project.chapters = vec![
            Chapter {
                start_ms: 500,
                end_ms: 6500,
                title: "Crossing chapter".into(),
            },
            Chapter {
                start_ms: 7000,
                end_ms: 8000,
                title: "Outside chapter".into(),
            },
        ];
        let before = serde_json::to_value(&project).unwrap();
        let planned = plan(&project);
        assert!(planned.errors.is_empty(), "{:?}", planned.errors);
        assert_eq!(planned.duration_ms, Some(4000));
        let output = dir.path().join(format!("fitted.{}", container.extension()));
        assert!(backend
            .export(&project, &output, false, &AtomicBool::new(false), |_| {})
            .unwrap_err()
            .contains("approval"));
        assert!(!output.exists());
        let mut notices = Vec::new();
        backend
            .export(
                &project,
                &output,
                true,
                &AtomicBool::new(false),
                |progress| {
                    if progress.percent == Some(100.0) {
                        notices = progress.notices;
                    }
                },
            )
            .unwrap();
        let actual = backend.probe(&output).unwrap();
        assert!((actual.duration_ms.unwrap() - 4000).abs() <= 60);
        assert_eq!(
            hash(&source),
            hash(&output),
            "video must remain packet-identical"
        );
        assert_eq!(actual.chapters.last().unwrap().end_ms, 4000);
        let subtitle = actual
            .streams
            .iter()
            .find(|stream| stream.kind == StreamKind::Subtitle)
            .unwrap();
        let vtt = backend.subtitle_preview(&output, subtitle.index).unwrap();
        assert!(vtt.contains("00:03.500 --> 00:04.000"), "{vtt}");
        assert!(vtt.contains("inside") && vtt.contains("crossing") && !vtt.contains("outside"));
        let decoded = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(&output)
            .args([
                "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1",
            ])
            .output()
            .unwrap();
        assert!(decoded.status.success());
        assert!(
            (190000..=195000).contains(&(decoded.stdout.len() / 4)),
            "audio must stop at video end"
        );
        for label in [
            "Long audio",
            "Long subtitles",
            "Crossing chapter",
            "Outside chapter",
        ] {
            assert!(
                notices.iter().any(|notice| notice.contains(label)),
                "missing {label}: {notices:?}"
            );
        }
        if container == Container::Mp4 {
            let mut shifted = project.clone();
            shifted.tracks[s].offset_ms = 250;
            let shifted_output = dir.path().join("positive.mp4");
            backend
                .export(
                    &shifted,
                    &shifted_output,
                    true,
                    &AtomicBool::new(false),
                    |_| {},
                )
                .unwrap();
            let asset = backend.probe(&shifted_output).unwrap();
            let stream = asset
                .streams
                .iter()
                .find(|stream| stream.kind == StreamKind::Subtitle)
                .unwrap();
            let text = backend
                .subtitle_preview(&shifted_output, stream.index)
                .unwrap();
            assert!(text.contains("00:03.750 --> 00:04.000"), "{text}");
            assert!(text.contains("00:00.500 --> 00:01.000"), "{text}");
            assert!(!text.contains("outside"));
        }
        assert_eq!(serde_json::to_value(&project).unwrap(), before);
    }
    for (path, before) in [&source, &music, &subs].iter().zip(originals) {
        assert_eq!(fs::read(path).unwrap(), before);
    }
}

#[test]
fn empty_shifted_cues_are_omitted_and_remaining_subtitles_are_remapped() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("video.mp4");
    video(&source);
    let empty = dir.path().join("gap.srt");
    fs::write(
        &empty,
        "1\n00:00:01,000 --> 00:00:02,000\nbefore\n\n2\n02:00:00,000 --> 02:00:01,000\nafter\n",
    )
    .unwrap();
    let kept = dir.path().join("kept.srt");
    fs::write(&kept, "1\n01:46:34,530 --> 01:46:35,530\nretained\n").unwrap();
    let originals: Vec<_> = [&source, &empty, &kept]
        .iter()
        .map(|path| fs::read(path).unwrap())
        .collect();
    let backend = Ffmpeg::default();
    let mut project = Project::default();
    add(&mut project, &source);
    let e = add(&mut project, &empty);
    // Match the reported large negative offset, without touching the user's media.
    project.tracks[e].offset_ms = -6_393_530;
    project.tracks[e].default = true;
    project.tracks[e].title = "Empty gap".into();
    let mut notices = Vec::new();
    let output = dir.path().join("empty.mp4");
    backend
        .export(
            &project,
            &output,
            true,
            &AtomicBool::new(false),
            |progress| {
                if progress.percent == Some(100.0) {
                    notices = progress.notices;
                }
            },
        )
        .unwrap();
    assert_eq!(backend.probe(&output).unwrap().streams.len(), 1);
    assert!(notices
        .iter()
        .any(|notice| notice.contains("Empty gap") && notice.contains("no cues")));
    assert_eq!(hash(&source), hash(&output));
    let k = add(&mut project, &kept);
    project.tracks[k].offset_ms = -6_393_530;
    project.tracks[k].default = false;
    project.tracks[k].title = "Retained subtitle".into();
    let before = serde_json::to_value(&project).unwrap();
    let output = dir.path().join("remaining.mp4");
    backend
        .export(&project, &output, true, &AtomicBool::new(false), |_| {})
        .unwrap();
    let actual = backend.probe(&output).unwrap();
    assert_eq!(actual.streams.len(), 2);
    assert!(
        actual.streams[1].title == "Retained subtitle"
            || actual.streams[1]
                .properties
                .get("handler_name")
                .map(String::as_str)
                == Some("Retained subtitle")
    );
    assert!(actual.streams[1].default);
    let text = backend
        .subtitle_preview(&output, actual.streams[1].index)
        .unwrap();
    assert!(
        text.contains("00:01.000 --> 00:02.000") && text.contains("retained"),
        "{text}"
    );
    assert!((actual.duration_ms.unwrap() - 4000).abs() <= 50);
    assert_eq!(serde_json::to_value(project).unwrap(), before);
    for (path, before) in [&source, &empty, &kept].iter().zip(originals) {
        assert_eq!(fs::read(path).unwrap(), before);
    }
}

#[test]
fn embedded_long_subtitles_do_not_define_the_video_duration() {
    let dir = tempfile::tempdir().unwrap();
    let movie = dir.path().join("video.mp4");
    video(&movie);
    let subtitle = dir.path().join("long.srt");
    fs::write(
        &subtitle,
        "1\n00:00:01,000 --> 00:00:02,000\ninside\n\n2\n00:01:00,000 --> 00:01:01,000\nafter\n",
    )
    .unwrap();
    let source = dir.path().join("combined.mkv");
    let result = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(&movie)
        .arg("-i")
        .arg(&subtitle)
        .args(["-map", "0:v:0", "-map", "1:0", "-c", "copy"])
        .arg(&source)
        .output()
        .unwrap();
    assert!(result.status.success());
    let backend = Ffmpeg::default();
    let asset = backend.probe(&source).unwrap();
    assert_eq!(asset.streams[0].duration_ms, Some(4000));
    assert!(asset.duration_ms.unwrap() > 60000);
    let bytes = fs::read(&source).unwrap();
    let mut project = Project {
        container: Container::Matroska,
        ..Default::default()
    };
    project.add_asset(asset).unwrap();
    assert_eq!(plan(&project).duration_ms, Some(4000));
    let output = dir.path().join("fitted.mkv");
    backend
        .export(&project, &output, true, &AtomicBool::new(false), |_| {})
        .unwrap();
    let actual = backend.probe(&output).unwrap();
    assert!((actual.duration_ms.unwrap() - 4000).abs() < 50);
    let vtt = backend
        .subtitle_preview(&output, actual.streams[1].index)
        .unwrap();
    assert!(vtt.contains("inside") && !vtt.contains("after"));
    assert_eq!(hash(&source), hash(&output));
    assert_eq!(fs::read(&source).unwrap(), bytes);
}

#[test]
fn audio_entirely_after_video_is_reported_and_omitted_without_rendering() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("video.mp4");
    video(&source);
    let music = dir.path().join("outside.wav");
    audio(&music);
    let mut project = Project::default();
    add(&mut project, &source);
    let a = add(&mut project, &music);
    project.tracks[a].offset_ms = 5000;
    project.tracks[a].title = "Outside audio".into();
    let output = dir.path().join("outside.mp4");
    let mut notices = Vec::new();
    Ffmpeg::default()
        .export(
            &project,
            &output,
            false,
            &AtomicBool::new(false),
            |progress| {
                if progress.percent == Some(100.0) {
                    notices = progress.notices;
                }
            },
        )
        .unwrap();
    assert_eq!(Ffmpeg::default().probe(&output).unwrap().streams.len(), 1);
    assert!(notices
        .iter()
        .any(|notice| notice.contains("Omitted Outside audio")));
    let mut wrong_duration = Ffmpeg::default().probe(&output).unwrap();
    wrong_duration.duration_ms = Some(12000);
    assert!(
        reelio_ffmpeg::verify(&project, &plan(&project), &wrong_duration)
            .unwrap_err()
            .contains("duration differs beyond tolerance")
    );
    assert_eq!(hash(&source), hash(&output));
}
