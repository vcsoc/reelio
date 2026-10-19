use reelio_domain::*;
use reelio_ffmpeg::{Ffmpeg, MediaBackend};
use std::{fs, path::Path, process::Command, sync::atomic::AtomicBool};

fn ffmpeg(args: &[&str], output: &Path) {
    let result = Command::new("ffmpeg")
        .args(["-hide_banner", "-v", "error", "-n"])
        .args(args)
        .arg(output)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}
fn movie(path: &Path) {
    ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=96x64:rate=20",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "3",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
        ],
        path,
    );
}
fn read_process(args: &[&str], path: &Path, tail: &[&str]) -> Vec<u8> {
    let out = Command::new("ffmpeg")
        .args(["-v", "error"])
        .args(args)
        .arg("-i")
        .arg(path)
        .args(tail)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    out.stdout
}
fn packets(path: &Path, stream: &str) -> Vec<u8> {
    read_process(
        &[],
        path,
        &[
            "-map",
            stream,
            "-c",
            "copy",
            "-f",
            "streamhash",
            "-hash",
            "sha256",
            "pipe:1",
        ],
    )
}
fn frame(path: &Path, time: &str) -> Vec<u8> {
    read_process(
        &["-ss", time],
        path,
        &[
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "pipe:1",
        ],
    )
}
fn samples(path: &Path) -> Vec<f32> {
    read_process(
        &[],
        path,
        &[
            "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1",
        ],
    )
    .as_chunks::<4>()
    .0
    .iter()
    .copied()
    .map(f32::from_le_bytes)
    .collect()
}
fn frequency(samples: &[f32], start: f64, end: f64, hz: f64) -> f64 {
    let values = &samples[(start * 48000.) as usize..(end * 48000.) as usize];
    let (re, im) = values
        .iter()
        .enumerate()
        .fold((0., 0.), |(re, im), (i, &s)| {
            let phase = 2. * std::f64::consts::PI * hz * i as f64 / 48000.;
            (
                re + f64::from(s) * phase.cos(),
                im + f64::from(s) * phase.sin(),
            )
        });
    2. * re.hypot(im) / values.len() as f64
}
fn add(p: &mut Project, path: &Path) {
    p.add_asset(Ffmpeg::default().probe(path).unwrap()).unwrap();
}

#[test]
fn trimmed_video_and_audio_export_actual_source_interval_and_can_restore_copy() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.mkv");
    movie(&source);
    let original = fs::read(&source).unwrap();
    let reference = frame(&source, "0.500");
    for container in [Container::Matroska, Container::Mp4, Container::M4v] {
        let mut p = Project {
            container,
            ..Default::default()
        };
        add(&mut p, &source);
        for t in &mut p.tracks {
            t.trim_start_ms = 500;
            t.trim_end_ms = Some(2000);
            t.offset_ms = -500;
        }
        let before = serde_json::to_vec(&p).unwrap();
        let output = dir.path().join(format!("trim.{}", container.extension()));
        assert!(Ffmpeg::default()
            .export(&p, &output, false, &AtomicBool::new(false), |_| {})
            .is_err());
        assert!(!output.exists());
        Ffmpeg::default()
            .export(&p, &output, true, &AtomicBool::new(false), |_| {})
            .unwrap();
        let actual = Ffmpeg::default().probe(&output).unwrap();
        assert!((actual.duration_ms.unwrap() - 1500).abs() < 150);
        assert_eq!(actual.streams[0].codec, "h264");
        for duration in [None, Some(0)] {
            let mut unverified = actual.clone();
            unverified.duration_ms = duration;
            assert!(reelio_ffmpeg::verify(&p, &plan(&p), &unverified)
                .unwrap_err()
                .contains("duration"));
        }
        let first = frame(&output, "0");
        assert_eq!(first.len(), reference.len());
        assert!(!first.is_empty());
        let error = first
            .iter()
            .zip(&reference)
            .map(|(a, b)| (*a as f64 - *b as f64).abs())
            .sum::<f64>()
            / first.len() as f64;
        assert!(error < 8., "First retained video frame differs: {error}");
        assert!((samples(&output).len() as i64 - 72000).abs() < 3000);
        assert_eq!(serde_json::to_vec(&p).unwrap(), before);
        assert_eq!(fs::read(&source).unwrap(), original);
    }
    let mut restored = Project {
        container: Container::Matroska,
        ..Project::default()
    };
    add(&mut restored, &source);
    restored.tracks[0].trim_start_ms = 500;
    restored.tracks[0].trim_end_ms = Some(2000);
    restored.tracks[0].trim_start_ms = 0;
    restored.tracks[0].trim_end_ms = None;
    assert!(plan(&restored)
        .tracks
        .iter()
        .all(|t| matches!(t.compatibility.action, Action::Copy)));
    let output = dir.path().join("restored.mkv");
    Ffmpeg::default()
        .export(&restored, &output, false, &AtomicBool::new(false), |_| {})
        .unwrap();
    for selector in ["0:v:0", "0:a:0"] {
        assert_eq!(packets(&source, selector), packets(&output, selector));
    }
}

