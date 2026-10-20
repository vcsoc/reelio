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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **reelio** (2377 symbols, 6066 relationships, 203 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/reelio/context` | Codebase overview, check index freshness |
| `gitnexus://repo/reelio/clusters` | All functional areas |
| `gitnexus://repo/reelio/processes` | All execution flows |
| `gitnexus://repo/reelio/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
