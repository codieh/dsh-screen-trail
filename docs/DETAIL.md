![Screen images become an activity timeline](preview.svg)

## Capture

A persistent macOS ScreenCaptureKit stream samples the primary display at a configurable interval, defaulting to once every five seconds. Enter a positive integer number of seconds in Sampling Interval; Enter or blur saves it across restarts. Changing it rebuilds capture without cancelling analysis. Idle messages extend presence without re-encoding images. There is no OCR, accessibility-body extraction, DOM parsing, input monitoring, audio or all-day video recording. Only application/window identity is read.

Simple RGB filtering removes near-duplicate candidates. JPEG files share SHA-256 content IDs, but A-to-B-to-A remains three raw occurrences. Every five minutes, up to twenty representative frames are selected by time alone: retain the first and last, then choose the nearest unselected candidate to each evenly spaced target between them, breaking ties toward the earlier candidate. Send all candidates when within budget and preserve chronological order. The budget scales with the configured interval from six to twenty. Identical images upload once.

Each batch adds representative images, image numbers, readable Asia/Taipei dates and window metadata to the native Harness conversation. Window metadata excludes bundleId. Stored times are milliseconds. The model can query historical events through the business tools.

The prompt asks for a useful journal of the user's activities. The model chooses what to keep, continue, merge or omit, including an empty batch. Observation times describe screen visibility; activity descriptions use screenshot and conversation evidence. New events require a title, summary and image references. Goals, progress, details and tags are optional.

Use write_events with create/update/merge/delete actions and real IDs from tool results or find_events. mergeIds names the other events to consolidate. Screenshot numbers remain local to the batch. Existing descriptions can be updated without new images. The model decides whether returning to earlier work continues an event and uses the tools to update or merge its phases.

Unused candidates are removed after successful analysis, and unreferenced local JPEGs are collected. Failed batches retain evidence for manual retry. The model can use some images or acknowledge a batch with no event changes. Invalid IDs, missing labels/summaries and invalid merge/cover contracts produce explicit errors.

The main list shows goals with expandable phase details and evidence. The model picks a meaningful main cover or keeps the old cover for supporting work. Capture Evidence shows pending/failed candidates and retained assigned observations. Analyse Now can run early on queued images; it does not capture the recorder page.

## Self-Surface Exclusion

The visible panel marks its window title with `[dsh-screen-trail]`; hiding or unmounting removes the marker. Native capture excludes a focused marked window before encoding and persistence. Ordinary Harness chat remains eligible. Start observing, then switch to another window.

## Screen Sleep and Wake

Screen sleep, system sleep or loss of a capture source pauses capture while retaining the helper, existing data and analysis. The UI shows a waiting state. About one second after the display wakes, the controller restarts the helper once to obtain a fresh primary display and stream. Background system wakes do not trigger recording; duplicate display-wake notifications do not start multiple helpers.

Manual pause cancels pending recovery. Failed recovery, user-stopped sharing, permission errors and other capture failures produce explicit errors with native domain/code diagnostics. Users can retry after resolving the error.

## Native Analysis Conversations

Each batch is submitted through a native Harness Agent conversation. Harness streams and persists the input, model replies, tool calls and results. Events are saved through business tools. Conversations belong to a dedicated 屏幕纪事 group. Tool execution follows the host's presets, approvals and security policies.

The native Workspace registry creates or reuses the group for `~/.dsh/screen-trail`. New analysis sessions are created there and attached to the group. User-renamed group titles are preserved. Registration or attachment failures produce explicit errors.

Reuse the current conversation until eight hours have elapsed since its latest user or assistant message. Only the next analysis opens a new conversation; midnight alone does not rotate it. Manual messages reset the gap, title/config events do not. Persist the association across restarts, retain old conversations, and keep empty event replies visible. Missing, busy or failed native conversations produce explicit errors rather than invisible direct-model fallbacks. Clearing recorder data does not remove host conversations or reset the association.

Harness manages conversation history, context compaction and total model input.

## Harness-Owned Context

Native Harness Agents provide conversation history. Automatic compaction and image-history handling follow the host's presets and configuration.

New conversations mount the host's default Agent preset before submitting analysis and save its ID. Resuming a conversation uses its latest saved preset selection.

Unresolvable presets, mount failures, missing compaction or disabled automatic compaction stop analysis, preserve pending evidence and display the error. The host runs automatic compaction, image-history handling and overflow recovery. Background summaries can make additional model calls; the panel's request counter counts main analysis requests.

Two global native tools are available to every DSH conversation subject to host permissions: `screen_trail_find_events` queries compact records by keywords, date range or IDs (ten by default), optionally returning cover images or stored evidence IDs. `screen_trail_write_events` creates, updates, merges or deletes, returning real IDs and actions. Analysis uses current image numbers; ordinary chat can attach stored screenshots through evidenceIds. Existing IDs stay stable and unspecified update fields are preserved; new events require screenshot evidence.

Each call reads only the affected events, validates on a copy and commits events, evidence relations and batch status in one serialized SQLite transaction before returning saved IDs. Replaying the same tool call reuses its receipt; new calls in the same turn may make further edits. The plugin does not call concludeTurn(): the model receives the result and can inspect, edit again or reply normally, potentially making additional model requests. Later model/chat-persistence failures are reported separately and cannot undo or requeue committed events.

