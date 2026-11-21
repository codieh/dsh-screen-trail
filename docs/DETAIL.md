![Screen images become an activity timeline](preview.svg)

## Simplified Capture (0.5.6)

A persistent macOS ScreenCaptureKit stream observes the primary display at up to 2 fps. Idle messages extend presence without re-encoding images. There is no OCR, accessibility-body extraction, DOM parsing, input monitoring, audio or all-day video recording. Only application/window identity is read.

Simple RGB filtering removes near-duplicate candidates. JPEG files share SHA-256 content IDs, but A-to-B-to-A remains three raw occurrences. Every five minutes, up to twenty representative frames are selected across time buckets, retaining the first and last. Within a bucket, new image/window resources, manual evidence, context boundaries and stable frames are preferred. The budget scales with the configured interval from six to twenty. Identical images upload once.

The model receives a compact timeline of ALL batch observations and numbered representative images inside its native Harness conversation. Adjacent identical contexts share a heading; only overlapping/touching visibility intervals merge. Missing periods stay missing. One static screenshot can carry sustained recorded visibility; a single sample does not establish an exact visit duration. Timeline segments without images provide metadata only, not unseen visual content.

The prompt asks for a useful journal rather than a page-by-page browsing history. The model chooses what to keep, continue, merge or omit, including an empty batch. There are no classification labels, scores, duration gates or extra interpretation calls. Visibility does not establish attention, reading, understanding or completion. Capture, selection budgets, stored history and UI are unchanged. Goals, progress, details and tags are optional; text arrays are no longer silently reduced to three details or five tags.

Use a stable saved event ID in `task` to update an event and stable IDs in `mergeTasks` to consolidate phases. `null` (also accepts `0`) means new. Temporary per-batch event numbers are no longer accepted; screenshot numbers remain local to the batch. Existing descriptions can be updated without new images. Retained IDs and positions remain stable. There is no implicit same-label/window merge, deferred pool, undo or startup bulk rewrite.

Unused candidates are removed after successful analysis; the program does not add its own value filter. Unreferenced local JPEGs are collected; shared evidence survives. Partial image assignments and empty arrays are allowed. Invalid IDs, missing labels/summaries and invalid merge/cover contracts fail visibly, retaining evidence rather than treating protocol errors as deliberate omission.

The main list shows goals with expandable phase details and evidence. The model picks a meaningful main cover or keeps the old cover for supporting work. Capture Evidence shows pending/failed candidates and retained assigned observations. Analyse Now can run early on queued images; it does not capture the recorder page.

## Self-Surface Exclusion

The visible panel marks its window title with `[dsh-screen-trail]`; hiding or unmounting removes the marker. Native capture excludes a focused marked window before encoding and persistence. Ordinary Harness chat remains eligible. Start observing, then switch to another window.

## Screen Sleep and Wake

Screen sleep, system sleep or loss of a capture source pauses capture while retaining the helper, existing data and analysis. The UI shows a waiting state. About one second after the display wakes, the controller restarts the helper once to obtain a fresh primary display and stream. Background system wakes do not trigger recording; duplicate display-wake notifications do not start multiple helpers.

Manual pause cancels pending recovery. Failed recovery, user-stopped sharing, permission errors and other capture failures remain explicit errors with native domain/code diagnostics. There is no retry loop, capture fallback or dedicated monitor-hotplug handling. Mock lifecycle tests and the helper's `--self-test-screen-events` exercise the notification path without actually sleeping the display, capturing pixels or requesting Screen Recording permission. Real sleep/wake still requires device verification.

## Native Analysis Conversations

Each batch is submitted through a real Harness Agent conversation. Harness streams and persists the actual input/reply before the existing event parser processes the result. Conversations belong to a dedicated 屏幕纪事 group. There is no mirrored second model request and analysis gains no execution-tool permissions.

The native Workspace registry creates or reuses the group for the plugin's existing `~/.dsh/screen-trail` directory. New analysis sessions are created there and explicitly attached. Shared profile directories and unrelated conversations are not grouped, and user-renamed group titles are preserved. Registration or attachment failures remain explicit errors rather than ungrouped fallbacks.

