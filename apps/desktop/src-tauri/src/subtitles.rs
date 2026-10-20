use super::{blocking, grant, AppState};
use reelio_subtitles::{
    local_model::{JobInfo, Service},
    Document,
};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
};
use tauri::State;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
#[tauri::command]
pub async fn subtitle_editor_open(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: Option<PathBuf>,
) -> Result<Option<Value>, String> {
    let state = state.inner().clone();
    blocking(move || {
        let path = if let Some(path) = path {
            state.require_authorized(&path)?
        } else {
            let Some(file) = app
                .dialog()
                .file()
                .set_title("Open SRT for editing (original stays unchanged)")
                .set_directory(super::preferences::default_folder(&app, &state)?)
                .add_filter("SubRip subtitles", &["srt"])
                .blocking_pick_file()
            else {
                return Ok(None);
            };
            grant(&app, &state, &file.into_path().map_err(|e| e.to_string())?)?
        };
        if path
            .extension()
            .and_then(|e| e.to_str())
            .is_none_or(|e| !e.eq_ignore_ascii_case("srt"))
        {
            return Err(
                "The subtitle editor opens .srt files; export embedded subtitles to SRT first"
                    .into(),
            );
        }
        let document = Document::read(&path)?;
        Ok(Some(json!({"document":document,"path":path})))
    })
    .await
}
#[tauri::command]
pub async fn subtitle_editor_save(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    document: Document,
) -> Result<Option<String>, String> {
    let state = state.inner().clone();
    blocking(move || {
        document.validate(true)?;
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Save a new SRT copy; existing files are protected")
            .set_directory(super::preferences::default_folder(&app, &state)?)
            .set_file_name("subtitles-edited.srt")
            .add_filter("SubRip subtitles", &["srt"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        document.save_copy(&path)?;
        let path = grant(&app, &state, &path)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}
#[tauri::command]
pub fn subtitle_editor_dirty(service: State<'_, Arc<Service>>, dirty: bool) {
    if dirty {
        service.dirty.store(true, Ordering::SeqCst);
    }
}
#[tauri::command]
pub async fn subtitle_editor_draft(
    service: State<'_, Arc<Service>>,
    document: Option<Document>,
    clear: bool,
) -> Result<Option<Document>, String> {
    let service = service.inner().clone();
    blocking(move || {
        if clear {
            service.clear_draft()?;
            Ok(None)
        } else if let Some(doc) = document {
            service.save_draft(&doc)?;
            Ok(None)
        } else {
            service.draft()
        }
    })
    .await
}
#[tauri::command]
pub async fn subtitle_models(service: State<'_, Arc<Service>>) -> Result<Value, String> {
    let service = service.inner().clone();
    blocking(move || service.models()).await
}
#[tauri::command]
pub async fn subtitle_model_start(
    app: tauri::AppHandle,
    service: State<'_, Arc<Service>>,
    model: String,
    document: Option<Document>,
    language: String,
) -> Result<JobInfo, String> {
    let service = service.inner().clone();
    blocking(move||{let message=if document.is_some(){"Translation sends cue IDs and text only to the configured loopback Ollama service, never video files or cue timings. Local inference uses additional RAM. Starting a new operation replaces the previous model-result record; save/apply any results you want to keep first. Use a trusted service configured for local inference, not a cloud proxy. Translation quality is not guaranteed; review before applying. Start translation?"}else{"Download this local model plugin through Ollama? Model weights can require several gigabytes of disk space and internet access. The selected model may be installed or refreshed; other model tags and service settings are not changed by Reelio. Follow the model publisher's license terms. Cancellation stops Reelio's request, but Ollama may retain/finish cached downloads. Ollama must already be installed and running locally."};if !app.dialog().message(format!("{model}\n\n{message}")).title("Local subtitle model").buttons(MessageDialogButtons::YesNo).blocking_show(){return Err("Local model operation was not approved".into());}service.start(model,document,language)}).await
}
#[tauri::command]
pub fn subtitle_model_status(service: State<'_, Arc<Service>>) -> Result<JobInfo, String> {
    service.status()
}
#[tauri::command]
pub fn subtitle_model_cancel(service: State<'_, Arc<Service>>) {
    service.cancel();
}
#[tauri::command]
pub async fn subtitle_model_results(
    service: State<'_, Arc<Service>>,
    id: String,
) -> Result<Value, String> {
    let service = service.inner().clone();
    blocking(move || service.results(&id)).await
}
