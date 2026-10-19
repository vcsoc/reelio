use reelio_domain::*;
use reelio_ffmpeg::{Ffmpeg, MediaBackend};
use std::{fs, path::Path, process::Command, sync::atomic::AtomicBool};
fn ffmpeg(args: &[&str], path: &Path) {
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
    video_length(path, "2");
}
fn video_length(path: &Path, duration: &str) {
    ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=96x64:rate=12",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=2",
            "-t",
            duration,
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
        ],
        path,
    );
}
fn packet_hash(path: &Path, selector: &str) -> Vec<u8> {
    let result = Command::new("ffmpeg")
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
            "pipe:1",
        ])
        .output()
        .unwrap();
    assert!(result.status.success());
    result.stdout
}
fn samples(path: &Path, stream: &str) -> Vec<f32> {
    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(path)
        .args([
            "-map", stream, "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1",
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    out.stdout
        .as_chunks::<4>()
        .0
        .iter()
        .copied()
        .map(f32::from_le_bytes)
        .collect()
}
fn frequency(samples: &[f32], start: f64, end: f64, hz: f64) -> f64 {
    let range = &samples[(start * 48000.) as usize..(end * 48000.) as usize];
    let (re, im) = range
        .iter()
        .enumerate()
        .fold((0., 0.), |(re, im), (i, &s)| {
            let phase = 2. * std::f64::consts::PI * hz * i as f64 / 48000.;
            (
                re + f64::from(s) * phase.cos(),
                im + f64::from(s) * phase.sin(),
            )
        });
    2. * re.hypot(im) / range.len() as f64
}
fn add(p: &mut Project, path: &Path) {
    p.add_asset(Ffmpeg::default().probe(path).unwrap()).unwrap();
}
#[test]
fn real_mixed_audio_separate_language_and_independent_subtitle_offsets() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("movie.mkv");
    // Leave room for the delayed music while the original audio ends at two seconds.
    video_length(&source, "3");
    let music = dir.path().join("music.wav");
    ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:sample_rate=48000",
            "-t",
            "2",
            "-c:a",
            "pcm_s16le",
        ],
        &music,
    );
    let french = dir.path().join("french.m4a");
    ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=660:sample_rate=48000",
            "-t",
            "2",
            "-c:a",
            "aac",
        ],
        &french,
    );
    let subs = dir.path().join("english.srt");
    fs::write(&subs, "1\n00:00:01,000 --> 00:00:01,500\nHello\n").unwrap();
    let other = dir.path().join("french.srt");
    fs::write(&other, "1\n00:00:01,000 --> 00:00:01,500\nBonjour\n").unwrap();
    let originals: Vec<_> = [&source, &music, &french, &subs, &other]
        .iter()
        .map(|p| fs::read(p).unwrap())
        .collect();
    for container in [Container::Matroska, Container::Mp4, Container::M4v] {
        let mut p = Project {
            container,
            ..Default::default()
        };
        add(&mut p, &source);
        p.tracks[1].audio_role = AudioRole::Mix;
        add(&mut p, &music);
        let t = p.tracks.last_mut().unwrap();
        t.audio_role = AudioRole::Mix;
        t.offset_ms = 500;
        t.title = "Music".into();
        add(&mut p, &french);
        let t = p.tracks.last_mut().unwrap();
        t.language = "fra".into();
        t.title = "French".into();
        t.default = false;
        add(&mut p, &subs);
        let t = p.tracks.last_mut().unwrap();
        t.offset_ms = 500;
        t.language = "eng".into();
        add(&mut p, &other);
        let t = p.tracks.last_mut().unwrap();
        t.offset_ms = -500;
        t.language = "fra".into();
        let output = dir.path().join(format!("mixed.{}", container.extension()));
        p.chapters.push(Chapter {
            start_ms: 500,
            end_ms: 2500,
            title: "Scene".into(),
        });
        let snapshot = serde_json::to_string(&p).unwrap();
        Ffmpeg::default()
            .export(&p, &output, true, &AtomicBool::new(false), |_| {})
            .unwrap();
        assert_eq!(serde_json::to_string(&p).unwrap(), snapshot);
        let asset = Ffmpeg::default().probe(&output).unwrap();
        assert_eq!(
            asset
                .streams
                .iter()
                .filter(|s| s.kind == StreamKind::Audio)
                .count(),
            2
        );
        let language = asset
            .streams
            .iter()
            .find(|s| s.kind == StreamKind::Audio && s.language == "fra")
            .unwrap();
        assert!(!language.default);
        assert_eq!(packet_hash(&output, "0:v:0"), packet_hash(&source, "0:v:0"));
        assert_eq!(packet_hash(&output, "0:a:1"), packet_hash(&french, "0:a:0"));
        let audio = samples(&output, "0:a:0");
        assert!(frequency(&audio, 0.1, 0.3, 440.) > 0.02);
        assert!(frequency(&audio, 0.1, 0.3, 880.) < 0.01);
        assert!(frequency(&audio, 0.8, 1., 440.) > 0.02);
        assert!(frequency(&audio, 0.8, 1., 880.) > 0.02);
        assert!(frequency(&audio, 2.2, 2.4, 880.) > 0.02);
        for (lang, start) in [("eng", "00:01.500"), ("fra", "00:00.500")] {
            let stream = asset
                .streams
                .iter()
                .find(|s| s.kind == StreamKind::Subtitle && s.language == lang)
                .unwrap();
            let text = Ffmpeg::default()
                .subtitle_preview(&output, stream.index)
                .unwrap();
            assert!(text.contains(start), "{text}");
        }
        for (path, original) in [&source, &music, &french, &subs, &other]
            .iter()
            .zip(&originals)
        {
            assert_eq!(&fs::read(path).unwrap(), original);
        }
    }
}
#[test]
fn negative_subtitle_offsets_drop_and_clip_cues_before_zero() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("movie.mkv");
    video(&source);
    let subtitles = directory.path().join("clip.srt");
    fs::write(&subtitles,"1\n00:00:00,100 --> 00:00:00,300\nDrop\n\n2\n00:00:00,300 --> 00:00:00,900\nClip\n\n3\n00:00:01,000 --> 00:00:01,500\nKeep\n").unwrap();
    let original = fs::read(&subtitles).unwrap();
    for container in [Container::Matroska, Container::Mp4, Container::M4v] {
        let mut p = Project {
            container,
            ..Default::default()
        };
        add(&mut p, &source);
        add(&mut p, &subtitles);
        assert_eq!(p.assets.last().unwrap().duration_ms, Some(1500));
        p.tracks.last_mut().unwrap().offset_ms = -500;
        let output = directory
            .path()
            .join(format!("clipped.{}", container.extension()));
        Ffmpeg::default()
            .export(&p, &output, true, &AtomicBool::new(false), |_| {})
            .unwrap();
        let actual = Ffmpeg::default().probe(&output).unwrap();
        let index = actual
            .streams
            .iter()
            .find(|s| s.kind == StreamKind::Subtitle)
            .unwrap()
            .index;
        let vtt = Ffmpeg::default().subtitle_preview(&output, index).unwrap();
        assert!(!vtt.contains("Drop"));
        assert!(vtt.contains("00:00.000 --> 00:00.400"), "{vtt}");
        assert!(vtt.contains("00:00.500 --> 00:01.000"), "{vtt}");
        assert_eq!(fs::read(&subtitles).unwrap(), original);
    }
}
#[test]
fn muting_excludes_audio_and_legacy_projects_keep_separate_tracks() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.mkv");
    video(&source);
    let mut p = Project {
        container: Container::Matroska,
        ..Project::default()
    };
    add(&mut p, &source);
    let raw = serde_json::to_value(&p).unwrap();
    let mut legacy = raw.clone();
    for t in legacy["tracks"].as_array_mut().unwrap() {
        t.as_object_mut().unwrap().remove("audio_role");
        t.as_object_mut().unwrap().remove("muted");
    }
    legacy["schema_version"] = serde_json::json!(1);
    let mut restored: Project = serde_json::from_value(legacy).unwrap();
    restored.upgrade_legacy().unwrap();
    assert!(restored
        .tracks
        .iter()
        .all(|t| t.audio_role == AudioRole::Separate && !t.muted));
    p.tracks[1].muted = true;
    let output = dir.path().join("muted.mkv");
    Ffmpeg::default()
        .export(&p, &output, false, &AtomicBool::new(false), |_| {})
        .unwrap();
    assert!(Ffmpeg::default()
        .probe(&output)
        .unwrap()
        .streams
        .iter()
        .all(|s| s.kind != StreamKind::Audio));
}
#[test]
fn positioned_audio_renders_silence_or_trims_without_moving_other_streams() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.mkv");
    video(&source);
    let original = fs::read(&source).unwrap();
    for container in [Container::Matroska, Container::Mp4] {
        for offset in [-500, 500] {
            let mut p = Project {
                container,
                ..Default::default()
            };
            add(&mut p, &source);
            p.tracks[0].enabled = false;
            p.tracks[1].offset_ms = offset;
            let output = dir
                .path()
                .join(format!("audio-{offset}.{}", container.extension()));
            Ffmpeg::default()
                .export(&p, &output, true, &AtomicBool::new(false), |_| {})
                .unwrap();
            let audio = samples(&output, "0:a:0");
            assert!((audio.len() as i64 - (2000 + offset) * 48).abs() < 2400);
            if offset > 0 {
                assert!(audio[..9600].iter().all(|s| s.abs() < 0.005));
                assert!(frequency(&audio, 0.7, 0.9, 440.) > 0.05);
            } else {
                assert!(frequency(&audio, 0.1, 0.3, 440.) > 0.05);
            }
            assert_eq!(fs::read(&source).unwrap(), original);
        }
    }
}
#[test]
fn positioned_video_renders_black_lead_in_or_trims_with_approval() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.mkv");
    video(&source);
    let original = fs::read(&source).unwrap();
    for offset in [-500, 500] {
        let mut p = Project {
            container: Container::Mp4,
            ..Default::default()
        };
        add(&mut p, &source);
        p.tracks[1].enabled = false;
        p.tracks[0].offset_ms = offset;
        let output = dir.path().join(format!("video-{offset}.mp4"));
        Ffmpeg::default()
            .export(&p, &output, true, &AtomicBool::new(false), |_| {})
            .unwrap();
        let actual = Ffmpeg::default().probe(&output).unwrap();
        assert_eq!(actual.streams[0].codec, "h264");
        assert!((actual.duration_ms.unwrap() - (2000 + offset)).abs() < 150);
        assert_eq!(fs::read(&source).unwrap(), original);
    }
}
