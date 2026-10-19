use super::{app_version, blocking};
use reelio_updates::{Report, Target, UpdateService};
use std::sync::Arc;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn update_check(service: State<'_, Arc<UpdateService>>) -> Result<Report, String> {
    let service = service.inner().clone();
    blocking(move || service.check(app_version(), Target::current())).await
}
#[tauri::command]
pub async fn update_download(
    app: tauri::AppHandle,
    service: State<'_, Arc<UpdateService>>,
    offer_id: String,
) -> Result<Option<String>, String> {
    let service = service.inner().clone();
    blocking(move || {
        let name = service.filename(&offer_id)?;
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Save verified Reelio update")
            .set_file_name(&name)
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|error| error.to_string())?;
        service.download(&offer_id, &path)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}
#[tauri::command]
pub fn update_cancel(service: State<'_, Arc<UpdateService>>) {
    service.cancel();
}
