![Screen images become an activity timeline](preview.svg)

## Simplified Capture (0.5.2)

A persistent macOS ScreenCaptureKit stream observes the primary display at up to 2 fps. Idle messages extend presence without re-encoding images. There is no OCR, accessibility-body extraction, DOM parsing, input monitoring, audio or all-day video recording. Only application/window identity is read.

Simple RGB filtering removes near-duplicate candidates. JPEG files share SHA-256 content IDs, but A-to-B-to-A remains three raw occurrences. Every five minutes, up to twenty representative frames are selected across time buckets, retaining the first and last. Within a bucket, new image/window resources, manual evidence, context boundaries and stable frames are preferred. The budget scales with the configured interval from six to twenty. Identical images upload once.

The model sees a compact timeline of ALL batch observations, numbered representative images and recent activities. Adjacent identical contexts share a heading; only overlapping/touching visibility intervals merge. Missing periods stay missing. One static screenshot can carry sustained recorded visibility; a single sample does not establish an exact visit duration. Timeline segments without images provide metadata only, not unseen visual content.

The shorter prompt asks for a useful activity journal rather than a page-by-page browsing history. The same model call chooses what to keep, continue, merge or omit, including an empty batch. There are no new classification labels, scores, duration gates or extra model calls. Visibility does not establish attention, reading, understanding or completion; recent summaries are previous model interpretations rather than confirmed intent. Capture, selection budgets, event format, storage and UI remain unchanged.

Use `task` to continue an existing goal and `mergeTasks` to consolidate its previously split phases, with an updated whole-goal summary. The retained activity keeps its ID and position. The old same-label/same-window implicit merge is removed. There is no deferred assignment pool, undo or extra review workflow, and startup does not bulk-rewrite history.

Candidates not selected by the model are removed after successful analysis; the program does not add its own value filter. Unreferenced local JPEGs are collected; shared evidence survives. Missing image assignments and empty activity arrays are allowed. Failed batches retain raw evidence for explicit retry. Missing activity arrays/goals and invalid merge/cover contracts fail visibly.

The main list shows goals with expandable phase details and evidence. The model picks a meaningful main cover or keeps the old cover for supporting work. Capture Evidence shows pending/failed candidates and retained assigned observations. Analyse Now can run early on queued images; it does not capture the recorder page.

## Self-Surface Exclusion

The visible panel marks its window title with `[dsh-screen-trail]`; hiding or unmounting removes the marker. Native capture excludes a focused marked window before encoding and persistence. Ordinary Harness chat remains eligible. Start observing, then switch to another window.

## Screen Sleep and Wake

Screen sleep, system sleep or loss of a capture source pauses capture while retaining the helper, existing data and analysis. The UI shows a waiting state. About one second after the display wakes, the controller restarts the helper once to obtain a fresh primary display and stream. Background system wakes do not trigger recording; duplicate display-wake notifications do not start multiple helpers.

Manual pause cancels pending recovery. Failed recovery, user-stopped sharing, permission errors and other capture failures remain explicit errors with native domain/code diagnostics. There is no retry loop, capture fallback or dedicated monitor-hotplug handling. Mock lifecycle tests and the helper's `--self-test-screen-events` exercise the notification path without actually sleeping the display, capturing pixels or requesting Screen Recording permission. Real sleep/wake still requires device verification.

## Permissions

The first launch compiles the helper using a local Swift compiler and caches it under `~/.dsh/screen-trail/native/`. Grant Screen Recording to DeepSeek Harness or the helper named by macOS. Accessibility and Input Monitoring are not required. Failures are visible; there is no silent switch to the old capture mode. Screenpipe and FFmpeg are not dependencies.

## Storage and Backpressure

Version-four `state.json` separates raw observations and activities. Existing history migrates without clearing. Shared JPEGs live under `shots/`. By default, 80 processed raw observations and 80 activities are retained. Pending observations have a separate capacity. Each activity keeps at most twelve evidence frames: its first, chosen cover and recent evidence. Referenced images survive observation pruning.

Only one frame is processed and one stream frame may wait; superseded waiting frames are counted and logged. Pending capacity covers the maximum frame rate over one analysis window plus the ninety-second request timeout, and is never smaller than history retention. Defaults are 780 pending frames and a 774-frame resume watermark. Capture pauses at capacity while analysis drains. User pause stops both; Analyse Now can process remaining candidates. Clearing removes plugin-owned data, preserving helper binaries and configuration. Host-managed attachments have independent retention; local collection does not delete those copies.

The latest 50 diagnostics preserve batch/selected IDs, recent task mappings, goal/merge decisions, model controls, finish reason and usage, plus the actual system prompt, timeline input and raw text reply for both success and failure. Full input/replies remain in restricted local diagnostic files, not polling state or ordinary logs; window titles may still be private. No extra image copies, credentials or full reasoning text are logged. Truncation, missing finish and invalid JSON are errors, not repaired or automatically retried.

Defaults: `analysisWindowSec: 300`, `analysisMaxTokens: 16384`, `maxDimension: 1600`, `retention: 80`, `autoStart: false`. Old event-trigger timing settings are retired with a migration log. Optional model controls remain supported.

Run `npm test`. Tests use injected frames, storage and responses; successful context/cleanup tests are not evidence of model judgment accuracy. Evaluate real blank pages, brief PDF appearances, sustained static viewing and short important results separately. Actual recording and cloud-model quality require authorised verification.
