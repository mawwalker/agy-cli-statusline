# Security & Privacy Policy

Please do not report secrets, raw Antigravity probe payloads, cookies, CSRF tokens, emails, session IDs, transcript paths, or local absolute paths in public issues.

## Data Flow & Privacy

- `agy-hud statusline` reads only the JSON payload from `stdin`, local configuration files, local cache files, and local conversation `transcript.jsonl` files (read-only) to compute cumulative token and cache-hit statistics.
- It **never** sends telemetry, transcript contents, prompts, or local paths to any external server.
- Quota refreshes contact only the local Antigravity loopback server, or (on Antigravity CLI 1.2.2+ where loopback requires CSRF) invoke the official read-only `agy -p /usage --output-format json` command using your existing CLI sign-in.
- Sensitive fields from stdin (email, session ID, conversation ID, transcript path, CSRF tokens, cookies, full workspace path) are never rendered to the status line.

## Local Cache Files

Local cache files are stored under `$XDG_CACHE_HOME/agy-hud/` (or `$HOME/.cache/agy-hud/`) with directory mode `0700` and file mode `0600`:

- `quota_cache.json`: sanitized quota buckets (`remaining_fraction`, `reset_time`) and timestamp (written atomically via temp file + rename).
- `quota_cache.json.statusline.json`: last conversation id, agent state, turn count, and dirty timestamp used to schedule quota refreshes without redundant polling.
- `quota_cache.json.server.json`: optional loopback discovery hint (PID, port, process identity, discovery timestamp; no credentials).
- `quota_cache.json.auth-rejected.json`: CLI version marker and `/usage` failure backoff timestamps.
- `quota_cache.json.lock`: transient owner-token lock preventing concurrent `/usage` subprocesses.
- `session_tokens_cache.json`: incremental byte-offset cache (inode, mtime, offset, numeric token sums, and child conversation IDs) for up to 128 recent transcripts so status-line redraws stay sub-millisecond with zero transcript content stored.