Tools, capture and UI share the plugin service and journal.sqlite. Tool execution follows DSH's presets, approvals and security policies. Both analysis and ordinary chat can continue after saving events. Candidates remain available until the turn finishes, so later edits can use their images; unused candidates are reclaimed at the end of a committed turn. Failed uncommitted batches retain evidence. New conversations can query historical events through the business tools. Editing an event's text preserves the original screenshots.

## Permissions

Node.js 24 or newer is required for built-in node:sqlite. The first launch compiles the helper using a local Swift compiler and caches it under `~/.dsh/screen-trail/native/`. Grant Screen Recording to DeepSeek Harness or the helper named by macOS. Accessibility and Input Monitoring are not required. Compilation, permission and native protocol failures are displayed. A database server, Screenpipe and FFmpeg are not dependencies.

## Storage and Backpressure

`~/.dsh/screen-trail/journal.sqlite` has four tables: events, observations, event_observations and settings. Times remain milliseconds. Schema version is PRAGMA user_version=1; foreign keys, WAL and transactions are enabled. The database is created with mode 0600. Shared JPEGs remain under shots/ rather than becoming database blobs.

Formal events are retained long-term. The temporary observation pool defaults to 80 processed observations; referenced evidence survives leaving that pool, and pending observations have a separate capacity. Each event keeps at most twelve evidence frames: its first, chosen cover and recent evidence. Reference changes commit before unused images are collected. Database initialization and write failures produce explicit errors.

## Date Tabs and Pagination

The panel defaults to today and displays seven horizontal date tabs, previous/next-day controls and a date picker. Dates use Asia/Taipei, not the machine timezone. Empty dates remain selected and show an empty state. Events are sorted by start time descending, thirty per page, with Load More. Cross-midnight events belong only to their start date, with the full end date shown on the card. Details, cover/evidence previews and deletion remain available; temporary observations stay in a separate collapsible section.

GET /screen-trail/api/state returns status, total count, eventsRevision and bounded temporary observations, not full event history. GET /screen-trail/api/events?date=YYYY-MM-DD&limit=30&cursor=... uses stable keyset pagination. Event changes refresh the already loaded pages without resetting the selected date, expanded card or scroll position. Date switches cancel obsolete requests. Changes between page requests surface an explicit retry message rather than mixing inconsistent snapshots.

## Queue and Cleanup

Only one frame is processed and one stream frame may wait; superseded waiting frames are counted and logged. Pending capacity is the ceiling of (analysis window plus ninety-second timeout) divided by the sampling interval, and is never smaller than history retention. At the five-second default, capacity is 80 with a 74-frame resume watermark. Capture pauses at capacity while analysis drains. User pause stops both; Analyse Now can process remaining candidates. Clearing removes plugin-owned data, preserving helper binaries and configuration. Host-managed attachments have independent retention; local collection does not delete those copies.

The latest 50 diagnostics under `~/.dsh/screen-trail/diagnostics/` contain request/session IDs, batch/selected observation IDs, event receipts, tool calls, model controls, finish reason and usage. `contextOwner: harness` identifies context ownership; `agentPreset`, `compactionAvailable` and `compactionAuto` record the preset and compaction configuration. `contextBefore`/`contextAfter` are native Token Meter measurements before and after the turn; the former excludes the new batch input. `compactions` records actual compaction stages, measurements and errors without summary text.

Diagnostics store the plugin prompt, textual metadata for the batch's representative images and the raw reply. Harness records the full conversation history, system context and request. Private input/replies stay in restricted local files, not polling state or ordinary logs. Window titles can contain private information; review diagnostic files before sharing them. Diagnostics do not duplicate API keys, full reasoning text or extra screenshots. Ordinary logs mark key stages with `[screen-trail]`. Max-token finishes, missing finish events and invalid tool-argument JSON produce errors; failed batches retain evidence for manual retry.

Defaults: `sampleIntervalSec: 5`, `analysisWindowSec: 300`, `analysisMaxTokens: 16384`, `analysisReasoningEffort: low`, `maxDimension: 1600`, `retention: 80`, `autoStart: false`. The bundle requests low reasoning; an unsupported effort produces an error. Sampling and analysis intervals are independent, and saved UI choices take precedence over initial configuration. Optional controls include provider, model and locale.

The panel provides model and reasoning selectors with explicit Save. Models come from DSH's active providers and reasoning choices from the selected model's metadata; declared text-only models are excluded. Host-model following and model-default reasoning are available. Unsupported reasoning is shown rather than silently replaced. Sampling, analysis-window and model settings persist in SQLite, override initial plugin config, and affect subsequent work without interrupting the running analysis or changing DSH's global defaults. Refresh reloads metadata; errors remain visible. No generation is performed by configuration endpoints.

Run `npm test`. Tests use simulated screens and model responses to cover sampling, selection, event tools, SQLite transactions, date paging, resource cleanup and host-session interfaces. They do not call cloud models or record the screen.

## CI

Pushes, pull requests and manual dispatch run one Node.js 24 / Apple Silicon macOS 15 job: unit/package checks, Swift compilation, native no-capture self-tests, then an installable package artifact. Failures block later steps; reports upload on test failure.