#[test]
fn left_trim_and_positive_position_preserve_the_gap_instead_of_slipping_content() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.mkv");
    movie(&source);
    let original = fs::read(&source).unwrap();
    let reference = frame(&source, "0.500");
    for container in [Container::Matroska, Container::Mp4, Container::M4v] {
        let mut p = Project {
            container,
            ..Default::default()
        };
        add(&mut p, &source);
        for t in &mut p.tracks {
            t.trim_start_ms = 500;
            t.trim_end_ms = Some(1500);
            t.offset_ms = 250;
        }
        let output = dir.path().join(format!("gap.{}", container.extension()));
        Ffmpeg::default()
            .export(&p, &output, true, &AtomicBool::new(false), |_| {})
            .unwrap();
        let actual = Ffmpeg::default().probe(&output).unwrap();
        assert!(
            (actual
                .duration_ms
                .unwrap_or_else(|| panic!("Missing duration for {container:?}: {actual:?}"))
                - 1750)
                .abs()
                < 150
        );
        let black = frame(&output, "0.100");
        assert!(!black.is_empty());
        assert!(black.iter().map(|v| u64::from(*v)).sum::<u64>() < black.len() as u64 * 2);
        let retained = frame(&output, "0.750");
        assert_eq!(retained.len(), reference.len());
        let error = retained
            .iter()
            .zip(&reference)
            .map(|(a, b)| (*a as f64 - *b as f64).abs())
            .sum::<f64>()
            / retained.len() as f64;
        assert!(
            error < 8.,
            "Source content slipped after left trim: {error}"
        );
        let audio = samples(&output);
        assert!(audio[4800..24000].iter().all(|s| s.abs() < 0.005));
        assert!(frequency(&audio, 1., 1.3, 440.) > 0.03);
        assert_eq!(fs::read(&source).unwrap(), original);
    }
}

