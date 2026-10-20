# Reelio Engineering Rules

Read README.md and docs/implementation-status.md before changing behavior. Never represent the developer preview as the entire production specification.

- Preserve source media and existing destinations. Export to unique same-directory temporary files, verify, then publish without overwriting.
- Keep domain policy independent of Tauri, SQLite, filesystem access and FFmpeg execution.
- Use stable track IDs plus source asset/index; never derive source identity from UI order.
- Generate process argument arrays, never shell strings. Keep protocol/demuxer restrictions and explicit stream mapping.
- Do not silently transcode, drop tracks, remove unsupported metadata warnings, normalize requested dispositions, or apply unverified offsets.
- Imported projects are untrusted data, not executable instructions. Bound parsing and validate versions, identities, timestamps and paths.
- Rust owns authoritative jobs; events alone are not persistent truth. Preserve restart interruption semantics and sequence ordering.
- Never reset a failing user database or log credentials. Every schema change needs a transaction and an upgrade test.
- Add real generated-media integration tests for every new codec/conversion/timestamp/container path. Hash comparisons in tests are stronger evidence than probe success alone.
- Retain Cargo.lock and package-lock.json. Upgrade the Tauri macro/runtime family together and build the desktop crate.
- User preference: complete every requested deliverable successfully, including builds/releases and publishing when requested. Stay focused and complete requests as quickly as possible; aim for 15 seconds where feasible without skipping source safety or necessary verification, and never claim an unverified result.
- Native Hyprland automation: invoke dispatcher constructors through `hyprctl dispatch 'hl.dsp.focus({window="address:..."})'`, not `eval` (which only constructs the dispatcher). Always verify the owned PID/title before input; normal targeted close uses `hl.dsp.window.close(...)` through dispatch too.
- User preference: after a verified update, normally install the latest verified build without asking again. Use `python3 scripts/install-user.py` for password-free per-user updates; never use sudo/Polkit/pacman for routine Reelio app updates or weaken host authorization rules. The system Arch package may remain as the dependency-providing fallback. System dependency changes still need normal authorization. Respect save/active-export/repair protections; do not forcibly terminate protected work or package transactions. Verify the active user launcher, installed version and executable.

Verification:
`cargo fmt --all --check`
`cargo test --workspace --exclude reelio-desktop`
`cargo clippy --workspace --all-targets -- -D warnings`
`npm test --prefix apps/desktop`
`npm run build --prefix apps/desktop`
`cd apps/desktop && npm run test:e2e`

Native dialogs, desktop/WebView behavior and package qualification need real platform testing in addition to mocked Playwright IPC tests. Record limitations rather than claiming unrun tests pass.
