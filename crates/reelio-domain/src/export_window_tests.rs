use super::*;

fn lane(project: &mut Project, kind: StreamKind, duration: i64, offset: i64) -> usize {
    let index = project.tracks.len();
    project
        .add_asset(Asset {
            id: id(),
            path: format!("input-{index}.mkv").into(),
            format: "matroska".into(),
            size: 100,
            modified_ms: 0,
            duration_ms: Some(duration),
            metadata: Default::default(),
            chapters: vec![],
            streams: vec![Stream {
                index: 0,
                kind,
                codec: match kind {
                    StreamKind::Video => "h264",
                    StreamKind::Audio => "aac",
                    _ => "subrip",
                }
                .into(),
                title: format!("lane-{index}"),
                language: "und".into(),
                duration_ms: Some(duration),
                default: false,
                forced: false,
                properties: Default::default(),
            }],
        })
        .unwrap();
    project.tracks[index].offset_ms = offset;
    index
}

#[test]
fn video_bounds_crop_audio_subtitles_and_chapters_without_changing_edits() {
    let mut project = Project::default();
    lane(&mut project, StreamKind::Video, 2000, 0);
    let audio = lane(&mut project, StreamKind::Audio, 8000, 0);
    let subtitle = lane(&mut project, StreamKind::Subtitle, 12000, 0);
    project.chapters = vec![
        Chapter {
            start_ms: 500,
            end_ms: 8000,
            title: "crossing".into(),
        },
        Chapter {
            start_ms: 9000,
            end_ms: 10000,
            title: "outside".into(),
        },
    ];
    let original = serde_json::to_value(&project).unwrap();
    let (effective, notices) = project.fit_to_video();
    assert_eq!(effective.tracks[audio].trim_end_ms, Some(2000));
    assert_eq!(effective.tracks[subtitle].trim_end_ms, Some(2000));
    assert_eq!(effective.chapters.len(), 1);
    assert_eq!(effective.chapters[0].end_ms, 2000);
    assert_eq!(notices.len(), 4);
    let plan = plan(&project);
    assert!(plan.errors.is_empty(), "{:?}", plan.errors);
    assert_eq!(plan.duration_ms, Some(2000));
    assert_eq!(plan.tracks[audio].compatibility.action, Action::RenderAudio);
    assert_eq!(
        plan.tracks[subtitle].compatibility.action,
        Action::ConvertSubtitle
    );
    assert_eq!(serde_json::to_value(project).unwrap(), original);
}

#[test]
fn offsets_are_clipped_or_omitted_and_audio_only_projects_remain_unbounded() {
    let mut project = Project::default();
    lane(&mut project, StreamKind::Video, 4000, 0);
    let negative = lane(&mut project, StreamKind::Audio, 8000, -6000);
    let outside = lane(&mut project, StreamKind::Audio, 1000, 6000);
    let before = lane(&mut project, StreamKind::Subtitle, 2000, -3000);
    let (effective, notices) = project.fit_to_video();
    assert_eq!(effective.tracks[negative].trim_start_ms, 6000);
    assert!(!effective.tracks[outside].enabled);
    assert!(!effective.tracks[before].enabled);
    assert_eq!(notices.len(), 3);
    assert!(plan(&project).errors.is_empty());
    project.tracks[0].enabled = false;
    let (effective, notices) = project.fit_to_video();
    assert!(notices.is_empty());
    assert_eq!(
        serde_json::to_value(effective).unwrap(),
        serde_json::to_value(project).unwrap()
    );
}

#[test]
fn longest_enabled_video_end_includes_offsets_and_explicit_trims() {
    let mut project = Project::default();
    lane(&mut project, StreamKind::Video, 2000, 1000);
    let second = lane(&mut project, StreamKind::Video, 4000, 2000);
    lane(&mut project, StreamKind::Subtitle, 20000, 0);
    assert_eq!(plan(&project).duration_ms, Some(6000));
    project.tracks[second].trim_end_ms = Some(3000);
    assert_eq!(plan(&project).duration_ms, Some(5000));
    project.tracks[second].enabled = false;
    assert_eq!(plan(&project).duration_ms, Some(3000));
}

#[test]
fn natural_embedded_audio_padding_stays_copy_but_explicit_video_trims_crop_it() {
    let mut project = Project::default();
    lane(&mut project, StreamKind::Video, 2000, 0);
    let mut stream = project.assets[0].streams[0].clone();
    stream.index = 1;
    stream.kind = StreamKind::Audio;
    stream.codec = "aac".into();
    stream.duration_ms = Some(2021);
    project.assets[0].streams.push(stream);
    let mut track = project.tracks[0].clone();
    track.id = id();
    track.stream_index = 1;
    project.tracks.push(track);
    assert_eq!(plan(&project).tracks[1].compatibility.action, Action::Copy);
    project.tracks[0].trim_end_ms = Some(1950);
    assert_eq!(
        plan(&project).tracks[1].compatibility.action,
        Action::RenderAudio
    );
    assert_eq!(project.fit_to_video().0.tracks[1].trim_end_ms, Some(1950));
}
#[test]
fn unknown_video_and_unsupported_image_subtitle_cropping_fail_before_export() {
    let mut project = Project::default();
    lane(&mut project, StreamKind::Video, 2000, 0);
    lane(&mut project, StreamKind::Subtitle, 8000, 0);
    project.assets[1].streams[0].codec = "hdmv_pgs_subtitle".into();
    assert!(plan(&project)
        .errors
        .iter()
        .any(|error| error.contains("Cropping image subtitles")));
    project.assets[0].duration_ms = None;
    project.assets[0].streams[0].duration_ms = None;
    assert!(plan(&project)
        .errors
        .iter()
        .any(|error| error.contains("Cannot determine")));
}
