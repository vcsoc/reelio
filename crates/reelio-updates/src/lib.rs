use reqwest::{
    blocking::{Client, Response},
    redirect::Policy,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use url::Url;

const API: &str = "https://api.github.com/repos/vcsoc/reelio/releases";
const MAX_PACKAGE: u64 = 512 * 1024 * 1024;
const MAX_METADATA: u64 = 4 * 1024 * 1024;
const MAX_SUMS: u64 = 256 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct Version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub revision: u32,
}
impl Version {
    pub fn parse(text: &str) -> Option<Self> {
        if text.len() > 128 {
            return None;
        }
        let text = text.strip_prefix('v').unwrap_or(text);
        let (text, metadata) = text
            .split_once('+')
            .map_or((text, None), |(v, m)| (v, Some(m)));
        if metadata.is_some_and(|m| {
            m.is_empty()
                || m.split('.').any(|part| {
                    part.is_empty() || !part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
                })
        }) {
            return None;
        }
        let (core, revision) = text.split_once('-').map_or((text, "0"), |(c, r)| (c, r));
        let number = |s: &str| {
            if s.is_empty()
                || (s.len() > 1 && s.starts_with('0'))
                || !s.bytes().all(|b| b.is_ascii_digit())
            {
                None
            } else {
                s.parse::<u32>().ok()
            }
        };
        let parts: Vec<_> = core.split('.').collect();
        if parts.len() != 3 {
            return None;
        }
        Some(Self {
            major: number(parts[0])?,
            minor: number(parts[1])?,
            patch: number(parts[2])?,
            revision: number(revision)?,
        })
    }
    fn core(self) -> String {
        format!("{}.{}.{}", self.major, self.minor, self.patch)
    }
    fn same_core(self, other: Self) -> bool {
        (self.major, self.minor, self.patch) == (other.major, other.minor, other.patch)
    }
    fn display(self) -> String {
        if self.revision == 0 {
            self.core()
        } else {
            format!("{}-{}", self.core(), self.revision)
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub enum Target {
    ArchX64,
    DebianX64,
    AppImageX64,
    WindowsX64,
    MacX64,
    MacArm64,
    Unsupported,
}
impl Target {
    pub fn current() -> Self {
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("linux", "x86_64") => {
                if std::env::var_os("APPIMAGE").is_some_and(|path| !path.is_empty()) {
                    return Self::AppImageX64;
                }
                let text = std::fs::File::open("/etc/os-release")
                    .ok()
                    .and_then(|file| limited(file, 16384).ok())
                    .and_then(|v| String::from_utf8(v).ok())
                    .unwrap_or_default();
                let ids = text
                    .lines()
                    .filter_map(|line| {
                        line.strip_prefix("ID=")
                            .or_else(|| line.strip_prefix("ID_LIKE="))
                    })
                    .flat_map(|value| value.trim_matches(['"', '\'']).split_whitespace())
                    .collect::<Vec<_>>();
                if ids.contains(&"arch") {
                    Self::ArchX64
                } else if ids.iter().any(|id| ["debian", "ubuntu"].contains(id)) {
                    Self::DebianX64
                } else {
                    Self::Unsupported
                }
            }
            ("windows", "x86_64") => Self::WindowsX64,
            ("macos", "x86_64") => Self::MacX64,
            ("macos", "aarch64") => Self::MacArm64,
            _ => Self::Unsupported,
        }
    }
    fn asset_version(self, name: &str, tag: Version) -> Option<Version> {
        let version = match self {
            Self::ArchX64 => {
                let text = name
                    .strip_prefix("reelio-")?
                    .strip_suffix("-x86_64.pkg.tar.zst")?;
                if !text.contains('-') {
                    return None;
                }
                let version = Version::parse(text)?;
                if version.revision == 0 {
                    return None;
                }
                version
            }
            Self::AppImageX64 => {
                if name != format!("Reelio_{}_amd64.AppImage", tag.core()) {
                    return None;
                }
                tag
            }
            Self::DebianX64 => {
                if name != format!("Reelio_{}_amd64.deb", tag.core()) {
                    return None;
                }
                tag
            }
            Self::WindowsX64 => {
                if name != format!("Reelio_{}_x64-setup.exe", tag.core()) {
                    return None;
                }
                tag
            }
            Self::MacX64 => {
                if name != format!("Reelio_{}_x64.dmg", tag.core()) {
                    return None;
                }
                tag
            }
            Self::MacArm64 => {
                if name != format!("Reelio_{}_aarch64.dmg", tag.core()) {
                    return None;
                }
                tag
            }
            Self::Unsupported => return None,
        };
        (version.same_core(tag) && (tag.revision == 0 || version.revision == tag.revision))
            .then_some(version)
    }
}
#[derive(Clone, Debug, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    #[serde(default)]
    digest: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}
#[derive(Clone)]
struct Offer {
    id: String,
    asset: Asset,
    sums: Option<Asset>,
    created: Instant,
}
#[derive(Clone, Debug, Serialize)]
pub struct Report {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub status: String,
    pub message: String,
    pub asset_name: Option<String>,
    pub bytes: Option<u64>,
    pub offer_id: Option<String>,
}
fn select(
    releases: &[Release],
    current: &str,
    target: Target,
) -> Result<(Report, Option<Offer>), String> {
    let installed = Version::parse(current).ok_or("Installed version cannot be compared safely")?;
    let mut candidates = Vec::new();
    for release in releases.iter().filter(|r| !r.draft && !r.prerelease) {
        if release.assets.len() > 128 {
            return Err("Release has too many assets to inspect safely".into());
        }
        let Some(tag) = Version::parse(&release.tag_name) else {
            continue;
        };
        let asset = release
            .assets
            .iter()
            .filter_map(|a| target.asset_version(&a.name, tag).map(|v| (v, a)))
            .max_by_key(|(v, _)| *v);
        let version = asset.map_or(tag, |(version, _)| version);
        candidates.push((version, release, asset.map(|(_, asset)| asset)));
    }
    let mut report = Report {
        current_version: current.into(),
        latest_version: None,
        status: "no_releases".into(),
        message: "No published stable GitHub releases are available yet.".into(),
        asset_name: None,
        bytes: None,
        offer_id: None,
    };
    let Some((version, release, asset)) = candidates
        .into_iter()
        .max_by_key(|(version, _, _)| *version)
    else {
        return Ok((report, None));
    };
    report.latest_version = Some(version.display());
    if version <= installed {
        report.status = "up_to_date".into();
        report.message = "This installation is up to date.".into();
        return Ok((report, None));
    }
    let Some(asset) = asset else {
        report.status = "unsupported".into();
        report.message =
            "A newer release exists, but it has no compatible package for this system.".into();
        return Ok((report, None));
    };
    validate_asset(asset)?;
    let sums = release
        .assets
        .iter()
        .find(|a| a.name == "SHA256SUMS")
        .cloned();
    if let Some(sums) = &sums {
        validate_asset(sums)?;
        if sums.size > MAX_SUMS {
            return Err("Release checksum file is too large".into());
        }
    }
    if asset.digest.is_none() && sums.is_none() {
        report.status = "unverified".into();
        report.message="A newer package exists, but the release has no SHA-256 verification data. Download is blocked.".into();
        return Ok((report, None));
    }
    if let Some(digest) = &asset.digest {
        parse_digest(digest)?;
    }
    let offer = Offer {
        id: uuid::Uuid::new_v4().to_string(),
        asset: asset.clone(),
        sums,
        created: Instant::now(),
    };
    report.status = "available".into();
    report.message="A newer verified-download candidate is available. Installation remains a separate, authorized step.".into();
    report.asset_name = Some(asset.name.clone());
    report.bytes = Some(asset.size);
    report.offer_id = Some(offer.id.clone());
    Ok((report, Some(offer)))
}
fn validate_asset(asset: &Asset) -> Result<(), String> {
    if asset.name.len() > 160
        || !asset
            .name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        || asset.size == 0
        || asset.size > MAX_PACKAGE
    {
        return Err("Release asset has an invalid name or size".into());
    }
    let url = secure_url(&asset.browser_download_url)?;
    if url.host_str() != Some("github.com")
        || !url.path().starts_with("/vcsoc/reelio/releases/download/")
        || !url.path().ends_with(&format!("/{}", asset.name))
        || url.query().is_some()
    {
        return Err("Release asset is not hosted in the Reelio GitHub repository".into());
    }
    Ok(())
}
fn secure_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Invalid update URL")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.port_or_known_default() != Some(443)
        || !matches!(
            url.host_str(),
            Some(
                "github.com"
                    | "api.github.com"
                    | "release-assets.githubusercontent.com"
                    | "objects.githubusercontent.com"
            )
        )
    {
        return Err("Update URL is outside the permitted HTTPS GitHub endpoints".into());
    }
    Ok(url)
}
fn client() -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .user_agent(concat!("Reelio/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.without_url().to_string())
}
fn get(client: &Client, value: &str, metadata: bool) -> Result<Response, String> {
    let mut url = secure_url(value)?;
    let deadline = Instant::now() + Duration::from_secs(if metadata { 15 } else { 180 });
    for _ in 0..6 {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("GitHub request timed out".into());
        }
        let response = client
            .get(url.clone())
            .timeout(remaining)
            .header(
                "Accept",
                if metadata {
                    "application/vnd.github+json"
                } else {
                    "application/octet-stream"
                },
            )
            .header("Cache-Control", "no-cache")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .map_err(|e| format!("GitHub HTTPS request failed: {}", e.without_url()))?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or("GitHub redirect has no valid location")?;
            url = secure_url(
                url.join(location)
                    .map_err(|_| "Invalid GitHub redirect")?
                    .as_str(),
            )?;
            continue;
        }
        if !response.status().is_success() || response.status().as_u16() != 200 {
            return Err(format!("GitHub returned HTTP {}. The check/download did not succeed; retry later (rate limits may apply).",response.status().as_u16()));
        }
        return Ok(response);
    }
    Err("Too many GitHub redirects".into())
}
fn limited(mut reader: impl Read, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("GitHub response exceeds its size limit".into());
    }
    Ok(bytes)
}
fn parse_digest(value: &str) -> Result<String, String> {
    let value = value
        .strip_prefix("sha256:")
        .ok_or("Unsupported release digest algorithm")?;
    if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid release SHA-256 digest".into());
    }
    Ok(value.to_ascii_lowercase())
}
fn checksum(bytes: &[u8], filename: &str) -> Result<String, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Checksum file is not UTF-8")?;
    let mut found = None;
    for line in text.lines() {
        if line.len() < 66 {
            continue;
        }
        let hash = line.get(..64).ok_or("Malformed checksum entry")?;
        let name = line.get(64..).ok_or("Malformed checksum entry")?;
        if !name.starts_with([' ', '\t']) {
            continue;
        }
        let name = name.trim_start_matches([' ', '\t', '*']);
        if name != filename {
            continue;
        }
        let hash = parse_digest(&format!("sha256:{hash}"))?;
        if found.replace(hash).is_some() {
            return Err("Ambiguous duplicate checksum entry".into());
        }
    }
    found.ok_or("Release checksum does not include the selected package".into())
}
fn publish_verified(
    mut reader: impl Read,
    size: u64,
    hash: &str,
    destination: &Path,
    cancel: &AtomicBool,
) -> Result<(), String> {
    if size == 0 || size > MAX_PACKAGE {
        return Err("Update package exceeds the download limit".into());
    }
    if destination.exists() {
        return Err("Destination exists. Choose a new filename; nothing was overwritten.".into());
    }
    let parent = destination
        .parent()
        .filter(|p| p.is_dir())
        .ok_or("Download destination directory is unavailable")?;
    let mut file = tempfile::Builder::new()
        .prefix(".reelio-update-")
        .tempfile_in(parent)
        .map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut count = 0;
    let mut buffer = [0; 64 * 1024];
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("Update download cancelled".into());
        }
        let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        count += n as u64;
        if count > size {
            return Err("Update package is larger than its published size".into());
        }
        digest.update(&buffer[..n]);
        file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
    }
    if count != size || format!("{:x}", digest.finalize()) != hash {
        return Err(
            "Update verification failed: size or SHA-256 differs. No package was published.".into(),
        );
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("Update download cancelled".into());
    }
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist_noclobber(destination)
        .map_err(|e| format!("Could not publish update without overwriting: {e}"))?;
    Ok(())
}
#[derive(Default)]
pub struct UpdateService {
    phase: AtomicU8,
    cancel: AtomicBool,
    offer: Mutex<Option<Offer>>,
}
struct Busy<'a>(&'a AtomicU8);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(0, Ordering::SeqCst);
    }
}
impl UpdateService {
    fn enter(&self, phase: u8) -> Result<Busy<'_>, String> {
        self.phase
            .compare_exchange(0, phase, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "An update operation is already running")?;
        Ok(Busy(&self.phase))
    }
    pub fn downloading(&self) -> bool {
        self.phase.load(Ordering::SeqCst) == 2
    }
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }
    pub fn check(&self, current: &str, target: Target) -> Result<Report, String> {
        let _busy = self.enter(1)?;
        *self.offer.lock().map_err(|_| "Update state unavailable")? = None;
        let client = client()?;
        let mut releases = Vec::new();
        let mut complete = false;
        for page in 1..=10 {
            let response = get(&client, &format!("{API}?per_page=100&page={page}"), true)?;
            let batch: Vec<Release> = serde_json::from_slice(&limited(response, MAX_METADATA)?)
                .map_err(|_| "GitHub release metadata is invalid")?;
            if batch.len() > 100 {
                return Err("GitHub release page exceeds its limit".into());
            }
            let last = batch.len() < 100;
            releases.extend(batch);
            if last {
                complete = true;
                break;
            }
        }
        if !complete {
            return Err("Too many release pages to determine the latest version reliably".into());
        }
        let (report, offer) = select(&releases, current, target)?;
        *self.offer.lock().map_err(|_| "Update state unavailable")? = offer;
        Ok(report)
    }
    pub fn filename(&self, id: &str) -> Result<String, String> {
        let lock = self.offer.lock().map_err(|_| "Update state unavailable")?;
        let offer = lock
            .as_ref()
            .filter(|o| o.id == id && o.created.elapsed() < Duration::from_secs(900))
            .ok_or("Update offer expired; check again")?;
        Ok(offer.asset.name.clone())
    }
    pub fn download(&self, id: &str, destination: &Path) -> Result<(), String> {
        let _busy = self.enter(2)?;
        self.cancel.store(false, Ordering::SeqCst);
        let offer = self
            .offer
            .lock()
            .map_err(|_| "Update state unavailable")?
            .as_ref()
            .filter(|o| o.id == id && o.created.elapsed() < Duration::from_secs(900))
            .cloned()
            .ok_or("Update offer expired; check again")?;
        let client = client()?;
        let hash = if let Some(digest) = &offer.asset.digest {
            parse_digest(digest)?
        } else {
            let sums = offer.sums.as_ref().ok_or("No release checksum")?;
            let bytes = limited(get(&client, &sums.browser_download_url, false)?, MAX_SUMS)?;
            checksum(&bytes, &offer.asset.name)?
        };
        if self.cancel.load(Ordering::SeqCst) {
            return Err("Update download cancelled".into());
        }
        let response = get(&client, &offer.asset.browser_download_url, false)?;
        if response
            .content_length()
            .is_some_and(|length| length != offer.asset.size)
        {
            return Err("Update response length differs from the release metadata".into());
        }
        publish_verified(response, offer.asset.size, &hash, destination, &self.cancel)
    }
}

#[cfg(test)]
mod tests;
