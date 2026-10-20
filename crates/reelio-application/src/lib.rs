pub mod dependencies;
pub use reelio_artwork as artwork;
pub use reelio_resources as resources;

use reelio_domain::*;
use reelio_ffmpeg::{Ffmpeg, MediaBackend};
use reelio_storage::{Job, Storage};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

pub struct Application {
    pub backend: Ffmpeg,
    pub dependencies: dependencies::DependencyService,
    pub resources: resources::ResourceService,
    pub storage: Mutex<Storage>,
    authorized: Mutex<HashSet<PathBuf>>,
    active: Mutex<Option<(String, Arc<AtomicBool>)>>,
}
fn lock<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    m.lock()
        .map_err(|_| "Application state lock failed. Restart Reelio.".into())
}
impl Application {
    pub fn new(database: &Path) -> Result<Self, String> {
        let storage = Storage::open(database)?;
        let mut backend = Ffmpeg::default();
        if let Some(v) = storage.setting("backend")? {
            if let Some(s) = v["ffmpeg"].as_str() {
                backend.ffmpeg = s.into();
            }
            if let Some(s) = v["ffprobe"].as_str() {
                backend.ffprobe = s.into();
            }
        }
        Ok(Self {
            backend,
            dependencies: dependencies::DependencyService::default(),
            resources: resources::ResourceService::new(
                database
                    .parent()
                    .unwrap_or(Path::new("."))
                    .join("downloads"),
            ),
            storage: Mutex::new(storage),
            authorized: Mutex::new(HashSet::new()),
            active: Mutex::new(None),
        })
    }
    pub fn authorize(&self, path: &Path) -> Result<PathBuf, String> {
        let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
        lock(&self.authorized)?.insert(path.clone());
        Ok(path)
    }
    pub fn require_authorized(&self, path: &Path) -> Result<PathBuf, String> {
        let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
        if !lock(&self.authorized)?.contains(&path) {
            return Err(
                "Select the source using Open Media or drop it onto the window before accessing it"
                    .into(),
            );
        }
        Ok(path)
    }
    pub fn import(&self, path: &Path) -> Result<Asset, String> {
        let path = self.require_authorized(path)?;
        let asset = self.backend.probe(&path)?;
        lock(&self.storage)?.recent(&path.to_string_lossy(), "media")?;
        Ok(asset)
    }
    pub fn validate_sources(&self, p: &Project) -> Result<(), String> {
        let errors = p.validate();
        if !errors.is_empty() {
            return Err(errors.join("; "));
        }
        if let Some(artwork) = &p.artwork {
            reelio_artwork::jpeg_bytes(artwork)?;
        }
        for asset in &p.assets {
            let path = self.require_authorized(&asset.path)?;
            let actual = self.backend.probe(&path)?;
            if (actual.size, actual.modified_ms) != (asset.size, asset.modified_ms) {
                return Err("A source changed since import. Re-import the source.".into());
            }
            if actual.streams.len() != asset.streams.len()
                || actual.streams.iter().zip(&asset.streams).any(|(a, b)| {
                    a.index != b.index
                        || a.codec != b.codec
                        || a.kind != b.kind
                        || a.properties != b.properties
                })
            {
                return Err(
                    "Source stream model does not match FFprobe. Re-import the source.".into(),
                );
            }
        }
        Ok(())
    }
    pub fn open_project_with_sources(&self, path: &Path) -> Result<Project, String> {
        let project = self.open_project(path)?;
        for asset in &project.assets {
            if asset.path.is_file() {
                self.authorize(&asset.path)?;
            }
        }
        Ok(project)
    }
    pub fn open_project(&self, path: &Path) -> Result<Project, String> {
        if fs::metadata(path).map_err(|e| e.to_string())?.len() > 4 * 1024 * 1024 {
            return Err("Project exceeds 4 MiB limit".into());
        }
        let mut bytes = vec![];
        fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let mut p: Project =
            serde_json::from_slice(&bytes).map_err(|e| format!("Invalid project: {e}"))?;
        p.upgrade_legacy()?;
        let parent = path.parent().unwrap_or(Path::new("."));
        for a in &mut p.assets {
            if a.path.is_relative() {
                a.path = parent.join(&a.path);
            }
        }
        let errors = p.validate();
        if !errors.is_empty() {
            return Err(errors.join("; "));
        }
        if let Some(artwork) = &p.artwork {
            reelio_artwork::jpeg_bytes(artwork)?;
        }
        Ok(p)
    }
    pub fn save_project(&self, p: &Project, path: &Path) -> Result<(), String> {
        if path.extension().and_then(|s| s.to_str()) != Some("reelio") {
            return Err("Project must end in .reelio".into());
        }
        let errors = p.validate();
        if !errors.is_empty() {
            return Err(errors.join("; "));
        }
        if let Some(artwork) = &p.artwork {
            reelio_artwork::jpeg_bytes(artwork)?;
        }
        let parent = fs::canonicalize(
            path.parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )
        .map_err(|e| e.to_string())?;
        let target = parent.join(path.file_name().ok_or("Invalid project path")?);
        for a in &p.assets {
            if fs::canonicalize(&a.path).ok().as_ref() == Some(&target) {
                return Err("Project cannot replace source media".into());
            }
        }
        let mut p = p.clone();
        for a in &mut p.assets {
            if let Ok(relative) = a.path.strip_prefix(&parent) {
                a.path = relative.into();
            }
        }
        let bytes = serde_json::to_vec_pretty(&p).map_err(|e| e.to_string())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("Project exceeds 4 MiB limit".into());
        }
        let mut temp = tempfile::NamedTempFile::new_in(&parent).map_err(|e| e.to_string())?;
        temp.write_all(&bytes).map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(&target).map_err(|e| e.to_string())?;
        lock(&self.storage)?.recent(&target.to_string_lossy(), "project")?;
        Ok(())
    }
    pub fn reserve_job(
        &self,
        p: &Project,
        destination: &Path,
    ) -> Result<(String, Arc<AtomicBool>), String> {
        let mut active = lock(&self.active)?;
        if active.is_some() {
            return Err(
                "An export is already running. Reelio currently runs one job at a time.".into(),
            );
        }
        let id = id();
        let cancel = Arc::new(AtomicBool::new(false));
        lock(&self.storage)?.insert_job(
            &id,
            &destination.to_string_lossy(),
            &serde_json::to_value(p).map_err(|e| e.to_string())?,
        )?;
        *active = Some((id.clone(), cancel.clone()));
        Ok((id, cancel))
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let active = lock(&self.active)?;
        if let Some((current, flag)) = active.as_ref() {
            if current == id {
                flag.store(true, Ordering::SeqCst);
                return Ok(());
            }
        }
        Err("Job is no longer running".into())
    }
    pub fn finish(&self, id: &str) -> Result<(), String> {
        let mut active = lock(&self.active)?;
        if active.as_ref().is_some_and(|(current, _)| current == id) {
            *active = None;
        }
        Ok(())
    }
    pub fn jobs(&self) -> Result<Vec<Job>, String> {
        lock(&self.storage)?.jobs()
    }
    pub fn update_job(
        &self,
        id: &str,
        status: &str,
        progress: Option<&serde_json::Value>,
        error: Option<&str>,
    ) -> Result<(), String> {
        lock(&self.storage)?.update_job(id, status, progress, error)
    }
    pub fn active_job(&self) -> bool {
        self.active.lock().map(|a| a.is_some()).unwrap_or(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires public Bing access"]
    fn live_poster_proportions_and_pagination() {
        use resources::PosterProportion;
        let first =
            resources::poster_search_page("The Matrix 1999", PosterProportion::Any, 0).unwrap();
        assert!(!first.results.is_empty());
        assert!(first.next_offset > 0);
        let next = resources::poster_search_page(
            "The Matrix 1999",
            PosterProportion::Any,
            first.next_offset,
        )
        .unwrap();
        assert!(
            next.results
                .iter()
                .any(|p| !first.results.iter().any(|old| old.image_url == p.image_url)),
            "Provider repeated the entire previous page"
        );
        let wide =
            resources::poster_search_page("The Matrix 1999", PosterProportion::SixteenNine, 0)
                .unwrap();
        assert!(!wide.results.is_empty());
        assert!(wide.results.iter().all(|p| p
            .width
            .zip(p.height)
            .is_some_and(|(w, h)| PosterProportion::SixteenNine.matches(w, h))));
    }
    #[test]
    #[ignore = "requires public Bing/image host access"]
    fn live_internal_poster_search_and_selection() {
        let posters = resources::poster_search("The Matrix 1999").unwrap();
        assert!(!posters.is_empty());
        let thumbnail = resources::poster_image(&posters[0].thumbnail_url).unwrap();
        assert!(artwork::prepare(&thumbnail, "Search thumbnail").is_ok());
        let mut selected = false;
        for poster in posters.iter().take(6) {
            if let Ok(bytes) = resources::poster_image(&poster.image_url) {
                if let Ok(cover) = artwork::prepare(&bytes, &poster.source_host) {
                    assert!(!artwork::jpeg_bytes(&cover).unwrap().is_empty());
                    selected = true;
                    break;
                }
            }
        }
        assert!(
            selected,
            "None of the first six public poster images could be imported"
        );
    }
    #[test]
    #[ignore = "requires public Wikimedia HTTPS access"]
    fn live_public_artwork_download_is_validated() {
        let d = tempfile::tempdir().unwrap();
        let service = resources::ResourceService::new(d.path().join("downloads"));
        let pending = service
            .remember(
                "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg"
                    .parse()
                    .unwrap(),
                resources::SearchKind::Artwork,
                String::new(),
            )
            .unwrap();
        let download = service.download(&pending.id).unwrap();
        let cover = artwork::prepare(&download.bytes, &download.source_label).unwrap();
        assert!(!artwork::jpeg_bytes(&cover).unwrap().is_empty());
        assert!(service.download(&pending.id).is_err());
    }
    #[test]
    fn unselected_sources_are_denied() {
        let d = tempfile::tempdir().unwrap();
        let a = Application::new(&d.path().join("db")).unwrap();
        let source = d.path().join("sample");
        fs::write(&source, "x").unwrap();
        assert!(a.require_authorized(&source).is_err());
        a.authorize(&source).unwrap();
        assert!(a.require_authorized(&source).is_ok());
    }
    #[test]
    fn explicitly_opened_projects_grant_only_existing_referenced_files() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let app = Application::new(&root.join("db")).unwrap();
        let source = root.join("source.mkv");
        let neighbor = root.join("private.mkv");
        let missing = root.join("missing.srt");
        fs::write(&source, "fixture").unwrap();
        fs::write(&neighbor, "not selected").unwrap();
        let mut project = Project::default();
        for path in [&source, &missing] {
            project.assets.push(Asset {
                id: id(),
                path: path.clone(),
                format: "matroska".into(),
                size: 7,
                modified_ms: 0,
                duration_ms: None,
                streams: vec![],
                metadata: Default::default(),
                chapters: vec![],
            });
        }
        let path = root.join("selected.reelio");
        app.save_project(&project, &path).unwrap();
        let opened = app.open_project_with_sources(&path).unwrap();
        assert_eq!(opened.assets.len(), 2);
        assert!(app.require_authorized(&source).is_ok());
        assert!(app.require_authorized(&neighbor).is_err());
        assert!(app.require_authorized(&root).is_err());
        assert!(app.require_authorized(&missing).is_err());
    }
    #[test]
    fn empty_project_can_be_saved_and_reopened() {
        let directory = tempfile::tempdir().unwrap();
        let application = Application::new(&directory.path().join("db")).unwrap();
        let project = Project::default();
        let path = directory.path().join("new.reelio");
        application.save_project(&project, &path).unwrap();
        let reopened = application.open_project(&path).unwrap();
        assert_eq!(reopened.id, project.id);
        assert_eq!(reopened.name, project.name);
        assert!(reopened.assets.is_empty());
        assert!(reopened.tracks.is_empty());
    }
    #[test]
    fn legacy_project_is_upgraded_in_memory_without_rewriting_the_original() {
        let directory = tempfile::tempdir().unwrap();
        let application = Application::new(&directory.path().join("db")).unwrap();
        for version in [1, 2] {
            let mut value = serde_json::to_value(Project::default()).unwrap();
            value["schema_version"] = serde_json::json!(version);
            let bytes = serde_json::to_vec(&value).unwrap();
            let path = directory.path().join(format!("legacy-{version}.reelio"));
            fs::write(&path, &bytes).unwrap();
            let project = application.open_project(&path).unwrap();
            assert_eq!(project.schema_version, 3);
            assert_eq!(fs::read(&path).unwrap(), bytes);
            let new_path = directory.path().join(format!("upgraded-{version}.reelio"));
            application.save_project(&project, &new_path).unwrap();
            let upgraded: serde_json::Value =
                serde_json::from_slice(&fs::read(new_path).unwrap()).unwrap();
            assert_eq!(upgraded["schema_version"], 3);
        }
    }
    #[test]
    fn project_roundtrip_relative_paths() {
        let d = tempfile::tempdir().unwrap();
        let a = Application::new(&d.path().join("db")).unwrap();
        let mut p = Project::default();
        let source = d.path().join("source.mkv");
        fs::write(&source, "fixture").unwrap();
        p.assets.push(Asset {
            id: id(),
            path: source.clone(),
            format: "matroska".into(),
            size: 7,
            modified_ms: 0,
            duration_ms: None,
            streams: vec![],
            metadata: Default::default(),
            chapters: vec![],
        });
        let path = d.path().join("x.reelio");
        a.save_project(&p, &path).unwrap();
        let raw: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(raw["assets"][0]["path"], "source.mkv");
        let reopened = a.open_project(&path).unwrap();
        assert_eq!(reopened.id, p.id);
        assert_eq!(reopened.assets[0].path, source);
    }
    #[test]
    fn only_one_job_and_cancel_is_scoped() {
        let d = tempfile::tempdir().unwrap();
        let a = Application::new(&d.path().join("db")).unwrap();
        let (id, flag) = a
            .reserve_job(&Project::default(), Path::new("out.mkv"))
            .unwrap();
        assert!(a
            .reserve_job(&Project::default(), Path::new("out2.mkv"))
            .is_err());
        assert!(a.cancel("wrong").is_err());
        a.cancel(&id).unwrap();
        assert!(flag.load(Ordering::SeqCst));
        a.finish(&id).unwrap();
        assert!(!a.active_job());
    }
}
