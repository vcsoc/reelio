use reqwest::{
    blocking::Client,
    header::{COOKIE, LOCATION},
    redirect::Policy,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    io::{Cursor, Read, Write},
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use url::{Host, Url};

const MAX_DOWNLOAD: u64 = 8 * 1024 * 1024;
const MAX_SUBTITLE: usize = 4 * 1024 * 1024;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchKind {
    Artwork,
    Subtitles,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingInfo {
    pub id: String,
    pub kind: SearchKind,
    pub host: String,
    pub name: String,
}
struct Pending {
    info: PendingInfo,
    url: Url,
    cookie: String,
    created: Instant,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleFile {
    pub path: PathBuf,
    pub name: String,
}
pub struct ResourceDownload {
    pub kind: SearchKind,
    pub bytes: Vec<u8>,
    pub source_label: String,
    pub filename: String,
}
pub struct ResourceService {
    root: PathBuf,
    pending: Mutex<VecDeque<Pending>>,
}

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a, b, c, _] = v.octets();
            !(v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_broadcast()
                || v.is_documentation()
                || v.is_unspecified()
                || v.is_multicast()
                || a == 0
                || a >= 240
                || (a == 100 && (64..=127).contains(&b))
                || (a == 198 && (b == 18 || b == 19))
                || (a == 192 && b == 0 && c == 0)
                || (a == 192 && b == 88 && c == 99))
        }
        IpAddr::V6(v) => {
            if let Some(v4) = v.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(v4));
            }
            let s = v.segments();
            !(v.is_loopback()
                || v.is_unspecified()
                || v.is_multicast()
                || v.is_unique_local()
                || v.is_unicast_link_local()
                || (s[0] == 0x2002)
                || s[0] == 0x3ffe
                || (s[0] == 0x3fff && s[1] & 0xf000 == 0)
                || (s[0] == 0x2001
                    && (s[1] == 0xdb8 || s[1] == 0 || s[1] == 2 || s[1] == 0x10 || s[1] == 0x20))
                || (s[0] & 0xe000 != 0x2000))
        }
    }
}
pub fn allowed_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && match url.host() {
            Some(Host::Domain(d)) => {
                d.contains('.')
                    && !d.ends_with(".localhost")
                    && !d.ends_with(".local")
                    && !d.ends_with(".internal")
            }
            Some(Host::Ipv4(ip)) => public_ip(IpAddr::V4(ip)),
            Some(Host::Ipv6(ip)) => public_ip(IpAddr::V6(ip)),
            None => false,
        }
}
pub fn search_url(kind: SearchKind, query: &str) -> Result<Url, String> {
    let query = query.trim();
    if query.is_empty() || query.len() > 512 || query.contains('\0') {
        return Err("Enter a movie title (up to 512 bytes)".into());
    }
    let mut url = Url::parse(match kind {
        SearchKind::Artwork => "https://www.bing.com/images/search",
        SearchKind::Subtitles => "https://www.bing.com/search",
    })
    .map_err(|e| e.to_string())?;
    let q = match kind {
        SearchKind::Artwork => format!("{query} movie poster cover"),
        SearchKind::Subtitles => {
            format!("{query} subtitles site:opensubtitles.org OR site:opensubtitles.com")
        }
    };
    url.query_pairs_mut().append_pair("q", &q);
    Ok(url)
}
#[derive(Clone, Copy, Debug, Default, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PosterProportion {
    #[default]
    Any,
    Landscape,
    Portrait,
    Square,
    #[serde(rename = "4:3")]
    FourThree,
    #[serde(rename = "3:4")]
    ThreeFour,
    #[serde(rename = "16:9")]
    SixteenNine,
    #[serde(rename = "9:16")]
    NineSixteen,
    #[serde(rename = "2:3")]
    TwoThree,
    #[serde(rename = "3:2")]
    ThreeTwo,
    #[serde(rename = "21:9")]
    TwentyOneNine,
    #[serde(rename = "9:21")]
    NineTwentyOne,
}
impl PosterProportion {
    pub fn ratio(self) -> Option<(u32, u32)> {
        match self {
            Self::Any | Self::Landscape | Self::Portrait => None,
            Self::Square => Some((1, 1)),
            Self::FourThree => Some((4, 3)),
            Self::ThreeFour => Some((3, 4)),
            Self::SixteenNine => Some((16, 9)),
            Self::NineSixteen => Some((9, 16)),
            Self::TwoThree => Some((2, 3)),
            Self::ThreeTwo => Some((3, 2)),
            Self::TwentyOneNine => Some((21, 9)),
            Self::NineTwentyOne => Some((9, 21)),
        }
    }
    pub fn matches(self, width: u32, height: u32) -> bool {
        if width == 0 || height == 0 {
            return false;
        }
        match self {
            Self::Any => true,
            Self::Landscape => width > height,
            Self::Portrait => height > width,
            _ => {
                let (w, h) = self.ratio().unwrap();
                let actual = u64::from(width) * u64::from(h);
                let target = u64::from(height) * u64::from(w);
                actual.abs_diff(target) * 100 <= target * 4
            }
        }
    }
    fn provider_filter(self) -> Option<&'static str> {
        match self {
            Self::Any => None,
            Self::Square => Some("+filterui:aspect-square"),
            Self::Landscape
            | Self::FourThree
            | Self::SixteenNine
            | Self::ThreeTwo
            | Self::TwentyOneNine => Some("+filterui:aspect-wide"),
            _ => Some("+filterui:aspect-tall"),
        }
    }
}
#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PosterBatch {
    pub results: Vec<PosterResult>,
    pub next_offset: u32,
    pub has_more: bool,
}
#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PosterResult {
    pub title: String,
    pub source_host: String,
    pub image_url: String,
    pub thumbnail_url: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}
