# Contributing

Use the development prerequisites and test commands in README.md. Keep changes scoped and include domain and generated-media regression tests for processing changes. Use synthetic fixtures instead of private or copyrighted media. A backend operation is not complete until a real output has been reopened and verified.

Discuss compatibility, timestamp, metadata-loss and overwrite policy changes before implementation. Never bypass a safety check to make a fixture appear to pass; expose a genuine unsupported case and test the error path. Do not check secrets, user databases, videos, build artifacts or credential-bearing diagnostics into the repository.

Run formatting, strict Clippy, Rust tests, frontend build, Vitest and Playwright before proposing a change. Document the platforms and native UI checks actually run. Consult AGENTS.md for architectural rules and docs/implementation-status.md for outstanding milestones.
