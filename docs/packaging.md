# Packaging And Release Qualification

## Password-Free User Updates

Use `python3 scripts/install-user.py` after verifying a Linux release build, or pass an explicitly verified executable/AppImage path. It installs immutable, checksummed version slots under `~/.local/opt/reelio`, atomically switches `~/.local/bin/reelio`, and creates a per-user desktop entry. Old slots remain available for rollback; unrelated launchers/desktop entries are refused rather than overwritten. It never terminates running work, edits sudo/Polkit rules, or needs an administrator password. Close and reopen the app when safe. The system Arch package can remain as a dependency-providing fallback; system dependency changes still require normal authorization.

## AppImage

The **AppImage Release** workflow builds x86_64 AppImages on Ubuntu 22.04, checks the frontend and generated image formats, extracts and starts the actual AppImage under Xvfb/DBus, and uploads `reelio-appimage-x86_64` with SHA256SUMS. AppImages are also included in future Linux release-workflow builds. Run `gh workflow run appimage-release.yml --ref main` to produce a candidate without publishing it automatically.

For a local candidate, run `npm run tauri build -- --bundles appimage` in `apps/desktop`; output is under `target/release/bundle/appimage`. Verify SHA256SUMS, mark the downloaded AppImage executable and run it as a normal user. If FUSE is unavailable, use `--appimage-extract-and-run`. The AppImage bundles GStreamer plugins and a matching inspection tool, with third-party notices/source-package provenance. FFmpeg/FFprobe executables remain external and run against the host's libraries rather than the AppImage library path. A cold plugin registry gets a bounded startup allowance. Smoke acceptance requires a working backend, working playback components and exactly zero missing components; merely keeping the GUI alive is not sufficient. Broader cross-distribution playback is not qualified by startup tests alone. Packages remain unsigned developer previews.

## Arch / Omarchy Package

From the repository root:

```sh
./scripts/package-arch.sh
```

This builds the release application, stages checksummed local artifacts, and runs `makepkg` without sudo or dependency installation. Build prerequisites include the normal Tauri toolchain, `makepkg`, Python 3, and `desktop-file-validate`. To package an already verified release executable without rebuilding, use `./scripts/package-arch.sh --reuse-build`. A manual Cargo production build must enable the embedded frontend: `cargo build --locked --release -p reelio-desktop --features tauri/custom-protocol`; a bare Cargo release build can still use Tauri's development URL and is not an acceptable installed candidate.

Output: `target/release/bundle/arch/reelio-0.2.0-3-x86_64.pkg.tar.zst` (unsigned developer-preview candidate; installation is separate from build verification).

About Reelio stamps Cargo's version plus the tracked numeric package revision (`0.2.0-3`). Rebuild the native executable after changing `pkgrel`; `--reuse-build` is only for that matching build. The optional Linux About homepage action uses the desktop's `/usr/bin/xdg-open` (`xdg-utils`); absence/failure is shown in the dialog rather than silently navigating the editor. Windows/macOS browser launchers are implemented but not qualified by the Linux package checks.

Install the verified built executable for this user when ready:

```sh
python3 scripts/install-user.py
```

Routine app updates use this password-free path. Installing a system package or changing its dependencies is a separate, explicitly authorized administrative operation.

The package includes `/usr/bin/reelio`, an application-menu entry, an icon and the MIT license. It declares FFmpeg, GTK/WebKitGTK, GStreamer/base/good/libav plus `gst-plugin-dav1d` for AV1 decoding, CA certificates and Polkit as required dependencies. Playback plugins are not optional: missing `autoaudiosink` previously caused a WebKit renderer abort. Preview is now gated on runtime checks, and supported Linux hosts offer an explicitly authorized fixed-allowlist component repair. It does not bundle FFmpeg or run custom privileged install scripts. This is an unsigned developer-preview package for x86_64 Arch-based systems. The earlier Pigeon-styled package and playback-dependency fix have been installed on this Omarchy host. The artwork/subtitle `0.1.0-3` update also passed archive checks, native startup/IPC, authorized installation and installed-file verification; see testing.md. Save open work before closing and reopening an already running instance after upgrade.

## Tauri Bundle Builds

```sh
cd apps/desktop
npm ci
npm run tauri build -- --bundles deb   # Linux Debian candidate
npm run tauri build -- --bundles nsis  # On Windows
npm run tauri build -- --bundles dmg   # On macOS
```

