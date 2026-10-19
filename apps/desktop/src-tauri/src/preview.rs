//! Capability-only, read-only loopback transport for WebKit media range requests.
use std::{
    collections::VecDeque,
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime},
};
use uuid::Uuid;
type Sources = Arc<Mutex<VecDeque<(String, Arc<Mutex<Source>>)>>>;
struct Source {
    path: std::path::PathBuf,
    file: File,
    len: u64,
    modified: Option<SystemTime>,
    mime: &'static str,
    _keepalive: Option<Arc<reelio_ffmpeg::PreparedPreview>>,
}
struct Prepared {
    original: std::path::PathBuf,
    file: File,
    len: u64,
    modified: Option<SystemTime>,
    prepared: Arc<reelio_ffmpeg::PreparedPreview>,
}
struct Server {
    port: u16,
    sources: Sources,
    stop: Arc<AtomicBool>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
fn same_file(a: &std::fs::Metadata, b: &std::fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        a.dev() == b.dev() && a.ino() == b.ino()
    }
    #[cfg(not(unix))]
    {
        let _ = (a, b);
        false
    }
}
#[derive(Default)]
pub struct PreviewService(Mutex<Option<Server>>, Mutex<VecDeque<Prepared>>);
impl PreviewService {
    pub fn register_for_playback(
        &self,
        backend: &reelio_ffmpeg::Ffmpeg,
        path: &Path,
    ) -> Result<String, String> {
        let file = File::open(path).map_err(|error| error.to_string())?;
        let meta = file.metadata().map_err(|error| error.to_string())?;
        let mut cache = self
            .1
            .lock()
            .map_err(|_| "Preview preparation unavailable")?;
        if let Some(entry) = cache.iter().find(|entry| {
            entry.original == path
                && entry.len == meta.len()
                && entry.modified == meta.modified().ok()
                && entry
                    .file
                    .metadata()
                    .is_ok_and(|old| same_file(&old, &meta))
        }) {
            return self.register_owned(entry.prepared.path(), Some(entry.prepared.clone()));
        }
        let Some(prepared) = backend.seekable_preview(path)? else {
            return self.register(path);
        };
        let prepared = Arc::new(prepared);
        let url = self.register_owned(prepared.path(), Some(prepared.clone()))?;
        if cache.len() >= 2 {
            cache.pop_front();
        }
        cache.push_back(Prepared {
            original: path.to_path_buf(),
            file,
            len: meta.len(),
            modified: meta.modified().ok(),
            prepared,
        });
        Ok(url)
    }
    pub fn register(&self, path: &Path) -> Result<String, String> {
        self.register_owned(path, None)
    }
    fn register_owned(
        &self,
        path: &Path,
        keepalive: Option<Arc<reelio_ffmpeg::PreparedPreview>>,
    ) -> Result<String, String> {
        let file = File::open(path).map_err(|e| e.to_string())?;
        let meta = file.metadata().map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.len() == 0 {
            return Err("Preview requires a nonempty regular media file".into());
        }
        let source = Source {
            _keepalive: keepalive,
            path: path.to_path_buf(),
            file,
            len: meta.len(),
            modified: meta.modified().ok(),
            mime: match path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str()
            {
                "mp4" | "m4v" => "video/mp4",
                "mkv" => "video/x-matroska",
                "webm" => "video/webm",
                "mov" => "video/quicktime",
                "mp3" => "audio/mpeg",
                "m4a" => "audio/mp4",
                "wav" => "audio/wav",
                "ogg" | "oga" => "audio/ogg",
                _ => "application/octet-stream",
            },
        };
        let mut server = self.0.lock().map_err(|_| "Preview service unavailable")?;
        if server.is_none() {
            *server = Some(Server::start().map_err(|e| e.to_string())?);
        }
        let server = server.as_ref().unwrap();
        let token = Uuid::new_v4().to_string();
        let mut sources = server
            .sources
            .lock()
            .map_err(|_| "Preview service unavailable")?;
        let existing = sources.iter().position(|(_, item)| {
            item.lock().is_ok_and(|old| {
                old.path == source.path
                    && old.len == source.len
                    && old.modified == source.modified
                    && old
                        .file
                        .metadata()
                        .is_ok_and(|old_meta| same_file(&old_meta, &meta))
            })
        });
        if let Some(index) = existing {
            let entry = sources.remove(index).ok_or("Preview cache changed")?;
            let url = format!("http://127.0.0.1:{}/v/{}", server.port, entry.0);
            sources.push_back(entry);
            return Ok(url);
        }
        if source._keepalive.is_some()
            && sources
                .iter()
                .filter(|(_, item)| item.lock().is_ok_and(|source| source._keepalive.is_some()))
                .count()
                >= 2
        {
            if let Some(index) = sources
                .iter()
                .position(|(_, item)| item.lock().is_ok_and(|source| source._keepalive.is_some()))
            {
                sources.remove(index);
            }
        }
        if sources.len() >= 72 {
            sources.pop_front();
        }
        sources.push_back((token.clone(), Arc::new(Mutex::new(source))));
        Ok(format!("http://127.0.0.1:{}/v/{token}", server.port))
    }
}
impl Server {
    fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let sources: Sources = Arc::new(Mutex::new(VecDeque::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let shared = sources.clone();
        let shutdown = stop.clone();
        std::thread::Builder::new()
            .name("reelio-preview".into())
            .spawn(move || {
                let active = Arc::new(AtomicUsize::new(0));
                while !shutdown.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((stream, peer)) => {
                            if !peer.ip().is_loopback() {
                                continue;
                            }
                            if active.fetch_add(1, Ordering::Relaxed) >= 16 {
                                active.fetch_sub(1, Ordering::Relaxed);
                                continue;
                            }
                            let active = active.clone();
                            let sources = shared.clone();
                            let counter = active.clone();
                            if std::thread::Builder::new()
                                .name("reelio-media-read".into())
                                .spawn(move || {
                                    let _ = serve(stream, port, &sources);
                                    active.fetch_sub(1, Ordering::Relaxed);
                                })
                                .is_err()
                            {
                                counter.fetch_sub(1, Ordering::Relaxed);
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(20))
                        }
                        Err(_) => break,
                    }
                }
            })?;
        Ok(Self {
            port,
            sources,
            stop,
        })
    }
}
fn reply(stream: &mut TcpStream, status: &str, extra: &str) -> std::io::Result<()> {
    write!(stream,"HTTP/1.1 {status}\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n{extra}\r\n")
}
fn byte_range(value: &str, len: u64) -> Option<(u64, u64)> {
    let (first, last) = value.strip_prefix("bytes=")?.split_once('-')?;
    if first.is_empty() {
        let count = last.parse::<u64>().ok()?;
        if count == 0 {
            return None;
        }
        return Some((len.saturating_sub(count), len.checked_sub(1)?));
    }
    let start = first.parse::<u64>().ok()?;
    let end = if last.is_empty() {
        len.checked_sub(1)?
    } else {
        last.parse::<u64>().ok()?.min(len.checked_sub(1)?)
    };
    (start <= end && start < len).then_some((start, end))
}
fn serve(mut stream: TcpStream, port: u16, sources: &Sources) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let started = Instant::now();
    let mut header = Vec::new();
    let mut byte = [0];
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() >= 16 * 1024 || started.elapsed() > Duration::from_secs(5) {
            return reply(&mut stream, "431 Request Header Fields Too Large", "");
        }
        if stream.read(&mut byte)? == 0 {
            return Ok(());
        }
        header.push(byte[0]);
    }
    let Ok(header) = std::str::from_utf8(&header) else {
        return reply(&mut stream, "400 Bad Request", "");
    };
    let mut lines = header.split("\r\n");
    let request = lines
        .next()
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>();
    if request.len() != 3 || request[2] != "HTTP/1.1" {
        return reply(&mut stream, "400 Bad Request", "");
    }
    if request[0] != "GET" && request[0] != "HEAD" {
        return reply(
            &mut stream,
            "405 Method Not Allowed",
            "Allow: GET, HEAD\r\n",
        );
    }
    let mut host = None;
    let mut range = None;
    for line in lines.filter(|s| !s.is_empty()) {
        let Some((key, value)) = line.split_once(':') else {
            return reply(&mut stream, "400 Bad Request", "");
        };
        if key.eq_ignore_ascii_case("host") {
            if host.is_some() {
                return reply(&mut stream, "400 Bad Request", "");
            }
            host = Some(value.trim());
        }
        if key.eq_ignore_ascii_case("range") {
            if range.is_some() {
                return reply(&mut stream, "400 Bad Request", "");
            }
            range = Some(value.trim());
        }
    }
    if host != Some(format!("127.0.0.1:{port}").as_str()) {
        return reply(&mut stream, "403 Forbidden", "");
    }
    let Some(token) = request[1].strip_prefix("/v/") else {
        return reply(&mut stream, "404 Not Found", "");
    };
    let source = sources
        .lock()
        .ok()
        .and_then(|s| s.iter().find(|(t, _)| t == token).map(|(_, s)| s.clone()));
    let Some(source) = source else {
        return reply(&mut stream, "404 Not Found", "");
    };
    let (len, mime) = {
        let source = source
            .lock()
            .map_err(|_| std::io::Error::other("Preview unavailable"))?;
        let meta = source.file.metadata()?;
        if meta.len() != source.len || meta.modified().ok() != source.modified {
            return reply(&mut stream, "409 Conflict", "");
        }
        (source.len, source.mime)
    };
    let (start, end, status) = if let Some(range) = range {
        let Some((a, b)) = byte_range(range, len) else {
            return reply(
                &mut stream,
                "416 Range Not Satisfiable",
                &format!("Content-Range: bytes */{len}\r\n"),
            );
        };
        // WebKit's demuxer treats a shortened open-ended response as end-of-stream.
        // Stream the requested range; buffers, workers and idle socket waits stay bounded.
        (a, b, "206 Partial Content")
    } else {
        (0, len - 1, "200 OK")
    };
    #[cfg(test)]
    eprintln!("Preview byte response {start}..{end}/{len}");
    write!(stream,"HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n",end-start+1)?;
    if range.is_some() {
        write!(stream, "Content-Range: bytes {start}-{end}/{len}\r\n")?;
    }
    write!(stream, "\r\n")?;
    if request[0] == "HEAD" {
        return Ok(());
    }
    let mut offset = start;
    let mut buffer = [0u8; 64 * 1024];
    while offset <= end {
        let count = (end - offset + 1).min(buffer.len() as u64) as usize;
        let read = {
            let mut source = source
                .lock()
                .map_err(|_| std::io::Error::other("Preview unavailable"))?;
            source.file.seek(SeekFrom::Start(offset))?;
            source.file.read(&mut buffer[..count])?
        };
        if read == 0 {
            break;
        }
        stream.write_all(&buffer[..read])?;
        offset += read as u64;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(unix)]
    fn unchanged_sources_reuse_capabilities_but_replaced_files_do_not() {
        let directory =
            std::env::temp_dir().join(format!("reelio-preview-cache-{}", Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("source.mp4");
        std::fs::write(&path, b"first").unwrap();
        let original = std::fs::metadata(&path).unwrap();
        let service = PreviewService::default();
        let first = service.register(&path).unwrap();
        assert_eq!(service.register(&path).unwrap(), first);
        let replacement = directory.join("replacement.mp4");
        std::fs::write(&replacement, b"other").unwrap();
        File::options()
            .write(true)
            .open(&replacement)
            .unwrap()
            .set_modified(original.modified().unwrap())
            .unwrap();
        std::fs::rename(replacement, &path).unwrap();
        assert_ne!(service.register(&path).unwrap(), first);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "requires an explicit media path and a native WebKitGTK display"]
    fn native_webkit_loopback_playback() {
        let path =
            std::env::var_os("REELIO_PREVIEW_TEST_FILE").expect("Set REELIO_PREVIEW_TEST_FILE");
        let service = PreviewService::default();
        let url = service
            .register_for_playback(&reelio_ffmpeg::Ffmpeg::default(), Path::new(&path))
            .unwrap();
        assert_eq!(
            service
                .register_for_playback(&reelio_ffmpeg::Ffmpeg::default(), Path::new(&path))
                .unwrap(),
            url
        );
        let script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../scripts/smoke-webkit-http-preview.py");
        let output = std::process::Command::new("python3")
            .arg(script)
            .arg(url)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        println!("{}", String::from_utf8_lossy(&output.stdout));
    }
    #[test]
    #[ignore = "requires explicit generated video/audio files and native WebKitGTK display"]
    fn native_webkit_timeline_audio_sync() {
        let video =
            std::env::var_os("REELIO_PREVIEW_TEST_FILE").expect("Set REELIO_PREVIEW_TEST_FILE");
        let audio =
            std::env::var_os("REELIO_PREVIEW_TEST_AUDIO").expect("Set REELIO_PREVIEW_TEST_AUDIO");
        let service = PreviewService::default();
        let video = service.register(Path::new(&video)).unwrap();
        let audio = service.register(Path::new(&audio)).unwrap();
        let script =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../scripts/smoke-webkit-timeline.py");
        let output = std::process::Command::new("python3")
            .arg(script)
            .args([video, audio])
            .output()
            .unwrap();
        println!("{}", String::from_utf8_lossy(&output.stdout));
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    #[test]
    fn ranges_are_bounded_and_strict() {
        assert_eq!(byte_range("bytes=2-5", 10), Some((2, 5)));
        assert_eq!(byte_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(byte_range("bytes=5-", 10), Some((5, 9)));
        for bad in [
            "bytes=10-",
            "bytes=4-2",
            "bytes=0-1,4-5",
            "bytes=-0",
            "other=1-2",
        ] {
            assert_eq!(byte_range(bad, 10), None);
        }
    }
    #[test]
    fn open_ended_ranges_do_not_truncate_large_video_at_eight_mib() {
        let path =
            std::env::temp_dir().join(format!("reelio-preview-large-{}.webm", Uuid::new_v4()));
        let len = 9 * 1024 * 1024;
        File::create(&path).unwrap().set_len(len).unwrap();
        let service = PreviewService::default();
        let url = service.register(&path).unwrap();
        let (address, target) = url.trim_start_matches("http://").split_once('/').unwrap();
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(
            stream,
            "GET /{target} HTTP/1.1\r\nHost: {address}\r\nRange: bytes=1024-\r\n\r\n"
        )
        .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        let header_end = response.windows(4).position(|b| b == b"\r\n\r\n").unwrap() + 4;
        let headers = std::str::from_utf8(&response[..header_end]).unwrap();
        assert!(headers.starts_with("HTTP/1.1 206"));
        assert!(headers.contains(&format!("Content-Range: bytes 1024-{}/{len}", len - 1)));
        assert_eq!(response.len() - header_end, (len - 1024) as usize);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn transport_requires_capability_and_serves_ranges() {
        let path = std::env::temp_dir().join(format!("reelio-preview-{}.mp4", Uuid::new_v4()));
        std::fs::write(&path, b"0123456789").unwrap();
        let service = PreviewService::default();
        let url = service.register(&path).unwrap();
        let address = url.trim_start_matches("http://").split('/').next().unwrap();
        let token = url.split("/v/").nth(1).unwrap();
        let request = |method: &str, target: &str, headers: &str| {
            let mut stream = TcpStream::connect(address).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            write!(
                stream,
                "{method} {target} HTTP/1.1\r\nHost: {address}\r\n{headers}\r\n"
            )
            .unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            response
        };
        let response = request("GET", &format!("/v/{token}"), "Range: bytes=2-5\r\n");
        assert!(response.starts_with("HTTP/1.1 206"));
        assert!(response.ends_with("2345"));
        assert!(request("GET", "/v/no-token", "").starts_with("HTTP/1.1 404"));
        assert!(request("POST", &format!("/v/{token}"), "").starts_with("HTTP/1.1 405"));
        assert!(
            request("GET", &format!("/v/{token}"), "Range: bytes=20-\r\n")
                .starts_with("HTTP/1.1 416")
        );
        assert!(request("HEAD", &format!("/v/{token}"), "").ends_with("\r\n\r\n"));
        assert!(request("GET", "/etc/passwd", "").starts_with("HTTP/1.1 404"));
        assert!(
            request("GET", &format!("/v/{token}"), "Host: evil.test\r\n")
                .starts_with("HTTP/1.1 400")
        );
        let mut latest = String::new();
        for generation in 0..72 {
            std::fs::write(&path, vec![b'x'; generation + 11]).unwrap();
            latest = service.register(&path).unwrap();
        }
        assert!(request("GET", &format!("/v/{token}"), "").starts_with("HTTP/1.1 404"));
        let latest = latest.split("/v/").nth(1).unwrap();
        std::fs::write(&path, b"changed-length").unwrap();
        assert!(request("GET", &format!("/v/{latest}"), "").starts_with("HTTP/1.1 409"));
        std::fs::remove_file(path).unwrap();
    }
}
