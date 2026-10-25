# Architecture

## Boundaries

```text
React responsive UI
  ├─ domain.ts         versioned schemas, endpoint normalization, context assembly
  ├─ migration.ts      the only legacy-format boundary
  ├─ store.ts          single writer, IndexedDB transactions, checkpoints and restore points
  ├─ operations.ts     workspace-operation/model-run mutual exclusion
  ├─ api.ts            per-conversation generation lifecycle and cancellation
  ├─ sync.ts           explicit secret-Gist backup, no credentials in uploaded payload
  └─ components/       navigation, composer, messages, settings, conversation details
          │
          │ same-origin POST, no server-side conversation database
          ▼
Node HTTP gateway
  ├─ server/index.mjs     schema validation, admission, static whitelist, stream adaptation
  └─ server/security.mjs  origin/host, DNS-bound public address checks, redaction
          │
          ▼
User-configured public HTTPS provider
```

React/TypeScript/Vite are build-time choices. The deployed service needs Node plus production dependencies and `dist/`; it does not run a dev server or Python compatibility wrapper.

## Storage and ownership

`chatbutte-v2` IndexedDB contains an object store `workspace`:

- `current`: version-2 workspace, including full attachment payloads.
- `backup`: previous successfully saved workspace.
- `restore-point`: workspace preceding the last explicit import/reset/remote replacement.
- `legacy-original`: untouched raw legacy primary/backup strings, when migrated.
- `writer-lease`: transactional fallback lease for browsers without Web Locks.

Acquire the write lock **before** migration/repair. Other tabs read a snapshot and cannot generate or modify it. Web Locks are preferred; the fallback uses an expiring transactionally claimed lease checked again during writes. A restored bfcache page reloads and reacquires ownership.

Normal updates debounce 250 ms with a 1.5-second maximum wait. The save queue has a shared promise, retains failed pending data, and does not acknowledge explicit replacement until the transaction commits. Lifecycle flush is best effort, not a guarantee against process/OS failure. Provider requests start after the initial user message has been saved. Completion/cancellation schedules an immediate terminal checkpoint.

Invalid initialization enters recovery mode without writing an empty workspace over the original. Explicit validated import is still available. Replacement is atomic and mutually exclusive with model runs. Sensitive credentials omitted from a safe backup can retain matching local model keys; explicit reset does not retain credentials.

## Generation

Each conversation owns an AbortController. Up to three client runs and six admitted gateway requests are allowed simultaneously. Message status is `streaming`, `complete`, `stopped`, or `error`; partial output remains visible. Model runs are never automatically retried.

Gateway events are application-level SSE:

```json
{"type":"delta","content":"…","reasoning":"…"}
{"type":"done","reason":"stop"}
{"type":"error","message":"…"}
```

The shared incremental SSE parser handles arbitrary UTF-8 boundaries, LF/CRLF, comments, multiline data and an EOF tail. A stream without a terminal event is an error. Gateway JSON fallback produces the same event vocabulary. Backpressure waits terminate on drain, close, error or abort.

Reasoning controls are explicit: default adds nothing; other modes use exactly one selected parameter family. The optional temperature field can be disabled for strict models. Context assembly excludes errors, honors the last divider, retains 0-valued parameters and keeps the current user message even when history is disabled.

## UI and performance

One layout tree; no legacy skins, DOM relocation or duplicate composer. The composer consumes layout space rather than covering the reader. Mobile uses a focus-managed drawer and native full-screen dialogs. Native dialogs contain keyboard focus and restore the previous focus on close.

Settings/message Markdown modules load on demand. Stable message bodies are memoized; long histories start with the newest 80 messages and can load earlier batches. Search does not concatenate every message on an empty query. Stream UI updates are coalesced rather than reparsing all history per token.

## Intentional non-goals

No accounts, server-side conversation storage, automatic cloud sync, tool execution, provider-specific native Responses/Messages protocols, image editing, or asynchronous image task polling. No Service Worker/offline cache. Expanding these boundaries requires explicit schemas, tests and migration decisions rather than protocol guessing.