Artifacts are under the workspace's `target/release/bundle/`. The Linux executable is `target/release/reelio-desktop`. Build Linux release candidates on the oldest supported distribution: a `.deb` assembled on a newer/non-Debian development host is only a packaging check, not proof of ABI compatibility with older Debian/Ubuntu systems. Do not execute a foreign-platform build command on Linux and infer that the target platform works. The dedicated Windows Release workflow has now produced and inspected an unsigned x64 NSIS installer on a native Windows runner; see testing.md for its run, checksum and remaining CI/runtime gaps. The all-platform publishing workflow and macOS native package remain unqualified.

FFmpeg/FFprobe are external system dependencies. The `.deb` is not a bundled media backend distribution. The Arch package declares the system media/playback/certificate packages as mandatory dependencies; pacman resolves them during installation. Debian bundle metadata declares the corresponding FFmpeg, GStreamer, certificate and authorization packages. Supported Arch-family and Debian/Ubuntu hosts also offer native-confirmed repair through the system package manager. Other platform bundles do not yet provide a qualified backend-install guarantee; Windows/macOS backend bundling and native acceptance remain release work. For source builds or custom backends, use a maintained trusted distribution and configure absolute paths in Preferences if needed. No package asks for elevated media-processing privileges or promises that a particular codec build is legally redistributable.

## Windows x64 Installer

The manually dispatched **Windows Release** workflow (`windows-release.yml`) builds an unsigned NSIS installer on Windows Server 2022 with the MSVC x64 target. It checks version consistency, frontend tests, executable PE architecture/product version, then uploads the installer and `SHA256SUMS` as `reelio-windows-x64` (90-day CI artifact retention). Run with `gh workflow run windows-release.yml --ref main`. This does not push a release tag or publish a GitHub release.

The installer is not Authenticode signed; Windows may show an unknown-publisher warning. WebView2 is managed by Tauri's installer; FFmpeg/FFprobe remain external requirements. Building and inspecting the Windows executable does not qualify interactive installer, playback or editing behavior on a Windows desktop.

## GitHub Release Updates

The desktop Project menu provides a manual stable-release checker and verified package downloads; it never installs automatically. See [updates](updates.md) for version comparison, platform selection, transfer limits and checksum/signing distinctions. `scripts/check-release-version.py` rejects mismatched version files/tags; `scripts/collect-release-assets.py` produces version-matching packages plus SHA256SUMS without clobbering. Manual release-workflow dispatch uploads candidates; an explicitly pushed version tag publishes only after all package jobs pass. This workflow has not been qualified on every platform locally.

## Required Manual Native Acceptance

Use synthetic media first; retain source hashes and backups.

- Launch from an installed package, not only the development server; verify backend discovery and settings persistence.
- Open multiple media files, add external audio/subtitles, drop files from the native file manager, and import a folder containing subdirectories. Confirm no recursive scan occurs.
- Try unreadable/corrupt sources, missing/relinked project sources, duplicate paths, Unicode names, spaces and shell metacharacters.
- Inspect tracks and original metadata; reorder tracks and verify actual exported stream order. Test one default track per type and both forced/commentary/accessibility flags.
- Edit supported metadata/chapters, undo/redo, save/open the project, and confirm unchanged source hashes.
- Export MKV and MP4/M4V, approve subtitle conversion, probe the result, play it with independent players and compare stream hashes where possible.
- Cancel while processing and during verification. Confirm no final destination and no normal-operation temporary files remain.
- Create a destination while FFmpeg is running. Confirm finalization refuses to overwrite it.
- Test disk full, read-only directory, disconnected source, permission changes, source changes during processing and unexpected app termination. Inspect interrupted jobs and orphan temporary files before retrying.
- Verify single-instance behavior, active-job close protection, restarts, high-DPI scaling, system/light/dark appearance, keyboard-only controls and screen-reader announcements.

## Release Blockers

Complete the unimplemented product scope as required by the release contract. Run generated-media tests on Windows/macOS/Linux, qualify codecs and metadata adapters, review dependencies and licenses, establish private vulnerability reporting, and add signing/notarization. Production releases need a documented update strategy and rollback/recovery policy. A successfully built unsigned candidate is not a production release.
