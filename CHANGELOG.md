# Changelog

## [0.2.0] - 2026-11-23

Forked and enhanced from upstream [`franksde/agy-hud` v0.1.12](https://github.com/franksde/agy-hud).

### Added
- **Cumulative Session Token Breakdown (`show_session_tokens`)**: Displays total session tokens plus `In` (uncached input), `Out` (output + thinking), `Cache` (cache read), and optional `CWrite` (cache creation) directly from Antigravity's local `transcript.jsonl`.
- **Prompt Cache Hit Rate (`show_cache_hit_rate`, `cache_hit_rate_mode`)**: Computes `Cache / (In + Cache)` with quality-aware coloring (`>=70%` green, `>=40%` yellow, `<40%` orange). Supports `"session"` (cumulative), `"last"` (most recent turn), and `"both"`.
- **Recursive Swarm & Subagent Token Aggregation (`include_subagent_tokens`)**: Automatically discovers child conversations spawned via `/swarm` (`swarm add`, single or batch), `invoke_subagent`, `run_workflow`, and nested worker helpers, showing a `[+N]` badge when child agents are active. Strictly filters `read_file` / `run_command` / `read_board` outputs to prevent false positives.
- **Incremental Byte-Offset Transcript Cache**: Stores per-transcript inode/mtime/offset state in `session_tokens_cache.json` (128-entry LRU, atomic writes, `0600` permissions) using native C++ `Buffer.includes` pre-filtering — sub-millisecond warm redraws with zero disk writes when idle.
- **Flexible Layout (`session_tokens_layout`)**: Dedicated 3rd line (`"line"`, default) or wide-terminal `"inline"` mode, plus multi-tier narrow-terminal degradation down to 30 columns and single-line mode support.
- **Adaptive Low-Latency Quota Refresh**:
  - Three-tier configurable schedule: `quota_active_interval_sec` (`20s`, down from `60s`), `quota_settled_cooldown_sec` (`10s` post-turn / dirty cooldown, fixing 5-minute idle lockouts after a turn finishes), and `quota_idle_interval_sec` (`120s`, down from `300s`).
  - Turn-advance & `dirty` tracking across coordinator and Swarm worker turns, plus immediate refresh eligibility when a quota window passes `reset_time`.
  - Bounded in-flight wait (`quota_inflight_wait_ms`, default `1200ms`) exclusively on `active -> idle` transitions when a background `/usage` refresh is already running, catching fresh quota in the same frame without blocking typing or streaming.
- **Config & Tooling**:
  - Reads `~/.config/agy-cli-statusline/config.json` with backward-compatible fallback to `~/.config/agy-hud/config.json`.
  - Added clean staging installer (`scripts/install-local.sh`) and zero-dependency `node --test` suite (`test/hud.test.js`).

### Fixed
- Atomic temp-file + `rename` writes for `quota_cache.json` and `quota_cache.json.statusline.json` to avoid torn JSON reads.
- Background `quota refresh` now respects caller-supplied `--min-age` instead of silently skipping caches newer than 60s.
- `mergeQuotaBuckets` handles quota window rollovers cleanly when `payload.quota` reports a newer `reset_time` than cached old-window data.

---

## Upstream Baseline — `franksde/agy-hud` 0.1.12 (2026-10-03)

- Compact Antigravity CLI 1.1.0+ status-line HUD with model/plan badges, CWD, git branch, agent state, session cost, optional title, context progress bar, dual-window (5h + weekly) quota bars, `/usage` fallback, `doctor`, and Node version-manager discovery in `hooks/status-line.sh`.
