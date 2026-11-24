"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const hudPath = path.resolve(__dirname, "..", "dist", "agy-hud.js");
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

function baseConfig(overrides = {}) {
  return {
    showModel: true,
    showProgressBar: true,
    multiline: true,
    color: false,
    showGitBranch: false,
    showCWD: true,
    showAgentState: true,
    showCost: true,
    showTitle: false,
    showIcons: false,
    showSessionTokens: true,
    showCacheHitRate: true,
    includeSubagentTokens: true,
    cacheHitRateMode: "session",
    sessionTokensLayout: "line",
    quotaActiveIntervalSec: 20,
    quotaSettledCooldownSec: 10,
    quotaIdleIntervalSec: 120,
    quotaInflightWaitMs: 1200,
    contextValue: "percent",
    usageValue: "remaining",
    debug: false,
    ...overrides
  };
}

function makeTranscript(brainDir, convId, lines) {
  const dir = path.join(brainDir, convId, ".system_generated", "logs");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(filePath, lines.map((o) => JSON.stringify(o)).join("\n") + "\n");
  return filePath;
}

describe("agy-cli-statusline", () => {
  it("computes incremental session tokens, cache hit rate, handles partial lines and duplicate step_index", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-sl-t1-"));
    try {
      process.env.AGY_HUD_QUOTA_CACHE = path.join(tmp, "quota_cache.json");
      const hud = require(hudPath);
      const tf = path.join(tmp, "transcript.jsonl");

      fs.writeFileSync(tf, [
        JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", input_tokens: 10000, cache_read_tokens: 0, output_tokens: 500 }),
        JSON.stringify({ step_index: 2, type: "GENERIC", content: "x".repeat(40000) }),
        JSON.stringify({ step_index: 3, type: "PLANNER_RESPONSE", input_tokens: 2000, cache_read_tokens: 10000, output_tokens: 1000 })
      ].join("\n") + "\n");

      const mkPayload = (w = 100) => JSON.stringify({
        version: "1.5.15",
        conversation_id: "00000000-0000-0000-0000-000000000001",
        transcript_path: tf,
        model: { display_name: "Gemini 4 Neon (XHigh)" },
        plan_tier: "Google AI Pro",
        cwd: "/tmp/demo",
        agent_state: "idle",
        terminal_width: w,
        context_window: { total_input_tokens: 12000, context_window_size: 1000000 }
      });

      const cfg = baseConfig();
      let lines = hud.renderStatusline(mkPayload(), cfg, null).split("\n");
      assert.equal(lines.length, 3);
      assert.equal(lines[2], "Tokens 23.5k (In 12k · Out 1.5k · Cache 10k) │ Cache Hit 45.5%");

      // Append duplicate step_index 3 + half-written step 5
      const partial = JSON.stringify({ step_index: 5, type: "PLANNER_RESPONSE", input_tokens: 1000, cache_read_tokens: 19000, output_tokens: 500 });
      const mid = Math.floor(partial.length / 2);
      fs.appendFileSync(tf, JSON.stringify({ step_index: 3, type: "PLANNER_RESPONSE", input_tokens: 2000, cache_read_tokens: 10000, output_tokens: 1000 }) + "\n" + partial.slice(0, mid));

      lines = hud.renderStatusline(mkPayload(), cfg, null).split("\n");
      assert.equal(lines[2], "Tokens 23.5k (In 12k · Out 1.5k · Cache 10k) │ Cache Hit 45.5%");

      // Complete partial line
      fs.appendFileSync(tf, partial.slice(mid) + "\n");
      lines = hud.renderStatusline(mkPayload(), cfg, null).split("\n");
      assert.equal(lines[2], "Tokens 44k (In 13k · Out 2k · Cache 29k) │ Cache Hit 69%");

      // cache_hit_rate_mode: last & both
      assert.equal(
        hud.renderStatusline(mkPayload(), baseConfig({ cacheHitRateMode: "last" }), null).split("\n")[2],
        "Tokens 44k (In 13k · Out 2k · Cache 29k) │ Cache Hit 95%"
      );
      assert.equal(
        hud.renderStatusline(mkPayload(), baseConfig({ cacheHitRateMode: "both" }), null).split("\n")[2],
        "Tokens 44k (In 13k · Out 2k · Cache 29k) │ Cache Hit 69% (Last 95%)"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("recursively aggregates Swarm workers, helpers, and subagents while ignoring decoy outputs", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-sl-t2-"));
    try {
      const brainDir = path.join(tmp, "brain");
      const tokenCachePath = path.join(tmp, "session_tokens_cache.json");
      process.env.AGY_HUD_QUOTA_CACHE = path.join(tmp, "quota_cache.json");
      const hud = require(hudPath);

      const coordId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const w1Id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      const w2Id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const sub1Id = "dddddddd-dddd-dddd-dddd-dddddddddddd";
      const sub2Id = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
      const helpId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      const decoyId = "99999999-9999-9999-9999-999999999999";

      const coordPath = makeTranscript(brainDir, coordId, [
        { step_index: 1, type: "PLANNER_RESPONSE", created_at: "2026-11-23T08:00:01Z", input_tokens: 10000, cache_read_tokens: 0, output_tokens: 1000 },
        { step_index: 2, type: "GENERIC", content: `Created At: x\nCompleted At: y\n{"status":"added","name":"data-pipe","conversation_id":"${w1Id}"}` },
        { step_index: 3, type: "GENERIC", content: `Created At: x\nCompleted At: y\n{"status":"added","workers":[{"name":"w2","conversation_id":"${w2Id}"}]}` },
        { step_index: 4, type: "GENERIC", content: `Created At: x\nCompleted At: y\n{"conversationId":"${sub1Id}","status":"started"}` },
        { step_index: 5, type: "GENERIC", content: `Created At: x\nCompleted At: y\nLaunched subagent with conversationId: ${sub2Id}` },
        { step_index: 6, type: "GENERIC", content: `Created At: x\nCompleted At: y\nShowing lines 1-10 of 10\n1: {"status":"added","conversation_id":"${decoyId}"}` },
        { step_index: 7, type: "GENERIC", content: `Created At: x\nCompleted At: y\nCommand exited with code 0.\n\nCommand output:\n{"conversation_id":"${decoyId}"}` },
        { step_index: 8, type: "GENERIC", content: `Created At: x\nCompleted At: y\n{"messages":[{"seq":1,"text":"conversation_id: ${decoyId}"}],"head":1}` }
      ]);
      const w1Path = makeTranscript(brainDir, w1Id, [
        { step_index: 1, type: "PLANNER_RESPONSE", created_at: "2026-11-23T08:01:00Z", input_tokens: 20000, cache_read_tokens: 80000, output_tokens: 5000 },
        { step_index: 2, type: "GENERIC", content: `Created At: x\nCompleted At: y\n{"status":"added","name":"helper-1","conversation_id":"${helpId}"}` }
      ]);
      makeTranscript(brainDir, w2Id, [{ step_index: 1, type: "PLANNER_RESPONSE", created_at: "2026-11-23T08:02:00Z", input_tokens: 30000, cache_read_tokens: 170000, output_tokens: 4000 }]);
      makeTranscript(brainDir, sub1Id, [{ step_index: 1, type: "PLANNER_RESPONSE", created_at: "2026-11-23T08:03:00Z", input_tokens: 5000, cache_read_tokens: 45000, output_tokens: 1000 }]);
      makeTranscript(brainDir, sub2Id, [{ step_index: 1, type: "PLANNER_RESPONSE", created_at: "2026-11-23T08:04:00Z", input_tokens: 5000, cache_read_tokens: 45000, output_tokens: 1000 }]);
      makeTranscript(brainDir, helpId, [{ step_index: 1, type: "PLANNER_RESPONSE", created_at: "2026-11-23T08:05:00Z", input_tokens: 10000, cache_read_tokens: 90000, output_tokens: 3000 }]);
      makeTranscript(brainDir, decoyId, [{ step_index: 1, type: "PLANNER_RESPONSE", created_at: "2026-11-23T08:06:00Z", input_tokens: 999999, cache_read_tokens: 999999, output_tokens: 999999 }]);

      const payloadStr = JSON.stringify({
        version: "1.5.15",
        conversation_id: coordId,
        transcript_path: coordPath,
        model: { display_name: "Gemini 4 Neon (XHigh)" },
        plan_tier: "Pro",
        cwd: "/tmp/demo",
        agent_state: "idle",
        terminal_width: 110,
        context_window: { total_input_tokens: 10000, context_window_size: 1000000 }
      });

      const cfg = baseConfig();
      const out = hud.renderStatusline(payloadStr, cfg, null);
      assert.equal(out.split("\n")[2], "Tokens 525k [+5] (In 80k · Out 15k · Cache 430k) │ Cache Hit 84.3%");

      // Warm hit must not rewrite cache
      const mtimeBefore = fs.statSync(tokenCachePath).mtimeMs;
      assert.equal(hud.renderStatusline(payloadStr, cfg, null), out);
      assert.equal(fs.statSync(tokenCachePath).mtimeMs, mtimeBefore);

      // Incremental append on worker 1
      fs.appendFileSync(w1Path, JSON.stringify({ step_index: 5, type: "PLANNER_RESPONSE", created_at: "2026-11-23T08:10:00Z", input_tokens: 20000, cache_read_tokens: 470000, output_tokens: 5000 }) + "\n");
      assert.equal(hud.renderStatusline(payloadStr, cfg, null).split("\n")[2], "Tokens 1.02M [+5] (In 100k · Out 20k · Cache 900k) │ Cache Hit 90%");

      // Disable subagent aggregation
      assert.equal(
        hud.renderStatusline(payloadStr, baseConfig({ includeSubagentTokens: false }), null).split("\n")[2],
        "Tokens 11k (In 10k · Out 1k · Cache 0) │ Cache Hit 0%"
      );

      // Narrow widths never exceed terminal_width
      for (const w of [80, 60, 45, 30]) {
        const res = hud.renderStatusline(JSON.stringify({ ...JSON.parse(payloadStr), terminal_width: w }), baseConfig({ color: true }), null);
        for (const ln of res.split("\n")) {
          assert.ok(stripAnsi(ln).length <= w, `Line exceeded width ${w}: ${stripAnsi(ln)}`);
        }
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles in-flight quota wait on active->idle, zero blocking when idle, dirty cooldown, and window rollover", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agy-sl-t3-"));
    try {
      const cachePath = path.join(tmp, "quota_cache.json");
      const statePath = cachePath + ".statusline.json";
      const rejPath = cachePath + ".auth-rejected.json";
      const lockPath = cachePath + ".lock";
      const tf = path.join(tmp, "transcript.jsonl");
      const cfgPath = path.join(tmp, "config.json");

      process.env.AGY_HUD_QUOTA_CACHE = cachePath;
      process.env.AGY_HUD_CONFIG = cfgPath;
      fs.writeFileSync(cfgPath, JSON.stringify({
        color: false, show_icons: false, quota_active_interval_sec: 20,
        quota_settled_cooldown_sec: 10, quota_idle_interval_sec: 120, quota_inflight_wait_ms: 1200
      }));
      fs.writeFileSync(rejPath, JSON.stringify({ cliVersion: "1.5.15", rejectedAt: new Date().toISOString() }));
      fs.writeFileSync(tf, JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", input_tokens: 1000, cache_read_tokens: 4000, output_tokens: 200 }) + "\n");

      const hud = require(hudPath);
      const futureReset = new Date(Date.now() + 3600 * 1000).toISOString();
      const mkPayload = (state, extra = {}) => JSON.stringify({
        version: "1.5.15",
        conversation_id: "11111111-1111-1111-1111-111111111111",
        transcript_path: tf,
        model: { display_name: "Gemini 4 Neon (XHigh)" },
        plan_tier: "Google AI Pro",
        cwd: "/tmp/demo",
        agent_state: state,
        terminal_width: 110,
        context_window: { total_input_tokens: 5000, context_window_size: 100000 },
        quota: { "gemini-5h": { remaining_fraction: 0.90, reset_time: futureReset, reset_in_seconds: 3600 } },
        ...extra
      });

      const runStatus = async (payloadStr) => {
        let out = "";
        await hud.runCli(["statusline"], { stdin: Readable.from([payloadStr]), stdout: (c) => { out += c; }, stderr: () => {} });
        return out;
      };

      // In-flight refresh finishes after 200ms during thinking -> idle transition
      fs.writeFileSync(cachePath, JSON.stringify({
        timestamp: new Date(Date.now() - 25 * 1000).toISOString(),
        source: "usage", models: {},
        quota: { "gemini-5h": { remaining_fraction: 0.90, reset_time: futureReset } }
      }));
      fs.writeFileSync(statePath, JSON.stringify({
        conversationId: "11111111-1111-1111-1111-111111111111",
        agentState: "thinking",
        lastSeenConvId: "11111111-1111-1111-1111-111111111111",
        lastSeenTurns: 1
      }));
      fs.writeFileSync(lockPath, "inflight-tok");
      setTimeout(() => {
        const tmpFile = cachePath + ".tmp";
        fs.writeFileSync(tmpFile, JSON.stringify({
          timestamp: new Date().toISOString(),
          source: "usage", models: {},
          quota: { "gemini-5h": { remaining_fraction: 0.82, reset_time: futureReset } }
        }));
        fs.renameSync(tmpFile, cachePath);
        try { fs.unlinkSync(lockPath); } catch {}
      }, 200);

      const out = await runStatus(mkPayload("idle"));
      assert.ok(out.includes("82%"), `Expected 82% in same frame, got: ${out}`);

      // Idle redraw with active lock never blocks
      fs.writeFileSync(lockPath, "other-tok");
      const t0 = performance.now();
      await runStatus(mkPayload("idle"));
      assert.ok(performance.now() - t0 < 150, "Idle redraw must not wait on lock");
      fs.unlinkSync(lockPath);

      // Window rollover (clock skew) prefers newer reset_time 100% bucket
      const soonReset = new Date(Date.now() + 3000).toISOString();
      const nextReset = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
      const rolloverCache = { timestamp: new Date().toISOString(), source: "usage", models: {}, quota: { "gemini-5h": { remaining_fraction: 0.40, reset_time: soonReset } } };
      const outRollover = hud.renderStatusline(
        mkPayload("idle", { quota: { "gemini-5h": { remaining_fraction: 1.0, reset_time: nextReset, reset_in_seconds: 18000 } } }),
        baseConfig({ showSessionTokens: false, showCacheHitRate: false }),
        rolloverCache
      );
      assert.ok(outRollover.includes("100%"), `Expected new window 100%, got: ${outRollover}`);
    } finally {
      delete process.env.AGY_HUD_CONFIG;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