fn poster_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Invalid poster URL")?;
    if value.len() > 8192 || !allowed_url(&url) {
        return Err("Posters require public HTTPS image URLs".into());
    }
    Ok(url)
}
fn parse_posters(bytes: &[u8]) -> Result<Vec<PosterResult>, String> {
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("Image search response exceeds 2 MiB".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "Invalid image search response encoding")?;
    // Parse inert result metadata; provider HTML/scripts never enter the application WebView.
    let document = scraper::Html::parse_document(text);
    let selector =
        scraper::Selector::parse("a.iusc[m]").map_err(|_| "Invalid image result selector")?;
    let mut results = Vec::new();
    for node in document.select(&selector) {
        let Some(metadata) = node.value().attr("m").filter(|m| m.len() <= 32768) else {
            continue;
        };
        let Ok(data) = serde_json::from_str::<serde_json::Value>(metadata) else {
            continue;
        };
        let Some(image) = data.get("murl").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(thumbnail) = data.get("turl").and_then(|v| v.as_str()) else {
            continue;
        };
        let Ok(url) = poster_url(image) else { continue };
        if poster_url(thumbnail).is_err()
            || results.iter().any(|p: &PosterResult| p.image_url == image)
        {
            continue;
        }
        let dimensions = node
            .value()
            .attr("href")
            .filter(|h| h.len() <= 16384)
            .and_then(|h| Url::parse("https://www.bing.com").ok()?.join(h).ok())
            .map(|url| {
                let dimension = |key: &str| {
                    url.query_pairs()
                        .find(|(k, _)| k == key)
                        .and_then(|(_, v)| v.parse::<u32>().ok())
                        .filter(|v| *v > 0 && *v <= 1_000_000)
                };
                (dimension("expw"), dimension("exph"))
            })
            .unwrap_or((None, None));
        results.push(PosterResult {
            title: data
                .get("t")
                .and_then(|v| v.as_str())
                .unwrap_or("Movie poster")
                .chars()
                .take(256)
                .collect(),
            source_host: url.host_str().unwrap_or_default().into(),
            image_url: image.into(),
            thumbnail_url: thumbnail.into(),
            width: dimensions.0,
            height: dimensions.1,
        });
        if results.len() == 96 {
            break;
        }
    }
    Ok(results)
}
pub fn poster_search_page(
    query: &str,
    proportion: PosterProportion,
    offset: u32,
) -> Result<PosterBatch, String> {
    if offset >= 1400 {
        return Err("Search limit reached; refine the movie title or proportions".into());
    }
    let mut url = search_url(SearchKind::Artwork, query)?;
    url.set_path("/images/async");
    url.query_pairs_mut()
        .append_pair("async", "content")
        .append_pair("dgst", "r")
        .append_pair("first", &(offset + 1).to_string())
        .append_pair("count", "35")
        .append_pair("IID", "images.1")
        .append_pair("SFX", "2");
    if let Some(filter) = proportion.provider_filter() {
        url.query_pairs_mut().append_pair("qft", filter);
    }
    let bytes = fetch(url, "")?;
    let results = parse_posters(&bytes)?;
    let text = std::str::from_utf8(&bytes).map_err(|_| "Invalid search response")?;
    let raw_count = scraper::Html::parse_document(text)
        .select(&scraper::Selector::parse("a.iusc[m]").map_err(|_| "Invalid selector")?)
        .count()
        .min(96) as u32;
    let next_offset = offset.saturating_add(raw_count).min(1400);
    let results = results
        .into_iter()
        .filter(|p| {
            proportion == PosterProportion::Any
                || p.width
                    .zip(p.height)
                    .is_some_and(|(w, h)| proportion.matches(w, h))
        })
        .collect();
    Ok(PosterBatch {
        results,
        next_offset,
        has_more: raw_count > 0 && next_offset < 1400,
    })
}
pub fn poster_search(query: &str) -> Result<Vec<PosterResult>, String> {
    Ok(poster_search_page(query, PosterProportion::Any, 0)?
        .results
        .into_iter()
        .take(12)
        .collect())
}
pub fn poster_image(url: &str) -> Result<Vec<u8>, String> {
    fetch(poster_url(url)?, "")
}
fn resolve(host: &str, timeout: Duration) -> Result<Vec<SocketAddr>, String> {
    let host = host.trim_matches(['[', ']']).to_owned();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = (host.as_str(), 443)
            .to_socket_addrs()
            .map(|addresses| addresses.take(64).collect());
        let _ = tx.send(result);
    });
    rx.recv_timeout(timeout)
        .map_err(|_| "Download DNS lookup timed out")?
        .map_err(|_| "Could not resolve download host".into())
}
fn fetch(mut url: Url, cookie: &str) -> Result<Vec<u8>, String> {
    let original_host = url.host_str().unwrap_or_default().to_owned();
    let deadline = Instant::now() + Duration::from_secs(35);
    for _ in 0..=4 {
        if !allowed_url(&url) {
            return Err("Downloads require a public HTTPS URL on port 443; local addresses and credentials in URLs are blocked".into());
        }
        let host = url.host_str().ok_or("Download URL has no host")?;
        let lookup_time = deadline
            .checked_duration_since(Instant::now())
            .ok_or("Download timed out")?
            .min(Duration::from_secs(5));
        let addresses = resolve(host, lookup_time)?;
        if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
            return Err("Download host resolved to a non-public address".into());
        }
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or("Download timed out")?;
        // Pin validated DNS answers and disable proxies so redirects cannot reach local services.
        let client = Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(Policy::none())
            .resolve_to_addrs(host, &addresses)
            .connect_timeout(Duration::from_secs(5))
            .timeout(remaining)
            .user_agent("Reelio/0.1 local-media-editor")
            .build()
            .map_err(|e| e.without_url().to_string())?;
        let mut request = client.get(url.clone());
        if host == original_host && !cookie.is_empty() {
            request = request.header(COOKIE, cookie);
        }
        let response = request
            .send()
            .map_err(|e| format!("Download failed: {}", e.without_url()))?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|h| h.to_str().ok())
                .ok_or("Download redirect has no valid location")?;
            url = url
                .join(location)
                .map_err(|_| "Invalid download redirect")?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("Provider returned HTTP {}. This host may block downloads or require an account. Choose another result, or save the image/subtitle in your browser and import the local file.",response.status().as_u16()));
        }
        if response.content_length().is_some_and(|n| n > MAX_DOWNLOAD) {
            return Err("Download exceeds 8 MiB".into());
        }
        let mut bytes = vec![];
        response
            .take(MAX_DOWNLOAD + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Download was interrupted or timed out")?;
        if bytes.is_empty() || bytes.len() as u64 > MAX_DOWNLOAD {
            return Err("Download must be between 1 byte and 8 MiB".into());
        }
        return Ok(bytes);
    }
    Err("Too many download redirects".into())
}
fn subtitle_extension(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.is_empty() || bytes.len() > MAX_SUBTITLE {
        return Err("Each subtitle must be smaller than 4 MiB".into());
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "Subtitle encoding is not UTF-8. Convert it explicitly before importing.")?;
    if text.contains('\0')
        || text
            .trim_start_matches('\u{feff}')
            .trim_start()
            .starts_with('<')
    {
        return Err("Provider returned a page, unsupported encoding, or invalid subtitle instead of a subtitle file".into());
    }
    if text
        .trim_start_matches('\u{feff}')
        .trim_start()
        .starts_with("WEBVTT")
    {
        Ok("vtt")
    } else if text.contains("[Script Info]") || text.contains("[V4+ Styles]") {
        Ok("ass")
    } else if text.contains("-->") {
        Ok("srt")
    } else {
        Err("No supported subtitle cues found. Download an SRT, ASS, SSA, or WebVTT file.".into())
    }
}
pub fn unpack_subtitles(bytes: &[u8], name: &str) -> Result<Vec<(String, Vec<u8>)>, String> {
    if bytes.len() as u64 > MAX_DOWNLOAD {
        return Err("Subtitle download exceeds 8 MiB".into());
    }
    if !bytes.starts_with(b"PK\x03\x04") && !bytes.starts_with(b"PK\x05\x06") {
        subtitle_extension(bytes)?;
        return Ok(vec![(name.chars().take(256).collect(), bytes.to_vec())]);
    }
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "Invalid subtitle ZIP archive")?;
    if archive.len() > 64 {
        return Err("Subtitle archive contains more than 64 entries".into());
    }
    let mut results = vec![];
    let mut total = 0usize;
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|_| "Unsupported or encrypted subtitle archive entry")?;
        if entry.enclosed_name().is_none()
            || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("Unsafe paths or symbolic links in subtitle archive".into());
        }
        if entry.is_dir() {
            continue;
        }
        let entry_name = entry
            .name()
            .map_err(|_| "Invalid encoding in subtitle archive filename")?;
        let name = Path::new(entry_name.as_ref())
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Subtitle")
            .chars()
            .take(256)
            .collect::<String>();
        if !["srt", "ass", "ssa", "vtt"].contains(
            &Path::new(&name)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str(),
        ) {
            continue;
        }
        if entry.size() > MAX_SUBTITLE as u64 || results.len() >= 8 {
            return Err("Subtitle archive exceeds 8 subtitle files or 4 MiB per file".into());
        }
        let mut content = vec![];
        entry
            .take(MAX_SUBTITLE as u64 + 1)
            .read_to_end(&mut content)
            .map_err(|_| "Corrupt subtitle ZIP entry")?;
        subtitle_extension(&content)?;
        total += content.len();
        if total > 16 * 1024 * 1024 {
            return Err("Expanded subtitles exceed 16 MiB".into());
        }
        results.push((name, content));
    }
    if results.is_empty() {
        return Err("Archive contains no supported text subtitle files".into());
    }
    Ok(results)
}
impl ResourceService {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            pending: Mutex::new(VecDeque::new()),
        }
    }
    pub fn remember(
        &self,
        url: Url,
        kind: SearchKind,
        cookie: String,
    ) -> Result<PendingInfo, String> {
        if !allowed_url(&url) || url.as_str().len() > 8192 || cookie.len() > 16384 {
            return Err("Download URL or browser session is unsupported".into());
        }
        let info = PendingInfo {
            id: uuid::Uuid::new_v4().to_string(),
            kind,
            host: url.host_str().unwrap_or_default().into(),
            name: url
                .path_segments()
                .and_then(|mut s| s.next_back())
                .unwrap_or("download")
                .chars()
                .take(256)
                .collect(),
        };
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "Download state lock failed")?;
        pending.retain(|p| p.created.elapsed() < Duration::from_secs(900));
        if pending.len() >= 8 {
            return Err("Finish or cancel the pending downloads before selecting more".into());
        }
        pending.push_back(Pending {
            info: info.clone(),
            url,
            cookie,
            created: Instant::now(),
        });
        Ok(info)
    }
    pub fn forget(&self, id: &str) -> Result<(), String> {
        self.pending
            .lock()
            .map_err(|_| "Download state lock failed")?
            .retain(|p| p.info.id != id);
        Ok(())
    }
    pub fn download(&self, id: &str) -> Result<ResourceDownload, String> {
        let p = {
            let mut queue = self
                .pending
                .lock()
                .map_err(|_| "Download state lock failed")?;
            let index = queue
                .iter()
                .position(|p| p.info.id == id)
                .ok_or("Download selection expired. Select it again in the browser.")?;
            queue.remove(index).ok_or("Download selection expired")?
        };
        if p.created.elapsed() > Duration::from_secs(900) {
            return Err("Download selection expired after 15 minutes".into());
        }
        let bytes = fetch(p.url, &p.cookie)?;
        Ok(ResourceDownload {
            kind: p.info.kind,
            source_label: p.info.host,
            filename: p.info.name,
            bytes,
        })
    }
    pub fn save_subtitles(&self, bytes: &[u8], name: &str) -> Result<Vec<SubtitleFile>, String> {
        let unpacked = unpack_subtitles(bytes, name)?;
        std::fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.root, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let dir = tempfile::Builder::new()
            .prefix("subtitle-")
            .tempdir_in(&self.root)
            .map_err(|e| e.to_string())?;
        let mut files = vec![];
        for (i, (name, content)) in unpacked.into_iter().enumerate() {
            let extension = subtitle_extension(&content)?;
            let path = dir.path().join(format!("{i}.{extension}"));
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|e| e.to_string())?;
            file.write_all(&content)
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string())?;
            files.push(SubtitleFile { path, name });
        }
        let _ = dir.keep();
        Ok(files)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    const SRT: &[u8] = b"1\n00:00:00,200 --> 00:00:01,500\nFixture subtitle\n";
    #[test]
    fn poster_results_filter_unsafe_images_duplicates_and_limit_results() {
        fn card(image: &str) -> String {
            let data=serde_json::json!({"t":"Example <Movie>","murl":image,"turl":"https://example.com/thumb.jpg"}).to_string().replace('&',"&amp;").replace('"',"&quot;");
            format!("<a class=\"iusc\" m=\"{data}\"></a>")
        }
        let mut html = card("https://127.0.0.1/unsafe.jpg");
        for i in 0..120 {
            let c = card(&format!("https://example.com/{i}.jpg"));
            html.push_str(&c);
            html.push_str(&c);
        }
        let result = parse_posters(html.as_bytes()).unwrap();
        assert_eq!(result.len(), 96);
        assert_eq!(result[0].title, "Example <Movie>");
        assert_eq!(result[0].source_host, "example.com");
        for url in [
            "http://example.com/a.jpg",
            "https://user:pass@example.com/a.jpg",
            "https://example.com:8443/a.jpg",
        ] {
            assert!(poster_url(url).is_err());
        }
        assert!(
            parse_posters(b"<html><script>window.location='evil'</script></html>")
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn proportions_match_orientation_and_ratio_with_bounded_tolerance() {
        assert!(PosterProportion::Landscape.matches(1600, 900));
        assert!(PosterProportion::NineTwentyOne.matches(900, 2100));
        assert_eq!(
            serde_json::from_str::<PosterProportion>("\"9:21\"").unwrap(),
            PosterProportion::NineTwentyOne
        );
        assert!(!PosterProportion::Portrait.matches(1600, 900));
        assert!(PosterProportion::SixteenNine.matches(1640, 900));
        assert!(!PosterProportion::SixteenNine.matches(1700, 900));
        assert!(PosterProportion::Square.matches(1000, 1020));
        assert!(!PosterProportion::Any.matches(0, 0));
        assert!(serde_json::from_str::<PosterProportion>("\"1:0\"").is_err());
        assert!(poster_search_page("Movie", PosterProportion::Any, 1400).is_err());
        let html=br#"<a class="iusc" href="/images/search?expw=1600&amp;exph=900" m='{"t":"Film","murl":"https://example.com/a.jpg","turl":"https://example.com/t.jpg"}'></a>"#;
        let results = parse_posters(html).unwrap();
        assert_eq!(
            (results[0].width, results[0].height),
            (Some(1600), Some(900))
        );
    }
    #[test]
    fn unsafe_network_targets_and_credentials_are_blocked() {
        for url in [
            "http://example.com/a.srt",
            "https://localhost/a",
            "https://127.0.0.1/a",
            "https://[::1]/a",
            "https://192.168.1.1/a",
            "https://100.64.1.1/a",
            "https://user:pass@example.com/a",
            "https://example.com:8443/a",
        ] {
            assert!(!allowed_url(&Url::parse(url).unwrap()), "{url}");
        }
        assert!(allowed_url(
            &Url::parse("https://example.com/a.srt").unwrap()
        ));
    }
    #[test]
    fn public_ipv4_and_ipv6_are_recognized() {
        assert!(public_ip("8.8.8.8".parse().unwrap()));
        assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
        assert!(!public_ip("::ffff:127.0.0.1".parse().unwrap()));
        assert!(!public_ip("3fff::1".parse().unwrap()));
    }
    #[test]
    fn query_is_encoded_not_executed() {
        let u = search_url(SearchKind::Artwork, "Film & sequel <test>").unwrap();
        assert_eq!(u.host_str(), Some("www.bing.com"));
        assert!(u
            .query_pairs()
            .any(|(k, v)| k == "q" && v.contains("Film & sequel <test>")));
    }
    #[test]
    fn direct_subtitle_is_validated_and_preserved() {
        assert_eq!(unpack_subtitles(SRT, "fixture.srt").unwrap()[0].1, SRT);
        assert!(unpack_subtitles(b"<html>login</html>", "x.srt").is_err());
        assert!(unpack_subtitles(&[0xff, 0xfe], "x.srt").is_err());
    }
    fn archive(name: &str, content: &[u8]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        z.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(content).unwrap();
        z.finish().unwrap().into_inner()
    }
    #[test]
    fn traversal_and_oversized_archive_entries_are_rejected() {
        assert!(unpack_subtitles(&archive("../escape.srt", SRT), "x.zip").is_err());
        assert!(
            unpack_subtitles(&archive("huge.srt", &vec![b'a'; MAX_SUBTITLE + 1]), "x.zip").is_err()
        );
    }
    #[test]
    fn zip_subtitle_keeps_content_and_ignores_original_paths_on_disk() {
        let root = tempfile::tempdir().unwrap();
        let service = ResourceService::new(root.path().join("downloads"));
        let files = service
            .save_subtitles(&archive("folder/movie.srt", SRT), "x.zip")
            .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "movie.srt");
        assert_eq!(std::fs::read(&files[0].path).unwrap(), SRT);
        assert!(files[0].path.starts_with(root.path()));
    }
    #[test]
    fn pending_download_capacity_and_cancellation_are_bounded() {
        let root = tempfile::tempdir().unwrap();
        let service = ResourceService::new(root.path().into());
        let mut ids = vec![];
        for _ in 0..8 {
            ids.push(
                service
                    .remember(
                        Url::parse("https://example.com/a.jpg").unwrap(),
                        SearchKind::Artwork,
                        String::new(),
                    )
                    .unwrap()
                    .id,
            );
        }
        assert!(service
            .remember(
                Url::parse("https://example.com/a.jpg").unwrap(),
                SearchKind::Artwork,
                String::new()
            )
            .is_err());
        service.forget(&ids[0]).unwrap();
        assert!(service
            .remember(
                Url::parse("https://example.com/a.jpg").unwrap(),
                SearchKind::Artwork,
                String::new()
            )
            .is_ok());
    }
    #[test]
    fn pending_downloads_require_an_opaque_one_time_selection() {
        let root = tempfile::tempdir().unwrap();
        let s = ResourceService::new(root.path().into());
        assert!(s.download("https://example.com/private").is_err());
        assert!(s
            .remember(
                Url::parse("https://localhost/a").unwrap(),
                SearchKind::Artwork,
                String::new()
            )
            .is_err());
    }
}
