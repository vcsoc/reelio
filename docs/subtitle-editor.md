# SRT Editor (0.2.0-2 Developer Preview)

Open **Project menu > SRT subtitle editor**, or **Subtitles > Create / edit / translate SRT**. No video is required to create or edit a document.

- Open UTF-8 SRT files, create cues, edit text and millisecond timing, capture video playhead boundaries, split at the text cursor, merge, sort, shift selected/all cues, and perform literal case-sensitive replacements.
- The editor has its own 40-step undo/redo history. Ctrl/Cmd+S saves a new copy; Ctrl/Cmd+Z and Shift+Z undo/redo. Validation reports overlaps, empty text, long lines and reading speed.
- **Save SRT copy** uses a native chooser and refuses existing destinations. Originals are never overwritten. **Add saved SRT to project** explicitly imports the copy; inspect its language/title and normal export settings afterward.
- Limits: UTF-8 SubRip, 4 MiB, 10,000 cues, 16 KiB per cue, timestamps through 99:59:59,999. Invalid intervals and blank-line cue bodies block final saving; incomplete drafts remain editable/recoverable. Preview is source-based, not a rendering of project trims or subtitle styling.

## Local Translation

Ollama must already be running at `http://127.0.0.1:11434`. It is optional; manual editing does not require it. Reelio does not install or reconfigure the service, gateway, credentials or default models.

1. Refresh local models; choose `gemma3:4b`, `qwen3.5:2b` or `qwen3.5:4b`.
2. Download missing weights through **Download model plugin**, with native approval. Weights can require several GB; publisher license terms apply. Refreshing an installed tag may update that selected model. Other model tags are not removed. Cancel stops Reelio's request; Ollama may retain or finish cached downloads.
3. Enter the target language and approve translation. Cue IDs/text go only to the fixed loopback service, without HTTP proxies or redirects. Use a trusted service configured for local inference, not a cloud proxy. Video files and cue timestamps are not sent.
4. Review original/translated text side by side, select results and explicitly apply. Timing and cue identity remain unchanged. Applying is one undoable edit; save a new SRT copy afterward. Partial validated results remain reviewable after failure/cancellation/restart. Restoring a different source snapshot requires confirmation.

Translation uses batches of at most four cues and 6,000 UTF-8 text bytes; split larger individual cues first. Quality and markup preservation require human review. This is translation, not speech recognition, OCR, automatic release/FPS matching or a style-perfect subtitle renderer.

## Recovery And Qualification

Private application-data `subtitles/draft.json` stores the draft; `job.json` retains the latest translation source/results for review. These are local plaintext recovery records, separate from project SQLite data. Native close protection covers dirty subtitle work and active model jobs. Corrupt model records are preserved and block new model operations rather than being reset; manual SRT editing remains available.

Verified locally: 15 subtitle Rust tests, nine desktop library tests, 87 frontend unit tests, six desktop/mobile editor browser tests, production frontend build and workspace Clippy. An explicit synthetic live test with the already installed `gemma3:4b` translated `Hello 0` to `Bonjour 0`, preserving cue IDs/timing. Qwen inference, actual multi-GB weight downloads and Windows/macOS interactive acceptance are not qualified. The Linux 0.2.0-2 package is built and installed locally. Windows installer builds are separately verified by CI; interactive Windows/macOS acceptance remains open.
