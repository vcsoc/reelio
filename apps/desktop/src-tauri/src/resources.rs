use super::{blocking, grant, AppState};
use reelio_application::{
    artwork,
    resources::{self, PendingInfo, SearchKind, SubtitleFile},
};
use reelio_domain::{Artwork, Project};
use serde::Serialize;
use std::{io::Read, thread};
use tauri::{
    webview::{DownloadEvent, NewWindowResponse},
    Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::DialogExt;

pub(super) fn trusted_ipc_source(label: &str, url: &tauri::Url) -> bool {
    label == "main"
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (url.scheme() == "http"
                && url.host_str() == Some("tauri.localhost")
                && url.port_or_known_default() == Some(80))
            || (cfg!(debug_assertions)
                && url.scheme() == "http"
                && url.host_str() == Some("localhost")
                && url.port() == Some(1420)))
}
#[tauri::command]
pub async fn choose_artwork(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Artwork>, String> {
    let state = state.inner().clone();
    blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Choose a poster or cover")
            .set_directory(super::preferences::default_folder(&app, &state)?)
            .add_filter("Cover image", &["jpg", "jpeg", "png", "webp", "avif"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let path = grant(&app, &state, &path)?;
        load_cover(&state, &path).map(|result| Some(result.artwork))
    })
    .await
}
#[derive(Serialize)]
pub struct ImportedCover {
    pub asset: reelio_domain::Asset,
    pub artwork: Artwork,
}
fn load_cover(
    state: &reelio_application::Application,
    path: &std::path::Path,
) -> Result<ImportedCover, String> {
    use reelio_ffmpeg::MediaBackend;
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > artwork::MAX_DOWNLOAD as u64 {
        return Err("Choose a regular still image smaller than 8 MiB".into());
    }
    let asset = state.backend.probe(path)?;
    if !asset.is_still_image() {
        return Err(
            "Drop a JPEG, PNG, WebP or still AVIF image into the cover area, not a video".into(),
        );
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|error| error.to_string())?
        .take(artwork::MAX_DOWNLOAD as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    let label = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Local cover");
    let art = if asset
        .metadata
        .get("major_brand")
        .is_some_and(|brand| brand.trim() == "avif")
    {
        artwork::prepare(&state.backend.cover_image_bytes(&asset)?, label)?
    } else {
        artwork::prepare(&bytes, label)?
    };
    if reelio_ffmpeg::fingerprint(path)? != (asset.size, asset.modified_ms) {
        return Err("Image changed while preparing the cover".into());
    }
    Ok(ImportedCover {
        asset,
        artwork: art,
    })
}
#[tauri::command]
pub async fn artwork_import(
    state: State<'_, AppState>,
    path: std::path::PathBuf,
) -> Result<ImportedCover, String> {
    let path = state.require_authorized(&path)?;
    let state = state.inner().clone();
    blocking(move || load_cover(&state, &path)).await
}
#[tauri::command]
pub async fn poster_search(
    query: String,
    proportion: resources::PosterProportion,
    offset: u32,
) -> Result<resources::PosterBatch, String> {
    blocking(move || resources::poster_search_page(&query, proportion, offset)).await
}
#[tauri::command]
pub async fn poster_image(
    url: String,
    proportion: Option<resources::PosterProportion>,
) -> Result<Artwork, String> {
    blocking(move || {
        let art=artwork::prepare(
            &resources::poster_image(&url)?,
            tauri::Url::parse(&url)
                .map_err(|_| "Invalid image URL")?
                .host_str()
                .unwrap_or("Web artwork"),
        )?;
        let proportion=proportion.unwrap_or_default();
        if !proportion.matches(art.width,art.height){return Err("The downloaded image does not match the selected proportions. Choose another result; your existing cover is unchanged.".into());}
        if let Some((w,h))=proportion.ratio(){artwork::crop_to_ratio(&art,w,h)}else{Ok(art)}
    })
    .await
}
#[tauri::command]
pub async fn artwork_save_copy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    artwork: Artwork,
) -> Result<Option<String>, String> {
    let state = state.inner().clone();
    blocking(move || {
        artwork::jpeg_bytes(&artwork)?;
        let value = state
            .storage
            .lock()
            .map_err(|_| "Storage lock failed")?
            .setting("image_format")?
            .unwrap_or(serde_json::json!("png"));
        let format: artwork::ImageFileFormat = serde_json::from_value(value)
            .map_err(|_| "Invalid default image format; choose PNG, JPEG or WebP in Settings")?;
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Save preview image to a new file")
            .set_directory(super::preferences::default_folder(&app, &state)?)
            .set_file_name(format!("cover-preview.{}", format.extension()))
            .add_filter("Preview image", &[format.extension()])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let mut path = file.into_path().map_err(|e| e.to_string())?;
        if path.extension().is_none() {
            path.set_extension(format.extension());
        }
        artwork::save_copy(&artwork, &path, format)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}
#[tauri::command]
pub async fn artwork_edit(artwork: Artwork, edits: artwork::ImageEdits) -> Result<Artwork, String> {
    blocking(move || artwork::edit(&artwork, &edits)).await
}
#[tauri::command]
pub async fn choose_subtitles(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let s = state.inner().clone();
    blocking(move || {
        let files = app
            .dialog()
            .file()
            .set_title("Choose subtitles to test")
            .set_directory(super::preferences::default_folder(&app, &s)?)
            .add_filter("Text subtitles", &["srt", "ass", "ssa", "vtt"])
            .blocking_pick_files()
            .unwrap_or_default();
        files
            .into_iter()
            .take(32)
            .map(|file| {
                let path = file.into_path().map_err(|e| e.to_string())?;
                Ok(grant(&app, &s, &path)?.to_string_lossy().into_owned())
            })
            .collect()
    })
    .await
}
#[tauri::command]
pub async fn subtitle_preview(
    state: State<'_, AppState>,
    project: Project,
    track_id: String,
) -> Result<String, String> {
    let s = state.inner().clone();
    blocking(move|| {
        s.validate_sources(&project)?;
        let track=project.tracks.iter().find(|t|t.id==track_id).ok_or("Subtitle track not found")?;
        if track.offset_ms!=0{return Err("Nonzero subtitle offsets are not implemented; set the offset to zero before testing".into());}
        let asset=project.assets.iter().find(|a|a.id==track.asset_id).ok_or("Subtitle source not found")?;
        s.backend.subtitle_preview(&asset.path,track.stream_index)
    }).await
}
#[tauri::command]
pub fn resource_queue(
    state: State<'_, AppState>,
    kind: SearchKind,
    url: String,
) -> Result<PendingInfo, String> {
    state.resources.remember(
        tauri::Url::parse(&url).map_err(|_| "Enter a valid public HTTPS download URL")?,
        kind,
        String::new(),
    )
}
#[tauri::command]
pub fn resource_cancel(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.resources.forget(&id)
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ImportResult {
    Artwork { artwork: Artwork },
    Subtitles { files: Vec<SubtitleFile> },
}
#[tauri::command]
pub async fn resource_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<ImportResult, String> {
    let s = state.inner().clone();
    blocking(move || {
        let download = s.resources.download(&id)?;
        match download.kind {
            SearchKind::Artwork => Ok(ImportResult::Artwork {
                artwork: artwork::prepare(&download.bytes, &download.source_label)?,
            }),
            SearchKind::Subtitles => {
                let files = s
                    .resources
                    .save_subtitles(&download.bytes, &download.filename)?;
                for file in &files {
                    grant(&app, &s, &file.path)?;
                }
                Ok(ImportResult::Subtitles { files })
            }
        }
    })
    .await
}
#[tauri::command]
pub async fn search_browser_open(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    kind: SearchKind,
    query: String,
) -> Result<(), String> {
    let url = resources::search_url(kind, &query)?;
    let check = state.inner().clone();
    if !blocking(move || {
        let report = check.dependencies.status(&check.backend);
        Ok(report.preview_available && report.network_available)
    })
    .await?
    {
        let _ = app.emit_to("main", "dependencies:changed", ());
        return Err("Install the required playback and HTTPS components before opening the search browser. Use the workspace repair control.".into());
    }
    let label = match kind {
        SearchKind::Artwork => "artwork-browser",
        SearchKind::Subtitles => "subtitle-browser",
    };
    if let Some(window) = app.get_webview_window(label) {
        window.navigate(url).map_err(|e| e.to_string())?;
        let _ = window.show();
        return window.set_focus().map_err(|e| e.to_string());
    }
    let s = state.inner().clone();
    let popup_app = app.clone();
    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title(match kind {
            SearchKind::Artwork => "Reelio - Cover search",
            SearchKind::Subtitles => "Reelio - Subtitle search",
        })
        .inner_size(1100.0, 800.0)
        .incognito(true)
        .devtools(false)
        .on_navigation(resources::allowed_url)
        .on_new_window(move |url, _| {
            if resources::allowed_url(&url) {
                if let Some(window) = popup_app.get_webview_window(label) {
                    let _ = window.navigate(url);
                }
            }
            NewWindowResponse::Deny
        })
        .on_download(move |webview, event| {
            if let DownloadEvent::Requested { url, .. } = event {
                let app = webview.app_handle().clone();
                let s = s.clone();
                thread::spawn(move || {
                    let cookies = webview.cookies_for_url(url.clone()).unwrap_or_default();
                    let cookie = cookies
                        .iter()
                        .map(|c| format!("{}={}", c.name(), c.value()))
                        .collect::<Vec<_>>()
                        .join("; ");
                    match s.resources.remember(url, kind, cookie) {
                        Ok(info) => {
                            let _ = app.emit_to("main", "resource:download-requested", info);
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        Err(error) => {
                            let _ = app.emit_to("main", "resource:error", error);
                        }
                    }
                });
            }
            // Web content never writes downloads directly; the main UI confirms a bounded import.
            false
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_content_never_gets_privileged_ipc() {
        let local = tauri::Url::parse("tauri://localhost/index.html").unwrap();
        assert!(trusted_ipc_source("main", &local));
        assert!(!trusted_ipc_source("artwork-browser", &local));
        assert!(!trusted_ipc_source(
            "main",
            &tauri::Url::parse("https://example.com/").unwrap()
        ));
        assert!(!trusted_ipc_source(
            "main",
            &tauri::Url::parse("http://tauri.localhost.evil.test/").unwrap()
        ));
    }
}