#[test]
fn independently_trimmed_mix_inputs_keep_source_content_and_silence_outside_edges() {
    let dir = tempfile::tempdir().unwrap();
    let first = dir.path().join("first.wav");
    let second = dir.path().join("second.wav");
    ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "aevalsrc=if(lt(t\\,1)\\,0.2*sin(2*PI*440*t)\\,0.2*sin(2*PI*880*t)):s=48000:d=3",
            "-c:a",
            "pcm_s16le",
        ],
        &first,
    );
    ffmpeg(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=660:sample_rate=48000",
            "-t",
            "3",
            "-c:a",
            "pcm_s16le",
        ],
        &second,
    );
    let originals = [fs::read(&first).unwrap(), fs::read(&second).unwrap()];
    for container in [Container::Matroska, Container::Mp4, Container::M4v] {
        let mut p = Project {
            container,
            ..Default::default()
        };
        add(&mut p, &first);
        add(&mut p, &second);
        for t in &mut p.tracks {
            t.audio_role = AudioRole::Mix;
            t.offset_ms = -500;
        }
        p.tracks[0].trim_start_ms = 500;
        p.tracks[0].trim_end_ms = Some(2000);
        p.tracks[1].trim_start_ms = 1000;
        p.tracks[1].trim_end_ms = Some(1500);
        assert_eq!(plan(&p).tracks[0].mix_sources.len(), 2);
        let output = dir.path().join(format!("mix.{}", container.extension()));
        Ffmpeg::default()
            .export(&p, &output, true, &AtomicBool::new(false), |_| {})
            .unwrap();
        let audio = samples(&output);
        assert!((audio.len() as i64 - 72000).abs() < 3000);
        assert!(frequency(&audio, 0.1, 0.4, 440.) > 0.03);
        assert!(frequency(&audio, 0.1, 0.4, 660.) < 0.005);
        assert!(frequency(&audio, 0.6, 0.9, 880.) > 0.03);
        assert!(frequency(&audio, 0.6, 0.9, 660.) > 0.02);
        assert!(frequency(&audio, 1.1, 1.4, 880.) > 0.03);
        assert!(frequency(&audio, 1.1, 1.4, 660.) < 0.005);
    }
    assert_eq!(fs::read(first).unwrap(), originals[0]);
    assert_eq!(fs::read(second).unwrap(), originals[1]);
}

#[test]
fn subtitle_edges_clip_straddling_cues_and_drop_outside_cues_without_trimming_other_tracks() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.mkv");
    movie(&source);
    let subtitle = dir.path().join("source.srt");
    fs::write(&subtitle, "1\n00:00:00,100 --> 00:00:00,300\nbefore\n\n2\n00:00:00,400 --> 00:00:00,800\nhead\n\n3\n00:00:01,200 --> 00:00:01,800\ntail\n\n4\n00:00:02,100 --> 00:00:02,400\nafter\n").unwrap();
    let originals = [fs::read(&source).unwrap(), fs::read(&subtitle).unwrap()];
    for container in [Container::Matroska, Container::Mp4, Container::M4v] {
        for offset in [-500, 250] {
            let mut p = Project {
                container,
                ..Default::default()
            };
            add(&mut p, &source);
            add(&mut p, &subtitle);
            let t = p.tracks.last_mut().unwrap();
            t.trim_start_ms = 600;
            t.trim_end_ms = Some(1500);
            t.offset_ms = offset;
            let output = dir
                .path()
                .join(format!("subs-{offset}.{}", container.extension()));
            Ffmpeg::default()
                .export(&p, &output, true, &AtomicBool::new(false), |_| {})
                .unwrap();
            let actual = Ffmpeg::default().probe(&output).unwrap();
            let stream = actual
                .streams
                .iter()
                .find(|s| s.kind == StreamKind::Subtitle)
                .unwrap();
            let text = Ffmpeg::default()
                .subtitle_preview(&output, stream.index)
                .unwrap();
            assert!(!text.contains("before"));
            assert!(!text.contains("after"));
            assert!(text.contains("head") && text.contains("tail"));
            let clocks = if offset < 0 {
                ["00:00.100 --> 00:00.300", "00:00.700 --> 00:01.000"]
            } else {
                ["00:00.850 --> 00:01.050", "00:01.450 --> 00:01.750"]
            };
            for clock in clocks {
                assert!(text.contains(clock), "{text}");
            }
            for selector in ["0:v:0", "0:a:0"] {
                assert_eq!(packets(&source, selector), packets(&output, selector));
            }
            assert!((actual.duration_ms.unwrap() - 3000).abs() < 150);
        }
    }
    assert_eq!(fs::read(source).unwrap(), originals[0]);
    assert_eq!(fs::read(subtitle).unwrap(), originals[1]);
}