For legacy sessions created elsewhere, the next analysis opens a fresh conversation in the dedicated group, as requested. Old conversations stay where they were: no moving, copying, archiving, deleting or header rewriting. Saved journal events remain untouched. Existing output-state inputs still work, but old chat history is not copied into the new conversation. The normal eight-hour reuse policy applies within the dedicated group.

Reuse the current conversation until eight hours have elapsed since its latest user or assistant message. Only the next analysis opens a new conversation; midnight alone does not rotate it. Manual messages reset the gap, title/config events do not. Persist the association across restarts, retain old conversations, and keep empty event replies visible. Missing, busy or failed native conversations produce explicit errors rather than invisible direct-model fallbacks. Clearing recorder data does not remove host conversations or reset the association.

The per-batch image budget is unchanged. Conversation history, native compaction and total model context follow Harness's standard behavior; the batch image limit is not a lifetime history limit.

## Harness-Owned Context

There is no recent-eight selector, exact-image return lookup, twelve-candidate history cap or plugin summarizer/retrieval flow. Native Harness history and its enabled compaction/image-handling components own conversational context. The installed base bundle includes those components; host overrides remain authoritative and the plugin does not replace a disabled backend.

`Saved activities state` contains ALL currently retained output records as ID, timestamps, label and summary. This is current business state, not curated memory or confirmed user intent. It makes saved records addressable after host compaction or a new conversation, reflects removals/merges, and prevents stale IDs from editing nonexistent outputs. New batches do not manually replay the full chat history. The eight-hour rotation policy is unchanged and stored event IDs need no migration.

## Permissions

The first launch compiles the helper using a local Swift compiler and caches it under `~/.dsh/screen-trail/native/`. Grant Screen Recording to DeepSeek Harness or the helper named by macOS. Accessibility and Input Monitoring are not required. Failures are visible; there is no silent switch to the old capture mode. Screenpipe and FFmpeg are not dependencies.

## Storage and Backpressure

Version-four `state.json` separates raw observations and activities. Existing history migrates without clearing. Shared JPEGs live under `shots/`. By default, 80 processed raw observations and 80 activities are retained. Pending observations have a separate capacity. Each activity keeps at most twelve evidence frames: its first, chosen cover and recent evidence. Referenced images survive observation pruning.

Only one frame is processed and one stream frame may wait; superseded waiting frames are counted and logged. Pending capacity covers the maximum frame rate over one analysis window plus the ninety-second request timeout, and is never smaller than history retention. Defaults are 780 pending frames and a 774-frame resume watermark. Capture pauses at capacity while analysis drains. User pause stops both; Analyse Now can process remaining candidates. Clearing removes plugin-owned data, preserving helper binaries and configuration. Host-managed attachments have independent retention; local collection does not delete those copies.

The latest 50 diagnostics preserve native session/batch/selected/saved-event IDs, decisions, model controls, finish reason and usage, plus the plugin's prompt, new batch state and raw reply. `contextOwner: harness` states ownership; `compactionAvailable` only reports a bound host service, not proof that compression ran or its configuration succeeded. Harness's canonical conversation owns the full native request/history. Private batch input/replies stay in restricted local files, not polling state or ordinary logs. No extra image copies, credentials or full reasoning text are duplicated. Protocol errors are not repaired or automatically retried by this plugin.

Defaults: `analysisWindowSec: 300`, `analysisMaxTokens: 16384`, `maxDimension: 1600`, `retention: 80`, `autoStart: false`. Old event-trigger timing settings are retired with a migration log. Optional model controls remain supported.

Run `npm test`. Tests inject frames, storage and responses, including a host-provided compacted-history contract fixture; they do not perform real model compaction or prove judgment accuracy. Evaluate real blank pages, brief PDF appearances, sustained static viewing and short important results separately. Actual recording and model quality require authorised verification.
