# Migration and recovery

## Automatic migration

Open the new app at the **same origin** as the old app. If version-2 data does not exist, the app looks for:

- `localStorage.chatbutte_state_v1`
- `localStorage.chatbutte_state_v1_backup`
- `localStorage.chatbutte_language`

It validates/migrates data, stores a versioned workspace in IndexedDB, and preserves the original localStorage keys. A damaged primary can fall back to a valid legacy backup. The raw originals are also retained inside IndexedDB by the writer tab. Migration is local; the server cannot access your browser’s old conversations.

Preserved fields include model keys, model reasoning mode, conversation prompts/model references/history limits/temperature, user and assistant messages, reasoning, context-cutoff markers, recoverable attachments, generated image URLs, preferences and Gist settings. Explicit old dual-purpose model profiles split deterministically; ordinary chat models do not acquire invented image configurations. Orphan message containers become recovered conversations rather than being thrown away.

## Irrecoverable old data

Some old versions deliberately removed attachment image data and truncated text during localStorage saves. The new app cannot restore bytes that no longer exist. These attachments are marked unavailable or legacy-truncated. Old signed provider image URLs can also expire independently of migration.

## Import and export

Version-2 JSON backups contain `version: 2` and a validated workspace. Legacy backups use `profiles`, `topics` and `messagesByTopic`. Other JSON is rejected. Duplicate IDs and malformed message containers are rejected before changing current data.

Ordinary exports omit model API keys; the UI offers explicit inclusion. Gist tokens are always omitted. Import uses whole-workspace replacement, not an undocumented merge. Matching omitted model keys may retain local keys only when ID, API URL and model agree. A changed endpoint cannot silently inherit an unrelated key.

An import/reset/remote download saves the previous database record as `restore-point` in the same transaction as the replacement. Use **Settings → Data & backups → Undo last replacement** to restore it. There is one restore point; another replacement rotates it. Always keep an external backup for durable recovery.

## Recovery mode

If both current and backup are invalid/unreadable, the app must not save a new empty workspace over them. It shows a recovery screen. Import a known-good backup or explicitly reset the workspace. No automatic reset is performed.

If writes fail (quota, blocked storage, browser policy), an error remains visible. The pending in-memory state is retained for a later save attempt and can be exported. Explicit import never reports success before its database transaction commits. A browser crash can still lose the most recent unsaved checkpoint; no local database can promise zero loss under every device failure.

## Multiple tabs and devices

Only one tab may write/generate. Close the first tab and reload the second to take ownership. Different devices are independent until you explicitly export/import or use Gist.

Changing scheme/hostname/port changes browser storage origin. If switching domains, export from the old origin and import on the new one. Do not clear old site data before verifying migration and creating a fresh backup.
