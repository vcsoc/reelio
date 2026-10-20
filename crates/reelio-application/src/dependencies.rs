use reelio_ffmpeg::{Ffmpeg, MediaBackend};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

fn bundled_gstreamer_tool(appdir: Option<PathBuf>) -> PathBuf {
    appdir
        .filter(|root| root.is_absolute())
        .map(|root| root.join("usr/bin/gst-inspect-1.0"))
        .unwrap_or_else(|| PathBuf::from("/usr/bin/gst-inspect-1.0"))
}

const PREVIEW_ELEMENTS: &[&str] = &[
    "autoaudiosink",
    "audioconvert",
    "audioresample",
    "volume",
    "playbin",
    "decodebin",
    "qtdemux",
    "matroskademux",
    "avdec_h264",
    "avdec_aac",
];
const ARCH_PACKAGES: &[&str] = &[
    "ca-certificates",
    "ca-certificates-utils",
    "ca-certificates-mozilla",
    "polkit",
    "ffmpeg",
    "gstreamer",
    "gst-plugins-base",
    "gst-plugins-good",
    "gst-libav",
    "gst-plugin-dav1d",
];
const DEBIAN_PACKAGES: &[&str] = &[
    "ca-certificates",
    "pkexec",
    "ffmpeg",
    "gstreamer1.0-tools",
    "gstreamer1.0-plugins-base",
    "gstreamer1.0-plugins-good",
    "gstreamer1.0-libav",
    "gstreamer1.0-plugins-bad",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyReport {
    pub preview_available: bool,
    pub network_available: bool,
    pub backend_available: bool,
    pub missing_components: Vec<String>,
    pub repair_supported: bool,
    pub repair_hint: String,
    pub packages: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallPlan {
    pub executable: &'static str,
    pub arguments: Vec<&'static str>,
    pub packages: &'static [&'static str],
}

// Package names and privileged executable paths never come from IPC or project files.
pub fn install_plan(os_release: &str) -> Option<InstallPlan> {
    let ids: Vec<&str> = os_release
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once('=')?;
            ["ID", "ID_LIKE"]
                .contains(&key)
                .then_some(value.trim_matches(['"', '\'']))
        })
        .flat_map(str::split_ascii_whitespace)
        .collect();
    if ids.contains(&"arch") {
        let mut arguments = vec!["-S", "--noconfirm"];
        arguments.extend_from_slice(ARCH_PACKAGES);
        Some(InstallPlan {
            executable: "/usr/bin/pacman",
            arguments,
            packages: ARCH_PACKAGES,
        })
    } else if ids.iter().any(|id| ["debian", "ubuntu"].contains(id)) {
        let mut arguments = vec!["install", "--yes", "--no-remove", "--reinstall"];
        arguments.extend_from_slice(DEBIAN_PACKAGES);
        Some(InstallPlan {
            executable: "/usr/bin/apt-get",
            arguments,
            packages: DEBIAN_PACKAGES,
        })
    } else {
        None
    }
}
fn current_plan() -> Option<InstallPlan> {
    if cfg!(target_os = "linux") {
        install_plan(&std::fs::read_to_string("/etc/os-release").ok()?)
    } else {
        None
    }
}
fn inspect_element(name: &str) -> bool {
    // AppImage plugins and diagnostics must use the same bundled GStreamer ABI.
    let tool = bundled_gstreamer_tool(std::env::var_os("APPDIR").map(PathBuf::from));
    let mut child = match Command::new(tool)
        .args(["--exists", name])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return false,
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if started.elapsed() < Duration::from_secs(3) => {
                thread::sleep(Duration::from_millis(20))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}
fn assess(
    backend_available: bool,
    linux: bool,
    plan: Option<InstallPlan>,
    mut has_element: impl FnMut(&str) -> bool,
) -> DependencyReport {
    let mut missing_elements: Vec<String> = if linux {
        PREVIEW_ELEMENTS
            .iter()
            .filter(|name| !has_element(name))
            .map(|name| format!("GStreamer: {name}"))
            .collect()
    } else {
        vec![]
    };
    if linux
        && !["dav1ddec", "av1dec", "avdec_av1"]
            .iter()
            .any(|name| has_element(name))
    {
        missing_elements
            .push("GStreamer: AV1 video decoder (dav1ddec / av1dec / avdec_av1)".into());
    }
    let preview_available = missing_elements.is_empty();
    let mut missing_components = missing_elements;
    if !backend_available {
        missing_components.push("Configured FFmpeg / FFprobe backend".into());
    }
    let repair_supported = plan.is_some();
    DependencyReport {
        preview_available,
        network_available: true,
        backend_available,
        missing_components,
        repair_supported,
        repair_hint: if repair_supported {
            "Install or repair required components using the system package manager. System authentication may be required. A configured custom backend path may still need correction in Preferences.".into()
        } else {
            "This platform has no supported in-app package-manager repair. Install the platform's required media backend or configure its executable paths in Preferences. No files will be downloaded or executed automatically.".into()
        },
        packages: plan
            .map(|p| p.packages.iter().map(|s| s.to_string()).collect())
            .unwrap_or_default(),
    }
}
#[derive(Default)]
pub struct DependencyService {
    repairing: AtomicBool,
}
struct RepairGuard<'a>(&'a AtomicBool);
impl Drop for RepairGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl DependencyService {
    pub fn status(&self, backend: &Ffmpeg) -> DependencyReport {
        let plan = current_plan().filter(|p| {
            std::path::Path::new(p.executable).is_file()
                && std::path::Path::new("/usr/bin/pkexec").is_file()
        });
        let mut report = assess(
            backend.capabilities().is_ok_and(|c| {
                ["mp4", "matroska"]
                    .iter()
                    .all(|m| c.muxers.iter().any(|v| v == m))
                    && ["mov_text", "subrip", "webvtt"]
                        .iter()
                        .all(|e| c.subtitle_encoders.iter().any(|v| v == e))
            }),
            cfg!(target_os = "linux"),
            plan,
            inspect_element,
        );
        if cfg!(target_os = "linux")
            && !["/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"]
                .iter()
                .any(|p| std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.len() > 0))
        {
            report.network_available = false;
            report
                .missing_components
                .push("System HTTPS certificate bundle".into());
        }
        report
    }
    pub fn is_repairing(&self) -> bool {
        self.repairing.load(Ordering::SeqCst)
    }
    pub fn install(&self, authorize: impl FnOnce(&InstallPlan) -> bool) -> Result<(), String> {
        self.repairing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "A component installation is already running")?;
        let _guard = RepairGuard(&self.repairing);
        let plan = current_plan()
            .ok_or("Automatic component installation is not supported on this platform")?;
        if !authorize(&plan) {
            return Err("Component installation was not authorized; no changes were made".into());
        }
        let mut child = Command::new("/usr/bin/pkexec")
            .arg(plan.executable)
            .args(&plan.arguments)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not start system authorization: {e}"))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or("Installer diagnostics unavailable")?;
        let reader = thread::spawn(move || {
            let mut tail = Vec::new();
            let mut buffer = [0; 4096];
            while let Ok(n) = stderr.read(&mut buffer) {
                if n == 0 {
                    break;
                }
                tail.extend_from_slice(&buffer[..n]);
                if tail.len() > 16384 {
                    tail.drain(..tail.len() - 16384);
                }
            }
            tail
        });
        // Do not time out or kill a package manager during a system transaction.
        let status = child
            .wait()
            .map_err(|e| format!("Could not wait for system installation: {e}"))?;
        let diagnostics = String::from_utf8_lossy(&reader.join().unwrap_or_default()).into_owned();
        if status.success() {
            Ok(())
        } else {
            Err(format!("Component installation was cancelled or failed. Source media is unchanged. Check system authorization, network access, and package-manager errors; do not remove package-manager locks manually. {diagnostics}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_inspection_uses_package_tool_without_falling_back_to_host_abi() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("usr/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let tool = bin.join("gst-inspect-1.0");
        std::fs::write(&tool, b"fixture").unwrap();
        assert_eq!(
            bundled_gstreamer_tool(Some(root.path().to_path_buf())),
            tool
        );
        assert_eq!(
            bundled_gstreamer_tool(Some(PathBuf::from("relative"))),
            PathBuf::from("/usr/bin/gst-inspect-1.0")
        );
        assert_eq!(
            bundled_gstreamer_tool(None),
            PathBuf::from("/usr/bin/gst-inspect-1.0")
        );
    }
    #[test]
    fn omarchy_uses_a_fixed_arch_package_allowlist() {
        let plan = install_plan("ID=omarchy\nID_LIKE=\"arch\"\n").unwrap();
        assert_eq!(plan.executable, "/usr/bin/pacman");
        assert!(plan.arguments.contains(&"gst-plugins-good"));
        assert!(plan.arguments.contains(&"gst-libav"));
        assert!(plan.arguments.contains(&"gst-plugin-dav1d"));
        assert!(!plan.arguments.contains(&"-Sy"));
    }
    #[test]
    fn unknown_os_and_injected_values_never_become_commands() {
        assert!(install_plan("ID=arch;rm -rf /\n").is_none());
        assert!(install_plan("ID=unknown\nID_LIKE=archlinux\n").is_none());
    }
    #[test]
    fn debian_installs_required_backends_without_removing_packages() {
        let p = install_plan("ID=ubuntu\nID_LIKE=debian\n").unwrap();
        assert_eq!(p.executable, "/usr/bin/apt-get");
        assert!(p.arguments.contains(&"--no-remove"));
        assert!(p.arguments.contains(&"gstreamer1.0-libav"));
        assert!(p.arguments.contains(&"gstreamer1.0-plugins-bad"));
    }
    #[test]
    fn missing_sink_blocks_preview_but_not_a_working_remux_backend() {
        let r = assess(true, true, install_plan("ID=arch"), |name| {
            name != "autoaudiosink"
        });
        assert!(!r.preview_available);
        assert!(r.backend_available);
        assert_eq!(r.missing_components, vec!["GStreamer: autoaudiosink"]);
        assert!(r.repair_supported);
    }
    #[test]
    fn missing_av1_decoder_is_reported_instead_of_audio_only_success() {
        let report = assess(true, true, install_plan("ID=arch"), |name| {
            !["dav1ddec", "av1dec", "avdec_av1"].contains(&name)
        });
        assert!(!report.preview_available);
        assert!(report.backend_available);
        assert_eq!(
            report.missing_components,
            vec!["GStreamer: AV1 video decoder (dav1ddec / av1dec / avdec_av1)"]
        );
    }
    #[test]
    fn supported_alternative_av1_decoders_are_accepted() {
        for decoder in ["dav1ddec", "av1dec", "avdec_av1"] {
            let report = assess(true, true, install_plan("ID=debian"), |name| {
                PREVIEW_ELEMENTS.contains(&name) || name == decoder
            });
            assert!(report.preview_available, "{decoder}");
        }
    }
    #[test]
    fn missing_inspection_tool_fails_closed() {
        let r = assess(true, true, None, |_| false);
        assert!(!r.preview_available);
        assert_eq!(r.missing_components.len(), PREVIEW_ELEMENTS.len() + 1);
    }
    #[test]
    fn non_linux_preview_does_not_require_gstreamer() {
        let r = assess(false, false, None, |_| {
            panic!("must not run GStreamer checks")
        });
        assert!(r.preview_available);
        assert!(!r.backend_available);
        assert!(!r.repair_supported);
    }
    #[test]
    fn complete_install_is_ready() {
        let r = assess(true, true, install_plan("ID=arch"), |_| true);
        assert!(r.preview_available);
        assert!(r.missing_components.is_empty());
    }
}
