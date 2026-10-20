use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};
type Requests = Arc<Mutex<Vec<(String, Value)>>>;
fn server(replies: Vec<(u16, String, Duration)>) -> (String, Requests) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let requests: Requests = Arc::new(Mutex::new(vec![]));
    let captured = requests.clone();
    std::thread::spawn(move || {
        for (status, body, delay) in replies {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut part = [0; 8192];
            let (header_end, length) = loop {
                let count = socket.read(&mut part).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&part[..count]);
                assert!(bytes.len() < 256 * 1024);
                if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]);
                    let length = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|n| n.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    break (end + 4, length);
                }
            };
            while bytes.len() < header_end + length {
                let count = socket.read(&mut part).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&part[..count]);
            }
            let path = String::from_utf8_lossy(&bytes[..header_end])
                .split_whitespace()
                .nth(1)
                .unwrap()
                .to_string();
            let value = if length == 0 {
                Value::Null
            } else {
                serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap()
            };
            captured.lock().unwrap().push((path, value));
            std::thread::sleep(delay);
            let response=format!("HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
            let _ = socket.write_all(response.as_bytes());
        }
    });
    (endpoint, requests)
}
fn service(dir: &Path, endpoint: String) -> Arc<Service> {
    let mut value = Service::new(dir.into()).unwrap();
    Arc::get_mut(&mut value).unwrap().endpoint = endpoint;
    value
}
fn document(count: usize) -> Document {
    Document {
        cues: (0..count)
            .map(|i| crate::Cue {
                id: format!("cue-{i}"),
                start_ms: i as i64 * 2000,
                end_ms: i as i64 * 2000 + 1500,
                text: format!("Hello {i}"),
            })
            .collect(),
    }
}
fn translated(ids: std::ops::Range<usize>) -> String {
    json!({"message":{"content":json!({"translations":ids.map(|i|json!({"id":format!("cue-{i}"),"text":format!("Bonjour {i}")})).collect::<Vec<_>>()}).to_string()}}).to_string()
}
fn wait(service: &Service) -> JobInfo {
    let deadline = Instant::now() + Duration::from_secs(8);
    while service.active.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline, "Model fixture timed out");
        std::thread::sleep(Duration::from_millis(10));
    }
    service.status().unwrap()
}
#[test]
fn http_translation_batches_preserve_source_and_restart_results() {
    let dir = tempfile::tempdir().unwrap();
    let (endpoint, requests) = server(vec![
        (200, translated(0..4), Duration::ZERO),
        (200, translated(4..5), Duration::ZERO),
    ]);
    let service = service(dir.path(), endpoint);
    let source = document(5);
    let id = service
        .start("gemma3:4b".into(), Some(source.clone()), "French".into())
        .unwrap()
        .id;
    assert_eq!(wait(&service).status, "completed");
    let results = service.results(&id).unwrap();
    assert_eq!(results["translations"].as_array().unwrap().len(), 5);
    assert_eq!(
        serde_json::from_value::<Document>(results["document"].clone()).unwrap(),
        source
    );
    for (path, body) in requests.lock().unwrap().iter() {
        assert_eq!(path, "/api/chat");
        assert_eq!(body["stream"], false);
        let input: Value =
            serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
        for cue in input.as_array().unwrap() {
            assert_eq!(cue.as_object().unwrap().len(), 2);
            assert!(cue.get("start_ms").is_none());
        }
    }
    let restored = Service::new(dir.path().into()).unwrap();
    assert_eq!(restored.results(&id).unwrap(), results);
}
#[test]
fn invalid_later_batch_retains_only_validated_partial_results() {
    let dir = tempfile::tempdir().unwrap();
    let (endpoint, _) = server(vec![
        (200, translated(0..4), Duration::ZERO),
        (200, translated(99..100), Duration::ZERO),
    ]);
    let service = service(dir.path(), endpoint);
    let id = service
        .start("gemma3:4b".into(), Some(document(5)), "French".into())
        .unwrap()
        .id;
    let info = wait(&service);
    assert_eq!(info.status, "failed");
    assert_eq!(info.done, 4);
    assert_eq!(
        service.results(&id).unwrap()["translations"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    assert!(!service.protected());
}
#[test]
fn cancellation_and_exclusive_worker_are_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let (endpoint, requests) = server(vec![(200, translated(0..1), Duration::from_secs(2))]);
    let service = service(dir.path(), endpoint);
    service
        .start("gemma3:4b".into(), Some(document(1)), "French".into())
        .unwrap();
    assert!(service
        .start("gemma3:4b".into(), Some(document(1)), "French".into())
        .is_err());
    let deadline = Instant::now() + Duration::from_secs(3);
    while requests.lock().unwrap().is_empty() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let start = Instant::now();
    service.cancel();
    assert_eq!(wait(&service).status, "cancelled");
    assert!(start.elapsed() < Duration::from_secs(1));
}
#[test]
fn pull_accepts_final_progress_without_newline_and_preserves_counts() {
    let dir = tempfile::tempdir().unwrap();
    let (endpoint, requests) = server(vec![(
        200,
        "{\"status\":\"pulling\",\"completed\":100,\"total\":100}\n{\"status\":\"success\"}".into(),
        Duration::ZERO,
    )]);
    let service = service(dir.path(), endpoint);
    service
        .start("gemma3:4b".into(), None, String::new())
        .unwrap();
    let info = wait(&service);
    assert_eq!(info.status, "completed");
    assert_eq!((info.done, info.total), (100, 100));
    assert_eq!(requests.lock().unwrap()[0].0, "/api/pull");
}
#[test]
fn pull_errors_and_http_failures_do_not_report_success() {
    for (status, body) in [
        (200, "{\"error\":\"No model fixture\"}\n"),
        (200, "{\"status\":\"pulling\"}\n"),
        (500, "{}"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let (endpoint, _) = server(vec![(status, body.into(), Duration::ZERO)]);
        let service = service(dir.path(), endpoint);
        service
            .start("gemma3:4b".into(), None, String::new())
            .unwrap();
        assert_eq!(wait(&service).status, "failed");
    }
}
#[test]
fn installed_models_filter_unsupported_names() {
    let dir = tempfile::tempdir().unwrap();
    let (endpoint, _) = server(vec![(
        200,
        json!({"models":[{"name":"gemma3:4b","size":123},{"name":"unrelated:latest","size":456}]})
            .to_string(),
        Duration::ZERO,
    )]);
    let service = service(dir.path(), endpoint);
    service.cancel();
    let models = service.models().unwrap();
    assert_eq!(models["installed"].as_array().unwrap().len(), 1);
    assert_eq!(models["installed"][0]["name"], "gemma3:4b");
    assert!(service
        .start("remote-cloud:latest".into(), None, String::new())
        .is_err());
}
#[test]
fn corrupt_job_does_not_break_manual_editing_or_get_reset() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("job.json");
    std::fs::write(&path, b"corrupt preserved bytes").unwrap();
    let service = Service::new(dir.path().into()).unwrap();
    assert_eq!(service.status().unwrap().status, "failed");
    assert!(service
        .start("gemma3:4b".into(), None, String::new())
        .is_err());
    service.save_draft(&document(1)).unwrap();
    assert!(service.protected());
    assert_eq!(std::fs::read(&path).unwrap(), b"corrupt preserved bytes");
}
#[test]
fn initial_persist_failure_is_terminal_not_a_permanent_running_job() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into()).unwrap();
    std::fs::create_dir(dir.path().join("job.json")).unwrap();
    assert!(service
        .start("gemma3:4b".into(), Some(document(1)), "French".into())
        .is_err());
    assert_eq!(service.status().unwrap().status, "failed");
    assert!(!service.active.load(Ordering::SeqCst));
    assert!(dir.path().join("job.json").is_dir());
}
#[test]
fn batching_adapts_to_the_context_byte_budget() {
    let dir = tempfile::tempdir().unwrap();
    let (endpoint, requests) = server(vec![
        (200, translated(0..3), Duration::ZERO),
        (200, translated(3..4), Duration::ZERO),
    ]);
    let service = service(dir.path(), endpoint);
    let mut source = document(4);
    for cue in &mut source.cues {
        cue.text = "a".repeat(1700);
    }
    let id = service
        .start("gemma3:4b".into(), Some(source), "French".into())
        .unwrap()
        .id;
    assert_eq!(wait(&service).status, "completed");
    assert_eq!(requests.lock().unwrap().len(), 2);
    assert_eq!(service.results(&id).unwrap()["language"], "French");
}
#[test]
#[ignore = "Explicit local inference acceptance; uses an already installed model, never downloads"]
fn live_local_translation() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into()).unwrap();
    let source = document(1);
    let id = service
        .start("gemma3:4b".into(), Some(source.clone()), "French".into())
        .unwrap()
        .id;
    let deadline = Instant::now() + Duration::from_secs(180);
    while service.active.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(100));
    }
    let info = service.status().unwrap();
    assert_eq!(info.status, "completed", "{}", info.message);
    let result = service.results(&id).unwrap();
    assert_eq!(
        serde_json::from_value::<Document>(result["document"].clone()).unwrap(),
        source
    );
    assert_eq!(result["translations"][0]["id"], "cue-0");
    assert!(!result["translations"][0]["text"]
        .as_str()
        .unwrap()
        .trim()
        .is_empty());
    println!(
        "Local gemma3:4b synthetic translation: {}",
        result["translations"][0]["text"]
    );
}
