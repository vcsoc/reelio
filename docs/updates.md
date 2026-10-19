# GitHub Updates

Use **Project menu > Check for updates** in the desktop app. Checks are manual: local editing does not contact GitHub. Browser preview cannot check or download packages.

The native checker reads public releases from `vcsoc/reelio`, excludes drafts/prereleases, and compares numeric major/minor/patch versions plus Reelio's numeric package revision. It understands tags such as `v0.2.0` and legacy `v0.1.0-27`; build metadata does not change precedence. It examines every bounded release page rather than trusting creation order or lexical sorting. Invalid/non-version tags are not candidates. A locally newer build is never offered a downgrade.

“No published stable releases”, “up to date”, “newer release without a compatible package”, missing verification data, and API/network failures are separate states. An unsuccessful or incomplete check never reports up to date. Linux package selection distinguishes x86_64 Arch-family and Debian-family systems; Windows x64 and macOS x64/arm64 package names are also recognized. Other platforms require manual release review. These other native platforms have not been qualified locally.

## Downloads

A download requires a newer, version-matching platform asset and either GitHub's SHA-256 asset digest or an exact, unambiguous `SHA256SUMS` entry. Missing/invalid checksums block downloading. GitHub release checksums provide integrity, not independent publisher authentication or code signing: these are **unsigned developer-preview packages**.

The native save chooser approves the destination. Downloads stream into a private, same-directory temporary file, verify the exact published size and SHA-256, sync, and publish without overwriting. Existing destinations and publication races are refused. Normal failure/cancellation removes the temporary file. Downloads do not execute an installer or request elevation. Save work and close Reelio before separately authorizing installation through the system package manager.

Only fixed HTTPS GitHub endpoints are allowed, including checked release-asset redirects. No caller-supplied URL, token, proxy, shell command or installer command is accepted. Response errors omit signed URLs. Limits: 4 MiB metadata/page, 100 releases/page, at most ten pages (an unproven complete result fails), 128 assets/release, 256 KiB checksum files, 512 MiB packages and 64 KiB transfer buffers. API requests have a 15-second deadline; package/checksum redirect chains have a 180-second deadline. Cancel is best effort between reads and can wait for the bounded network request. Native close protection remains active during transfer. Downloads are transient, not persistent export jobs; resume and crash-orphan cleanup are not implemented. Offers expire after 15 minutes and native operations are serialized.

## Publishing

Keep Cargo, npm, npm lock root and Tauri versions consistent; use a new semantic version for application changes and a tracked numeric Arch `pkgrel`. Run `python scripts/check-release-version.py vVERSION` and `python scripts/test-release-scripts.py`. Rebuild the embedded frontend/native executable after any UI or package-revision change.

The release workflow builds unsigned Debian, Windows, macOS and Arch candidates. Manual workflow dispatch only uploads CI artifacts. An explicitly pushed version tag triggers publication after all package jobs succeed; the collector accepts only version-matching installer names and creates `SHA256SUMS`. Review before pushing/publishing. The workflow's cross-platform execution and signing are not local acceptance evidence.

At implementation time the public repository had no releases. A local package/commit is not a GitHub publication; the checker correctly reports no published stable releases until a release with suitable assets exists.
