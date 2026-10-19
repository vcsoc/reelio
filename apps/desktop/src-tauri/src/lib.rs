mod preview;
mod resources;
mod updates;

#[tauri::command]
fn app_version() -> &'static str {
    env!("REELIO_BUILD_VERSION")
}

#[tauri::command]
async fn open_project_homepage() -> Result<(), String> {
    blocking(|| {
        const URL: &str = "https://github.com/vcsoc/reelio";
        #[cfg(target_os = "linux")]
        let mut command = std::process::Command::new("/usr/bin/xdg-open");
        #[cfg(target_os = "macos")]
        let mut command = std::process::Command::new("/usr/bin/open");
        #[cfg(target_os = "windows")]
        let mut command = {
            let root = std::env::var_os("SystemRoot")
                .map(std::path::PathBuf::from)
                .filter(|path| path.is_absolute() && !path.to_string_lossy().starts_with("\\\\"))
                .ok_or("Cannot locate the Windows browser launcher")?;
            let mut command = std::process::Command::new(root.join("System32/rundll32.exe"));
            command.arg("url.dll,FileProtocolHandler");
            command
        };
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        return Err("Opening a browser is unsupported on this platform".into());
        #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
        {
            let status = command
                .arg(URL)
                .status()
                .map_err(|error| format!("Could not open GitHub: {error}"))?;
            if status.success() {
                Ok(())
            } else {
                Err("The system browser could not open GitHub".into())
            }
        }
    })
    .await
}
use reelio_application::Application;
use reelio_domain::{Asset, ExportPlan, Project};
use reelio_ffmpeg::MediaBackend;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
type AppState = Arc<Application>;
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}
fn grant(app: &tauri::AppHandle, a: &Application, path: &Path) -> Result<PathBuf, String> {
    let p = a.authorize(path)?;
    app.asset_protocol_scope()
        .allow_file(&p)
        .map_err(|e| e.to_string())?;
    Ok(p)
}
#[tauri::command]
async fn preview_source(
    state: State<'_, AppState>,
    service: State<'_, Arc<preview::PreviewService>>,
    path: PathBuf,
) -> Result<String, String> {
    let path = state.require_authorized(&path)?;
    let service = service.inner().clone();
    let backend = state.backend.clone();
    blocking(move || service.register_for_playback(&backend, &path)).await
}
#[tauri::command]
async fn backend_status(state: State<'_, AppState>) -> Result<Value, String> {
    let s = state.inner().clone();
    blocking(move || serde_json::to_value(s.backend.capabilities()?).map_err(|e| e.to_string()))
        .await
}
#[tauri::command]
async fn dependencies_status(
    state: State<'_, AppState>,
) -> Result<reelio_application::dependencies::DependencyReport, String> {
    let s = state.inner().clone();
    blocking(move || {
        let report = s.dependencies.status(&s.backend);
        tracing::info!(
            preview_available = report.preview_available,
            backend_available = report.backend_available,
            network_available = report.network_available,
            missing_count = report.missing_components.len(),
            "Runtime component check completed"
        );
        Ok(report)
    })
    .await
}
#[tauri::command]
async fn dependencies_repair(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<reelio_application::dependencies::DependencyReport, String> {
    let s = state.inner().clone();
    blocking(move|| {
        s.dependencies.install(|plan| app.dialog()
            .message(format!("Reelio needs these system components:\n\n{}\n\nInstall or repair them using {}? System authentication may be required. Do not close Reelio while the package manager is running. Source media will not be changed.",plan.packages.join(", "),plan.executable))
            .title("Install required Reelio components")
            .kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::YesNo).blocking_show())?;
        Ok(s.dependencies.status(&s.backend))
    }).await
}
#[tauri::command]
async fn choose_media(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    folder: bool,
) -> Result<Vec<String>, String> {
    let s = state.inner().clone();
    blocking(move || {
        let files = if folder {
            app.dialog().file().blocking_pick_folder().map(|f| vec![f])
        } else {
            app.dialog()
                .file()
                .set_title("Open media or add tracks")
                .blocking_pick_files()
        };
        let mut paths = vec![];
        for f in files.unwrap_or_default() {
            let p = f.into_path().map_err(|e| e.to_string())?;
            if folder {
                // Deliberately non-recursive; directory imports have a hard entry limit.
                for entry in std::fs::read_dir(p).map_err(|e| e.to_string())?.take(256) {
                    let p = entry.map_err(|e| e.to_string())?.path();
                    if p.is_file() {
                        paths.push(grant(&app, &s, &p)?.to_string_lossy().into_owned());
                    }
                }
            } else {
                paths.push(grant(&app, &s, &p)?.to_string_lossy().into_owned());
            }
        }
        Ok(paths)
    })
    .await
}
#[tauri::command]
async fn media_probe(state: State<'_, AppState>, path: String) -> Result<Asset, String> {
    let s = state.inner().clone();
    blocking(move || s.import(Path::new(&path))).await
}
fn interface_zoom_factor(percent: u16) -> Result<f64, String> {
    if !(50..=200).contains(&percent) {
        return Err("Interface zoom must be between 50% and 200%".into());
    }
    Ok(f64::from(percent) / 100.0)
}
#[tauri::command]
fn interface_zoom(window: tauri::WebviewWindow, percent: u16) -> Result<(), String> {
    window
        .set_zoom(interface_zoom_factor(percent)?)
        .map_err(|e| e.to_string())?;
    tracing::info!(percent, "Interface zoom applied");
    Ok(())
}
#[tauri::command]
fn project_create() -> Project {
    Project::default()
}
#[tauri::command]
fn project_validate(project: Project) -> ExportPlan {
    reelio_domain::plan(&project)
}
#[tauri::command]
async fn project_open(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Project>, String> {
    let s = state.inner().clone();
    blocking(move||{
        let Some(f)=app.dialog().file().add_filter("Reelio project",&["reelio"]).blocking_pick_file() else{return Ok(None)};
        let path=f.into_path().map_err(|e|e.to_string())?;let p=s.open_project(&path)?;
        let description=p.assets.iter().map(|a|a.path.to_string_lossy().into_owned()).collect::<Vec<_>>().join("\n");
        if !p.assets.is_empty() && !app.dialog().message(format!("This project references these local sources:\n\n{description}\n\nAllow Reelio to inspect these files? Missing sources can be relinked in Media information.")).title("Authorize project sources").kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::YesNo).blocking_show(){return Err("Project source access was not authorized".into());}
        for a in &p.assets{if a.path.is_file(){grant(&app,&s,&a.path)?;}}
        s.storage.lock().map_err(|_|"Storage lock failed")?.recent(&path.to_string_lossy(),"project")?;Ok(Some(p))
    }).await
}
#[tauri::command]
async fn project_save(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project: Project,
) -> Result<Option<String>, String> {
    let s = state.inner().clone();
    blocking(move || {
        let Some(f) = app
            .dialog()
            .file()
            .set_file_name("Untitled.reelio")
            .add_filter("Reelio project", &["reelio"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let p = f.into_path().map_err(|e| e.to_string())?;
        s.save_project(&project, &p)?;
        Ok(Some(p.to_string_lossy().into_owned()))
    })
    .await
}
#[tauri::command]
async fn export_plan(state: State<'_, AppState>, project: Project) -> Result<ExportPlan, String> {
    let s = state.inner().clone();
    blocking(move || {
        s.validate_sources(&project)?;
        Ok(reelio_domain::plan(&project))
    })
    .await
}
#[tauri::command]
async fn export_start(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project: Project,
    approve_conversion: bool,
) -> Result<Option<String>, String> {
    let s = state.inner().clone();
    blocking(move || {
        s.validate_sources(&project)?;
        let plan = reelio_domain::plan(&project);
        if !plan.errors.is_empty() {
            return Err(plan.errors.join("; "));
        }
        if plan
            .tracks
            .iter()
            .any(|t| t.compatibility.target_codec.is_some())
            && !approve_conversion
        {
            return Err("Approve subtitle conversion before exporting".into());
        }
        let filename = format!(
            "{}.{}",
            project
                .name
                .chars()
                .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                })
                .collect::<String>(),
            project.container.extension()
        );
        let Some(f) = app
            .dialog()
            .file()
            .set_title("Export to a NEW file (never overwrites)")
            .set_file_name(filename)
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let destination = f.into_path().map_err(|e| e.to_string())?;
        if destination.exists() {
            return Err("Destination exists. Choose a new filename.".into());
        }
        let (id, cancel) = s.reserve_job(&project, &destination)?;
        let job_id = id.clone();
        let worker = s.clone();
        std::thread::spawn(move || {
            let mut completed_progress = None;
            let result = (|| {
                worker.update_job(&job_id, "processing", None, None)?;
                worker.backend.export(
                    &project,
                    &destination,
                    approve_conversion,
                    &cancel,
                    |progress| {
                        let phase = progress.phase.clone();
                        let complete = progress.percent == Some(100.0);
                        let mut value = json!(progress);
                        if complete {
                            // Commit the final crop report atomically with the completed status.
                            value["phase"] = json!("completed");
                            completed_progress = Some(value);
                            return;
                        }
                        if let Err(error) = worker.update_job(&job_id, &phase, Some(&value), None) {
                            tracing::error!(%error,"Could not persist export progress");
                        }
                        let _ = app.emit("export:updated", json!({"id":job_id}));
                    },
                )
            })();
            let (status, error) = match result {
                Ok(_) => ("completed", None),
                Err(e) => {
                    if cancel.load(Ordering::SeqCst) {
                        ("cancelled", Some(e))
                    } else {
                        ("failed", Some(e))
                    }
                }
            };
            if let Err(e) = worker.update_job(
                &job_id,
                status,
                if status == "completed" {
                    completed_progress.as_ref()
                } else {
                    None
                },
                error.as_deref(),
            ) {
                tracing::error!(error=%e,"Could not persist export result");
            }
            let _ = worker.finish(&job_id);
            let _ = app.emit("export:updated", json!({"id":job_id}));
        });
        Ok(Some(id))
    })
    .await
}
#[tauri::command]
fn export_cancel(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.cancel(&id)
}
#[tauri::command]
fn jobs_list(state: State<'_, AppState>) -> Result<Value, String> {
    serde_json::to_value(state.jobs()?).map_err(|e| e.to_string())
}
#[tauri::command]
async fn job_project(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Project, String> {
    let s = state.inner().clone();
    blocking(move||{
        let value=s.storage.lock().map_err(|_|"Storage lock failed")?.job_project(&id)?;
        let mut project:Project=serde_json::from_value(value).map_err(|e|e.to_string())?;
        project.upgrade_legacy()?;
        let errors=project.validate();if !errors.is_empty(){return Err(errors.join("; "));}
        if let Some(artwork)=&project.artwork {reelio_application::artwork::jpeg_bytes(artwork)?;}
        let paths=project.assets.iter().map(|a|a.path.to_string_lossy().into_owned()).collect::<Vec<_>>().join("\n");
        if !project.assets.is_empty()&&!app.dialog().message(format!("Restore this job and authorize access to these sources?\n\n{paths}\n\nMissing sources can be relinked. Export still requires a new destination.")).title("Restore job settings").buttons(MessageDialogButtons::YesNo).blocking_show(){return Err("Job source access was not authorized".into());}
        for asset in &project.assets {if asset.path.is_file(){grant(&app,&s,&asset.path)?;}}
        Ok(project)
    }).await
}
#[tauri::command]
fn settings_get(state: State<'_, AppState>) -> Result<Value, String> {
    let db = state.storage.lock().map_err(|_| "Storage lock failed")?;
    Ok(
        json!({"theme":db.setting("theme")?.unwrap_or(json!("dark")),"recents":db.recents()?,"backend":db.setting("backend")?}),
    )
}
#[tauri::command]
fn settings_update(state: State<'_, AppState>, key: String, value: Value) -> Result<(), String> {
    match key.as_str() {
        "theme" => {
            if !["light", "dark", "system"].contains(&value.as_str().unwrap_or("")) {
                return Err("Invalid theme".into());
            }
        }
        "backend" => {
            for k in ["ffmpeg", "ffprobe"] {
                let p = value[k].as_str().ok_or("Missing backend path")?;
                if !Path::new(p).is_absolute() || !Path::new(p).is_file() {
                    return Err("Backend executables must be existing absolute paths".into());
                }
            }
        }
        _ => return Err("Unknown setting".into()),
    }
    state
        .storage
        .lock()
        .map_err(|_| "Storage lock failed")?
        .set_setting(&key, &value)
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum WindowAction {
    State,
    Drag,
    Minimize,
    ToggleMaximize,
    Close,
}
#[tauri::command]
fn window_action(window: tauri::WebviewWindow, action: WindowAction) -> Result<bool, String> {
    let result = match action {
        WindowAction::State => return window.is_maximized().map_err(|error| error.to_string()),
        WindowAction::Drag => window.start_dragging(),
        WindowAction::Minimize => window.minimize(),
        WindowAction::ToggleMaximize => {
            if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        // close() retains the authoritative active-export/component-repair close guards.
        WindowAction::Close => {
            return window
                .close()
                .map(|()| false)
                .map_err(|error| error.to_string())
        }
    };
    result.map_err(|error| error.to_string())?;
    window.is_maximized().map_err(|error| error.to_string())
}
pub fn run() {
    tracing_subscriber::fmt().with_target(false).init();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let state = Arc::new(
                Application::new(&dir.join("reelio.sqlite3")).map_err(std::io::Error::other)?,
            );
            app.manage(state);
            app.manage(Arc::new(preview::PreviewService::default()));
            app.manage(Arc::new(reelio_updates::UpdateService::default()));
            Ok(())
        })
        .invoke_handler(move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
            let trusted = invoke.message.webview().url().is_ok_and(|url| {
                resources::trusted_ipc_source(invoke.message.webview().label(), &url)
            });
            if !trusted {
                invoke
                    .resolver
                    .reject("Privileged Reelio commands are restricted to the local main window");
                return true;
            }
            let commands: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                backend_status,
                dependencies_status,
                dependencies_repair,
                choose_media,
                media_probe,
                project_create,
                interface_zoom,
                app_version,
                window_action,
                open_project_homepage,
                updates::update_check,
                updates::update_download,
                updates::update_cancel,
                project_validate,
                project_open,
                project_save,
                export_plan,
                export_start,
                export_cancel,
                jobs_list,
                job_project,
                settings_get,
                settings_update,
                resources::choose_artwork,
                resources::artwork_import,
                resources::artwork_edit,
                resources::poster_search,
                resources::poster_image,
                resources::choose_subtitles,
                resources::subtitle_preview,
                preview_source,
                resources::resource_queue,
                resources::resource_cancel,
                resources::resource_download,
                resources::search_browser_open
            ];
            commands(invoke)
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position }) => {
                    let app = window.app_handle();
                    let s = app.state::<AppState>();
                    let mut granted = vec![];
                    for path in paths.iter().take(256) {
                        if path.is_file() {
                            if let Ok(p) = grant(app, &s, path) {
                                granted.push(p.to_string_lossy().into_owned());
                            }
                        }
                    }
                    let size = window.inner_size().ok();
                    let _ = window.emit("media:dropped", json!({ "paths": granted, "position": { "x": position.x, "y": position.y }, "viewport": size.map(|size| json!({"width": size.width, "height": size.height})) }));
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let s = window.state::<AppState>();
                    let updates=window.state::<Arc<reelio_updates::UpdateService>>();
                    if s.active_job() || s.dependencies.is_repairing() || updates.downloading() {
                        api.prevent_close();
                        let _ = window.emit("app:close-blocked", ());
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("Reelio failed to start; the application database has not been reset");
}

#[cfg(test)]
mod interface_zoom_tests {
    use super::interface_zoom_factor;
    #[test]
    fn window_actions_and_main_chrome_are_bounded() {
        for action in ["state", "drag", "minimize", "toggle_maximize", "close"] {
            assert!(
                serde_json::from_value::<super::WindowAction>(serde_json::json!(action)).is_ok()
            );
        }
        for action in ["destroy", "execute", "set_url", ""] {
            assert!(
                serde_json::from_value::<super::WindowAction>(serde_json::json!(action)).is_err()
            );
        }
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["app"]["windows"][0]["decorations"], false);
    }
    #[test]
    fn reports_the_compiled_package_revision() {
        let version = super::app_version();
        let (base, revision) = version.rsplit_once('-').unwrap();
        assert_eq!(base, env!("CARGO_PKG_VERSION"));
        assert!(!revision.is_empty() && revision.bytes().all(|byte| byte.is_ascii_digit()));
    }
    #[test]
    fn accepts_bounded_interface_scales() {
        assert_eq!(interface_zoom_factor(50).unwrap(), 0.5);
        assert_eq!(interface_zoom_factor(100).unwrap(), 1.0);
        assert_eq!(interface_zoom_factor(200).unwrap(), 2.0);
    }
    #[test]
    fn rejects_out_of_range_interface_scales() {
        for percent in [0, 49, 201, u16::MAX] {
            assert!(interface_zoom_factor(percent).is_err());
        }
    }
}
