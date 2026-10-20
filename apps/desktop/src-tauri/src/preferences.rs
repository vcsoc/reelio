use super::{blocking, AppState};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

pub fn validate_folder(value: &Value) -> Result<(), String> {
    if value.is_null() {
        return Ok(());
    }
    let folder = value
        .as_str()
        .ok_or("Default folder must be a folder path")?;
    if !Path::new(folder).is_absolute() || !Path::new(folder).is_dir() {
        return Err("Choose an existing absolute folder path".into());
    }
    Ok(())
}
fn resolve_folder(custom: Option<&str>, videos: &Path) -> Result<PathBuf, String> {
    if let Some(path) = custom
        .map(Path::new)
        .filter(|path| path.is_absolute() && path.is_dir())
    {
        return Ok(path.into());
    }
    if !videos.is_absolute() {
        return Err("The operating system did not provide an absolute Videos folder".into());
    }
    std::fs::create_dir_all(videos).map_err(|e| format!("Could not use the Videos folder: {e}"))?;
    Ok(videos.into())
}
// Seeding a native dialog does not grant access to any folder or its files.
pub fn default_folder(app: &tauri::AppHandle, state: &AppState) -> Result<PathBuf, String> {
    let custom = state
        .storage
        .lock()
        .map_err(|_| "Storage lock failed")?
        .setting("default_folder")?;
    let videos = app
        .path()
        .video_dir()
        .or_else(|_| app.path().home_dir().map(|home| home.join("Videos")))
        .map_err(|e| e.to_string())?;
    resolve_folder(custom.as_ref().and_then(Value::as_str), &videos)
}
#[tauri::command]
pub async fn settings_choose_folder(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let state = state.inner().clone();
    blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Choose Reelio's default folder")
            .set_directory(default_folder(&app, &state)?)
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let value = path
            .to_str()
            .ok_or("Folder path must be valid Unicode")?
            .to_string();
        validate_folder(&Value::String(value.clone()))?;
        Ok(Some(value))
    })
    .await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_to_videos_and_honors_existing_custom_folder() {
        let root = tempfile::tempdir().unwrap();
        let videos = root.path().join("Videos");
        assert_eq!(resolve_folder(None, &videos).unwrap(), videos);
        assert!(videos.is_dir());
        let custom = root.path().join("custom");
        std::fs::create_dir(&custom).unwrap();
        assert_eq!(resolve_folder(custom.to_str(), &videos).unwrap(), custom);
    }
    #[test]
    fn invalid_settings_are_rejected_and_deleted_folder_falls_back() {
        let root = tempfile::tempdir().unwrap();
        let videos = root.path().join("Videos");
        for value in [
            serde_json::json!("relative"),
            serde_json::json!(root.path().join("missing")),
            serde_json::json!(12),
        ] {
            assert!(validate_folder(&value).is_err());
        }
        let file = root.path().join("file");
        std::fs::write(&file, b"preserved").unwrap();
        assert!(validate_folder(&serde_json::json!(file)).is_err());
        assert!(validate_folder(&Value::Null).is_ok());
        assert_eq!(resolve_folder(file.to_str(), &videos).unwrap(), videos);
        assert_eq!(std::fs::read(file).unwrap(), b"preserved");
    }
}
