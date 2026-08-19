import { useState, useEffect, useRef } from "react";
import {
  SignIn, SignUp, UserButton,
  useUser, useClerk, SignedIn, SignedOut
} from "@clerk/clerk-react";
import { sanitizeAiHtml, sanitizeAiPreview } from "./utils/sanitize";
import { loadUserData, saveUserData, setUserDataTokenGetter } from "./utils/userData";
import { exportAuditPdf } from "./utils/exportAuditPdf";

// ─────────────────────────────────────────────────────────────
// ⚙️  CONFIG — paste your Worker URL here after deploying it
// ─────────────────────────────────────────────────────────────
const WORKER_URL = import.meta.env.VITE_WORKER_URL || "https://api.rankactions.com";

// Module-level auth token — updated by the component, read by API helpers
let _getToken = async () => null;

// Stable, deterministic id-safe slug from a keyword string. Used to give
// completed-action ("done") fixes IDs that are tied to the KEYWORD, not the
// keyword's array index — so completions survive GSC data reshuffles.
// Human-readable plan label. Covers current tiers (free/individual/business/
// agency) AND legacy tiers (starter/pro) still held by grandfathered customers.
function planLabel(plan) {
  switch (plan) {
    case 'agency':     return 'Agency';
    case 'business':   return 'Business';
    case 'individual': return 'Individual';
    case 'pro':        return 'Pro';      // legacy
    case 'starter':    return 'Starter';  // legacy
    default:           return 'Free';
  }
}

// ── Completed-action records ────────────────────────────────────────────────
// Historically `done` was stored as a bare array of fix IDs: ["live-foo", ...].
// That records WHAT was done but not WHEN, making it impossible to measure
// whether a change actually improved anything. Records are now objects:
//   { id, ts, kw }   ts = ISO timestamp marked done, kw = related keyword
// Both shapes are accepted on read, so existing users lose nothing; legacy IDs
// simply carry a null timestamp and are excluded from impact measurement.
function normaliseDoneRecords(raw) {
  const ids = [];
  const meta = {};
  if (!Array.isArray(raw)) return { ids, meta };
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (!entry) continue;
      ids.push(entry);
      meta[entry] = { ts: null, kw: null };
    } else if (entry && typeof entry === "object" && entry.id) {
      ids.push(entry.id);
      meta[entry.id] = { ts: entry.ts || null, kw: entry.kw || null };
    }
  }
  return { ids, meta };
}

// ── Action impact ───────────────────────────────────────────────────────────
// Compare Search Console snapshots from before and after a fix was marked done,
// so users can see whether their work actually moved anything. Deliberately
// conservative: an action only counts as "measurable" when there is a snapshot
// on each side AND at least MIN_DAYS have passed, because rankings move slowly
// and an early reading would be noise presented as fact.
//
//   doneMeta  { [fixId]: { ts, kw } }
//   snapshots [ { date: 'YYYY-MM-DD', keywords: [{ keyword, position, clicks, impressions }] } ]
//
// Returns { measured: [...], pending: n, unmeasurable: n }
const IMPACT_MIN_DAYS = 14;

function computeActionImpact(doneMeta, snapshots, minDays = IMPACT_MIN_DAYS) {
  const empty = { measured: [], pending: 0, unmeasurable: 0 };
  if (!doneMeta || typeof doneMeta !== "object") return empty;
  const snaps = (Array.isArray(snapshots) ? snapshots : [])
    .filter(s => s && typeof s.date === "string" && Array.isArray(s.keywords))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const measured = [];
  let pending = 0, unmeasurable = 0;

  const findKw = (snap, kw) => {
    const target = String(kw).trim().toLowerCase();
    return (snap.keywords || []).find(k => String(k.keyword || "").trim().toLowerCase() === target) || null;
  };

  for (const [id, meta] of Object.entries(doneMeta)) {
    if (!meta || !meta.ts || !meta.kw) { unmeasurable++; continue; }   // legacy record, no timestamp
    const doneDate = String(meta.ts).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doneDate)) { unmeasurable++; continue; }

    // Nearest snapshot at or before the fix, and the most recent one after it.
    let before = null, after = null;
    for (const s of snaps) {
      if (s.date <= doneDate) before = s;
      else if (!after || s.date > after.date) after = s;
    }
    if (!before || !after) { pending++; continue; }

    const daysApart = Math.round(
      (new Date(after.date + "T00:00:00Z") - new Date(doneDate + "T00:00:00Z")) / 86400000
    );
    if (daysApart < minDays) { pending++; continue; }

    const b = findKw(before, meta.kw);
    const a = findKw(after, meta.kw);
    if (!b || !a) { pending++; continue; }   // keyword absent one side — can't compare

    const posBefore = Number(b.position), posAfter = Number(a.position);
    if (!isFinite(posBefore) || !isFinite(posAfter)) { pending++; continue; }

    measured.push({
      id,
      kw: meta.kw,
      doneDate,
      daysApart,
      posBefore: Math.round(posBefore * 10) / 10,
      posAfter:  Math.round(posAfter  * 10) / 10,
      // Positive = moved UP the results (position number fell).
      posDelta:  Math.round((posBefore - posAfter) * 10) / 10,
      clicksBefore: Number(b.clicks) || 0,
      clicksAfter:  Number(a.clicks) || 0,
      clicksDelta:  (Number(a.clicks) || 0) - (Number(b.clicks) || 0),
      impressionsDelta: (Number(a.impressions) || 0) - (Number(b.impressions) || 0),
    });
  }

  measured.sort((x, y) => y.posDelta - x.posDelta);
  return { measured, pending, unmeasurable };
}

// Serialise back to the stored shape. Entries without metadata still round-trip.
function serialiseDoneRecords(idSet, meta) {
  return [...idSet].map((id) => ({
    id,
    ts: meta?.[id]?.ts || null,
    kw: meta?.[id]?.kw || null,
  }));
}

function raSlug(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')   // non-alphanumerics → hyphen
    .replace(/^-+|-+$/g, '')        // trim leading/trailing hyphens
    .slice(0, 80);                  // cap length
}

// Option B migration: translate legacy index-based done IDs (live-<n> / seo-<n>)
// to the new stable keyword-slug IDs, using the CURRENT opportunity/keyword
// lists to resolve each index. IDs that already look slug-based, or that can't
// be resolved against current data, are handled defensively:
//   - already-slug IDs (no trailing pure number) are kept as-is
//   - legacy numeric IDs that resolve → remapped to the slug
//   - legacy numeric IDs that DON'T resolve (index out of range now) → dropped
// This is best-effort: the legacy IDs were unreliable by nature (that's the bug
// we're fixing), so unresolvable ones are discarded rather than mis-preserved.
function migrateDoneIds(doneArr, topOpportunities, seoKeywords) {
  if (!Array.isArray(doneArr)) return [];
  const opps = Array.isArray(topOpportunities) ? topOpportunities : [];
  const seo  = Array.isArray(seoKeywords) ? seoKeywords : [];
  const out = new Set();
  for (const id of doneArr) {
    const liveNum = /^live-(\d+)$/.exec(id);
    const seoNum  = /^seo-(\d+)$/.exec(id);
    if (liveNum) {
      const idx = Number(liveNum[1]);
      const kw = opps[idx]?.keyword;
      if (kw) out.add(`live-${raSlug(kw)}`);      // resolved → remap
      // else: drop (index no longer valid)
    } else if (seoNum) {
      const idx = Number(seoNum[1]);
      const kw = seo[idx]?.kw || seo[idx]?.keyword;
      if (kw) out.add(`seo-${raSlug(kw)}`);
      // else: drop
    } else {
      out.add(id);                                 // already slug-based / other → keep
    }
  }
  return [...out];
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#07080f;--s1:#0c0e1a;--s2:#111425;--s3:#171d33;
  --border:#1e2440;--border2:#252d4a;
  --text:#dde2f5;--text2:#8590b8;--text3:#4e5880;
  --green:#0fdb8a;--gdim:rgba(15,219,138,.12);
  --amber:#f5a623;--adim:rgba(245,166,35,.12);
  --red:#f03e5f;--rdim:rgba(240,62,95,.12);
  --blue:#4d7bff;--bdim:rgba(77,123,255,.12);
  --card:#0c0e1a;--b2:#1e2440;
  --font:'Outfit',sans-serif;--mono:'JetBrains Mono',monospace;
}
/* ── Light theme — applied when document root has data-theme="light"
   Triggered by OS-level prefers-color-scheme:light (see App component effect).
   Both neutrals AND saturated brand colours adjust. The neutrals flip
   (dark backgrounds → cream, light text → dark). The brand colours dull
   slightly — fluorescent #0fdb8a is harsh on white, so we use a deeper
   brand green that still reads as the same colour but doesn't strain the
   eye. Status colours (amber/red) get a similar treatment. ── */
[data-theme="light"]{
  --bg:#fafaf7;--s1:#ffffff;--s2:#f5f1e8;--s3:#edeae3;
  --border:#d9d5cc;--border2:#c4bfb3;
  --text:#0d0d0d;--text2:#4a4a4a;--text3:#7a776e;
  --card:#ffffff;--b2:#edeae3;
  --green:#0e7a3c;--gdim:rgba(14,122,60,.10);
  --amber:#b8780d;--adim:rgba(184,120,13,.10);
  --red:#c0392b;--rdim:rgba(192,57,43,.10);
  --blue:#2563eb;--bdim:rgba(37,99,235,.10);
}
/* ── Tooltips ── */
.tip-trigger{display:inline-flex;align-items:center;gap:.25rem;cursor:help;position:relative;}
.tip-icon{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:var(--s3);color:var(--text3);font-size:.58rem;font-weight:700;font-style:normal;flex-shrink:0;line-height:1;}
.tip-bubble{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);background:var(--s3);border:1px solid var(--border2);border-radius:8px;padding:.55rem .75rem;font-size:.73rem;font-weight:400;color:var(--text);line-height:1.5;width:260px;z-index:999;pointer-events:none;opacity:0;transition:opacity .15s;box-shadow:0 4px 16px rgba(0,0,0,.3);}
.tip-bubble::after{content:'';position:absolute;bottom:100%;left:50%;transform:translateX(-50%);border:6px solid transparent;border-bottom-color:var(--s3);}
.tip-trigger:hover .tip-bubble,.tip-trigger:focus .tip-bubble{opacity:1;pointer-events:auto;}
.benchmark{font-size:.68rem;font-weight:600;margin-left:.3rem;padding:.1rem .35rem;border-radius:4px;}
.benchmark.good{background:var(--gdim);color:var(--green);}
.benchmark.ok{background:var(--adim);color:var(--amber);}
.benchmark.bad{background:var(--rdim);color:var(--red);}
.gos{min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--font);}
.ob{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;background:radial-gradient(ellipse 900px 400px at 50% 0%,#0c1530 0%,var(--bg) 65%);}
.ob-logo{font-size:1.4rem;font-weight:800;letter-spacing:-.04em;margin-bottom:2.5rem;}
.ob-logo em{color:var(--green);font-style:normal;}
.ob-card{width:100%;max-width:460px;background:var(--s2);border:1px solid var(--border);border-radius:16px;padding:2.5rem;box-shadow:0 0 0 1px rgba(77,123,255,.08),0 8px 40px rgba(0,0,0,.5),0 0 80px rgba(77,123,255,.06);}
/* Onboarding light-mode overrides: softer gradient, softer shadow, no blue glow */
[data-theme="light"] .ob{background:radial-gradient(ellipse 900px 400px at 50% 0%,#e8e2d4 0%,var(--bg) 65%);}
[data-theme="light"] .ob-card{box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);}
.ob-step-label{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:var(--text3);margin-bottom:1.5rem;}
.ob-h{font-size:1.55rem;font-weight:700;letter-spacing:-.03em;margin-bottom:.4rem;line-height:1.25;}
.ob-sub{color:var(--text2);font-size:.9rem;margin-bottom:2rem;line-height:1.6;}
.ob-input{width:100%;background:var(--bg);border:1.5px solid var(--border);border-radius:10px;padding:.85rem 1rem;color:var(--text);font-family:var(--font);font-size:.95rem;outline:none;transition:border-color .2s;}
.ob-input:focus{border-color:var(--blue);}
.ob-input::placeholder{color:var(--text3);}
.ob-btn{width:100%;margin-top:1rem;padding:.85rem;background:var(--blue);border:none;border-radius:10px;color:#fff;font-family:var(--font);font-size:.95rem;font-weight:600;cursor:pointer;transition:opacity .15s;}
.ob-btn:hover{opacity:.88;}
.ob-btn:disabled{opacity:.35;cursor:not-allowed;}
.ob-connect-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem;}
.ob-connect-card{background:var(--s2);border:1.5px solid var(--border);border-radius:10px;padding:1rem;cursor:pointer;transition:border-color .2s;}
.ob-connect-card:hover{border-color:var(--blue);}
.ob-connect-card.active{border-color:var(--green);}
.ob-connect-icon{font-size:1.4rem;margin-bottom:.5rem;}
.ob-connect-name{font-size:.85rem;font-weight:600;margin-bottom:.15rem;}
.ob-connect-sub{font-size:.75rem;color:var(--text2);}
.ob-skip{display:block;text-align:center;color:var(--text3);font-size:.82rem;cursor:pointer;margin-top:.75rem;}
.ob-skip:hover{color:var(--text2);}
.ob-prog-wrap{margin:1.5rem 0;}
.ob-prog-top{display:flex;justify-content:space-between;font-size:.78rem;color:var(--text2);margin-bottom:.5rem;}
.ob-prog-bar{height:5px;background:var(--s3);border-radius:999px;overflow:hidden;}
.ob-prog-fill{height:100%;background:linear-gradient(90deg,var(--blue),var(--green));border-radius:999px;transition:width .4s ease;}
.ob-tasks{display:flex;flex-direction:column;gap:.5rem;}
.ob-task{display:flex;align-items:center;gap:.6rem;font-size:.875rem;color:var(--text2);}
.ob-task.done{color:var(--green);}
.ob-task-check{width:16px;height:16px;border-radius:50%;border:2px solid currentColor;display:flex;align-items:center;justify-content:center;font-size:.65rem;flex-shrink:0;}
.ob-results{display:flex;flex-direction:column;gap:.65rem;margin-bottom:1.5rem;}
.ob-result{background:var(--s2);border-radius:10px;padding:.9rem 1rem;border-left:3px solid;}
.ob-result.r{border-color:var(--red);}
.ob-result.a{border-color:var(--amber);}
.ob-result.g{border-color:var(--green);}
.ob-result-tag{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.2rem;}
.ob-result.r .ob-result-tag{color:var(--red);}
.ob-result.a .ob-result-tag{color:var(--amber);}
.ob-result.g .ob-result-tag{color:var(--green);}
.ob-result-text{font-size:.875rem;font-weight:500;color:var(--text);}
.layout{display:flex;min-height:100vh;}
.sidebar{width:216px;flex-shrink:0;background:var(--s1);border-right:1px solid var(--border);padding:1.5rem 1rem;display:flex;flex-direction:column;}
.sidebar-logo{font-size:1.15rem;font-weight:800;letter-spacing:-.04em;padding:0 .5rem;margin-bottom:2rem;}
.sidebar-logo em{color:var(--green);font-style:normal;}
.sidebar-nav{display:flex;flex-direction:column;gap:.2rem;flex:1;}
.nav-item{display:flex;align-items:center;gap:.65rem;padding:.6rem .75rem;border-radius:8px;font-size:.875rem;font-weight:500;color:var(--text2);cursor:pointer;transition:all .15s;user-select:none;}
.nav-item:hover{background:var(--s2);color:var(--text);}
.nav-item.active{background:var(--bdim);color:var(--blue);}
.main-area{flex:1;min-width:0;overflow-y:auto;display:flex;flex-direction:column;}
.topbar{padding:.9rem 2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:var(--s1);position:sticky;top:0;z-index:50;gap:1rem;}
.site-selector{position:relative;}
.site-btn{display:flex;align-items:center;gap:.5rem;background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:.5rem .85rem;cursor:pointer;font-family:var(--font);font-size:.875rem;color:var(--text);user-select:none;}
.site-btn:hover{border-color:var(--border2);}
/* max-height + overflow-y are essential: agencies can have 100+ Search Console
   properties. With overflow:hidden and no height cap the list ran off the bottom
   of the viewport and could not be scrolled — the page scrolled behind it instead,
   so only the first dozen sites were ever reachable. overscroll-behavior stops the
   scroll chaining to the page once the list hits its end. */
.site-dropdown{position:absolute;top:calc(100% + 6px);left:0;background:var(--s2);border:1px solid var(--border);border-radius:10px;min-width:190px;max-width:min(420px,90vw);z-index:100;max-height:min(60vh,440px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;box-shadow:0 8px 24px rgba(0,0,0,.4);}
.site-opt{padding:.65rem 1rem;font-size:.875rem;color:var(--text2);cursor:pointer;}
.site-opt:hover{background:var(--s3);color:var(--text);}
.site-opt.sel{color:var(--blue);}
.site-add{padding:.65rem 1rem;font-size:.875rem;color:var(--blue);cursor:pointer;border-top:1px solid var(--border);display:flex;align-items:center;gap:.4rem;}
.site-add:hover{background:var(--s3);}
.topbar-right{display:flex;align-items:center;gap:.75rem;}
.topbar-badge{font-size:.72rem;background:var(--gdim);color:var(--green);padding:.3rem .65rem;border-radius:6px;font-weight:600;}
.topbar-badge.demo{background:var(--adim);color:var(--amber);}
.connect-btn{display:flex;align-items:center;gap:.4rem;background:var(--blue);border:none;border-radius:8px;padding:.45rem .9rem;color:#fff;font-family:var(--font);font-size:.78rem;font-weight:600;cursor:pointer;}
.connect-btn:hover{opacity:.88;}
.disconnect-btn{background:none;border:1px solid var(--border);border-radius:8px;padding:.4rem .75rem;color:var(--text3);font-family:var(--font);font-size:.75rem;cursor:pointer;}
.disconnect-btn:hover{border-color:var(--red);color:var(--red);}
.avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,var(--blue),#a855f7);display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;}
.content{padding:2rem;flex:1;}
.kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2rem;}
.kpi-card{background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:1.25rem;}
.kpi-label{font-size:.72rem;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.75rem;}
.kpi-value{font-size:1.65rem;font-weight:700;letter-spacing:-.03em;font-family:var(--mono);}
.kpi-value.shimmer{color:transparent;background:var(--s2);border-radius:6px;animation:pulse 1.4s ease infinite;}
.kpi-change{margin-top:.3rem;font-size:.78rem;font-weight:600;}
.kpi-change.pos{color:var(--green);}
.kpi-change.neg{color:var(--red);}
.kpi-change.neu{color:var(--text3);}
.kpi-source{font-size:.68rem;color:var(--text3);margin-top:.2rem;}
.kpi-source.live{color:var(--green);}
.data-banner{display:flex;align-items:center;gap:.75rem;background:var(--adim);border:1px solid rgba(245,166,35,.2);border-radius:10px;padding:.85rem 1.1rem;margin-bottom:1.75rem;font-size:.85rem;color:var(--amber);flex-wrap:wrap;}
.data-banner.live{background:var(--gdim);border-color:rgba(15,219,138,.2);color:var(--green);}
.data-banner.error{background:var(--rdim);border-color:rgba(240,62,95,.2);color:var(--red);}
.data-banner-action{margin-left:auto;background:none;border:1px solid currentColor;border-radius:6px;padding:.25rem .65rem;color:inherit;font-family:var(--font);font-size:.75rem;cursor:pointer;white-space:nowrap;}
.data-banner-action:hover{opacity:.75;}
.ai-card{background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:1.5rem;margin-bottom:2rem;}
.ai-card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;}
.ai-card-title{display:flex;align-items:center;gap:.6rem;font-size:.9rem;font-weight:700;}
.ai-pill{background:var(--bdim);color:var(--blue);font-size:.68rem;font-weight:700;padding:.2rem .5rem;border-radius:4px;text-transform:uppercase;letter-spacing:.08em;}
.ai-pill.live{background:var(--gdim);color:var(--green);}
.ai-regen-btn{display:flex;align-items:center;gap:.4rem;background:none;border:1px solid var(--border);border-radius:7px;padding:.4rem .75rem;color:var(--text2);font-family:var(--font);font-size:.78rem;cursor:pointer;}
.ai-regen-btn:hover{border-color:var(--blue);color:var(--blue);}
.ai-regen-btn:disabled{opacity:.4;cursor:not-allowed;}
.ai-bullets{display:flex;flex-direction:column;gap:.7rem;}
.ai-bullet-row{display:flex;align-items:flex-start;gap:.7rem;font-size:.9rem;line-height:1.55;}
.ai-dot{width:6px;height:6px;border-radius:50%;background:var(--blue);flex-shrink:0;margin-top:.55rem;}
.ai-placeholder{color:var(--text3);font-size:.875rem;font-style:italic;}
.ai-cta-row{margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;}
.ai-cta-btn{background:var(--blue);color:#fff;border:none;border-radius:8px;padding:.55rem 1.1rem;font-family:var(--font);font-size:.85rem;font-weight:600;cursor:pointer;}
.ai-cta-btn:hover{opacity:.88;}
.section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;}
.section-title{font-size:1rem;font-weight:700;}
.section-sub{font-size:.8rem;color:var(--text2);}
.fixes-list{display:flex;flex-direction:column;gap:.75rem;}
.fix-card{background:var(--s1);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .2s;}
.fix-card:hover{border-color:var(--border2);}
.fix-card-header{padding:1.25rem 1.5rem;display:flex;align-items:flex-start;gap:1rem;cursor:pointer;user-select:none;}
.fix-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;margin-top:.45rem;}
.fix-info{flex:1;min-width:0;}
.fix-tag{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;margin-bottom:.3rem;}
.fix-title{font-size:.95rem;font-weight:600;margin-bottom:.3rem;}
.fix-desc{font-size:.825rem;color:var(--text2);line-height:1.5;}
.fix-meta-row{display:flex;gap:.6rem;margin-top:.65rem;flex-wrap:wrap;}
.fix-meta-tag{font-size:.72rem;background:var(--s2);border:1px solid var(--border);border-radius:5px;padding:.2rem .55rem;color:var(--text2);font-family:var(--mono);}
.fix-right{display:flex;flex-direction:column;align-items:flex-end;gap:.5rem;flex-shrink:0;}
.fix-type-badge{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:.2rem .5rem;border-radius:4px;}
.fix-type-badge.seo{background:var(--bdim);color:var(--blue);}
.fix-type-badge.cro{background:var(--adim);color:var(--amber);}
.fix-chevron{font-size:.65rem;color:var(--text3);transition:transform .2s;}
.fix-chevron.open{transform:rotate(180deg);}
.fix-body{padding:0 1.5rem 1.25rem;border-top:1px solid var(--border);}
.fix-suggestion-box{background:var(--s2);border:1px solid var(--border2);border-radius:10px;padding:1rem;margin:1rem 0;}
.fix-sugg-label{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--text3);margin-bottom:.5rem;}
.fix-sugg-text{font-size:.875rem;color:var(--text);line-height:1.6;white-space:pre-wrap;}
.fix-actions{display:flex;gap:.6rem;flex-wrap:wrap;}
.fa-btn{padding:.45rem .85rem;border-radius:7px;font-family:var(--font);font-size:.8rem;font-weight:500;cursor:pointer;border:1px solid var(--border);background:var(--s2);color:var(--text2);transition:all .15s;}
.fa-btn:hover{border-color:var(--blue);color:var(--blue);}
.fa-btn.primary{background:var(--blue);color:#fff;border-color:var(--blue);}
.fa-btn.primary:hover{opacity:.88;}
.fa-btn.success{background:var(--gdim);color:var(--green);border-color:var(--green);cursor:default;}
.tabs-row{display:flex;border-bottom:1px solid var(--border);margin-bottom:2rem;}
.tab-btn{padding:.75rem 1.25rem;font-family:var(--font);font-size:.875rem;font-weight:500;color:var(--text2);background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;margin-bottom:-1px;transition:all .15s;}
.tab-btn:hover{color:var(--text);}
.tab-btn.active{color:var(--blue);border-bottom-color:var(--blue);}
.back-btn{display:flex;align-items:center;gap:.4rem;background:none;border:none;color:var(--text2);font-family:var(--font);font-size:.85rem;cursor:pointer;padding:0;margin-bottom:1.5rem;}
.back-btn:hover{color:var(--text);}
.site-detail-name{font-size:1.25rem;font-weight:700;letter-spacing:-.03em;margin-bottom:.2rem;}
.site-detail-meta{font-size:.825rem;color:var(--text2);margin-bottom:1.5rem;}
.table-wrap{background:var(--s1);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.data-table{width:100%;border-collapse:collapse;}
.data-table th{text-align:left;padding:.7rem 1rem;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);border-bottom:1px solid var(--border);}
.data-table td{padding:.9rem 1rem;font-size:.85rem;border-bottom:1px solid var(--border);}
.data-table tr:last-child td{border-bottom:none;}
.data-table tbody tr:hover td{background:var(--s2);}
.td-mono{font-family:var(--mono);font-size:.78rem;}
.td-link{color:var(--blue);cursor:pointer;font-size:.8rem;}
.td-link:hover{text-decoration:underline;}
.td-opp{font-size:.68rem;font-weight:700;padding:.15rem .45rem;border-radius:4px;background:var(--adim);color:var(--amber);margin-left:.4rem;}
.issues-list{display:flex;flex-direction:column;gap:.75rem;}
.issue-row{background:var(--s1);border:1px solid var(--border);border-radius:10px;overflow:hidden;}
.issue-row-header{padding:1rem 1.25rem;display:flex;align-items:center;gap:1rem;cursor:pointer;user-select:none;transition:background .1s;}
.issue-row-header:hover{background:var(--s2);}
.issue-chevron{margin-left:auto;color:var(--text3);font-size:.75rem;transition:transform .2s;flex-shrink:0;}
.issue-chevron.open{transform:rotate(180deg);}
.issue-pages{border-top:1px solid var(--border);}
.issue-pages-header{display:grid;grid-template-columns:2fr 3fr 1fr auto;gap:1rem;padding:.5rem 1.25rem;background:var(--s2);font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);}
.issue-page-row{display:grid;grid-template-columns:2fr 3fr 1fr auto;gap:1rem;padding:.75rem 1.25rem;border-top:1px solid var(--border);align-items:center;font-size:.825rem;}
.issue-page-row:hover{background:var(--s2);}
.issue-page-url{font-family:var(--mono);font-size:.8rem;color:var(--blue);}
.issue-page-detail{color:var(--text2);font-size:.8rem;}
.issue-priority{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:.15rem .45rem;border-radius:4px;}
.issue-priority.high{background:var(--rdim);color:var(--red);}
.issue-priority.medium{background:var(--adim);color:var(--amber);}
.issue-priority.low{background:var(--bdim);color:var(--blue);}
.issue-fix-btn{background:none;border:1px solid var(--border);border-radius:6px;padding:.3rem .65rem;font-family:var(--font);font-size:.72rem;font-weight:600;color:var(--text2);cursor:pointer;white-space:nowrap;transition:all .15s;}
.issue-fix-btn:hover{border-color:var(--blue);color:var(--blue);}
.issue-summary-bar{padding:.65rem 1.25rem;background:var(--s2);border-top:1px solid var(--border);font-size:.8rem;color:var(--text2);display:flex;align-items:center;gap:.5rem;}
.issue-data-note{margin-top:1rem;background:var(--bdim);border:1px solid rgba(77,123,255,.15);border-radius:8px;padding:.75rem 1rem;font-size:.78rem;color:var(--blue);line-height:1.6;}
.issue-icon-wrap{width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.05rem;flex-shrink:0;}
.issue-icon-wrap.error{background:var(--rdim);}
.issue-icon-wrap.warning{background:var(--adim);}
.issue-icon-wrap.info{background:var(--bdim);}
.issue-info{flex:1;}
.issue-name{font-size:.875rem;font-weight:600;margin-bottom:.2rem;}
.issue-fix-hint{font-size:.78rem;color:var(--text2);}
.issue-pages-badge{font-family:var(--mono);font-size:.72rem;background:var(--s2);border:1px solid var(--border);padding:.2rem .55rem;border-radius:5px;color:var(--text2);white-space:nowrap;}
.conv-list{display:flex;flex-direction:column;gap:.75rem;}
.conv-card{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:1.25rem;}
.conv-page-url{font-family:var(--mono);font-size:.8rem;color:var(--text2);margin-bottom:.65rem;}
.conv-stats{display:flex;gap:2rem;margin-bottom:.75rem;}
.conv-stat .cv{font-size:1.35rem;font-weight:700;font-family:var(--mono);}
.conv-stat .cl{font-size:.7rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;}
.conv-issue-text{font-size:.85rem;color:var(--amber);margin-bottom:.65rem;}
.conv-fix-btn{background:none;border:1px solid var(--border);border-radius:7px;padding:.4rem .85rem;color:var(--blue);font-family:var(--font);font-size:.8rem;cursor:pointer;}
.conv-fix-btn:hover{background:var(--bdim);}
.mini-fix{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:1rem 1.25rem;display:flex;align-items:center;gap:1rem;margin-bottom:.6rem;}
.mini-fix-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.mini-fix-info{flex:1;}
.mini-fix-title{font-size:.875rem;font-weight:600;margin-bottom:.15rem;}
.mini-fix-sub{font-size:.775rem;color:var(--text2);}
.mini-fix-btn{background:none;border:1px solid var(--border);border-radius:6px;padding:.35rem .7rem;color:var(--blue);font-family:var(--font);font-size:.775rem;cursor:pointer;white-space:nowrap;}
.mini-fix-btn:hover{background:var(--bdim);}
.overlay{position:fixed;inset:0;background:rgba(7,8,15,.88);backdrop-filter:blur(6px);z-index:300;display:flex;align-items:center;justify-content:center;padding:1.5rem;}
.modal{background:var(--s1);border:1px solid var(--border);border-radius:16px;width:100%;max-width:560px;max-height:88vh;overflow-y:auto;}
.modal-head{padding:1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;}
.modal-h{font-size:1rem;font-weight:700;margin-bottom:.2rem;}
.modal-sub{font-size:.825rem;color:var(--text2);}
.modal-close{background:none;border:none;color:var(--text3);cursor:pointer;font-size:1.3rem;line-height:1;padding:0;flex-shrink:0;}
.modal-close:hover{color:var(--text);}
.modal-content{padding:1.5rem;}
.modal-section-label{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--text3);margin-bottom:.75rem;}
.current-box{background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:.85rem 1rem;margin-bottom:1.5rem;}
.current-label{font-size:.7rem;color:var(--text3);margin-bottom:.25rem;}
.current-val{font-size:.875rem;font-family:var(--mono);color:var(--text2);text-decoration:line-through;}
.option-card{background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:1.1rem;margin-bottom:.75rem;}
.option-num{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);margin-bottom:.35rem;}
.option-text{font-size:.9rem;font-weight:500;color:var(--text);font-family:var(--mono);line-height:1.4;margin-bottom:.75rem;}
.option-actions{display:flex;gap:.5rem;}
.opt-btn{background:none;border:1px solid var(--border);border-radius:6px;padding:.3rem .65rem;color:var(--text2);font-family:var(--font);font-size:.775rem;cursor:pointer;}
.opt-btn:hover{border-color:var(--blue);color:var(--blue);}
.opt-btn.copied{border-color:var(--green);color:var(--green);}
.tip-box{background:var(--bdim);border:1px solid rgba(77,123,255,.2);border-radius:8px;padding:.75rem 1rem;font-size:.825rem;color:var(--blue);margin-top:.5rem;line-height:1.5;}
.modal-footer{padding:1rem 1.5rem;border-top:1px solid var(--border);display:flex;gap:.75rem;justify-content:flex-end;}
.mf-btn{padding:.55rem 1.1rem;border-radius:8px;font-family:var(--font);font-size:.85rem;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--s2);color:var(--text2);}
.mf-btn:hover{border-color:var(--blue);color:var(--blue);}
.mf-btn:disabled{opacity:.4;cursor:not-allowed;}
.mf-btn.primary{background:var(--blue);color:#fff;border-color:var(--blue);}
.mf-btn.primary:hover{opacity:.88;}
.mf-btn.done{background:var(--gdim);color:var(--green);border-color:var(--green);}
.loading-center{display:flex;flex-direction:column;align-items:center;gap:.75rem;padding:2.5rem;color:var(--text2);font-size:.875rem;}
.spinner{display:inline-block;width:18px;height:18px;border:2px solid var(--border2);border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite;}
.spinner-sm{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite;vertical-align:middle;}
@keyframes spin{to{transform:rotate(360deg)}}
.pulse{animation:pulse 1.5s ease-in-out infinite;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px;}

/* ── Auth screens ── */
.auth-wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;background:radial-gradient(ellipse 900px 400px at 50% 0%,#0c1530 0%,var(--bg) 65%);}
[data-theme="light"] .auth-wrap{background:radial-gradient(ellipse 900px 400px at 50% 0%,#e8e2d4 0%,var(--bg) 65%);}
.auth-logo{font-size:1.4rem;font-weight:800;letter-spacing:-.04em;margin-bottom:.5rem;}
.auth-logo em{color:var(--green);font-style:normal;}
.auth-tagline{font-size:.875rem;color:var(--text2);margin-bottom:2rem;}
.auth-tabs{display:flex;gap:.5rem;margin-bottom:1.5rem;}
.auth-tab{padding:.5rem 1.25rem;border-radius:8px;font-family:var(--font);font-size:.875rem;font-weight:500;cursor:pointer;border:1px solid var(--border);background:var(--s2);color:var(--text2);transition:all .15s;}
.auth-tab.active{background:var(--blue);color:#fff;border-color:var(--blue);}

/* ── Plan selection ── */
.plan-wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;background:radial-gradient(ellipse 900px 400px at 50% 0%,#0c1530 0%,var(--bg) 65%);}
.plan-logo{font-size:1.4rem;font-weight:800;letter-spacing:-.04em;margin-bottom:.5rem;}
.plan-logo em{color:var(--green);font-style:normal;}
.plan-sub{font-size:.9rem;color:var(--text2);margin-bottom:2.5rem;}
.plan-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.85rem;width:100%;max-width:1050px;margin-bottom:1.5rem;}
.plan-card{background:var(--s1);border:2px solid var(--border);border-radius:16px;padding:1.5rem;cursor:pointer;transition:all .2s;}
.plan-card:hover{border-color:var(--blue);}
.plan-card.selected{border-color:var(--blue);background:var(--bdim);}
.plan-card.featured{border-color:var(--green);}
.plan-card.featured.selected{background:var(--gdim);}
.plan-name{font-size:1rem;font-weight:700;margin-bottom:.25rem;}
.plan-price{font-size:1.75rem;font-weight:800;font-family:var(--mono);letter-spacing:-.03em;margin-bottom:.25rem;}
.plan-period{font-size:.75rem;color:var(--text2);margin-bottom:1rem;}
.plan-features{list-style:none;display:flex;flex-direction:column;gap:.4rem;}
.plan-features li{font-size:.8rem;color:var(--text2);display:flex;align-items:center;gap:.4rem;}
.plan-features li::before{content:"✓";color:var(--green);font-weight:700;flex-shrink:0;}
.plan-badge{display:inline-block;background:var(--green);color:#000;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:.15rem .45rem;border-radius:4px;margin-bottom:.5rem;}
.plan-continue-btn{width:100%;max-width:560px;padding:.9rem;background:var(--blue);border:none;border-radius:10px;color:#fff;font-family:var(--font);font-size:.95rem;font-weight:600;cursor:pointer;transition:opacity .15s;}
.plan-continue-btn:hover{opacity:.88;}
.plan-continue-btn:disabled{opacity:.35;cursor:not-allowed;}
.plan-skip{font-size:.8rem;color:var(--text3);cursor:pointer;margin-top:.75rem;}
.plan-skip:hover{color:var(--text2);}

/* ── User plan badge in topbar ── */
.plan-pill{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:.2rem .55rem;border-radius:5px;background:var(--bdim);color:var(--blue);}
.plan-pill.pro{background:var(--gdim);color:var(--green);}
.plan-pill.starter{background:rgba(77,123,255,.12);color:var(--blue);}
.plan-pill.agency{background:var(--bdim);color:#a855f7;border:1px solid rgba(168,85,247,.3);}

/* ── Upgrade prompt ── */
.upgrade-wall{background:var(--s2);border:1.5px dashed var(--border2);border-radius:12px;padding:2rem;text-align:center;margin:1rem 0;}
.upgrade-wall-icon{font-size:1.75rem;margin-bottom:.75rem;}
.upgrade-wall-h{font-size:.95rem;font-weight:700;margin-bottom:.35rem;}
.upgrade-wall-sub{font-size:.85rem;color:var(--text2);margin-bottom:1.25rem;line-height:1.6;}
.upgrade-wall-btn{background:var(--green);color:#000;border:none;border-radius:8px;padding:.6rem 1.4rem;font-family:var(--font);font-size:.875rem;font-weight:700;cursor:pointer;}
.upgrade-wall-btn:hover{opacity:.88;}
.ai-fix-counter{font-size:.72rem;color:var(--text3);margin-left:.5rem;}
.ai-fix-counter.warn{color:var(--amber);}
.tab-btn.locked{opacity:.45;}
.tab-btn.locked::after{content:" 🔒";font-size:.65rem;}
.upgrade-overlay{position:fixed;inset:0;background:rgba(7,8,15,.88);backdrop-filter:blur(6px);z-index:400;display:flex;align-items:center;justify-content:center;padding:1.5rem;}
.upgrade-modal{background:var(--s1);border:1px solid var(--border);border-radius:16px;width:100%;max-width:440px;padding:2rem;text-align:center;}
.upgrade-modal-badge{display:inline-block;background:var(--green);color:#000;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:.25rem .65rem;border-radius:999px;margin-bottom:1rem;}
.upgrade-modal h2{font-size:1.3rem;font-weight:800;letter-spacing:-.03em;margin-bottom:.5rem;}
.upgrade-modal p{font-size:.875rem;color:var(--text2);margin-bottom:1.5rem;line-height:1.6;}
.upgrade-modal-features{text-align:left;background:var(--s2);border-radius:10px;padding:1rem;margin-bottom:1.5rem;}
.upgrade-modal-features li{font-size:.85rem;color:var(--text2);padding:.3rem 0;list-style:none;display:flex;align-items:center;gap:.5rem;}
.upgrade-modal-features li::before{content:"✓";color:var(--green);font-weight:700;}
.upgrade-modal-cta{width:100%;padding:.85rem;background:var(--green);color:#000;border:none;border-radius:10px;font-family:var(--font);font-size:.95rem;font-weight:700;cursor:pointer;margin-bottom:.75rem;}
.upgrade-modal-cta:hover{opacity:.88;}
.upgrade-modal-skip{font-size:.8rem;color:var(--text3);cursor:pointer;}
.upgrade-modal-skip:hover{color:var(--text2);}

/* ── Content Generator ── */
.cg-wrap{padding:2rem;flex:1;display:flex;flex-direction:column;gap:1.5rem;}
.cg-header{}
.cg-title{font-size:1.1rem;font-weight:700;letter-spacing:-.03em;margin-bottom:.25rem;}
.cg-sub{font-size:.85rem;color:var(--text2);}
.cg-privacy{display:flex;align-items:flex-start;gap:.6rem;background:var(--bdim);border:1px solid rgba(77,123,255,.15);border-radius:8px;padding:.75rem 1rem;font-size:.78rem;color:var(--blue);line-height:1.55;}
.cg-privacy-icon{flex-shrink:0;font-size:.9rem;margin-top:.05rem;}
.cg-grid{display:grid;grid-template-columns:300px 1fr;gap:1.5rem;flex:1;}
.cg-panel{background:var(--s1);border:1px solid var(--border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;}
.cg-panel-hd{background:var(--s3);border-bottom:1px solid var(--border);padding:1rem 1.25rem;}
.cg-panel-hd-title{font-size:.85rem;font-weight:700;margin-bottom:.15rem;color:var(--text);}
.cg-panel-hd-sub{font-size:.72rem;color:var(--text2);}
.cg-panel-bd{padding:1rem 1.25rem;display:flex;flex-direction:column;gap:.85rem;flex:1;}
.cg-field label{display:block;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text2);margin-bottom:.4rem;}
.cg-field input,.cg-field select,.cg-field textarea{width:100%;background:var(--s2);border:1.5px solid var(--border2);border-radius:8px;padding:.6rem .8rem;color:var(--text);font-family:var(--font);font-size:.85rem;outline:none;transition:border-color .2s;}
.cg-field input:focus,.cg-field select:focus,.cg-field textarea:focus{border-color:var(--blue);}
.cg-field select{cursor:pointer;color:var(--text);}
.cg-field textarea{resize:vertical;min-height:72px;line-height:1.5;}
.cg-field input::placeholder,.cg-field textarea::placeholder{color:var(--text3);}
.cg-field-row{display:grid;grid-template-columns:1fr 1fr;gap:.65rem;}
.cg-divider{height:1px;background:var(--border);margin:.25rem 0;}
.cg-gen-btn{width:100%;padding:.75rem;background:var(--blue);color:#fff;border:none;border-radius:8px;font-family:var(--font);font-size:.875rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.5rem;transition:opacity .15s;}
.cg-gen-btn:hover:not(:disabled){opacity:.88;}
.cg-gen-btn:disabled{opacity:.4;cursor:not-allowed;}
.cg-output{background:var(--s1);border:1px solid var(--border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;min-height:500px;}
.cg-toolbar{padding:.65rem 1rem;background:var(--s2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;}
.cg-status{display:flex;align-items:center;gap:.5rem;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);}
.cg-status-dot{width:7px;height:7px;border-radius:50%;background:var(--border2);}
.cg-status-dot.ready{background:var(--green);}
.cg-status-dot.loading{background:var(--blue);animation:pulse 1s ease-in-out infinite;}
.cg-status-dot.error{background:var(--red);}
.cg-actions{display:flex;gap:.5rem;}
.cg-act{padding:.35rem .85rem;border-radius:6px;border:1px solid var(--border);background:var(--s1);font-family:var(--font);font-size:.775rem;font-weight:500;color:var(--text2);cursor:pointer;transition:all .15s;}
.cg-act:hover{border-color:var(--blue);color:var(--blue);}
.cg-act:disabled{opacity:.3;cursor:not-allowed;}
.cg-act.primary{background:var(--blue);color:#fff;border-color:var(--blue);}
.cg-act.primary:hover{opacity:.88;}
.cg-tabs{display:flex;gap:2px;padding:0 1rem;background:var(--s2);border-bottom:1px solid var(--border);}
.cg-tab{padding:.6rem .9rem;background:none;border:none;border-bottom:2px solid transparent;font-family:var(--font);font-size:.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text3);cursor:pointer;margin-bottom:-1px;}
.cg-tab.on{color:var(--blue);border-bottom-color:var(--blue);}
.cg-seo-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;padding:.85rem 1rem;border-bottom:1px solid var(--border);}
.cg-seo-c{background:var(--s2);border-radius:8px;padding:.65rem .85rem;}
.cg-seo-l{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);margin-bottom:.25rem;}
.cg-seo-v{font-size:.8rem;color:var(--text);}
.cg-seo-v.ok{color:var(--green);}
.cg-seo-v.warn{color:var(--amber);}
.cg-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3rem;text-align:center;}
.cg-empty-icon{font-size:2rem;opacity:.25;margin-bottom:.75rem;}
.cg-empty h3{font-size:.95rem;font-weight:600;margin-bottom:.4rem;}
.cg-empty p{font-size:.825rem;color:var(--text2);max-width:240px;line-height:1.6;}
.cg-preview{flex:1;overflow:auto;background:white;}
.cg-preview iframe{width:100%;height:100%;min-height:500px;border:none;display:block;}
.cg-code{flex:1;background:#0d1117;padding:1rem;overflow:auto;}
.cg-code pre{font-family:var(--mono);font-size:.75rem;color:#a8d8d0;line-height:1.65;white-space:pre-wrap;word-break:break-word;}
.cg-error{margin:1rem;padding:.85rem 1rem;background:var(--rdim);border:1px solid var(--red);border-radius:8px;font-size:.83rem;color:var(--red);line-height:1.6;}
.cg-tip{font-size:.75rem;color:var(--text2);line-height:1.5;padding:.65rem .85rem;background:var(--s3);border-radius:7px;border-left:2px solid var(--blue);margin-top:.25rem;}
.cg-loading-msgs{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.75rem;padding:3rem;}
.cg-loading-msgs .spinner{width:22px;height:22px;}
.cg-loading-msg{font-size:.85rem;color:var(--text2);text-align:center;}
@media(max-width:900px){.cg-grid{grid-template-columns:1fr;}}

/* ── Admin panel ── */
.admin-wrap{padding:2rem;flex:1;}
.admin-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;}
.admin-title{font-size:1.1rem;font-weight:700;letter-spacing:-.03em;}
.admin-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.75rem;}
.admin-stat{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:1rem 1.25rem;}
.admin-stat-label{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);margin-bottom:.4rem;}
.admin-stat-value{font-size:1.5rem;font-weight:700;font-family:var(--mono);letter-spacing:-.02em;}
.admin-search{display:flex;gap:.75rem;margin-bottom:1.25rem;flex-wrap:wrap;}
.admin-search-input{flex:1;min-width:200px;background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:.6rem .9rem;color:var(--text);font-family:var(--font);font-size:.875rem;outline:none;}
.admin-search-input:focus{border-color:var(--blue);}
.admin-search-input::placeholder{color:var(--text3);}
.admin-filter{background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:.6rem .9rem;color:var(--text);font-family:var(--font);font-size:.875rem;outline:none;cursor:pointer;}
.admin-table-wrap{background:var(--s1);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.admin-table{width:100%;border-collapse:collapse;}
.admin-table th{text-align:left;padding:.7rem 1rem;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);border-bottom:1px solid var(--border);background:var(--s2);}
.admin-table td{padding:.85rem 1rem;font-size:.85rem;border-bottom:1px solid var(--border);vertical-align:middle;}
.admin-table tr:last-child td{border-bottom:none;}
.admin-table tbody tr{cursor:pointer;transition:background .1s;}
.admin-table tbody tr:hover td{background:var(--s2);}
.admin-table tbody tr.disabled-row td{opacity:.45;}
.plan-badge{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:.2rem .55rem;border-radius:4px;}
.plan-badge.free{background:var(--bdim);color:var(--blue);}
.plan-badge.pro{background:var(--gdim);color:var(--green);}
.plan-badge.agency{background:rgba(168,85,247,.15);color:#a855f7;border:1px solid rgba(168,85,247,.3);}
.status-badge{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:.2rem .55rem;border-radius:4px;}
.status-badge.active{background:var(--gdim);color:var(--green);}
.status-badge.disabled{background:var(--rdim);color:var(--red);}

/* ── User drawer ── */
.drawer-overlay{position:fixed;inset:0;background:rgba(7,8,15,.6);z-index:200;}
.drawer{position:fixed;right:0;top:0;bottom:0;width:420px;background:var(--s1);border-left:1px solid var(--border);z-index:201;overflow-y:auto;display:flex;flex-direction:column;}
.drawer-head{padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
.drawer-close{background:none;border:none;color:var(--text3);font-size:1.3rem;cursor:pointer;padding:0;line-height:1;}
.drawer-close:hover{color:var(--text);}
.drawer-body{padding:1.5rem;flex:1;display:flex;flex-direction:column;gap:1.25rem;}
.drawer-section-label{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--text3);margin-bottom:.65rem;}
.drawer-field{background:var(--s2);border-radius:8px;padding:.75rem 1rem;}
.drawer-field-label{font-size:.68rem;color:var(--text3);margin-bottom:.2rem;}
.drawer-field-value{font-size:.9rem;color:var(--text);font-weight:500;word-break:break-all;}
.drawer-field-value.mono{font-family:var(--mono);font-size:.8rem;}
.drawer-actions{display:flex;flex-direction:column;gap:.6rem;margin-top:auto;padding-top:1.25rem;border-top:1px solid var(--border);}
.drawer-btn{width:100%;padding:.7rem;border-radius:8px;font-family:var(--font);font-size:.875rem;font-weight:600;cursor:pointer;border:none;transition:opacity .15s;}
.drawer-btn:hover{opacity:.88;}
.drawer-btn.upgrade{background:var(--green);color:#000;}
.drawer-btn.downgrade{background:var(--bdim);color:var(--blue);border:1px solid var(--blue);}
.drawer-btn.disable{background:var(--adim);color:var(--amber);border:1px solid var(--amber);}
.drawer-btn.enable{background:var(--gdim);color:var(--green);border:1px solid var(--green);}
.drawer-btn.delete{background:var(--rdim);color:var(--red);border:1px solid var(--red);}
.admin-empty{text-align:center;padding:4rem 2rem;color:var(--text3);}
.admin-empty-icon{font-size:2rem;margin-bottom:.75rem;opacity:.3;}
.admin-refresh{background:none;border:1px solid var(--border);border-radius:7px;padding:.45rem .9rem;color:var(--text2);font-family:var(--font);font-size:.8rem;cursor:pointer;}
.admin-refresh:hover{border-color:var(--blue);color:var(--blue);}

/* ── CRO Modal ── */
.cro-overlay{position:fixed;inset:0;background:rgba(7,8,15,.88);backdrop-filter:blur(6px);z-index:300;display:flex;align-items:center;justify-content:center;padding:1.5rem;}
.cro-modal{background:var(--s1);border:1px solid var(--border);border-radius:16px;width:100%;max-width:580px;max-height:85vh;overflow-y:auto;display:flex;flex-direction:column;}
.cro-modal-head{padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;position:sticky;top:0;background:var(--s1);z-index:1;}
.cro-modal-title{font-size:.95rem;font-weight:700;}
.cro-modal-sub{font-size:.78rem;color:var(--text2);margin-top:.2rem;}
.cro-modal-body{padding:1.5rem;display:flex;flex-direction:column;gap:1.1rem;}
.cro-section-label{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);margin-bottom:.5rem;}
.cro-card{background:var(--s2);border-radius:10px;padding:.9rem 1rem;}
.cro-card-label{font-size:.7rem;font-weight:700;color:var(--text3);margin-bottom:.35rem;}
.cro-card-value{font-size:.875rem;color:var(--text);line-height:1.55;}
.cro-card-actions{display:flex;gap:.5rem;margin-top:.6rem;}
.cro-copy-btn{background:none;border:1px solid var(--border);border-radius:6px;padding:.3rem .75rem;font-family:var(--font);font-size:.75rem;font-weight:600;color:var(--text2);cursor:pointer;transition:all .15s;}
.cro-copy-btn:hover{border-color:var(--green);color:var(--green);}
.cro-copy-btn.copied{background:var(--gdim);border-color:var(--green);color:var(--green);}
.cro-tip-box{background:var(--gdim);border:1px solid rgba(15,219,138,.2);border-radius:8px;padding:.75rem 1rem;font-size:.82rem;color:var(--green);line-height:1.55;}
.cro-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;}
.cro-list{display:flex;flex-direction:column;gap:.4rem;}
.cro-list-item{display:flex;align-items:flex-start;gap:.5rem;font-size:.85rem;color:var(--text2);line-height:1.5;}
.cro-list-item::before{content:"✓";color:var(--green);font-weight:700;flex-shrink:0;}
.cro-list-item.remove::before{content:"✕";color:var(--red);}

/* ── Reports tab ── */
.reports-wrap{padding:2rem;display:flex;flex-direction:column;gap:2rem;}
.reports-section{background:var(--s1);border:1px solid var(--border);border-radius:14px;overflow:hidden;}
.reports-section-head{padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem;}
.reports-section-title{font-size:.95rem;font-weight:700;}
.reports-section-sub{font-size:.78rem;color:var(--text2);margin-top:.15rem;}
.reports-filter-row{display:flex;gap:.4rem;flex-wrap:wrap;}
.reports-filter-btn{background:none;border:1px solid var(--border);border-radius:6px;padding:.3rem .75rem;font-family:var(--font);font-size:.75rem;font-weight:500;color:var(--text2);cursor:pointer;transition:all .15s;}
.reports-filter-btn:hover{border-color:var(--blue);color:var(--blue);}
.reports-filter-btn.high.active{background:var(--rdim);border-color:var(--red);color:var(--red);}
.reports-filter-btn.medium.active{background:var(--adim);border-color:var(--amber);color:var(--amber);}
.reports-filter-btn.low.active{background:var(--gdim);border-color:var(--green);color:var(--green);}
.reports-filter-btn.all.active{background:var(--bdim);border-color:var(--blue);color:var(--blue);}
.reports-charts-row{display:grid;grid-template-columns:240px 1fr;gap:0;align-items:stretch;}
.reports-donut-wrap{padding:1.5rem;border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;}
.reports-donut-legend{display:flex;flex-direction:column;gap:.5rem;width:100%;}
.reports-legend-item{display:flex;align-items:center;gap:.6rem;font-size:.82rem;}
.reports-legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.reports-legend-label{flex:1;color:var(--text2);}
.reports-legend-count{font-weight:700;font-family:var(--mono);color:var(--text);}
.reports-bar-wrap{padding:1.5rem;overflow-x:auto;}
.reports-bar-title{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:1rem;}
.reports-site-row{display:grid;grid-template-columns:140px 1fr auto;gap:.75rem;align-items:center;margin-bottom:.85rem;}
.reports-site-name{font-size:.8rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.reports-bar-track{height:20px;background:var(--s2);border-radius:4px;overflow:hidden;display:flex;}
.reports-bar-total{font-size:.75rem;font-weight:700;font-family:var(--mono);color:var(--text2);white-space:nowrap;}
.reports-perf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1px;background:var(--border);}
.reports-perf-card{background:var(--s1);padding:1.25rem 1.5rem;}
.reports-perf-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-top:.75rem;}
.reports-perf-kpi{background:var(--s2);border-radius:7px;padding:.5rem .65rem;}
.reports-perf-kpi-val{font-size:1rem;font-weight:700;font-family:var(--mono);}
.reports-perf-kpi-lbl{font-size:.65rem;color:var(--text3);margin-top:.15rem;}
.reports-actions-list{display:flex;flex-direction:column;gap:.4rem;margin-top:.85rem;}
.reports-action-item{display:flex;align-items:center;gap:.5rem;font-size:.78rem;color:var(--text2);background:var(--s2);border-radius:6px;padding:.4rem .65rem;}
.reports-priority-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
@media(max-width:800px){.reports-charts-row{grid-template-columns:1fr;}.reports-donut-wrap{border-right:none;border-bottom:1px solid var(--border);}}

/* ── Link Building ── */
.links-wrap{padding:2rem;display:flex;flex-direction:column;gap:2rem;}
.links-section{background:var(--s1);border:1px solid var(--border);border-radius:14px;}
.links-section-head{padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem;}
.links-section-title{font-size:.95rem;font-weight:700;}
.links-section-sub{font-size:.78rem;color:var(--text2);margin-top:.15rem;}
.links-generate-btn{background:var(--green);color:#000;border:none;border-radius:8px;padding:.5rem 1.1rem;font-family:var(--font);font-size:.82rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:.4rem;transition:opacity .15s;}
.links-generate-btn:hover{opacity:.88;}
.links-generate-btn:disabled{opacity:.5;cursor:not-allowed;}
.links-opp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);}
@media(max-width:1200px){.links-opp-grid{grid-template-columns:repeat(2,1fr);}}
.links-opp-card{background:var(--s1);padding:1.25rem 1.5rem;display:flex;flex-direction:column;gap:.65rem;}
.links-opp-type{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:.2rem .55rem;border-radius:4px;display:inline-block;width:fit-content;}
.links-opp-type.easy{background:var(--gdim);color:var(--green);}
.links-opp-type.medium{background:var(--adim);color:var(--amber);}
.links-opp-type.hard{background:var(--rdim);color:var(--red);}
.links-opp-title{font-size:.9rem;font-weight:600;}
.links-opp-desc{font-size:.8rem;color:var(--text2);line-height:1.6;}
.links-opp-meta{display:flex;gap:.5rem;flex-wrap:wrap;}
.links-opp-tag{font-size:.68rem;background:var(--s2);border:1px solid var(--border);border-radius:4px;padding:.15rem .5rem;color:var(--text3);}
.links-opp-actions{display:flex;gap:.5rem;margin-top:.25rem;}
.links-opp-btn{background:none;border:1px solid var(--border);border-radius:6px;padding:.35rem .75rem;font-family:var(--font);font-size:.75rem;font-weight:600;color:var(--text2);cursor:pointer;transition:all .15s;}
.links-opp-btn:hover{border-color:var(--blue);color:var(--blue);}
.links-opp-btn.primary{background:var(--bdim);border-color:var(--blue);color:var(--blue);}
.links-template-tabs{display:flex;gap:0;border-bottom:1px solid var(--border);overflow-x:auto;}
.links-template-tab{padding:.75rem 1.25rem;font-size:.82rem;font-weight:500;color:var(--text2);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;transition:all .15s;}
.links-template-tab.active{color:var(--blue);border-bottom-color:var(--blue);font-weight:700;}
.links-template-body{padding:1.5rem;display:flex;flex-direction:column;gap:1rem;}
.links-template-field{display:flex;flex-direction:column;gap:.4rem;}
.links-template-label{font-size:.75rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;}
.links-template-input{background:var(--s2);border:1px solid var(--border);border-radius:7px;padding:.6rem .85rem;color:var(--text);font-family:var(--font);font-size:.85rem;outline:none;}
.links-template-input:focus{border-color:var(--blue);}
.links-template-output{background:var(--s2);border:1px solid var(--border);border-radius:7px;padding:1rem;font-size:.85rem;color:var(--text);line-height:1.75;white-space:pre-wrap;min-height:180px;}
.links-tracker-cols{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--border);min-height:300px;}
.links-tracker-col{background:var(--s1);display:flex;flex-direction:column;}
.links-tracker-col-head{padding:.75rem 1rem;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
.links-tracker-col-count{background:var(--s2);border-radius:999px;padding:.1rem .45rem;font-size:.65rem;}
.links-tracker-cards{padding:.65rem;display:flex;flex-direction:column;gap:.5rem;flex:1;}
.links-prospect-card{background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:.75rem .85rem;cursor:pointer;transition:border-color .15s;}
.links-prospect-card:hover{border-color:var(--blue);}
.links-prospect-domain{font-size:.82rem;font-weight:600;color:var(--text);}
.links-prospect-type{font-size:.72rem;color:var(--text3);margin-top:.15rem;}
.links-prospect-date{font-size:.68rem;color:var(--text3);margin-top:.35rem;}
.links-add-btn{background:none;border:1px dashed var(--border);border-radius:8px;padding:.65rem;width:100%;font-family:var(--font);font-size:.78rem;color:var(--text3);cursor:pointer;transition:all .15s;margin-top:.25rem;}
.links-add-btn:hover{border-color:var(--blue);color:var(--blue);}
.links-add-form{background:var(--s2);border:1px solid var(--blue);border-radius:8px;padding:.75rem;}
.links-add-input{background:var(--s1);border:1px solid var(--border);border-radius:6px;padding:.45rem .65rem;color:var(--text);font-family:var(--font);font-size:.8rem;width:100%;outline:none;margin-bottom:.4rem;}
.links-add-input:focus{border-color:var(--blue);}
.links-add-row{display:flex;gap:.4rem;}
.links-add-save{background:var(--blue);color:#fff;border:none;border-radius:6px;padding:.4rem .75rem;font-family:var(--font);font-size:.75rem;font-weight:600;cursor:pointer;}
.links-add-cancel{background:none;border:1px solid var(--border);border-radius:6px;padding:.4rem .75rem;font-family:var(--font);font-size:.75rem;color:var(--text2);cursor:pointer;}
.links-dashboard-card{background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:1.25rem 1.5rem;}
.links-dashboard-row{display:flex;align-items:center;gap:1rem;padding:.6rem 0;border-bottom:1px solid var(--border);}
.links-dashboard-row:last-child{border-bottom:none;}
.links-dashboard-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.links-dashboard-text{flex:1;font-size:.82rem;color:var(--text2);}
.links-dashboard-badge{font-size:.68rem;font-weight:700;text-transform:uppercase;padding:.15rem .45rem;border-radius:4px;}
@media(max-width:900px){.links-tracker-cols{grid-template-columns:1fr 1fr;}.links-opp-grid{grid-template-columns:1fr;}}

/* ── GSC Site Picker ── */
.site-picker-overlay{position:fixed;inset:0;background:rgba(7,8,15,.88);backdrop-filter:blur(6px);z-index:400;display:flex;align-items:center;justify-content:center;padding:1.5rem;}
.site-picker-modal{background:var(--s1);border:1px solid var(--border);border-radius:16px;width:100%;max-width:520px;max-height:80vh;display:flex;flex-direction:column;}
.site-picker-head{padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);}
.site-picker-title{font-size:.95rem;font-weight:700;margin-bottom:.25rem;}
.site-picker-sub{font-size:.8rem;color:var(--text2);}
.site-picker-list{overflow-y:auto;flex:1;padding:.75rem;}
.site-picker-item{display:flex;align-items:center;gap:.75rem;padding:.75rem .85rem;border-radius:8px;cursor:pointer;transition:background .1s;border:1px solid transparent;margin-bottom:.4rem;}
.site-picker-item:hover{background:var(--s2);}
.site-picker-item.selected{background:var(--bdim);border-color:rgba(77,123,255,.25);}
.site-picker-checkbox{width:18px;height:18px;border-radius:4px;border:2px solid var(--border);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;transition:all .15s;}
.site-picker-item.selected .site-picker-checkbox{background:var(--blue);border-color:var(--blue);color:#fff;}
.site-picker-url{font-size:.85rem;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.site-picker-type{font-size:.7rem;color:var(--text3);margin-top:.1rem;}
.site-picker-foot{padding:1rem 1.5rem;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;}
.site-picker-count{font-size:.8rem;color:var(--text2);}
.site-picker-confirm{background:var(--blue);color:#fff;border:none;border-radius:8px;padding:.65rem 1.25rem;font-family:var(--font);font-size:.875rem;font-weight:600;cursor:pointer;}
.site-picker-confirm:disabled{opacity:.4;cursor:not-allowed;}
.site-picker-confirm:hover:not(:disabled){opacity:.88;}
.site-picker-search{width:100%;background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:.6rem .85rem;color:var(--text);font-family:var(--font);font-size:.85rem;outline:none;margin-bottom:.5rem;}
.site-picker-search::placeholder{color:var(--text3);}
.site-picker-search:focus{border-color:var(--blue);}

/* ── Clerk overrides ── */
.cl-socialButtonsBlockButton{background:#fff!important;color:#333!important;border:1px solid #ddd!important;font-weight:600!important;}
.cl-socialButtonsBlockButton:hover{background:#f5f5f5!important;}
.cl-socialButtonsBlockButtonText{color:#333!important;}
.cl-formFieldInput{background:var(--s2)!important;border:1px solid var(--border2)!important;color:var(--text)!important;}
.cl-formFieldInput:focus{border-color:var(--blue)!important;}

/* ── Onboarding Tour ── */
.tour-overlay{position:fixed;inset:0;z-index:10000;pointer-events:none;}
.tour-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;transition:opacity .3s;}
.tour-spotlight{position:fixed;z-index:10001;border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,.65);pointer-events:none;transition:all .35s ease;}
.tour-tooltip{position:fixed;z-index:10002;background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:1.25rem 1.5rem;max-width:340px;box-shadow:0 16px 48px rgba(0,0,0,.5);pointer-events:all;animation:tourFadeIn .3s ease;}
.tour-tooltip-title{font-size:.95rem;font-weight:700;color:var(--text);margin-bottom:.5rem;display:flex;align-items:center;gap:.5rem;}
.tour-tooltip-body{font-size:.82rem;color:var(--text2);line-height:1.65;margin-bottom:1rem;}
.tour-tooltip-footer{display:flex;align-items:center;justify-content:space-between;gap:.75rem;}
.tour-dots{display:flex;gap:.35rem;}
.tour-dot{width:7px;height:7px;border-radius:50%;background:var(--border2);transition:all .2s;}
.tour-dot.active{background:var(--green);width:18px;border-radius:4px;}
.tour-dot.done{background:var(--green);}
.tour-skip{background:none;border:none;color:var(--text3);font-size:.78rem;cursor:pointer;font-family:inherit;padding:.3rem .5rem;}
.tour-skip:hover{color:var(--text2);}
.tour-next{background:var(--green);color:#000;border:none;border-radius:8px;padding:.5rem 1.1rem;font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit;transition:opacity .15s;}
.tour-next:hover{opacity:.88;}
.tour-arrow{position:absolute;width:12px;height:12px;background:var(--s1);border:1px solid var(--border);transform:rotate(45deg);}
.tour-arrow.left{left:-7px;top:24px;border-right:none;border-top:none;}
.tour-arrow.right{right:-7px;top:24px;border-left:none;border-bottom:none;}
.tour-arrow.top{top:-7px;left:24px;border-bottom:none;border-right:none;}
.tour-arrow.bottom{bottom:-7px;left:24px;border-top:none;border-left:none;}
.tour-step-num{background:var(--green);color:#000;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:800;flex-shrink:0;}
@keyframes tourFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`;

// ── SEO Glossary — plain English tooltips for non-technical users ──
const SEO_TIPS = {
  ctr: "Click-through rate — the percentage of people who see your site in Google and actually click on it. Most sites average 2-5%. Higher is better.",
  impressions: "The number of times your site appeared in Google search results. High impressions with low clicks means your titles and descriptions need improving.",
  clicks: "How many times someone clicked on your site from Google search results in the selected period.",
  position: "Your average ranking position in Google. Position 1-3 means you're near the top. Position 10 = bottom of page 1. Position 11+ = page 2 or beyond.",
  avgPosition: "The average of all your keyword positions in Google. Lower numbers are better — position 1 is the top spot.",
  keyword: "A word or phrase that people type into Google. Your goal is to rank as high as possible for keywords relevant to your business.",
  h1: "The main heading on a page — like the title of a newspaper article. Every page should have exactly one H1 that includes your target keyword.",
  h2: "Subheadings that break your content into sections. They help readers scan the page and help Google understand your content structure.",
  metaDesc: "A short summary (about 155 characters) that appears below your page title in Google results. A good meta description encourages people to click.",
  titleTag: "The clickable blue headline that appears in Google search results. Put your main keyword near the front (in the first 50-60 characters). Titles can extend up to ~100 characters when the additional words add real value — Google indexes the full title; it just may not be visible in full on narrow screens.",
  canonical: "A tag that tells Google which version of a page is the 'official' one. Prevents duplicate content issues if you have similar pages.",
  schema: "Structured data (JSON-LD) that helps Google understand what your page is about. Can trigger rich results like star ratings, FAQs, and event details.",
  openGraph: "Tags that control how your page looks when shared on social media (Facebook, LinkedIn, Twitter). Includes the title, description, and image shown.",
  internalLinks: "Links from one page on your site to another page on your site. They help visitors navigate and help Google discover and rank all your pages.",
  backlinks: "Links from other websites pointing to yours. Google treats these as votes of confidence — more quality backlinks generally means higher rankings.",
  pillarPage: "A comprehensive, long-form page (2,000-3,000 words) that covers a broad topic in depth. It acts as the central hub that cluster posts link back to.",
  clusterPost: "A shorter blog post (800-1,200 words) that covers a specific subtopic in detail and links back to the pillar page. Together they build topical authority.",
  topicalAuthority: "When Google sees your site as an expert on a topic because you have multiple, interlinked pages covering it thoroughly. Leads to higher rankings for the whole cluster.",
  haro: "Help A Reporter Out — a free platform where journalists post requests for expert quotes. If you respond and get quoted, you usually get a backlink to your site.",
  guestPost: "An article you write for someone else's website. In return, you typically get a link back to your site within the article or author bio.",
  resourcePage: "A page on another website that lists helpful links and tools for their audience. Getting your site listed here earns you a relevant backlink.",
  brokenLink: "A link on someone else's site that leads to a page that no longer exists (404 error). You can contact them and suggest your content as a replacement — earning a backlink.",
  domainProperty: "A way to verify your site in Google Search Console that covers all versions (www, non-www, http, https) at once, verified via DNS.",
  cta: "Call to Action — a button or link that tells visitors what to do next, like 'Get a free quote', 'Book a call', or 'Download the guide'. The clearest CTAs convert best.",
  cro: "Conversion Rate Optimisation — the process of improving your website so more visitors take the action you want (buy, enquire, sign up). Small changes can have a big impact.",
  strikingDistance: "Keywords where you rank between positions 11-20 (page 2 of Google). With some optimisation, these are the easiest to push onto page 1 where they'll get significantly more clicks.",
  viewport: "A meta tag that tells mobile browsers how to display your page. Without it, your site may look tiny on phones. Essential for mobile-friendly pages.",
  ssl: "HTTPS (SSL certificate) encrypts the connection between your site and visitors. Google uses it as a ranking factor and browsers show 'Not Secure' warnings without it.",
  wordCount: "The number of words on a page. Pages with fewer than 300 words often struggle to rank because Google sees them as 'thin content'. Aim for 800+ for blog posts.",
  pageSpeed: "How fast your page loads. Slow pages frustrate visitors and rank lower in Google. Under 3 seconds is good, under 1 second is excellent.",
  altText: "A text description added to images that tells Google (and screen readers) what the image shows. Include relevant keywords where natural.",
  noFollow: "A tag on a link that tells Google not to pass ranking power through it. Some backlinks are nofollow — they're still valuable for traffic but don't directly boost rankings.",
  rankTracker: "Monitors your keyword positions in Google over time. Shows whether your SEO work is moving the needle — positions going up means your changes are working.",
  weeklyDigest: "An automated email sent every Monday morning with your key metrics compared to last week, your top 3 actions, and keywords close to reaching page 1.",
  aiReadiness: "How well your page is structured for AI search engines like Google AI Overviews, ChatGPT, and Perplexity. Higher scores mean AI is more likely to cite your content as a source.",
  faqSchema: "Structured FAQ markup that lets AI search engines extract your questions and answers directly. One of the strongest signals for appearing in AI-generated answers.",
};

// ── Tooltip component ──
const Tip = ({ term, children, label }) => {
  const text = SEO_TIPS[term];
  if (!text) return children || label || null;
  return (
    <span className="tip-trigger" tabIndex={0}>
      {children || label}
      <span className="tip-icon">i</span>
      <span className="tip-bubble">{text}</span>
    </span>
  );
};

// ── Benchmark helper ──
const Benchmark = ({ value, thresholds }) => {
  // thresholds: { good: [min, max], ok: [min, max] } — anything outside is bad
  if (!thresholds || value == null) return null;
  const v = parseFloat(value);
  if (isNaN(v)) return null;
  const { good, ok, goodLabel, okLabel, badLabel, invert } = thresholds;
  let level, label;
  if (invert) {
    // Lower is better (e.g. position)
    level = v <= good ? "good" : v <= ok ? "ok" : "bad";
    label = v <= good ? (goodLabel||"excellent") : v <= ok ? (okLabel||"average") : (badLabel||"needs work");
  } else {
    // Higher is better (e.g. CTR)
    level = v >= good ? "good" : v >= ok ? "ok" : "bad";
    label = v >= good ? (goodLabel||"above average") : v >= ok ? (okLabel||"average") : (badLabel||"below average");
  }
  return <span className={`benchmark ${level}`}>{label}</span>;
};

const DEMO_KPI = [
  { label:"Organic Traffic", value:"2,847", delta:"↓ 8%",    pos:false, sub:"vs last week",  source:"demo" },
  { label:"Impressions",     value:"74,200",delta:"↓ 5%",    pos:false, sub:"vs last week",  source:"demo" },
  { label:"Avg. Position",   value:"14.2",  delta:"↑ 1.3",   pos:false, sub:"lower = better",source:"demo" },
  { label:"Click Rate",      value:"3.8%",  delta:"↑ 0.2pp", pos:true,  sub:"avg CTR",       source:"demo" },
];

const DEMO_FIXES = [
  { id:"f1", level:"high",   color:"#f03e5f", label:"HIGH IMPACT", type:"SEO", demo:true,
    title:"Improve homepage ranking",
    desc:"Your homepage ranks outside the top 5 for your main keyword — a title tag update could move you into the top 3.",
    m1:"Position: #7", m2:"Target: Top 3",
    suggestion:"Rewrite your title tag to include your primary keyword in the first 60 characters with a clear value proposition.",
    field:"Title Tag", current:"Homepage | Your Business Name",
    recommended:"Primary Keyword | Clear Value Proposition | Brand",
    metaDesc:"Connect Google Search Console to see your real keyword data and get specific AI suggestions for your site." },
  { id:"f2", level:"medium", color:"#f5a623", label:"OPPORTUNITY",  type:"CRO", demo:true,
    title:"Increase conversions on your key service page",
    desc:"Your main service page gets good traffic but converts below the industry average.",
    m1:"Conv: below avg", m2:"Industry: 2.1%",
    suggestion:"Move your primary CTA above the fold and make the benefit clear in the button text.",
    field:"CTA Copy", current:"Contact us", recommended:"Get a free quote today", metaDesc:null },
  { id:"f3", level:"low",    color:"#0fdb8a", label:"QUICK WIN",    type:"SEO", demo:true,
    title:"Add internal links to orphan pages",
    desc:"Several pages on your site have no inbound links, limiting their Google authority.",
    m1:"Orphan pages", m2:"Easy fix",
    suggestion:"Add 3–5 contextual internal links from your most visited pages to these orphaned pages.",
    field:"Internal Links", current:"0 links", recommended:"3–5 links each", metaDesc:null },
];

const DEMO_SEO = [
  { page:"/",        kw:"your main keyword",       pos:7,  vol:"connect GSC", gap:"Add keyword to title tag and H1",      opp:true  },
  { page:"/services",kw:"your service keyword",    pos:18, vol:"connect GSC", gap:"Rewrite H1 and meta title",            opp:true  },
  { page:"/about",   kw:"your brand keyword",      pos:24, vol:"connect GSC", gap:"Expand page content to 800+ words",    opp:false },
  { page:"/contact", kw:"local service keyword",   pos:31, vol:"connect GSC", gap:"Add location-specific content",        opp:false },
];

const ISSUES_DATA = [
  {
    t:"error", icon:"⚠", label:"Missing meta descriptions",
    fixCategory:"meta",
    summary:"4 pages have no meta description — Google writes its own, often poorly.",
    fix:"Write a unique 145-155 character meta description for each page to improve click-through rate.",
    pages:[
      { url:"/services/",     detail:"No meta description set",                     priority:"high"   },
      { url:"/about/",        detail:"No meta description set",                     priority:"high"   },
      { url:"/contact/",      detail:"No meta description set",                     priority:"medium" },
      { url:"/case-studies/", detail:"No meta description set",                     priority:"medium" },
    ]
  },
  {
    t:"warning", icon:"⏱", label:"Slow page speed",
    fixCategory:"pagespeed",
    summary:"2 pages load slowly on mobile — Google uses mobile speed as a ranking factor.",
    fix:"Compress images, enable lazy loading and remove unused JavaScript to improve load time.",
    pages:[
      { url:"/services/", detail:"Load time: 4.8s on mobile · Images not compressed", priority:"high"   },
      { url:"/",          detail:"Load time: 3.9s on mobile · Render-blocking JS",     priority:"medium" },
    ]
  },
  {
    t:"warning", icon:"🔗", label:"Broken internal links",
    fixCategory:"broken_links",
    summary:"3 internal links point to pages that no longer exist — this wastes link authority.",
    fix:"Update each broken link to point to the correct current page, or remove it entirely.",
    pages:[
      { url:"/blog/",    detail:'Link to "/old-services/" returns 404',   priority:"high"   },
      { url:"/about/",   detail:'Link to "/team/" returns 404',           priority:"medium" },
      { url:"/contact/", detail:'Link to "/pricing-old/" returns 404',    priority:"medium" },
    ]
  },
  {
    t:"info", icon:"📋", label:"Missing schema markup",
    fixCategory:"schema",
    summary:"6 pages have no structured data — schema helps Google display rich results.",
    fix:"Add LocalBusiness, Article or FAQ schema to help Google understand your pages better.",
    pages:[
      { url:"/",          detail:"Missing: LocalBusiness schema",   priority:"high"   },
      { url:"/services/", detail:"Missing: Service schema",         priority:"high"   },
      { url:"/about/",    detail:"Missing: Organization schema",    priority:"medium" },
      { url:"/blog/",     detail:"Missing: Blog / Article schema",  priority:"medium" },
      { url:"/contact/",  detail:"Missing: ContactPage schema",     priority:"low"    },
      { url:"/faq/",      detail:"Missing: FAQPage schema",         priority:"low"    },
    ]
  },
];

const CONV_DATA = [
  {
    page:"/services", rate:"0.4%", traffic:"840/mo",
    industryAvg:"2.1%",
    issue:"CTA buried below the fold",
    issueDetail:"Your primary call-to-action button sits 1,200px down the page. Most visitors leave before seeing it. Moving it above the fold typically increases conversions by 50–200%.",
    action:"Move CTA & rewrite copy",
    fixType:"cta",
    currentCta:"Contact us",
    context:"Services page for a professional services business",
  },
  {
    page:"/pricing", rate:"0.8%", traffic:"290/mo",
    industryAvg:"2.1%",
    issue:"No social proof near the CTA",
    issueDetail:"Visitors reach your pricing page but leave without converting. There are no testimonials, reviews or trust signals near the pricing options — buyers need reassurance before committing.",
    action:"Add testimonials above CTA",
    fixType:"social_proof",
    currentCta:"Get started",
    context:"Pricing page — visitors are considering buying",
  },
  {
    page:"/contact", rate:"1.2%", traffic:"1.2k/mo",
    industryAvg:"3.5%",
    issue:"Contact form has 7 fields",
    issueDetail:"Your contact form asks for: name, email, phone, company, job title, message and how did you hear about us. Every additional field reduces completion rate by ~10%. A 3-field form typically converts 3x better.",
    action:"Reduce form to 3 fields",
    fixType:"form",
    currentCta:"Submit",
    context:"Contact page — visitors want to get in touch",
  },
];

// ─── AI helper — routes through Worker to avoid CORS ─────────
// Authenticated fetch helper — includes Clerk session token
async function authFetch(url, options = {}) {
  const token = await _getToken();
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
 
  return fetch(url, { ...options, headers });
}

// Initiate Google OAuth. Browser navigation can't send headers, so we
// pass the Clerk JWT as a short-lived query param. The worker verifies
// it the same way it verifies header-borne JWTs.
async function startGoogleOAuth() {
  const token = await _getToken();
  if (!token) {
    alert("You need to be signed in to connect Google. Please sign in and try again.");
    return;
  }
  window.location.href = `${WORKER_URL}/auth/google?token=${encodeURIComponent(token)}`;
}

async function callClaude(userMsg, systemMsg, mode = 'standard') {
  const res = await authFetch(`${WORKER_URL}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userMsg, systemMsg, mode }),
  });
  if (res.status === 403) {
    const d = await res.json();
    if (d.upgrade) throw new Error('UPGRADE_REQUIRED:' + d.error);
    throw new Error(d.error || 'Forbidden');
  }
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) throw new Error(`AI request failed: ${res.status}`);
  const d = await res.json();
  return d.text || "";
}

// ─── Main component ───────────────────────────────────────────
export default function RankActions() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut, session }           = useClerk();

  // Keep the module-level token getter in sync with the current session
  useEffect(() => {
    _getToken = async () => {
      try {
        // Try Clerk session from useClerk
        if (session?.getToken) return await session.getToken();
        // Try window.Clerk as fallback
        if (window.Clerk?.session?.getToken) return await window.Clerk.session.getToken();
        return null;
      } catch { return null; }
    };
    // Also wire the userData persistence layer to use this same session token.
    setUserDataTokenGetter(_getToken);
  }, [session]);

  // ─── Theme: respect the user's OS-level light/dark preference ───────────────
  // The app defaults to dark. We set data-theme="light" on the root element when
  // the OS preference is light, which activates the [data-theme="light"] CSS
  // overrides defined at the top of the stylesheet.
  //
  // We ALSO track the current theme as React state — needed because the Clerk
  // sign-in widget is a third-party component that doesn't read our CSS
  // variables. It receives colours via an `appearance` prop, which we re-compute
  // when the theme changes.
  //
  // No localStorage / no manual toggle yet — that's a future iteration.
  // The runtime listener catches the case where the user switches their OS
  // theme while the app is open.
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  useEffect(() => {
    const applyTheme = () => {
      const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const next = prefersLight ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      setTheme(next);
    };
    applyTheme();
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    // Some older browsers use addListener instead of addEventListener — handle both
    if (mq.addEventListener) {
      mq.addEventListener('change', applyTheme);
      return () => mq.removeEventListener('change', applyTheme);
    } else if (mq.addListener) {
      mq.addListener(applyTheme);
      return () => mq.removeListener(applyTheme);
    }
  }, []);

  // Clerk widget appearance — re-built per theme so the sign-in/sign-up forms
  // and UserButton dropdown match the current theme. Light-mode colours mirror
  // the CSS variables in [data-theme="light"]{...}.
  const clerkAppearance = theme === 'light'
    ? { variables: { colorPrimary:"#2563eb", colorBackground:"#ffffff", colorInputBackground:"#fafaf7", colorText:"#0d0d0d", colorTextSecondary:"#4a4a4a", colorInputText:"#0d0d0d", borderRadius:"10px" } }
    : { variables: { colorPrimary:"#4d7bff", colorBackground:"#0c0e1a", colorInputBackground:"#07080f", colorText:"#dde2f5", colorTextSecondary:"#8590b8", colorInputText:"#dde2f5", borderRadius:"10px" } };

  // Auth UI state
  const [authView,  setAuthView]  = useState("signin"); // signin | signup
  const [showPlan,  setShowPlan]  = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  // RankActions Assist — guided weekly-action state. "Done" and "visited" are
  // persisted per-site in localStorage (keys ra_assist_done_<site> /
  // ra_assist_visited_<site>) so progress survives refresh and is separate
  // per site. A reset control lets the user show all tasks again.
  const [sproutOpen, setSproutOpen] = useState(false);
  const [sproutDismissed, setSproutDismissed] = useState(false);
  const loadAssistSet = (prefix) => {
    try {
      const site = localStorage.getItem("rankactions_selectedSite") || "mywebsite.com";
      return new Set(JSON.parse(localStorage.getItem(`ra_assist_${prefix}_${site}`) || "[]"));
    } catch { return new Set(); }
  };
  const [sproutDoneKeys, setSproutDoneKeys] = useState(() => loadAssistSet("done"));
  // Tasks the user has been taken to via "Show me how" but not yet confirmed
  // as complete. These stay in the list; Assist asks for confirmation on return.
  const [sproutVisitedKeys, setSproutVisitedKeys] = useState(() => loadAssistSet("visited"));
  const [plan,      setPlan]      = useState(() => localStorage.getItem("rankactions_plan") || "free");
  const [selPlan,   setSelPlan]   = useState(plan || "free");

  // Auth & real data
  const [userId,       setUserId]       = useState(null);
  const [isConnected,  setIsConnected]  = useState(false);
  const [siteData,     setSiteData]     = useState(null);
  const [dataLoading,  setDataLoading]  = useState(false);
  const [dataError,    setDataError]    = useState(null);

  // UI
  const [screen,       setScreen]       = useState("onboarding");
  const [step,         setStep]         = useState(1);
  const [urlInput,     setUrlInput]     = useState("");
  const [progress,     setProgress]     = useState(0);
  const [tasks,        setTasks]        = useState([false,false,false]);
  const [selectedSite, setSelectedSite] = useState(() => localStorage.getItem("rankactions_selectedSite") || "mywebsite.com");
  
  // Clean display name — strips sc-domain: and protocol for UI
  const displaySite = (s) => (s || "").replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const [sites,        setSites]        = useState(() => JSON.parse(localStorage.getItem("rankactions_sites") || '["mywebsite.com"]'));
  const [addingSite,   setAddingSite]   = useState(false);
  const [newSiteInput, setNewSiteInput] = useState("");
  const [siteOpen,     setSiteOpen]     = useState(false);
  const [activeTab,    setActiveTab]    = useState("Overview");
  // currentView toggles between the portfolio dashboard (Agency+ feature) and
  // the single-site experience. The default is set in a separate effect once
  // plan + sites are known. `arrivedFromPortfolio` tracks whether the user
  // drilled into the current site from the portfolio (vs picking it directly
  // via the dropdown) so we can show the "← Back to Portfolio" breadcrumb.
  const [currentView, setCurrentView] = useState("site");
  const [arrivedFromPortfolio, setArrivedFromPortfolio] = useState(false);
  const [expandedFix,  setExpandedFix]  = useState(null);
  // doneFixes stays a Set of fix IDs so every existing .has() read is unchanged.
  // doneMeta carries the detail needed to MEASURE impact later: when the fix was
  // marked done, and which keyword it related to. Without a timestamp there is no
  // way to compare Search Console data before vs after a change.
  const [doneFixes,    setDoneFixes]    = useState(() => {
    try {
      const site = localStorage.getItem("rankactions_selectedSite") || "mywebsite.com";
      return new Set(normaliseDoneRecords(JSON.parse(localStorage.getItem(`ra_done_${site}`) || "[]")).ids);
    } catch { return new Set(); }
  });
  const [doneMeta,     setDoneMeta]     = useState(() => {
    try {
      const site = localStorage.getItem("rankactions_selectedSite") || "mywebsite.com";
      return normaliseDoneRecords(JSON.parse(localStorage.getItem(`ra_done_${site}`) || "[]")).meta;
    } catch { return {}; }
  });
  const [copiedId,     setCopiedId]     = useState(null);
  // Manually hidden keywords, shared across Site Detail and the Rank Tracker.
  // Some GSC queries are real but useless — personal names, domain-history noise —
  // and no syntax filter can reliably catch them, so the user decides. Previously
  // this lived only inside the Rank Tracker, so junk could be hidden there while
  // still being served as the top Priority Action.
  const [hiddenKws, setHiddenKws] = useState(() => {
    try {
      const site = localStorage.getItem("rankactions_selectedSite") || "mywebsite.com";
      return new Set(JSON.parse(localStorage.getItem(`ra_hidden_kw_${site}`) || "[]"));
    } catch { return new Set(); }
  });
  const persistHidden = (next, site) => {
    try { localStorage.setItem(`ra_hidden_kw_${site}`, JSON.stringify([...next])); } catch {}
  };
  const hideKeywordGlobal = (keyword) => {
    setHiddenKws(prev => { const next = new Set(prev); next.add(keyword); persistHidden(next, selectedSite); return next; });
  };
  const unhideKeywordGlobal = (keyword) => {
    setHiddenKws(prev => { const next = new Set(prev); next.delete(keyword); persistHidden(next, selectedSite); return next; });
  };
  // Mark a fix complete, stamping WHEN and WHICH KEYWORD so impact can later be
  // measured against Search Console snapshots. Always use this rather than
  // setDoneFixes directly, or the record lands without a timestamp.
  const markFixDone = (fix) => {
    const id = typeof fix === "string" ? fix : fix?.id;
    if (!id) return;
    const kw = (fix && typeof fix === "object")
      ? (fix.kw || (String(fix.title || "").match(/"([^"]+)"/) || [])[1] || null)
      : null;
    setDoneFixes(prev => new Set([...prev, id]));
    setDoneMeta(prev => (prev[id]?.ts ? prev : { ...prev, [id]: { ts: new Date().toISOString(), kw } }));
  };
  const [aiSummary,    setAiSummary]    = useState(null);
  const [summaryLoading,setSummaryLoading] = useState(false);
  const [modal,        setModal]        = useState(null);
  const [modalData,    setModalData]    = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalApplied, setModalApplied] = useState(new Set());
  // Real on-page state (title/meta/H1) for the page a fix refers to, fetched when
  // the modal opens. Recommending a new title without reading the current one was
  // the single most-reported accuracy problem; this is what grounds it in reality.
  const [modalPageMeta, setModalPageMeta] = useState(null);
  const [indexingStatus, setIndexingStatus] = useState(null); // null | 'loading' | 'success' | 'error'
  const [indexingMsg, setIndexingMsg] = useState("");

  // Default landing for Agency + Enterprise users with 2+ sites: portfolio view.
  // Fires once per browser session (sessionStorage flag) so we don't fight the
  // user if they manually navigate to a single-site view. The session flag
  // resets on tab close, giving each new session the portfolio-first default.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (sessionStorage.getItem("rankactions_landing_decided") === "1") return;
    if ((plan === "agency" || plan === "enterprise") && sites.length >= 2) {
      setCurrentView("portfolio");
    }
    sessionStorage.setItem("rankactions_landing_decided", "1");
  }, [isLoaded, isSignedIn, plan, sites.length]);

  const requestIndexing = async (pageUrl) => {
    setIndexingStatus("loading");
    try {
      // Build the full URL robustly:
      // - If pageUrl is already absolute, use it as-is
      // - Otherwise: strip sc-domain: prefix from the site, strip any existing http(s):// (to avoid double-prefixing),
      //   strip trailing slashes, and ensure the path starts with /
      let fullUrl;
      if (pageUrl.startsWith("http://") || pageUrl.startsWith("https://")) {
        fullUrl = pageUrl;
      } else {
        const domain = selectedSite
          .replace(/^sc-domain:/, "")
          .replace(/^https?:\/\//, "")
          .replace(/\/+$/, "");
        const path = pageUrl.startsWith("/") ? pageUrl : `/${pageUrl}`;
        fullUrl = `https://${domain}${path}`;
      }
      const uid = userId || localStorage.getItem("rankactions_userId") || "";
      const res = await authFetch(`${WORKER_URL}/api/request-indexing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl: fullUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setIndexingStatus("success");
        setIndexingMsg(`Re-crawl requested. Google typically processes this within 1–7 days.`);
        setTimeout(() => { setIndexingStatus(null); setIndexingMsg(""); }, 5000);
      } else {
        setIndexingStatus("error");
        // Surface Google's actual error message when available — far more useful than our generic wrapper
        const googleMsg = data.detail?.error?.message;
        const statusCode = data.detail?.error?.code;
        setIndexingMsg(googleMsg ? `[${statusCode || '?'}] ${googleMsg}` : (data.error || "Request failed"));
        // Keep errors visible for 15s so they can actually be read
        setTimeout(() => { setIndexingStatus(null); setIndexingMsg(""); }, 15000);
      }
    } catch (err) {
      setIndexingStatus("error");
      setIndexingMsg(err.message);
      setTimeout(() => { setIndexingStatus(null); setIndexingMsg(""); }, 15000);
    }
  };
  const contentPresetRef = useRef(null);
  const [croModal,   setCroModal]   = useState(null);
  const [croData,    setCroData]    = useState(null);
  const [croLoading, setCroLoading] = useState(false);

  // ── Link building state ────────────────────────────────────
  const [linkOpps,       setLinkOpps]       = useState([]);
  const [linkOppsLoading,setLinkOppsLoading]= useState(false);
  const [linkTemplate,   setLinkTemplate]   = useState("guest_post");
  const [linkTemplateTarget, setLinkTemplateTarget] = useState("");
  const [linkTemplateContext, setLinkTemplateContext] = useState("");
  const linkTemplateContextRef = useRef("");
  const [linkTemplateOutput,  setLinkTemplateOutput]  = useState("");
  const [linkTemplateLoading, setLinkTemplateLoading] = useState(false);
  const [linkProspects,  setLinkProspects]  = useState(() => {
    try { const site = localStorage.getItem("rankactions_selectedSite") || "mywebsite.com"; return JSON.parse(localStorage.getItem(`ra_prospects_${site}`) || "[]"); } catch { return []; }
  });
  const [availableGscSites, setAvailableGscSites] = useState([]);
  const [gscSitesLoading,   setGscSitesLoading]   = useState(false);
  const [showTour,   setShowTour]   = useState(false);
  const [tourStep,   setTourStep]   = useState(0);
  const [isAdminFlag, setIsAdminFlag] = useState(false);
  // Rank Tracker state
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  // Page Audit state
  const [auditUrl, setAuditUrl] = useState("");
  const [auditData, setAuditData] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [perfData, setPerfData] = useState(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [aiFixCount,   setAiFixCount]   = useState(() => {
    const stored = JSON.parse(localStorage.getItem("rankactions_ai_fix_usage") || '{"count":0,"month":""}');
    const thisMonth = new Date().toISOString().slice(0,7);
    if (stored.month !== thisMonth) return 0; // reset each month
    return stored.count;
  });
  const [showUpgrade,  setShowUpgrade]  = useState(false);
  const [planBilling,  setPlanBilling]  = useState("monthly");
  const [gscSitePicker, setGscSitePicker] = useState(null); // list of sites to pick from // for plan selection screen

  // ── Browser tab title ─────────────────────────────────────
  useEffect(() => { document.title = "RankActions"; }, []);

  // ── Plan helpers ────────────────────────────────────────────
  const isAgency  = plan === "agency";
  const isPro     = plan === "pro" || plan === "business" || isAgency;   // business = Pro-level features
  const isStarter = plan === "starter" || plan === "individual" || isPro; // individual = Starter-level paid
  const isPaid    = isStarter;
  const AI_FIX_LIMIT = isPro ? Infinity : (plan === "starter" || plan === "individual") ? 20 : 5;
  const aiFixesLeft = AI_FIX_LIMIT === Infinity ? Infinity : Math.max(0, AI_FIX_LIMIT - aiFixCount);

  const trackAiFixUsage = () => {
    const thisMonth = new Date().toISOString().slice(0,7);
    const newCount  = aiFixCount + 1;
    setAiFixCount(newCount);
    localStorage.setItem("rankactions_ai_fix_usage", JSON.stringify({ count:newCount, month:thisMonth }));
  };

  // ── Fetch plan from Worker on Clerk sign-in ────────────────
  // This ensures plan persists across browsers/devices
  // Falls back to localStorage if Worker has no record yet
  useEffect(() => {
    if (!isSignedIn || !user?.id) return;
    const clerkId = user.id;
    const userId  = localStorage.getItem("rankactions_userId") || "";

    const profileUrl = `${WORKER_URL}/api/user/profile`;
	authFetch(profileUrl)
      .then(r => r.json())
      .then(data => {
        if (data.found) {
          // Server has a plan record — use it as source of truth
          if (data.plan && data.plan !== plan) {
            setPlan(data.plan);
            localStorage.setItem("rankactions_plan", data.plan);
          }
          // Check admin flag
          if (data.isAdmin) setIsAdminFlag(true);
          // Restore sites if server has more
          if (data.sites?.length > 0 && data.sites.length >= sites.length) {
            setSites(data.sites);
            localStorage.setItem("rankactions_sites", JSON.stringify(data.sites));
          }
          // Mark plan as chosen so selection screen doesn't show
          if (data.plan && data.plan !== "free") {
            localStorage.setItem("rankactions_plan_chosen", "1");
            setShowPlan(false);
          }
        } else if (!localStorage.getItem("rankactions_plan_chosen")) {
          // No server record and no local choice — show plan selection
          setShowPlan(true);
        }
      })
      .catch(() => {
        // Network error — fall back to localStorage behaviour
        if (!localStorage.getItem("rankactions_plan_chosen")) setShowPlan(true);
      });
  }, [isSignedIn, user?.id]);

  // ── Show plan selection on first sign-in (localStorage fallback) ──
  useEffect(() => {
    if (isSignedIn && !localStorage.getItem("rankactions_plan_chosen")) {
      // Only show if the profile fetch hasn't already handled it
      setTimeout(() => {
        if (!localStorage.getItem("rankactions_plan_chosen")) setShowPlan(true);
      }, 1500);
    }
  }, [isSignedIn]);

  // ── On mount: check if returning from Google OAuth ──────────
  // The Worker redirects back with ?auth=success after Google OAuth.
// We then fetch the user's profile (server-side source of truth) to
// learn the userId / connected sites, since the URL no longer carries
// these for security reasons (C2/C6/C10 fixes).
  useEffect(() => {
	  if (!isLoaded || !isSignedIn || !session) return;
    const params      = new URLSearchParams(window.location.search);
    const result      = params.get("auth");
    const saved       = localStorage.getItem("rankactions_userId");
    const savedSite   = localStorage.getItem("rankactions_selectedSite");
    const savedSites  = localStorage.getItem("rankactions_sites");
	console.log("[OAuth-return] mount. result=", result, "saved=", localStorage.getItem("rankactions_userId"));

    if (result === "error" || result === "login_required") {
      setDataError("Google connection failed. Please try again.");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    const isFreshOAuth = result === "success";

    if (isFreshOAuth) {
      // Fresh OAuth return — fetch profile to get the userId the worker
      // stored against our Clerk session, then load GSC sites.
      authFetch(`${WORKER_URL}/api/user/profile`)
        .then(r => r.json())
        .then(profile => {
    if (!profile.found) {
		setDataError("Connection succeeded but profile sync didn't complete. Please refresh.");
		return;
}

		console.log("[OAuth-return] profile fetched:", profile, "uid:", profile.userId, "found:", profile.found);
		const uid = profile.userId || user?.id;
		setUserId(uid);
		setIsConnected(true);
		if (uid) localStorage.setItem("rankactions_userId", uid);

          return authFetch(`${WORKER_URL}/api/gsc-sites`)
            .then(r => r.json())
            .then(data => {
              const gscSites = data.sites || [];
              const pendingSite = localStorage.getItem("rankactions_pending_site") || "";
              localStorage.removeItem("rankactions_pending_site");

              if (gscSites.length === 0) {
                const fallback = pendingSite || "mywebsite.com";
                setSelectedSite(fallback);
                localStorage.setItem("rankactions_selectedSite", fallback);
                setSites([fallback]);
                localStorage.setItem("rankactions_sites", JSON.stringify([fallback]));
              } else if (gscSites.length === 1) {
                const site = gscSites[0].siteUrl;
                setSelectedSite(site);
                localStorage.setItem("rankactions_selectedSite", site);
                setSites([site]);
                localStorage.setItem("rankactions_sites", JSON.stringify([site]));
              } else {
                setGscSitePicker({ sites: gscSites, pending: pendingSite });
              }
            });
        })
        .catch(() => {
          const fallback = localStorage.getItem("rankactions_pending_site") || savedSite || "mywebsite.com";
          localStorage.removeItem("rankactions_pending_site");
          setSelectedSite(fallback);
          localStorage.setItem("rankactions_selectedSite", fallback);
          setSites([fallback]);
          localStorage.setItem("rankactions_sites", JSON.stringify([fallback]));
        });

      window.history.replaceState({}, "", window.location.pathname);
      setScreen("dashboard");
    } else if (saved) {
      // Returning user — restore from localStorage and trust the saved userId
      setUserId(saved);
      setIsConnected(true);
      if (savedSite && savedSite !== "mywebsite.com") setSelectedSite(savedSite);
      if (savedSites) setSites(JSON.parse(savedSites));
      setScreen("dashboard");
    }
  }, [isLoaded, isSignedIn, session]);

  // ── Sync user data to Worker for admin panel ───────────────
  useEffect(() => {
    if (!user?.id) return;
    const syncName = user?.fullName || user?.firstName || user?.username || "";
    const syncEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || "";
    const syncSites = sites.filter(s => s && s !== "mywebsite.com");
    // Don't sync if no real sites connected yet — avoids overwriting with empty
    const body = {
      userId,
      clerkId:    user.id,
      plan,
      aiFixCount,
      name:  syncName,
      email: syncEmail,
    };
    if (syncSites.length > 0) body.sites = syncSites;
    authFetch(`${WORKER_URL}/api/user/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).catch(()=>{});
  }, [plan, sites, aiFixCount, user?.id, selectedSite]);

  // ── Fetch data when userId or site changes ──────────────────
  useEffect(() => {
    if (userId && selectedSite && screen !== "onboarding") fetchSiteData();
  }, [userId, selectedSite]);

  // ── Reload per-site state when site changes ─────────────────
  useEffect(() => {
    if (!selectedSite) return;
    let cancelled = false;
    const site = selectedSite;
    // Load done + prospects from the server (loadUserData falls back to
    // localStorage automatically if the server is unreachable). The `cancelled`
    // guard drops stale results if the site changes again before these resolve.
    (async () => {
      // doneFixes — load, then apply Option B legacy-id migration.
      // Hidden keywords are per-site; reload alongside the rest of this site's data.
      try { setHiddenKws(new Set(JSON.parse(localStorage.getItem(`ra_hidden_kw_${site}`) || "[]"))); }
      catch { setHiddenKws(new Set()); }

      const rawDone = await loadUserData(site, 'done');
      if (cancelled || site !== selectedSite) return;
      // Accept legacy (string[]) and current ({id,ts,kw}[]) shapes alike.
      const { ids: loadedIds, meta: loadedMeta } = normaliseDoneRecords(
        Array.isArray(rawDone) ? rawDone : []
      );
      const migrated = migrateDoneIds(
        loadedIds,
        siteData?.topOpportunities,
        siteData?.keywords
      );
      // Carry metadata across the id migration where the id is unchanged.
      const migratedMeta = {};
      for (const id of migrated) migratedMeta[id] = loadedMeta[id] || { ts: null, kw: null };
      setDoneFixes(new Set(migrated));
      setDoneMeta(migratedMeta);
      // Persist back if ids changed OR the stored shape was still legacy.
      const wasLegacy = (Array.isArray(rawDone) ? rawDone : []).some(e => typeof e === "string");
      if (wasLegacy ||
          JSON.stringify([...migrated].sort()) !== JSON.stringify([...loadedIds].sort())) {
        saveUserData(site, 'done', serialiseDoneRecords(new Set(migrated), migratedMeta));
      }
    })();
    (async () => {
      const rawProspects = await loadUserData(site, 'prospects');
      if (cancelled || site !== selectedSite) return;
      setLinkProspects(Array.isArray(rawProspects) ? rawProspects : []);
    })();
    // Snapshots power the completed-action impact panel (Reports). Best-effort:
    // a failure just means the panel shows nothing, never blocks the dashboard.
    (async () => {
      setSnapshotsLoading(true);
      try {
        // MUST match the normalisation the Rank Tracker uses when SAVING, because
        // snapshots are keyed by the exact siteUrl string (snapshots:<clerk>:<url>).
        // Asking for "example.com" when they were stored under "https://example.com"
        // silently returns nothing.
        const snapSiteUrl = (site.startsWith("http") || site.startsWith("sc-domain:")) ? site : `https://${site}`;
        const res = await authFetch(`${WORKER_URL}/api/rank-snapshots?siteUrl=${encodeURIComponent(snapSiteUrl)}`);
        const data = res.ok ? await res.json() : null;
        if (cancelled || site !== selectedSite) return;
        setSnapshots(Array.isArray(data?.snapshots) ? data.snapshots : []);
      } catch {
        if (!cancelled && site === selectedSite) setSnapshots([]);
      } finally {
        if (!cancelled && site === selectedSite) setSnapshotsLoading(false);
      }
    })();
    // Hydrate the remaining types from the server into the localStorage cache.
    // These are read synchronously elsewhere; loadUserData write-throughs to
    // localStorage on a successful server read, so after a cache wipe the
    // synchronous reads find server-backed data once hydration completes.
    // Fire-and-forget — we don't hold dedicated React state for all of them.
    ['strategy', 'strategy_history', 'content_history', 'link_history', 'starting_out', 'kw_enrich']
      .forEach((t) => { loadUserData(site, t); });
    // Clear cached link opps and AI summary (they're site-specific)
    setLinkOpps([]);
    setAiSummary(null);
    return () => { cancelled = true; };
  }, [selectedSite]);

  // ── Persist doneFixes whenever they change ──────────────────
  useEffect(() => {
    if (!selectedSite) return;
    // saveUserData writes localStorage immediately AND the server (debounced).
    saveUserData(selectedSite, 'done', serialiseDoneRecords(doneFixes, doneMeta));
  }, [doneFixes, doneMeta, selectedSite]);

  // ── RankActions Assist: reload per-site progress when the site changes ──
  // Tracks which site the in-memory sets belong to, so the save effect below
  // doesn't clobber a site's stored data with another site's keys during the
  // render where selectedSite has just changed.
  const assistLoadedSite = useRef(localStorage.getItem("rankactions_selectedSite") || "mywebsite.com");
  useEffect(() => {
    if (!selectedSite) return;
    if (assistLoadedSite.current === selectedSite) return;
    assistLoadedSite.current = selectedSite;
    try {
      setSproutDoneKeys(new Set(JSON.parse(localStorage.getItem(`ra_assist_done_${selectedSite}`) || "[]")));
      setSproutVisitedKeys(new Set(JSON.parse(localStorage.getItem(`ra_assist_visited_${selectedSite}`) || "[]")));
    } catch {
      setSproutDoneKeys(new Set());
      setSproutVisitedKeys(new Set());
    }
  }, [selectedSite]);

  // ── RankActions Assist: persist progress whenever it changes ──
  useEffect(() => {
    if (!selectedSite || assistLoadedSite.current !== selectedSite) return;
    try { localStorage.setItem(`ra_assist_done_${selectedSite}`, JSON.stringify([...sproutDoneKeys])); } catch {}
  }, [sproutDoneKeys, selectedSite]);
  useEffect(() => {
    if (!selectedSite || assistLoadedSite.current !== selectedSite) return;
    try { localStorage.setItem(`ra_assist_visited_${selectedSite}`, JSON.stringify([...sproutVisitedKeys])); } catch {}
  }, [sproutVisitedKeys, selectedSite]);

  // ── Show onboarding tour on first dashboard visit ──────────
  useEffect(() => {
    if (screen === "dashboard" && isSignedIn && selectedSite && selectedSite !== "mywebsite.com" && !gscSitePicker && !localStorage.getItem("ra_tour_complete")) {
      const timer = setTimeout(() => setShowTour(true), 1200);
      return () => clearTimeout(timer);
    }
  }, [screen, isSignedIn, selectedSite, gscSitePicker]);

  // ── Handle Stripe checkout return ─────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe") === "success") {
      setTimeout(async () => {
        try {
          const res = await authFetch(`${WORKER_URL}/api/user/profile`);
          const data = await res.json();
          if (data.found && data.plan) {
            setPlan(data.plan);
            localStorage.setItem("rankactions_plan", data.plan);
          }
        } catch {}
      }, 2000);
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("stripe") === "cancelled") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // ── Onboarding step 3 progress animation ───────────────────
  useEffect(() => {
    if (screen !== "onboarding" || step !== 3) return;
    setProgress(0); setTasks([false,false,false]);
    let p = 0;
    const tid = setInterval(() => {
      p += Math.random() * 11 + 4;
      if (p > 100) p = 100;
      setProgress(p);
      setTasks([p>=33, p>=66, p>=95]);
      if (p >= 100) { clearInterval(tid); setTimeout(()=>setStep(4), 700); }
    }, 380);
    return () => clearInterval(tid);
  }, [screen, step]);

  // ── Auto-generate summary when data is ready ──────────────
  // dataLoading===false does NOT mean the data arrived — it is also false BEFORE
  // the fetch starts. This effect used to fire on mount while siteData was still
  // null, so the summary was written from the "not connected" branch and cached,
  // leaving the dashboard telling the user to connect Search Console while the
  // KPI cards beside it showed live GSC figures. Wait for the data to actually
  // land before spending an AI call on it.
  useEffect(() => {
    if (screen !== "dashboard" || aiSummary || summaryLoading || dataLoading) return;
    if (isConnected && !siteData) return;   // connected, data still on its way
    generateSummary();
  }, [screen, siteData, dataLoading, isConnected]);

  // ─────────────────────────────────────────────────────────────
  // Fetch real Search Console data from the Worker
  // ─────────────────────────────────────────────────────────────
  const fetchSiteData = async () => {
    setDataLoading(true); setDataError(null);
    try {
      const siteUrl = selectedSite.startsWith("http") || selectedSite.startsWith("sc-domain:") ? selectedSite : `https://${selectedSite}`;
      const res = await authFetch(
        `${WORKER_URL}/api/search-console?siteUrl=${encodeURIComponent(siteUrl)}`
      );
      if (!res.ok) throw new Error((await res.json()).error || "Failed to load data");
      setSiteData(await res.json());
      setAiSummary(null); // reset so it regenerates with real numbers
    } catch(err) {
      setDataError(err.message);
    }
    setDataLoading(false);
  };

  // ─────────────────────────────────────────────────────────────
  // Data helpers — real data when connected, demo when not
  // ─────────────────────────────────────────────────────────────
  const getKpiData = () => {
    if (!siteData) return DEMO_KPI;
    const t = siteData.totals;
    const ctrNum = parseFloat(t.avgCtr);
    const posNum = parseFloat(t.avgPosition);
    return [
      { label:"Organic Clicks", value:t.clicks.toLocaleString(), delta:"last 28 days", pos:true, sub:"clicks", source:"live", tip:"clicks" },
      { label:"Impressions",    value:t.impressions.toLocaleString(), delta:"last 28 days", pos:true, sub:"search appearances", source:"live", tip:"impressions" },
      { label:"Avg. Position",  value:String(t.avgPosition), delta:"from GSC", pos:null, sub:"lower = better", source:"live", tip:"avgPosition",
        bench: <Benchmark value={posNum} thresholds={{good:10,ok:20,invert:true,goodLabel:"page 1",okLabel:"page 2",badLabel:"page 3+"}}/> },
      { label:"Click Rate",     value:t.avgCtr, delta:"from GSC", pos:true, sub:"avg CTR", source:"live", tip:"ctr",
        bench: <Benchmark value={ctrNum} thresholds={{good:4,ok:2,goodLabel:"above avg",okLabel:"average",badLabel:"below avg"}}/> },
    ];
  };

  const getPriorityFixes = () => {
    if (!siteData) return DEMO_FIXES;                 // unconnected -> sales demo
    if (!siteData.topOpportunities?.length) return []; // connected, no data yet -> empty state
    const colors = ["#f03e5f","#f5a623","#0fdb8a"];
    const labels = ["HIGH IMPACT","OPPORTUNITY","QUICK WIN"];
    const levels = ["high","medium","low"];
    // Filter out completed fixes AND non-targetable GSC noise (search-operator
    // strings, embedded-quote verbatim queries, over-long phrases) — the same
    // isUsableKeyword guard getSeoRows uses. Without this, raw operator queries
    // like '"professional services" -jobs -careers ...' surface as HIGH IMPACT
    // actions, which aren't real keywords a user can target.
    const allOpps = (siteData.topOpportunities || []).filter((opp) => isUsableKeyword(opp.keyword));
    const available = allOpps.filter((opp) =>
      !doneFixes.has(`live-${raSlug(opp.keyword)}`) && !hiddenKws.has(opp.keyword));
    // If all top ones are done, pull from deeper in the list
    const opps = available.length > 0 ? available : allOpps.slice(3, 6);
    if (opps.length === 0) return [];                 // connected, nothing qualifying -> empty state
    return opps.slice(0,3).map((opp,i) => {
      return {
        id: `live-${raSlug(opp.keyword)}`,
        // Landing page this keyword actually ranks on (worker resolves it from
        // Search Console's query->page mapping). Null-safe: older cached siteData
        // has no page, and openModal falls back to the site root as before.
        page:    opp.page || null,
        pageUrl: opp.pageUrl || null,
        level:levels[Math.min(i, 2)], color:colors[Math.min(i, 2)], label:labels[Math.min(i, 2)], type:"SEO",
        title:`Improve ranking for "${opp.keyword}"`,
        desc:`Currently at position #${opp.position}. ${opp.potential}.`,
        m1:`Position: #${opp.position}`, m2:opp.potential,
        suggestion:opp.fix,
        field:"Page Content & Title",
        current:`Not fully optimised for "${opp.keyword}"`,
        recommended:opp.fix,
        metaDesc:null,
      };
    });
  };

  const getSeoRows = () => {
    if (!siteData?.keywords?.length) return DEMO_SEO;
    // Filter out GSC noise queries — embedded-quote exact-match searches and
    // unusually long phrases are almost always document text leaking through
    // (e.g. someone Googling a verbatim phrase from an indexed PDF). These
    // aren't real SEO opportunities and clutter the actionable list.
    const usable = siteData.keywords.filter(k => isUsableKeyword(k.keyword));
    if (usable.length === 0) return DEMO_SEO;
    return usable.slice(0,15).map(k => {
      let gap, action;
      if (k.position <= 10) {
        gap    = "Add keyword to title tag and H1";
        action = "fix_title";
      } else if (k.position <= 20) {
        gap    = "Create a dedicated page for this keyword";
        action = "write_page";
      } else {
        gap    = "Write a blog post targeting this keyword";
        action = "write_blog";
      }
      // k.page now comes from Search Console's query→page mapping (worker-side).
      // Older cached siteData won't have it, so keep the placeholder as fallback.
      return { page:k.page || "—", pageUrl:k.pageUrl || null, kw:k.keyword, pos:k.position, vol:`${k.impressions}/mo`, gap, action, opp:k.opportunity };
    });
  };

  // ─────────────────────────────────────────────────────────────
  // Audit filter helpers — skip non-HTML resources (PDFs, images, etc)
  // and low-signal GSC queries (verbatim document text, embedded quotes).
  // Page audits, schema checks, page-speed recs and CTA suggestions are
  // only meaningful for HTML pages; running them against a PDF produces
  // nonsense like "move CTA above the fold" on a downloadable file.
  // ─────────────────────────────────────────────────────────────
  const isAuditablePage = (url) => {
    if (!url || typeof url !== 'string') return false;
    const path = url.toLowerCase().split('?')[0].split('#')[0];
    // Match file extensions at end of path (optionally followed by trailing slash)
    return !/\.(pdf|docx?|xlsx?|pptx?|zip|rar|gz|tar|jpe?g|png|gif|webp|svg|ico|mp[34]|mov|avi|webm|wav|ogg|xml|json|csv|txt|epub|rtf)\/?$/i.test(path);
  };

  const isUsableKeyword = (kw) => {
    if (!kw || typeof kw !== 'string') return false;
    if (kw.includes('"')) return false;                       // exact-match quoted searches — usually document text
    if (kw.includes(':')) return false;                       // colons rarely appear in real searches — system text like "rank: 2"
    if (/(^|\s)-\S/.test(kw)) return false;                   // minus-operator exclusions (e.g. "-jobs -careers") — a scraped search-operator string, not a real keyword
    if (/\b(OR|AND)\b/.test(kw) || kw.includes('|')) return false; // boolean operators — search-query syntax, not a keyword
    if (kw.split(/\s+/).length > 12) return false;            // > 12-word phrases are document text, not SEO targets
    if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(kw)) return false; // contains a date — almost always document text
    if (/^\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.test(kw.trim())) return false; // relative-time strings ("3 months ago") — scraped page text, not searches
    return true;
  };

  // ─────────────────────────────────────────────────────────────
  // Dynamic Issues data — site-specific, uses real GSC data where available
  // ─────────────────────────────────────────────────────────────
  const getIssuesData = (site, data) => {
    // Only audit HTML pages. PDF/document/image URLs get excluded from
    // schema, page-speed, broken-link and meta-description checks since
    // none of those recommendations apply to non-HTML resources.
    const pagesPool = (data?.pages || []).filter(p => isAuditablePage(p.page));

    // Use real low-CTR pages from GSC if available
    const lowCtrPages = pagesPool
      .filter(p => parseFloat(p.ctr) < 0.02 && p.clicks > 5)
      .slice(0, 4)
      .map(p => ({
        url:      p.page.replace(/^https?:\/\/[^/]+/,"") || "/",
        detail:   `No meta description set · CTR ${(p.ctr*100).toFixed(1)}% (avg ${(data.totals.avgCtr*100).toFixed(1)}%)`,
        priority: p.clicks > 50 ? "high" : "medium",
      }));

    const slowPages = [...pagesPool]
      .sort((a,b) => b.impressions - a.impressions)
      .slice(0, 2)
      .map(p => ({
        url:    p.page.replace(/^https?:\/\/[^/]+/,"") || "/",
        detail: `High traffic page — run a Page Audit for Core Web Vitals and speed recommendations`,
        priority: "medium",
      }));

    // Use real pages from GSC for schema and broken links if available
    const realPages = pagesPool.slice(0, 6).map(p => ({
      url:      p.page.replace(/^https?:\/\/[^/]+/, "") || "/",
      clicks:   p.clicks,
      impressions: p.impressions,
    }));

    const metaPages = lowCtrPages.length > 0 ? lowCtrPages : (
      realPages.length > 0
        ? realPages.slice(0, 4).map(p => ({ url: p.url, detail: "No meta description set", priority: p.clicks > 50 ? "high" : "medium" }))
        : [
            { url:`/services/`,     detail:"No meta description set",     priority:"high"   },
            { url:`/about/`,        detail:"No meta description set",     priority:"high"   },
            { url:`/contact/`,      detail:"No meta description set",     priority:"medium" },
            { url:`/blog/`,         detail:"No meta description set",     priority:"medium" },
          ]
    );

    const speedPages = slowPages.length > 0 ? slowPages : (
      realPages.length > 0
        ? realPages.slice(0, 2).map(p => ({ url: p.url, detail: "Run a Page Audit for speed score and Core Web Vitals", priority: "medium" }))
        : [
            { url:`/`,          detail:"Run a Page Audit for speed score and Core Web Vitals", priority:"medium" },
            { url:`/services/`, detail:"Run a Page Audit for speed score and Core Web Vitals", priority:"medium" },
          ]
    );

    const brokenPages = realPages.length > 0
      ? realPages.slice(0, 2).map(p => ({
          url:      p.url,
          detail:   `Check internal links on this page — verify manually or connect a crawler`,
          priority: "medium",
        }))
      : [
          { url:`/blog/`,    detail:`Check internal links — verify manually`, priority:"medium" },
          { url:`/about/`,   detail:`Check internal links — verify manually`, priority:"low"    },
        ];

    const schemaPages = realPages.length > 0
      ? realPages.slice(0, 4).map((p, i) => {
          const path = p.url.toLowerCase();
          const schemaType = path === "/" || path === ""           ? "LocalBusiness schema"
                           : path.includes("service")             ? "Service schema"
                           : path.includes("about")               ? "Organization schema"
                           : path.includes("contact")             ? "ContactPage schema"
                           : path.includes("blog") || path.includes("post") ? "Article schema"
                           : path.includes("faq")                 ? "FAQPage schema"
                           : path.includes("product")             ? "Product schema"
                           : "WebPage schema";
          return {
            url:      p.url,
            detail:   `Missing: ${schemaType}`,
            priority: i < 2 ? "high" : "medium",
          };
        })
      : [
          { url:`/`,          detail:`Missing: LocalBusiness schema`,  priority:"high"   },
          { url:`/services/`, detail:`Missing: Service schema`,        priority:"high"   },
          { url:`/about/`,    detail:`Missing: Organization schema`,   priority:"medium" },
          { url:`/contact/`,  detail:`Missing: ContactPage schema`,    priority:"low"    },
        ];

    return [
      {
        t:"error", icon:"⚠", label:"Missing meta descriptions",
        fixCategory:"meta",
        summary:`${metaPages.length} pages on ${site} have no meta description — Google writes its own, often poorly.`,
        fix:"Write a unique 145-155 character meta description for each page to improve click-through rate.",
        pages: metaPages,
      },
      {
        t:"warning", icon:"⏱", label:"Slow page speed",
        fixCategory:"pagespeed",
        summary:`Key pages on ${site} may load slowly on mobile — Google uses mobile speed as a ranking factor. Use Page Audit for detailed scores.`,
        fix:"Compress images, enable lazy loading and remove unused JavaScript to improve load time. Run a Page Audit on any URL for Core Web Vitals and specific recommendations.",
        pages: speedPages,
      },
      {
        t:"warning", icon:"🔗", label:"Broken internal links",
        fixCategory:"broken_links",
        summary:`Potential broken links detected on ${site} — connect a crawler to verify.`,
        fix:"Check each link and update or remove any that return 404 errors.",
        pages: brokenPages,
      },
      {
        t:"info", icon:"📋", label:"Missing schema markup",
        fixCategory:"schema",
        summary:`Pages on ${site} are missing structured data — schema helps Google show rich results.`,
        fix:"Add LocalBusiness, Service or FAQ schema to help Google understand your pages better.",
        pages: schemaPages,
      },
    ];
  };

  // ─────────────────────────────────────────────────────────────
  // Dynamic Conversion data — site-specific, uses GSC page data
  // ─────────────────────────────────────────────────────────────
  const getConvData = (site, data) => {
    // Conversion analysis only applies to HTML pages — a PDF doesn't have a
    // CTA to move above the fold or a form to simplify.
    const topPages = (data?.pages || []).filter(p => isAuditablePage(p.page)).slice(0, 3);

    if (topPages.length > 0) {
      return topPages.map(p => {
        const path = p.page.replace(/^https?:\/\/[^/]+/,"") || "/";
        const traffic = p.clicks >= 1000 ? `${(p.clicks/1000).toFixed(1)}k/mo` : `${p.clicks}/mo`;
        // Derive likely conversion issue based on page path
        const isContact  = path.includes("contact");
        const isPricing  = path.includes("pric") || path.includes("plan");
        const isServices = path.includes("service") || path.includes("product");
        const issue      = isContact  ? "Contact form may have too many fields"
                         : isPricing  ? "No social proof near the pricing CTA"
                         : isServices ? "CTA may be buried below the fold"
                         : "Potential conversion opportunity — check page layout";
        const fixType    = isContact ? "form" : isPricing ? "social_proof" : "cta";
        const action     = isContact ? "Simplify contact form"
                         : isPricing ? "Add testimonials above CTA"
                         : "Move CTA above the fold";
        return {
          page:        path,
          rate:        `${(Math.random()*1.5+0.3).toFixed(1)}%`,
          traffic,
          industryAvg: "2.1%",
          issue,
          issueDetail: `This page gets ${traffic} of traffic but likely converts below average. ${issue}.`,
          action,
          fixType,
          currentCta:  "Contact us",
          context:     `${path} page on ${site}`,
        };
      });
    }

    // Demo fallback — keyed to the actual site domain
    return [
      {
        page:`/services/`, rate:"0.4%", traffic:"840/mo",
        industryAvg:"2.1%",
        issue:"CTA may be buried below the fold",
        issueDetail:`Your services page on ${site} gets good traffic but likely converts below the industry average. Moving the CTA higher typically increases conversions by 50–200%.`,
        action:"Move CTA & rewrite copy",
        fixType:"cta", currentCta:"Contact us",
        context:`Services page on ${site}`,
      },
      {
        page:`/pricing/`, rate:"0.8%", traffic:"290/mo",
        industryAvg:"2.1%",
        issue:"No social proof near the CTA",
        issueDetail:`Visitors on ${site}'s pricing page may leave without converting — adding testimonials near your CTA typically improves conversion rate significantly.`,
        action:"Add testimonials above CTA",
        fixType:"social_proof", currentCta:"Get started",
        context:`Pricing page on ${site}`,
      },
      {
        page:`/contact/`, rate:"1.2%", traffic:"1.2k/mo",
        industryAvg:"3.5%",
        issue:"Contact form may have too many fields",
        issueDetail:`If your contact form on ${site} has more than 3 fields, reducing it will increase completion rate. Every extra field reduces conversions by ~10%.`,
        action:"Simplify contact form",
        fixType:"form", currentCta:"Submit",
        context:`Contact page on ${site}`,
      },
    ];
  };
  // ─────────────────────────────────────────────────────────────
  const generateSummary = async () => {
    // Never write a "connect Search Console" summary for a site that IS connected
    // — it contradicts the KPI cards and wastes an AI call. If the data has not
    // arrived, leave the panel empty; the effect above re-runs when it does.
    if (isConnected && !siteData) return;
    setSummaryLoading(true);
    try {
      const context = siteData
        ? `REAL DATA for ${selectedSite}: ${siteData.totals.clicks.toLocaleString()} clicks, ${siteData.totals.impressions.toLocaleString()} impressions in 28 days. Avg position: ${siteData.totals.avgPosition}. CTR: ${siteData.totals.avgCtr}. Top opportunity: "${siteData.topOpportunities[0]?.keyword}" at #${siteData.topOpportunities[0]?.position}.`
        : `DEMO DATA: Connect Google Search Console to see your real traffic, rankings, and opportunities.`;
      const txt = await callClaude(
        `Generate a 3-bullet AI weekly summary using this data:\n${context}\nFormat: exactly 3 bullet points starting with •. Each max 18 words. Use the actual numbers.`,
        "Output exactly 3 bullet points starting with •. Nothing else."
      );
      setAiSummary(txt.trim());
    } catch {
      setAiSummary(siteData
        ? `• Site received ${siteData.totals.clicks.toLocaleString()} clicks from ${siteData.totals.impressions.toLocaleString()} impressions this month\n• Average position ${siteData.totals.avgPosition} — ${siteData.topOpportunities.length} keywords have ranking opportunities\n• CTR is ${siteData.totals.avgCtr} — improving title tags could push this higher`
        : "• Connect Google Search Console to see your real traffic and ranking data\n• Your top keywords and positions will appear here once connected\n• AI will generate specific actions based on your actual site performance"
      );
    }
    setSummaryLoading(false);
  };

  // ─────────────────────────────────────────────────────────────
  // Fix modal
  // ─────────────────────────────────────────────────────────────
  const openModal = async (fix) => {
    if (fix.demo) {
      // Demo/example cards must never generate AI suggestions. The keyword extraction
      // below falls back to fix.current, which for demo cards is the placeholder
      // "Homepage | Your Business Name" — the prompt then REQUIRES that placeholder in
      // every suggestion. Serve canned example copy instead (keyword-first, brand-last).
      setModal(fix);
      setModalData({
        option1: "Example: Primary Keyword | Clear Value Proposition | Brand Name",
        option2: "Example: What You Do in Your Location — Key Benefit | Brand Name",
        metaDesc: "This is an example action. Connect Google Search Console and suggestions will be generated from your real pages and keywords.",
        tip: "Connect Google Search Console for AI suggestions based on your live data"
      });
      setModalLoading(false);
      return;
    }
    if (!isPro && aiFixCount >= AI_FIX_LIMIT) { setShowUpgrade(true); return; }
    if (!isPro) trackAiFixUsage();
    setModal(fix); setModalData(null); setModalLoading(true); setModalPageMeta(null);
    try {
      const category    = fix.fixCategory || null;
      // Prefer the full URL resolved from Search Console; fall back to the old
      // construction (and finally the site root) so nothing regresses.
      // displaySite() strips "sc-domain:" and any scheme. Without it, domain
      // properties produce "https://sc-domain:example.com", which is not a valid
      // URL — the old code had this latent bug and it would break /api/page-meta.
      const siteHost    = displaySite(selectedSite);
      // Did Search Console actually tell us which page this keyword ranks on?
      // If not, we must NOT audit the homepage as a stand-in: a long-tail keyword
      // usually ranks on a deep article, and showing the homepage's title as "your
      // current title" would be confidently wrong — the exact failure this feature
      // exists to prevent. Falling back to the site root for the prompt's "Page
      // being optimised" line is fine; auditing it is not.
      const resolvedPageUrl = fix.pageUrl || (fix.page ? `https://${siteHost}${fix.page}` : null);
      const pageUrl     = resolvedPageUrl || `https://${siteHost}`;

      // Read the page as it is TODAY. Best-effort: any failure leaves pageMeta
      // null and the prompt falls back to its previous, ungrounded form.
      let pageMeta = null;
      if (resolvedPageUrl) try {
        const pmRes = await authFetch(`${WORKER_URL}/api/page-meta`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: resolvedPageUrl }),
        });
        if (pmRes.ok) {
          const pm = await pmRes.json();
          if (pm?.ok && (pm.title || pm.metaDesc || pm.h1)) { pageMeta = pm; setModalPageMeta(pm); }
        }
      } catch { /* non-fatal — recommendation still works without it */ }

      const currentStateBlock = pageMeta
        ? `\nTHE PAGE'S CURRENT ON-PAGE CONTENT (read live from ${pageMeta.finalUrl || pageUrl} just now — this is what is published RIGHT NOW):
- Current title tag: ${pageMeta.title ? `"${pageMeta.title}"` : "(none found)"}
- Current meta description: ${pageMeta.metaDesc ? `"${pageMeta.metaDesc}"` : "(none found)"}
- Current H1: ${pageMeta.h1 ? `"${pageMeta.h1}"` : "(none found)"}
- Approx word count: ${pageMeta.wordCount || "unknown"}
Your suggestions MUST be genuine improvements on the CURRENT title and description above — not generic rewrites. Preserve the brand name and anything factually specific (locations, services, product names) that already appears. If the current title is already strong, say so in the tip and make only a targeted improvement.\n`
        : "";
      const topKwsShort = siteData?.keywords?.slice(0,5).map(k=>k.keyword).join(", ") || "not connected";
      const topKwsFull  = siteData?.keywords?.slice(0,8).map(k=>`"${k.keyword}" (pos #${k.position}, ${k.impressions} impressions/mo)`).join(", ") || "unknown";
      const allKws      = siteData?.keywords?.map(k=>k.keyword).join(", ") || "";
      const keyword     = fix.title.match(/"([^"]+)"/)?.[1] || fix.current?.replace(/Not fully optimised for |"/g,"") || "";
      const siteContext = siteData
        ? `Site: ${selectedSite}. All ranking keywords: ${allKws}. Top keywords: ${topKwsFull}. Avg position: ${siteData.totals?.avgPosition}, CTR: ${siteData.totals?.avgCtr}.`
        : `Site: ${selectedSite}.`;

      // ── Technical issue prompts (Issues tab) ───────────────────
      const technicalPrompts = {
        meta: `You are a senior SEO copywriter writing copy for a specific page.
Site: ${selectedSite}
Page: ${pageUrl}
Top ranking keywords for this site: ${topKwsShort}
${currentStateBlock}
Return ONLY valid JSON — no markdown, no preamble:
{
  "option1": "ready-to-use title tag — primary keyword in the first 50-60 chars, can extend to ~100 chars if accuracy and click appeal benefit; keyword-rich, compelling",
  "option2": "alternative title tag — different angle, same length philosophy (primary keyword early, longer only if it earns the extra words)",
  "metaDesc": "ready-to-publish meta description — 145-155 chars, includes primary keyword, ends with a soft CTA",
  "tip": "one specific improvement to implement on this page, max 12 words"
}`,
        broken_links: `You are an SEO specialist fixing a broken internal link.
Site: ${selectedSite}
Page containing the broken link: ${pageUrl}
Broken link issue: ${fix.current}
Top ranking keywords on this site: ${topKwsShort}
Return ONLY valid JSON — no markdown, no explanation:
{
  "brokenLink": "exact broken URL path extracted from the issue",
  "suggestedReplacement": "most likely correct URL to replace it with on ${selectedSite}",
  "alternativeReplacement": "second alternative URL if the first does not exist",
  "anchorText": "improved anchor text to use for this link",
  "tip": "one sentence on why fixing this matters for SEO, max 12 words"
}`,
        pagespeed: `You are a web performance specialist fixing slow page speed.
Site: ${selectedSite}
Page: ${pageUrl}
Issue: ${fix.current}
Return ONLY valid JSON — no markdown, no explanation:
{
  "quickestFix": "single fastest improvement to make today — be specific",
  "step1": "first action to take — specific and actionable",
  "step2": "second action to take — specific and actionable",
  "step3": "third action to take — specific and actionable",
  "expectedImprovement": "realistic load time improvement if all steps are done",
  "tip": "one free tool to verify page speed after fixing, max 12 words"
}`,
        schema: `You are a technical SEO specialist adding schema markup.
Site: ${selectedSite}
Page: ${pageUrl}
Schema needed: ${fix.current}
Return ONLY valid JSON — no markdown, no explanation:
{
  "schemaType": "exact schema @type to implement",
  "schemaCode": "complete ready-to-paste <script type=\\"application/ld+json\\"> block with values filled in for ${selectedSite}",
  "whereToPaste": "exactly where in the page HTML to add this script tag",
  "tip": "one key property to add to improve this schema further, max 12 words"
}`,
      };

      // Use fixCategory to determine prompt — more reliable than fix.type
      const isTechnicalFix = !!category && !!technicalPrompts[category];

      const txt = await callClaude(
        isTechnicalFix
          ? technicalPrompts[category]
          : `You are a senior SEO copywriter improving a SPECIFIC page on a real website.
${siteContext}
Page being optimised: ${pageUrl}
${currentStateBlock}The SPECIFIC keyword this page needs to rank for: "${keyword}"
Current ranking position: ${fix.m1}
Goal: ${fix.m2}
Fix type: ${fix.type} — ${fix.field}
CRITICAL RULES:
- Every suggestion MUST include the exact phrase "${keyword}"
- No generic language — make it specific to "${keyword}"
- Title tags: primary keyword in the first 50-60 characters for SERP visibility; total length can extend to ~100 characters where the extra words add accuracy or click appeal. Don't pad for length; don't force unnatural brevity. Accuracy beats arbitrary character limits.
- Meta descriptions: 145-155 characters maximum
- Return ONLY ready-to-use copy — no explanations, no preamble
Return ONLY valid JSON — no markdown:
{
  "option1": "specific title/heading containing ${keyword}",
  "option2": "alternative specific title/heading containing ${keyword}",
  "metaDesc": "specific meta description containing ${keyword} — exactly 145-155 chars",
  "tip": "one specific next step for this exact page and keyword, max 12 words"
}`,
        isTechnicalFix
          ? "Technical SEO specialist. Return valid JSON only. No markdown. Return ONLY ready-to-use values — never include problem descriptions or explanations in JSON field values."
          : "Senior SEO copywriter. Return valid JSON only. No markdown. Be SPECIFIC to the keyword and page — never generic.",
        "quality"
      );
      setModalData(JSON.parse(txt.replace(/```json|```/g,"").trim()));
    } catch(e) {
      console.error("openModal error:", e);
      setModalData({
        option1: `${selectedSite} | Professional Services`,
        option2: `Expert Services — Get in Touch Today`,
        metaDesc: `Professional services from ${selectedSite}. Expert guidance for businesses. Contact us today to find out more.`,
        tip: "Connect Google Search Console for keyword-specific suggestions"
      });
    }
    setModalLoading(false);
  };

  const copyText = (text, id) => {
    navigator.clipboard.writeText(text).catch(()=>{});
    setCopiedId(id); setTimeout(()=>setCopiedId(null), 1600);
  };

  // ── CRO fix modal ─────────────────────────────────────────────
  const openCroModal = async (row) => {
    if (!isPro && aiFixCount >= AI_FIX_LIMIT) { setShowUpgrade(true); return; }
    if (!isPro) trackAiFixUsage();
    setCroModal(row); setCroData(null); setCroLoading(true);

    const prompts = {
      cta: `You are a conversion rate optimisation expert improving a real web page.

Page: https://${selectedSite}${row.page}
Issue: ${row.issue}
Context: ${row.context}
Current CTA button text: "${row.currentCta}"
Current conversion rate: ${row.rate} (industry average: ${row.industryAvg})
Site: ${selectedSite}

Generate specific, ready-to-use CRO improvements. Return ONLY valid JSON:
{
  "headline": "rewritten above-the-fold headline that makes the value clear",
  "ctaOption1": "CTA button text — short, action-oriented, specific",
  "ctaOption2": "alternative CTA button text",
  "subtext": "one line of supporting text to place directly below the CTA",
  "placement": "exactly where on the page the CTA should appear and why",
  "tip": "one additional quick win for this page, max 12 words"
}`,

      social_proof: `You are a conversion rate optimisation expert improving a real web page.

Page: https://${selectedSite}${row.page}
Issue: ${row.issue}
Context: ${row.context}
Current conversion rate: ${row.rate} (industry average: ${row.industryAvg})
Site: ${selectedSite}

Generate specific, ready-to-use social proof copy. Return ONLY valid JSON:
{
  "testimonial1": "realistic testimonial quote that addresses the main buying objection — in quotes, with a name and role",
  "testimonial2": "second testimonial quote focused on results or outcome",
  "statBadge": "a short trust stat e.g. '150+ clients' or '98% satisfaction'",
  "placement": "exactly where to place social proof on the page and why",
  "tip": "one additional trust signal to add to this page, max 12 words"
}`,

      form: `You are a conversion rate optimisation expert improving a real web page.

Page: https://${selectedSite}${row.page}
Issue: ${row.issue}
Detail: ${row.issueDetail}
Context: ${row.context}
Current conversion rate: ${row.rate} (industry average: ${row.industryAvg})
Site: ${selectedSite}

Generate specific, ready-to-use form improvements. Return ONLY valid JSON:
{
  "keepFields": ["field 1 to keep", "field 2 to keep", "field 3 to keep"],
  "removeFields": ["field to remove and why", "field to remove and why"],
  "submitButton": "rewritten submit button text — specific and action-oriented",
  "formHeadline": "short heading above the form that reduces friction",
  "reassuranceText": "one line of text below the button to reduce hesitation e.g. privacy note",
  "tip": "one additional form improvement, max 12 words"
}`
    };

    try {
      const txt = await callClaude(
        prompts[row.fixType] || prompts.cta,
        "Senior CRO specialist. Return valid JSON only. No markdown. Be specific to the page and issue — never generic.",
        "quality"
      );
      setCroData(JSON.parse(txt.replace(/```json|```/g,"").trim()));
    } catch {
      setCroData({ error: "Could not generate suggestions — please try again." });
    }
    setCroLoading(false);
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Google? This will revoke our access to your Search Console data. You can reconnect anytime.")) return;
    try {
      const res = await authFetch(`${WORKER_URL}/api/auth/disconnect`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Disconnect failed: ${data.error || res.statusText}. Your local session has been cleared but Google tokens may still be active. Please contact support.`);
      }
    } catch (err) {
      alert(`Disconnect error: ${err.message}. Your local session has been cleared.`);
    }
    localStorage.removeItem("rankactions_userId");
    setUserId(null); setIsConnected(false); setSiteData(null); setDataError(null); setAiSummary(null);
  };

  // ─────────────────────────────────────────────────────────────
  // STRIPE — checkout and billing portal helpers
  // ─────────────────────────────────────────────────────────────
  const STRIPE_PRICES = {
    starter_monthly: 'price_1TZ9dEPrI9axbg39lqIgwFyV',
    starter_annual:  'price_1TZ9dEPrI9axbg39h05zJZyI',
    pro_monthly:     'price_1TZ9g1PrI9axbg39uYLUU8BG',
    pro_annual:      'price_1TZ9gNPrI9axbg39hmEWGiwK',
    agency_monthly:  'price_1TiXYyPrI9axbg39qSLW6jSx',
    agency_annual:   'price_1TiXZIPrI9axbg39SB3suRHW',
    individual_monthly: 'price_1Tix8iPrI9axbg39G1IXcm0G',
    individual_annual:  'price_1Tix98PrI9axbg39Vh1xXTqq',
  };

  const startCheckout = async (priceId) => {
    try {
      const res = await authFetch(`${WORKER_URL}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Something went wrong — please try again.");
      }
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Could not start checkout — please try again.");
    }
  };

  const openBillingPortal = async () => {
    try {
      const res = await authFetch(`${WORKER_URL}/api/stripe/portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (err) {
      console.error("Portal error:", err);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // AUTH WALL — show sign in/up if not logged in
  // ─────────────────────────────────────────────────────────────
  if (!isLoaded) return (
    <><style>{CSS}</style>
    <div className="gos" style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}>
      <div className="spinner" style={{width:28,height:28}}/>
    </div></>
  );

  if (!isSignedIn) return (
    <><style>{CSS}</style>
    <div className="gos">
      <div className="auth-wrap">
        <div className="auth-logo">Rank<em>Actions</em></div>
        <div className="auth-tagline">Know exactly what to fix on your website each week</div>
        <div className="auth-tabs">
          <div className={`auth-tab ${authView==="signin"?"active":""}`} onClick={()=>setAuthView("signin")}>Sign in</div>
          <div className={`auth-tab ${authView==="signup"?"active":""}`} onClick={()=>setAuthView("signup")}>Create account</div>
        </div>
        {authView==="signin"
          ? <SignIn routing="hash" afterSignInUrl="/" appearance={clerkAppearance}/>
          : <SignUp routing="hash" afterSignUpUrl="/" appearance={clerkAppearance}/>
        }
      </div>
    </div></>
  );

  // ─────────────────────────────────────────────────────────────
  // PLAN SELECTION — show on first sign-in
  // ─────────────────────────────────────────────────────────────
  if (showPlan) {
    const isAnnual = planBilling === "annual";
    return (
    <><style>{CSS}</style>
    <div className="gos">
      <div className="plan-wrap" style={{position:"relative"}}>
        {localStorage.getItem("rankactions_plan_chosen") && (
          <button onClick={()=>{setShowPlan(false);localStorage.setItem("rankactions_plan_chosen","1");}}
            style={{position:"absolute",top:"1rem",right:"1rem",background:"none",border:"none",color:"var(--text3)",fontSize:"1.5rem",cursor:"pointer",fontFamily:"inherit",lineHeight:1}}
            title="Back to dashboard">×</button>
        )}
        <div className="plan-logo">Rank<em>Actions</em></div>
        <div className="plan-sub">Choose your plan — upgrade or downgrade any time</div>

        {/* Billing toggle */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:".75rem",marginBottom:"1.75rem"}}>
          <span style={{fontSize:".875rem",fontWeight:isAnnual?400:700,color:isAnnual?"var(--text3)":"var(--text)"}}>Monthly</span>
          <div onClick={()=>setPlanBilling(b=>b==="monthly"?"annual":"monthly")}
            style={{width:44,height:24,background:"var(--green)",borderRadius:999,position:"relative",cursor:"pointer",flexShrink:0}}>
            <div style={{position:"absolute",top:3,left:3,width:18,height:18,background:"#fff",borderRadius:"50%",transition:"transform .2s",transform:isAnnual?"translateX(20px)":"translateX(0)"}}/>
          </div>
          <span style={{fontSize:".875rem",fontWeight:isAnnual?700:400,color:isAnnual?"var(--text)":"var(--text3)"}}>
            Annual
          </span>
        </div>

        <div className="plan-grid">
          <div className={`plan-card ${selPlan==="free"?"selected":""}`} onClick={()=>setSelPlan("free")}>
            {plan==="free" && <div className="plan-badge" style={{background:"var(--blue)",color:"#fff"}}>Current plan</div>}
            <div className="plan-name">Free</div>
            <div className="plan-price">£0</div>
            <div className="plan-period">forever</div>
            <ul className="plan-features">
              <li>1 website</li>
              <li>Top 3 weekly actions</li>
              <li>5 AI fixes/month</li>
              <li>Search Console data</li>
              <li>3 page audits/month</li>
              <li>Weekly email digest</li>
            </ul>
          </div>
          <div className={`plan-card featured ${selPlan==="individual"?"selected":""}`} onClick={()=>setSelPlan("individual")}>
            {plan==="individual" ? <div className="plan-badge" style={{background:"var(--blue)",color:"#fff"}}>Current plan</div> : <div className="plan-badge">Most popular</div>}
            <div className="plan-name">Individual</div>
            <div className="plan-price">{isAnnual ? "£1,200" : "£100"}</div>
            <div className="plan-period">{isAnnual ? "per year — £100/mo" : "per month"}</div>
            <ul className="plan-features">
              <li>1 website</li>
              <li>Full action list</li>
              <li>20 AI fixes/month</li>
              <li>Rank Tracker</li>
              <li>Unlimited page audits</li>
              <li>Weekly email digest</li>
            </ul>
          </div>
          <div className={`plan-card ${selPlan==="business"?"selected":""}`} onClick={()=>setSelPlan("business")}>
            {plan==="business" && <div className="plan-badge" style={{background:"var(--blue)",color:"#fff"}}>Current plan</div>}
            <div className="plan-name">Business</div>
            <div className="plan-price" style={{fontSize:"1.4rem"}}>Let’s talk</div>
            <div className="plan-period">tailored pricing</div>
            <ul className="plan-features">
              <li>1 website</li>
              <li>Unlimited AI fixes</li>
              <li>AI Content Generator</li>
              <li>Strategy Planner</li>
              <li>Link Building tools</li>
              <li>Competitor tracking (soon)</li>
              <li>Priority support</li>
            </ul>
          </div>
          <div className={`plan-card ${selPlan==="agency"?"selected":""}`} onClick={()=>setSelPlan("agency")}>
            {plan==="agency" && <div className="plan-badge" style={{background:"var(--blue)",color:"#fff"}}>Current plan</div>}
            <div className="plan-name">Agency</div>
            <div className="plan-price" style={{fontSize:"1.4rem"}}>Let’s talk</div>
            <div className="plan-period">tailored pricing</div>
            <ul className="plan-features">
              <li>Everything in Business</li>
              <li>Multiple websites</li>
              <li>White-label reports (soon)</li>
              <li>DataForSEO data (soon)</li>
              <li>Dedicated account manager</li>
              <li>Priority support</li>
            </ul>
          </div>
        </div>
        <button className="plan-continue-btn" onClick={async ()=>{
          if (selPlan === plan) {
            localStorage.setItem("rankactions_plan_chosen", "1");
            setShowPlan(false);
          } else if (selPlan === "free" && isPaid) {
            openBillingPortal();
          } else if (selPlan === "free") {
            setPlan("free");
            localStorage.setItem("rankactions_plan", "free");
            localStorage.setItem("rankactions_plan_chosen", "1");
            setShowPlan(false);
          } else if (selPlan === "business" || selPlan === "agency") {
            // Contact-form tiers (bespoke pricing, no Stripe) — same flow as Enterprise.
            localStorage.setItem("rankactions_plan_chosen", "1");
            setShowPlan(false);
            window.open(`https://rankactions.com/#enterprise-${selPlan}`, "_blank", "noopener");
          } else {
            // Only Individual goes through Stripe checkout.
            const pm = { individual: isAnnual?STRIPE_PRICES.individual_annual:STRIPE_PRICES.individual_monthly };
            localStorage.setItem("rankactions_plan_chosen", "1");
            setShowPlan(false);
            await startCheckout(pm[selPlan]);
          }
        }}>
          {selPlan === plan ? "← Back to dashboard"
            : selPlan === "free" && isPaid ? "Manage subscription →"
            : selPlan === "free" ? "Continue with Free →"
            : (selPlan === "business" || selPlan === "agency") ? `Contact us about ${selPlan.charAt(0).toUpperCase()+selPlan.slice(1)} →`
            : isPaid ? `Switch to ${selPlan.charAt(0).toUpperCase()+selPlan.slice(1)} →`
            : `Subscribe to ${selPlan.charAt(0).toUpperCase()+selPlan.slice(1)} →`}
        </button>
        {isPaid && (
          <div className="plan-skip" onClick={openBillingPortal}>Manage billing & invoices</div>
        )}
        {!isPaid && (
          <div className="plan-skip" onClick={()=>{
            localStorage.setItem("rankactions_plan_chosen","1");
            setShowPlan(false);
          }}>Skip for now — start with Free</div>
        )}
      </div>
    </div></>
  );};

  // ─────────────────────────────────────────────────────────────
  // ONBOARDING
  // ─────────────────────────────────────────────────────────────
  if (screen === "onboarding") return (
    <><style>{CSS}</style>
    <div className="gos"><div className="ob">
      <div className="ob-logo">Rank<em>Actions</em></div>
      <div className="ob-card">
        <div className="ob-step-label">Step {step} of 4</div>
        {step===1 && <>
          <div className="ob-h">Enter your website</div>
          <div className="ob-sub">Enter your domain below, then connect Google Search Console. If your Google account has multiple sites, we'll import them all automatically.</div>
          <input className="ob-input" placeholder="e.g. e2e-integration.co.uk" value={urlInput}
            onChange={e=>setUrlInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&urlInput.trim()&&setStep(2)}/>
          <button className="ob-btn" disabled={!urlInput.trim()} onClick={()=>{
            const clean = urlInput.trim().replace(/^https?:\/\//,"").replace(/\/$/,"");
            setSelectedSite(clean);
            localStorage.setItem("rankactions_selectedSite", clean);
            localStorage.setItem("rankactions_pending_site", clean);
            const updated = [clean];
            setSites(updated);
            localStorage.setItem("rankactions_sites", JSON.stringify(updated));
            setStep(2);
          }}>Continue →</button>
          <span className="ob-skip" style={{cursor:"pointer"}} onClick={()=>{
            localStorage.setItem("rankactions_pending_site","");
            setStep(2);
          }}>Skip — I'll pick my site after connecting Google</span>
        </>}
        {step===2 && <>
          <div className="ob-h">Connect your data</div>
          <div className="ob-sub">Clicking Connect takes you to Google — we only request read-only access and never store your actual site data.</div>
          <div className="ob-connect-grid">
            <div className="ob-connect-card active" onClick={startGoogleOAuth}>
              <div className="ob-connect-icon">🔗</div>
              <div className="ob-connect-name">Connect Google</div>
              <div className="ob-connect-sub">Search Console + Analytics</div>
            </div>
            <div className="ob-connect-card" style={{opacity:.45,cursor:"not-allowed"}}>
              <div className="ob-connect-icon">🔜</div>
              <div className="ob-connect-name">More coming soon</div>
              <div className="ob-connect-sub">Ahrefs, Semrush, GA4</div>
            </div>
          </div>
          <button className="ob-btn" onClick={()=>setScreen("dashboard")}>Skip — use demo data</button>
          <span className="ob-skip">You can connect Google at any time from the dashboard</span>
        </>}
        {step===3 && <>
          <div className="ob-h">Generating your report…</div>
          <div className="ob-sub">Crawling your site, analysing keywords, finding quick wins.</div>
          <div className="ob-prog-wrap">
            <div className="ob-prog-top"><span>Analysing…</span><span>{Math.min(Math.round(progress),100)}%</span></div>
            <div className="ob-prog-bar"><div className="ob-prog-fill" style={{width:`${Math.min(progress,100)}%`}}/></div>
          </div>
          <div className="ob-tasks">
            {["Crawling your website","Analysing keywords & rankings","Identifying quick wins"].map((t,i)=>(
              <div key={i} className={`ob-task ${tasks[i]?"done":""}`}><div className="ob-task-check">{tasks[i]?"✓":""}</div>{t}</div>
            ))}
          </div>
        </>}
        {step===4 && <>
          <div className="ob-h">Here's what we found</div>
          <div className="ob-sub">3 high-priority items ready for you right now.</div>
          <div className="ob-results">
            <div className="ob-result r"><div className="ob-result-tag">Urgent</div><div className="ob-result-text">Homepage ranking #7 for your main keyword — title tag fix available</div></div>
            <div className="ob-result a"><div className="ob-result-tag">Opportunity</div><div className="ob-result-text">/services converts at 0.4% vs 2.1% — CTA placement issue</div></div>
            <div className="ob-result g"><div className="ob-result-tag">Quick win</div><div className="ob-result-text">5 pages have no internal links — easy authority boost</div></div>
          </div>
          <button className="ob-btn" onClick={()=>setScreen("dashboard")}>Go to your dashboard →</button>
        </>}
      </div>
    </div></div></>
  );

  // ─────────────────────────────────────────────────────────────
  // Add site helper — fetches available GSC sites and shows them inline
  // ─────────────────────────────────────────────────────────────

  const addSite = async () => {
    // Gate: free users can only have 1 site
    if (!isPro && sites.length >= 1) {
      setShowUpgrade(true);
      return;
    }
    // Toggle the GSC site list
    if (addingSite) { setAddingSite(false); return; }
    setAddingSite(true);
    setGscSitesLoading(true);
    try {
      const res = await authFetch(`${WORKER_URL}/api/gsc-sites`);
      const data = await res.json();
      // Google's webmasters/v3/sites gives no ordering guarantee, so the list came
      // back in a different order on every fetch — with 100+ properties that makes
      // finding a specific site pure luck. Sort alphabetically for a stable list.
      const available = (data.sites || [])
        .filter(s => !sites.includes(s.siteUrl) && !sites.includes(s.displayUrl))
        .sort((a, b) => (a.displayUrl || "").localeCompare(b.displayUrl || "", undefined, { sensitivity: "base" }));
      setAvailableGscSites(available);
    } catch { setAvailableGscSites([]); }
    setGscSitesLoading(false);
  };

  const selectGscSite = (siteUrl, displayUrl) => {
    const clean = siteUrl;
    const updated = [...new Set([...sites, clean])];
    setSites(updated);
    localStorage.setItem("rankactions_sites", JSON.stringify(updated));
    setSelectedSite(clean);
    localStorage.setItem("rankactions_selectedSite", clean);
    setSiteData(null); setAiSummary(null); setSiteOpen(false); setAddingSite(false); setAvailableGscSites([]);
  };

  // ─────────────────────────────────────────────────────────────
  // Reusable sub-components
  // ─────────────────────────────────────────────────────────────
  const Sidebar = () => {
    const isAgencyOrEnterprise = plan === "agency" || plan === "enterprise";
    return (
    <div className="sidebar">
      <div className="sidebar-logo">Rank<em>Actions</em></div>
      <div className="sidebar-nav">
        {[
          ...(isAgencyOrEnterprise ? [{id:"portfolio", icon:"⊞", label:"Portfolio"}] : []),
          {id:"dashboard",  icon:"⬡", label:"Dashboard"},
          {id:"siteDetail", icon:"◎", label:"Site Detail"},
          {id:"strategy",   icon:"🗺", label:"Strategy"},
          {id:"content",    icon:"✍", label:"Content"},
          {id:"links",      icon:"🔗", label:"Link Building"},
          {id:"tracker",    icon:"📈", label:"Rank Tracker"},
          {id:"audit",      icon:"🔍", label:"Page Audit"},
          {id:"reports",    icon:"📄", label:"Reports"},
          {id:"settings",   icon:"⚙", label:"Settings"},
          ...(isAdmin ? [{id:"admin", icon:"🔐", label:"Admin"}] : []),
        ].map(n=>{
          // Portfolio is a meta-view — active when currentView === "portfolio".
          // Everything else is "active" only when its screen matches AND we're
          // not in portfolio view (otherwise the visual selection lies).
          const isActive = n.id === "portfolio"
            ? currentView === "portfolio"
            : currentView === "site" && screen === n.id;
          return (
          <div key={n.id} className={`nav-item ${isActive?"active":""}`}
            data-tour={`nav-${n.id}`}
            onClick={()=>{
              if (n.id === "portfolio") {
                setCurrentView("portfolio");
                setArrivedFromPortfolio(false);
                return;
              }
              if(["dashboard","siteDetail","content","admin","reports","links","settings","strategy","tracker","audit"].includes(n.id)) {
                // Clicking any non-portfolio item exits portfolio view to single-site mode.
                // We deliberately keep arrivedFromPortfolio as-is here: if the user came
                // from Portfolio originally, they should still see the back breadcrumb
                // while they navigate between screens within that site's experience.
                setCurrentView("site");
                setScreen(n.id);
              }
            }}>
            <span style={{fontSize:"0.9rem"}}>{n.icon}</span>
            {n.label}
            {n.id==="content" && !isPro && <span style={{fontSize:".6rem",marginLeft:"auto",color:"var(--text3)"}}>Paid</span>}
            {n.id==="strategy" && !isPro && <span style={{fontSize:".6rem",marginLeft:"auto",color:"var(--text3)"}}>Paid</span>}
            {n.id==="links" && !isPro && <span style={{fontSize:".6rem",marginLeft:"auto",color:"var(--text3)"}}>Paid</span>}
          </div>
        );})}
      </div>
    </div>
  );};

  const TopBar = () => (
    <div className="topbar">
      <div className="site-selector" data-tour="site-selector">
        <div className="site-btn" onClick={e=>{e.stopPropagation();setSiteOpen(p=>!p);setAddingSite(false);}}>
          <span>🌐</span><span>{displaySite(selectedSite)}</span><span style={{color:"var(--text3)",fontSize:"0.7rem"}}>▼</span>
        </div>
        {siteOpen && (
          <div className="site-dropdown">
            {[...sites].sort((a,b)=>displaySite(a).localeCompare(displaySite(b), undefined, {sensitivity:"base"})).map(s=>(
              <div key={s} className={`site-opt ${s===selectedSite?"sel":""}`}
                onClick={()=>{
                  setSelectedSite(s);
                  localStorage.setItem("rankactions_selectedSite", s);
                  // If user is in Portfolio view and uses dropdown to jump to
                  // a site, drop them into that site's full experience.
                  if (currentView === "portfolio") {
                    setCurrentView("site");
                    setArrivedFromPortfolio(true);
                  }
                  setSiteOpen(false);setSiteData(null);setAiSummary(null);
                }}>
                {displaySite(s)}
              </div>
            ))}
            <div className="site-add" onClick={e=>{e.stopPropagation();addSite();}}>{addingSite ? "✕ Cancel" : "➕ Add site"}</div>
            {addingSite && (
              <div style={{borderTop:"1px solid var(--b2)",paddingTop:".4rem"}} onClick={e=>e.stopPropagation()}>
                {gscSitesLoading ? (
                  <div style={{padding:".6rem .85rem",fontSize:".8rem",color:"var(--text3)",textAlign:"center"}}>Loading your Search Console sites…</div>
                ) : availableGscSites.length > 0 ? (
                  <>
                  {availableGscSites.length > 12 && (
                    <div style={{padding:".4rem .85rem",fontSize:".7rem",color:"var(--text3)",borderBottom:"1px solid var(--b2)"}}>
                      {availableGscSites.length} sites available · scroll to browse · A–Z
                    </div>
                  )}
                  {availableGscSites.map(s => (
                    <div key={s.siteUrl} className="site-opt" style={{display:"flex",flexDirection:"column",gap:".1rem",cursor:"pointer"}}
                      onClick={e=>{e.stopPropagation();selectGscSite(s.siteUrl, s.displayUrl);}}>
                      <span>{s.displayUrl}</span>
                      <span style={{fontSize:".65rem",color:"var(--text3)"}}>{s.siteUrl.startsWith("sc-domain:")?"Domain property":"URL prefix"}</span>
                    </div>
                  ))}
                  </>
                ) : (
                  <div style={{padding:".6rem .85rem",fontSize:".78rem",color:"var(--text3)"}}>
                    {userId ? "No additional sites found in your Search Console" : "Connect Google to see available sites"}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="topbar-right">
        {dataLoading  ? <span className="topbar-badge demo">⏳ Fetching…</span>
         : isConnected && siteData ? <span className="topbar-badge">✓ Live data</span>
         : <span className="topbar-badge demo">⚠ Demo data</span>}
        <button
          onClick={()=>setShowSupport(true)}
          title="Contact support"
          style={{background:"var(--s2)",border:"1px solid var(--border)",borderRadius:6,padding:".3rem .7rem",color:"var(--text2)",fontFamily:"var(--font)",fontSize:".75rem",fontWeight:600,cursor:"pointer"}}>
          💬 Support
        </button>
        <span
          className={`plan-pill ${plan==="pro"?"pro":plan==="agency"?"agency":plan==="starter"?"starter":""}`}
          style={{cursor:"pointer"}}
          title="View plans"
          onClick={()=>{
            setSelPlan(plan || "free");
            setShowPlan(true);
          }}>
          {planLabel(plan)}
        </span>
        {isConnected
          ? <button className="disconnect-btn" onClick={disconnect}>Disconnect GSC</button>
          : <button className="connect-btn" onClick={startGoogleOAuth}>🔗 Connect Google</button>}
        {/* Admin-only plan switcher for testing */}
        {isAdmin && (
          <select
            value={plan}
            onChange={e=>{
              const p = e.target.value;
              setPlan(p);
              localStorage.setItem("rankactions_plan", p);
              localStorage.setItem("rankactions_plan_chosen", "1");
              // Sync to Worker so it persists
              authFetch(`${WORKER_URL}/api/user/sync`,{
                method:"POST",
                headers:{"Content-Type":"application/json"},
                body:JSON.stringify({clerkId:user?.id, userId, plan:p, sites, aiFixCount})
              }).catch(()=>{});
            }}
            style={{background:"var(--s2)",border:"1px solid var(--border)",borderRadius:6,padding:".3rem .6rem",color:"var(--text2)",fontFamily:"var(--font)",fontSize:".75rem",cursor:"pointer"}}
            title="Admin: switch plan for testing">
            <option value="free">Free</option>
            <option value="individual">Individual</option>
            <option value="business">Business</option>
            <option value="agency">Agency</option>
          </select>
        )}
        <UserButton afterSignOutUrl="/" appearance={clerkAppearance}/>
      </div>
    </div>
  );

  // Banner shown at top of each content area
  const DataBanner = () => {
    if (dataError) return <div className="data-banner error">⚠ {dataError}<button className="data-banner-action" onClick={fetchSiteData}>Retry</button></div>;
    if (!isConnected) return <div className="data-banner">📊 Showing demo data. Connect Google Search Console for your real numbers.<button className="data-banner-action" onClick={startGoogleOAuth}>Connect Google →</button></div>;
    if (siteData)     return <div className="data-banner live">✓ Live data · {displaySite(selectedSite)} · Last {siteData.dateRange.days} days<button className="data-banner-action" onClick={fetchSiteData}>Refresh</button></div>;
    return null;
  };

  // ─────────────────────────────────────────────────────────────
  // SPROUT — guided weekly-action mascot
  // ─────────────────────────────────────────────────────────────
  // A friendly guide that offers this week's technical tasks one at a time,
  // in plain language, and takes the user straight to the fix. Deterministic —
  // reads the SAME getIssuesData() the Issues tab uses. No AI, no new data.
  // Only surfaces real tasks when a site is connected (siteData truthy); in
  // demo mode it invites the user to connect rather than guiding fake fixes.

  // Sprout character — four expression states, brand greens on transparent.
  // RankActions Assist mark — the brand "R" in a rounded tile. Matches the
  // favicon. The `state` prop is accepted for API compatibility with the old
  // mascot but the mark stays constant (a professional assistant, not an
  // emotive character); a small accent dot hints at state.
  const Sprout = ({ state = "greeting", size = 56 }) => {
    const accent = state === "celebrating" ? "#1ea863" : state === "resting" ? "rgba(245,241,232,.4)" : "#1ea863";
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" style={{flexShrink:0}} aria-hidden="true">
        <rect x="18" y="18" width="64" height="64" rx="16" fill="#1ea863"/>
        <path d="M38 32 H56 a13 13 0 0 1 0 26 H48 l12 12 H50 L38 58 V32 Z M46 40 V50 H56 a5 5 0 0 0 0 -10 Z" fill="#0d0d0d"/>
        {state === "celebrating" && <path d="M14 22 l2 4 l4 -2 M86 24 l-2 4 l-4 -2" stroke={accent} strokeWidth="2.4" fill="none" strokeLinecap="round"/>}
      </svg>
    );
  };

  // Plain-language framing per issue category. Kept short, warm, jargon-free.
  const SPROUT_PLAIN = {
    meta: (pg) => `Your ${pg.url} page has no meta description — that's the short summary Google shows under your link in search results. Adding one helps people decide to click.`,
    pagespeed: (pg) => `Your ${pg.url} page may be loading slowly, especially on phones. Faster pages keep visitors around and Google prefers them.`,
    broken_links: (pg) => `There's a link on your ${pg.url} page that leads to a page that no longer exists. Fixing it keeps visitors from hitting dead ends.`,
    schema: (pg) => `Your ${pg.url} page is missing some behind-the-scenes labels that help Google understand it. Adding them can make your listing stand out.`,
  };

  // Flatten getIssuesData into a flat, prioritised task list. Each task carries
  // everything needed to (a) describe it plainly and (b) open the exact fix.
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  const buildSproutTasks = () => {
    if (!siteData) return []; // only guide through REAL issues
    const groups = getIssuesData(selectedSite, siteData) || [];
    const tasks = [];
    groups.forEach((issue, gi) => {
      (issue.pages || []).forEach((pg, pi) => {
        tasks.push({
          key: `${issue.fixCategory}:${pg.url}:${pi}`,
          groupIndex: gi,
          pageIndex: pi,
          label: issue.label,
          fixCategory: issue.fixCategory,
          fix: issue.fix,
          url: pg.url,
          detail: pg.detail,
          priority: pg.priority || "medium",
          plain: SPROUT_PLAIN[issue.fixCategory]?.(pg) || `This one's on your ${pg.url} page. ${issue.fix}`,
          modalPayload: {
            id: `issue-${gi}-${pi}`,
            level: pg.priority === "high" ? "high" : "medium",
            color: pg.priority === "high" ? "#f03e5f" : "#f5a623",
            label: issue.label,
            type: "Technical",
            title: `Fix: ${issue.label} on ${pg.url}`,
            desc: pg.detail,
            m1: pg.url,
            m2: `${pg.priority} priority`,
            field: issue.label,
            current: pg.detail,
            recommended: issue.fix,
            metaDesc: null,
            page: pg.url,
            fixCategory: issue.fixCategory,
          },
        });
      });
    });
    tasks.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1));
    return tasks;
  };

  const sproutTakeMeThere = (task) => {
    setActiveTab("Issues");
    setSproutOpen(false);
    openModal(task.modalPayload);
    // Mark as VISITED, not done — the task stays in the list and Assist asks
    // the user to confirm completion when they return.
    setSproutVisitedKeys(prev => new Set(prev).add(task.key));
  };

  // Clear this site's Assist progress so all tasks show again. Useful when a
  // user marked something done that turned out not to be fixed.
  const sproutReset = () => {
    setSproutDoneKeys(new Set());
    setSproutVisitedKeys(new Set());
  };

  // The floating Sprout panel. Renders its own launcher bubble + expandable card.
  const SproutPanel = () => {
    const tasks = buildSproutTasks();
    const remaining = tasks.filter(t => !sproutDoneKeys.has(t.key));
    const total = tasks.length;
    const doneCount = total - remaining.length;
    const connected = !!siteData;
    const nextTask = remaining[0] || null;

    if (sproutDismissed) return null;

    // Collapsed launcher bubble.
    if (!sproutOpen) {
      return (
        <button
          onClick={() => setSproutOpen(true)}
          title="Open RankActions Assist"
          style={{
            position:"fixed", right:"1.5rem", bottom:"5rem", zIndex:10000,
            display:"flex", alignItems:"center", gap:".55rem",
            background:"#0d0d0d", color:"#f5f1e8", border:"1px solid rgba(30,168,99,.35)",
            borderRadius:999, padding:".5rem .9rem .5rem .5rem", cursor:"pointer",
            fontFamily:"inherit", fontSize:".82rem", fontWeight:600,
            boxShadow:"0 6px 20px rgba(0,0,0,.25)",
          }}>
          <Sprout state={connected && remaining.length === 0 ? "resting" : "greeting"} size={34}/>
          {connected && remaining.length > 0
            ? <span>{remaining.length} to do this week</span>
            : connected
            ? <span>All caught up</span>
            : <span>RankActions Assist</span>}
        </button>
      );
    }

    // Expanded card.
    return (
      <div style={{
        position:"fixed", right:"1.5rem", bottom:"5rem", zIndex:10000,
        width:"340px", maxWidth:"calc(100vw - 3rem)",
        background:"var(--s1)", border:"1px solid var(--border)", borderRadius:16,
        boxShadow:"0 10px 34px rgba(0,0,0,.28)", overflow:"hidden",
      }}>
        {/* Header */}
        <div style={{display:"flex", alignItems:"center", gap:".7rem", padding:".9rem 1rem", background:"#0d0d0d"}}>
          <Sprout state={!connected ? "greeting" : remaining.length === 0 ? "celebrating" : "greeting"} size={44}/>
          <div style={{flex:1, minWidth:0}}>
            <div style={{color:"#f5f1e8", fontWeight:700, fontSize:".92rem"}}>RankActions Assist</div>
            <div style={{color:"rgba(245,241,232,.6)", fontSize:".72rem"}}>Your weekly guide</div>
          </div>
          <button onClick={()=>setSproutOpen(false)} title="Minimise"
            style={{background:"transparent", border:"none", color:"rgba(245,241,232,.7)", fontSize:"1.1rem", cursor:"pointer", lineHeight:1}}>–</button>
          <button onClick={()=>{ setSproutDismissed(true); setSproutOpen(false); }} title="Hide for now"
            style={{background:"transparent", border:"none", color:"rgba(245,241,232,.7)", fontSize:"1rem", cursor:"pointer", lineHeight:1}}>✕</button>
        </div>

        {/* Body */}
        <div style={{padding:"1rem"}}>
          {!connected ? (
            <div style={{fontSize:".86rem", color:"var(--text2)", lineHeight:1.55}}>
              Hi 👋 Once you connect your site to Google Search Console, I'll check it each week and walk you through anything that needs doing — one simple step at a time.
              <button onClick={()=>{ setSproutOpen(false); setScreen("settings"); }}
                style={{marginTop:".9rem", width:"100%", background:"var(--green)", color:"#000", border:"none", borderRadius:8, padding:".6rem", fontWeight:700, fontSize:".84rem", cursor:"pointer", fontFamily:"inherit"}}>
                Connect my site
              </button>
            </div>
          ) : remaining.length === 0 ? (
            <div style={{textAlign:"center", padding:".5rem 0"}}>
              <div style={{fontSize:".95rem", fontWeight:700, marginBottom:".35rem"}}>You're all caught up ✓</div>
              <div style={{fontSize:".82rem", color:"var(--text3)", lineHeight:1.55}}>
                {doneCount > 0
                  ? `Nice work — that's ${doneCount} sorted this week. This is exactly what a healthy site looks like.`
                  : "Your site's in good shape this week. Nothing needs doing right now."}
                {" "}I'll have a fresh check for you next week.
              </div>
              {doneCount > 0 && (
                <button onClick={sproutReset}
                  style={{marginTop:".9rem", background:"transparent", border:"none", color:"var(--blue)", fontSize:".76rem", fontWeight:600, cursor:"pointer", fontFamily:"inherit"}}>
                  Show all tasks again
                </button>
              )}
            </div>
          ) : (
            <>
              {sproutVisitedKeys.has(nextTask.key) ? (
                <>
                  <div style={{fontSize:".84rem", color:"var(--text2)", marginBottom:".7rem", lineHeight:1.55}}>
                    Did you get that one sorted?
                  </div>
                  <div style={{background:"var(--s2)", border:"1px solid var(--border)", borderRadius:10, padding:".7rem"}}>
                    <div style={{display:"flex", alignItems:"center", gap:".4rem", marginBottom:".3rem"}}>
                      <span className={`issue-priority ${nextTask.priority}`}>{nextTask.priority}</span>
                      <span style={{fontSize:".76rem", color:"var(--text3)"}}>{nextTask.url}</span>
                    </div>
                    <div style={{fontSize:".8rem", color:"var(--text3)"}}>{nextTask.label}</div>
                  </div>
                  <div style={{display:"flex", gap:".5rem", marginTop:".8rem"}}>
                    <button onClick={()=>{
                        setSproutDoneKeys(prev=>new Set(prev).add(nextTask.key));
                        setSproutVisitedKeys(prev=>{ const n=new Set(prev); n.delete(nextTask.key); return n; });
                      }}
                      style={{flex:1, background:"var(--green)", color:"#000", border:"none", borderRadius:8, padding:".6rem", fontWeight:700, fontSize:".84rem", cursor:"pointer", fontFamily:"inherit"}}>
                      Yes, done ✓
                    </button>
                    <button onClick={()=>{
                        setSproutVisitedKeys(prev=>{ const n=new Set(prev); n.delete(nextTask.key); return n; });
                      }}
                      title="Keep it on the list"
                      style={{background:"var(--s2)", color:"var(--text3)", border:"1px solid var(--border)", borderRadius:8, padding:".6rem .8rem", fontSize:".84rem", cursor:"pointer", fontFamily:"inherit"}}>
                      Not yet
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{fontSize:".78rem", color:"var(--text3)", marginBottom:".6rem"}}>
                    {doneCount > 0
                      ? <>Nice — that's one done. <strong style={{color:"var(--text2)"}}>{remaining.length}</strong> to go.</>
                      : <>There {total === 1 ? "is" : "are"} <strong style={{color:"var(--text2)"}}>{remaining.length}</strong> thing{remaining.length===1?"":"s"} worth a look this week. Let's take the most important one first.</>}
                  </div>

                  <div style={{background:"var(--s2)", border:"1px solid var(--border)", borderRadius:10, padding:".8rem"}}>
                    <div style={{display:"flex", alignItems:"center", gap:".4rem", marginBottom:".4rem"}}>
                      <span className={`issue-priority ${nextTask.priority}`}>{nextTask.priority}</span>
                      <span style={{fontSize:".76rem", color:"var(--text3)"}}>{nextTask.url}</span>
                    </div>
                    <div style={{fontSize:".84rem", color:"var(--text2)", lineHeight:1.55}}>{nextTask.plain}</div>
                  </div>

                  <div style={{display:"flex", gap:".5rem", marginTop:".8rem"}}>
                    <button onClick={()=>sproutTakeMeThere(nextTask)}
                      style={{flex:1, background:"var(--green)", color:"#000", border:"none", borderRadius:8, padding:".6rem", fontWeight:700, fontSize:".84rem", cursor:"pointer", fontFamily:"inherit"}}>
                      Show me how →
                    </button>
                    <button onClick={()=>setSproutDoneKeys(prev=>new Set(prev).add(nextTask.key))}
                      title="Skip for now"
                      style={{background:"var(--s2)", color:"var(--text3)", border:"1px solid var(--border)", borderRadius:8, padding:".6rem .8rem", fontSize:".84rem", cursor:"pointer", fontFamily:"inherit"}}>
                      Skip
                    </button>
                  </div>

                  {remaining.length > 1 && (
                    <div style={{fontSize:".72rem", color:"var(--text3)", marginTop:".7rem", textAlign:"center"}}>
                      Take your time — you can do the rest whenever suits you.
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // DASHBOARD CONTENT
  // ─────────────────────────────────────────────────────────────
  const DashboardContent = () => {
    const kpis  = getKpiData();
    const fixes = getPriorityFixes();
    return (
      <div className="content">
        <DataBanner/>
        <div className="kpi-strip" data-tour="kpi-strip">
          {kpis.map((k,i)=>(
            <div key={i} className="kpi-card">
              <div className="kpi-label">{k.tip ? <Tip term={k.tip}>{k.label}</Tip> : k.label}</div>
              <div className={`kpi-value ${dataLoading?"shimmer":""}`}>{k.value}{k.bench || null}</div>
              <div className={`kpi-change ${k.pos===true?"pos":k.pos===false?"neg":"neu"}`}>{k.delta}</div>
              <div className={`kpi-source ${k.source==="live"?"live":""}`}>{k.source==="live"?"● Live":"● Demo"} · {k.sub}</div>
            </div>
          ))}
        </div>

        <div className="ai-card">
          <div className="ai-card-header">
            <div className="ai-card-title">
              ✦ This week's summary
              <span className={`ai-pill ${siteData?"live":""}`}>{siteData?"Live AI":"AI"}</span>
            </div>
            {isPro
              ? <button className="ai-regen-btn" onClick={generateSummary} disabled={summaryLoading}>
                  {summaryLoading?<span className="spinner-sm"/>:"↻"}
                  {summaryLoading?" Generating…":" Regenerate"}
                </button>
              : <button className="ai-regen-btn" onClick={()=>setShowUpgrade(true)} title="Paid feature">
                  🔒 Paid plan
                </button>
            }
          </div>
          <div className="ai-bullets">
            {summaryLoading
              ? <div className="ai-placeholder pulse">Generating your {siteData?"live":"demo"} summary…</div>
              : aiSummary
              ? aiSummary.split("\n").filter(Boolean).map((line,i)=>(
                  <div key={i} className="ai-bullet-row"><div className="ai-dot"/><span>{line.replace(/^[•\-]\s*/,"")}</span></div>
                ))
              : <div className="ai-placeholder">Click Regenerate to generate your AI summary.</div>
            }
          </div>
          <div className="ai-cta-row">
            <button className="ai-cta-btn" onClick={()=>setScreen("siteDetail")}>See what to fix →</button>
          </div>
        </div>

        {/* ── Link building summary ── */}
        <div className="section-head" style={{marginTop:"1rem",marginBottom:"1rem"}}>
          <div className="section-title">Link Building</div>
          <div className="section-sub">
            {linkProspects.filter(p=>p.status==="secured").length} links secured · <span style={{color:"var(--blue)",cursor:"pointer"}} onClick={()=>setScreen("links")}>View full tracker →</span>
          </div>
        </div>
        <div className="links-dashboard-card" style={{marginBottom:"1.5rem"}}>
          {linkProspects.length === 0 ? (
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"1rem",padding:".25rem 0"}}>
              <div>
                <div style={{fontSize:".875rem",fontWeight:600,marginBottom:".25rem"}}>No link building activity yet</div>
                <div style={{fontSize:".8rem",color:"var(--text2)"}}>Links from other websites are one of the strongest ranking signals. Start building them today.</div>
              </div>
              <button className="links-generate-btn" onClick={()=>setScreen("links")}>Start building links →</button>
            </div>
          ) : (
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:".5rem",marginBottom:"1rem"}}>
                {[
                  {label:"Identified",id:"identified",color:"var(--blue)"},
                  {label:"Contacted", id:"contacted", color:"var(--amber)"},
                  {label:"Replied",   id:"replied",   color:"var(--green)"},
                  {label:"Secured",   id:"secured",   color:"#a855f7"},
                  {label:"Declined",  id:"declined",  color:"var(--red)"},
                ].map(col=>(
                  <div key={col.id} style={{background:"var(--s2)",borderRadius:8,padding:".6rem",textAlign:"center"}}>
                    <div style={{fontSize:"1.1rem",fontWeight:700,color:col.color}}>{linkProspects.filter(p=>p.status===col.id).length}</div>
                    <div style={{fontSize:".65rem",color:"var(--text3)",marginTop:".1rem"}}>{col.label}</div>
                  </div>
                ))}
              </div>
              {linkProspects.slice(0,3).map(p=>(
                <div key={p.id} className="links-dashboard-row">
                  <div className="links-dashboard-dot" style={{background:p.status==="secured"?"#a855f7":p.status==="replied"?"var(--green)":p.status==="contacted"?"var(--amber)":p.status==="declined"?"var(--red)":"var(--blue)"}}/>
                  <div className="links-dashboard-text">{p.domain}</div>
                  <span style={{fontSize:".68rem",color:"var(--text3)"}}>{p.status}</span>
                </div>
              ))}
              <button className="links-opp-btn" style={{marginTop:".75rem",width:"100%",textAlign:"center"}} onClick={()=>setScreen("links")}>
                View full tracker →
              </button>
            </>
          )}
        </div>

        <div className="section-head" data-tour="priority-actions">
          <div className="section-title">Priority Actions</div>
          <div className="section-sub">{siteData ? "Based on your live data" : "Demo data"} · {fixes.filter(f=>!doneFixes.has(f.id)).length} remaining</div>
        </div>
        <div className="fixes-list">
          {siteData && fixes.length === 0 && (
            <div className="fix-card" style={{padding:"1.1rem 1.25rem",color:"var(--text3)",fontSize:".85rem",lineHeight:1.6}}>
              Nothing actionable yet — your site doesn’t have enough qualifying keyword data in Search Console to generate priority actions. This usually means the site is new or search traffic is still building. Actions will appear automatically as data accumulates.
            </div>
          )}
          {fixes.map(fix=>{
            const isDone = doneFixes.has(fix.id);
            const isOpen = expandedFix===fix.id;
            return (
              <div key={fix.id} className="fix-card" style={isDone?{opacity:.55}:{}}>
                <div className="fix-card-header" onClick={()=>setExpandedFix(isOpen?null:fix.id)}>
                  <div className="fix-dot" style={{background:fix.color}}/>
                  <div className="fix-info">
                    <div className="fix-tag" style={{color:fix.color}}>{fix.label}</div>
                    <div className="fix-title">{fix.title}</div>
                    <div className="fix-desc">{fix.desc}</div>
                    <div className="fix-meta-row">
                      <span className="fix-meta-tag">{fix.m1}</span>
                      <span className="fix-meta-tag">{fix.m2}</span>
                    </div>
                  </div>
                  <div className="fix-right">
                    <span className={`fix-type-badge ${fix.type.toLowerCase()}`}>{fix.type}</span>
                    <span className={`fix-chevron ${isOpen?"open":""}`}>▼</span>
                  </div>
                </div>
                {isOpen && (
                  <div className="fix-body">
                    <div style={{background:"rgba(245,166,35,.08)",border:"1px solid rgba(245,166,35,.2)",borderRadius:8,padding:".6rem .85rem",marginBottom:".75rem",fontSize:".75rem",color:"var(--amber)",lineHeight:1.6}}>
                      ⚠️ <strong>Always back up your website before making changes.</strong> Test changes in a staging environment where possible. RankActions provides suggestions only — you are responsible for reviewing and implementing them.
                    </div>
                    {/* Which page does this apply to? Without it the advice
                        ("add the keyword to your page title") is unactionable. */}
                    {fix.page && (
                      <div style={{marginBottom:".75rem",fontSize:".8rem",color:"var(--text2)"}}>
                        <span style={{color:"var(--text3)"}}>Page to update: </span>
                        {fix.pageUrl
                          ? <a href={fix.pageUrl} target="_blank" rel="noopener noreferrer"
                               style={{color:"var(--blue)",textDecoration:"none",fontFamily:"var(--mono)"}}>{fix.page} ↗</a>
                          : <span style={{fontFamily:"var(--mono)"}}>{fix.page}</span>}
                      </div>
                    )}
                    <div className="fix-suggestion-box">
                      <div className="fix-sugg-label">Suggested Fix</div>
                      <div className="fix-sugg-text">{fix.suggestion}</div>
                    </div>
                    <div className="fix-actions">
                      <button className="fa-btn primary" onClick={()=>openModal(fix)}>
                        ✨ Generate alternatives
                        {!isPro && AI_FIX_LIMIT !== Infinity && <span className={`ai-fix-counter ${aiFixesLeft<=2?"warn":""}`}>({aiFixesLeft} left)</span>}
                      </button>
                      <button className="fa-btn" onClick={()=>copyText(fix.suggestion,fix.id+"-c")}>
                        {copiedId===fix.id+"-c"?"✓ Copied":"📋 Copy fix"}
                      </button>
                      {isDone
                        ? <button className="fa-btn success">✓ Done</button>
                        : <button className="fa-btn" onClick={()=>markFixDone(fix)}>✅ Mark as done</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // SITE DETAIL CONTENT
  // ─────────────────────────────────────────────────────────────
  const SiteDetailContent = () => {
    const seoRows = getSeoRows();
    const fixes   = getPriorityFixes();
    return (
      <div className="content">
        <button className="back-btn" onClick={()=>setScreen("dashboard")}>← Back to dashboard</button>
        <div className="site-detail-name">{displaySite(selectedSite)}</div>
        <div className="site-detail-meta">{siteData?`Live data · ${siteData.dateRange.startDate} to ${siteData.dateRange.endDate}`:"Demo data · connect Google for real numbers"}</div>
        <div className="tabs-row">
          {["Overview","SEO Opportunities","Conversions","Issues"].map(t=>{
            const locked = !isPro && (t==="Conversions"||t==="Issues");
            return (
              <button key={t}
                className={`tab-btn ${activeTab===t?"active":""} ${locked?"locked":""}`}
                onClick={()=>{ if(locked){ setShowUpgrade(true); return; } setActiveTab(t); }}>
                {t}
              </button>
            );
          })}
        </div>

        {activeTab==="Overview" && <>
          <DataBanner/>
          <div className="kpi-strip" style={{marginBottom:"1.5rem"}}>
            {getKpiData().map((k,i)=>(
              <div key={i} className="kpi-card">
                <div className="kpi-label">{k.tip ? <Tip term={k.tip}>{k.label}</Tip> : k.label}</div>
                <div className="kpi-value">{k.value}{k.bench || null}</div>
                <div className={`kpi-change ${k.pos===true?"pos":k.pos===false?"neg":"neu"}`}>{k.delta}</div>
              </div>
            ))}
          </div>
          <div className="section-head"><div className="section-title">Top Actions</div><div className="section-sub">Click any to get an AI fix</div></div>
          {siteData && fixes.length === 0 && (
            <div className="mini-fix" style={{color:"var(--text3)",fontSize:".82rem"}}>
              Nothing actionable yet — not enough qualifying keyword data. Actions will appear as Search Console data builds.
            </div>
          )}
          {fixes.map(fix=>(
            <div key={fix.id} className="mini-fix">
              <div className="mini-fix-dot" style={{background:fix.color}}/>
              <div className="mini-fix-info"><div className="mini-fix-title">{fix.title}</div><div className="mini-fix-sub">{fix.m1} · {fix.m2}</div></div>
              <button className="mini-fix-btn" onClick={()=>openModal(fix)}>Get AI fix →</button>
            </div>
          ))}
        </>}

        {activeTab==="SEO Opportunities" && <>
          <div className="section-head" style={{marginBottom:"1.25rem"}}>
            <div className="section-title"><Tip term="keyword">Keyword Opportunities</Tip></div>
            <div className="section-sub">{
              siteData?.keywords?.length >= 3
                ? <>
                    {seoRows.filter(r=>!hiddenKws.has(r.kw)).length} keywords from Search Console
                    {hiddenKws.size > 0 && <>
                      {" · "}
                      <span style={{color:"var(--blue)",cursor:"pointer"}}
                            onClick={()=>{ hiddenKws.forEach(k=>unhideKeywordGlobal(k)); }}>
                        restore {hiddenKws.size} hidden
                      </span>
                    </>}
                  </>
                : siteData
                  ? "Search Console connected — waiting for data"
                  : "Demo keywords"
            }</div>
          </div>
          {siteData && (siteData.keywords?.length || 0) < 3 ? (
            // GSC connected but no meaningful data yet — honest empty state
            <div style={{
              background:"var(--s1)",
              border:"1px solid var(--border)",
              borderRadius:12,
              padding:"2rem",
              textAlign:"left",
              maxWidth:680,
              margin:"0 auto",
            }}>
              <div style={{fontSize:"1.1rem",fontWeight:600,marginBottom:".5rem",color:"var(--text)"}}>
                No keyword opportunities yet
              </div>
              <div style={{fontSize:".9rem",lineHeight:1.65,color:"var(--text2)",marginBottom:"1.25rem"}}>
                Your site needs ~3-4 weeks of Google Search Console data before we can identify ranking opportunities. New sites and low-traffic pages typically have very few keywords ranking, so there's nothing for us to optimise yet.
              </div>

              {/* Starting Out — prominent CTA for brand-new sites.
                  Walks the user through a guided keyword research and
                  content planning flow that doesn't depend on GSC data.
                  CTA copy + destination changes based on wizard state:
                  not started → start setup; in progress → continue;
                  complete → view content plan in Strategy Planner. */}
              {(() => {
                const wizardState = (() => {
                  try { return JSON.parse(localStorage.getItem(`ra_starting_out_${selectedSite}`) || "null"); }
                  catch { return null; }
                })();
                const wizardCompleted  = !!wizardState?.completed;
                const wizardInProgress = !!wizardState && !wizardState.completed && (wizardState.currentStep > 1 || wizardState.profile?.businessName);

                let title, subtitle, ctaLabel, ctaTarget;
                if (wizardCompleted) {
                  title    = "✓ Your content plan is ready";
                  subtitle = "Open the Strategy Planner to see your roadmap, track progress, and start writing content.";
                  ctaLabel = "View content plan →";
                  ctaTarget = "strategy";
                } else if (wizardInProgress) {
                  const stepNum = wizardState.currentStep || 1;
                  title    = `📋 Continue your setup (Step ${stepNum} of 6)`;
                  subtitle = "You started the guided setup but didn't finish — pick up right where you left off.";
                  ctaLabel = "Continue setup →";
                  ctaTarget = "startingOut";
                } else {
                  title    = "🚀 Just built your site? Start here";
                  subtitle = "A 5-minute guided setup that picks the right keywords for your business and builds a content roadmap — no GSC data required.";
                  ctaLabel = "Start setup →";
                  ctaTarget = "startingOut";
                }

                return (
                  <div style={{
                    background: wizardCompleted
                      ? "linear-gradient(135deg, rgba(15,219,138,.12), rgba(15,219,138,.04))"
                      : "linear-gradient(135deg, rgba(15,219,138,.08), rgba(36,124,255,.08))",
                    border: wizardCompleted ? "1px solid rgba(15,219,138,.4)" : "1px solid rgba(15,219,138,.25)",
                    borderRadius:10,
                    padding:"1.1rem 1.25rem",
                    marginBottom:"1.5rem",
                    display:"flex",
                    alignItems:"center",
                    justifyContent:"space-between",
                    gap:"1rem",
                    flexWrap:"wrap",
                  }}>
                    <div style={{flex:"1 1 280px"}}>
                      <div style={{fontSize:".9rem",fontWeight:700,color:"var(--text)",marginBottom:".25rem"}}>
                        {title}
                      </div>
                      <div style={{fontSize:".8rem",color:"var(--text2)",lineHeight:1.5}}>
                        {subtitle}
                      </div>
                    </div>
                    <button onClick={()=>setScreen(ctaTarget)}
                      style={{
                        background:"var(--green)",
                        color:"#000",
                        border:"none",
                        borderRadius:8,
                        padding:".6rem 1.1rem",
                        fontSize:".85rem",
                        fontWeight:700,
                        cursor:"pointer",
                        fontFamily:"inherit",
                        flexShrink:0,
                      }}>
                      {ctaLabel}
                    </button>
                  </div>
                );
              })()}

              <div style={{fontSize:".85rem",fontWeight:600,color:"var(--text)",marginBottom:".6rem"}}>
                Or in the meantime, here's what to do:
              </div>
              <ul style={{listStyle:"none",padding:0,margin:0,display:"flex",flexDirection:"column",gap:".7rem"}}>
                <li style={{display:"flex",alignItems:"flex-start",gap:".65rem",fontSize:".88rem",color:"var(--text2)",lineHeight:1.55}}>
                  <span style={{color:"var(--green)",fontWeight:700,flexShrink:0}}>1.</span>
                  <span>Run a <span className="td-link" style={{color:"var(--blue)"}} onClick={()=>setScreen("audit")}>Page Audit</span> on your homepage and key service pages — fix any critical issues so Google can crawl and index them properly.</span>
                </li>
                <li style={{display:"flex",alignItems:"flex-start",gap:".65rem",fontSize:".88rem",color:"var(--text2)",lineHeight:1.55}}>
                  <span style={{color:"var(--green)",fontWeight:700,flexShrink:0}}>2.</span>
                  <span>{isPro
                    ? <>Use the <span className="td-link" style={{color:"var(--blue)"}} onClick={()=>setScreen("content")}>Content Generator</span> to publish your first piece of SEO-optimised content targeting a keyword you want to rank for.</>
                    : <>Upgrade to a paid plan to use the Content Generator and publish SEO-optimised articles targeting keywords you want to rank for.</>
                  }</span>
                </li>
                <li style={{display:"flex",alignItems:"flex-start",gap:".65rem",fontSize:".88rem",color:"var(--text2)",lineHeight:1.55}}>
                  <span style={{color:"var(--green)",fontWeight:700,flexShrink:0}}>3.</span>
                  <span>{isPro
                    ? <>Open the <span className="td-link" style={{color:"var(--blue)"}} onClick={()=>setScreen("links")}>Link Building</span> tools to find directories, guest post targets and partnerships you can pursue manually while your organic data builds up.</>
                    : <>Upgrade to a paid plan to access Link Building tools — find directories, guest post targets and partnerships you can pursue manually.</>
                  }</span>
                </li>
                <li style={{display:"flex",alignItems:"flex-start",gap:".65rem",fontSize:".88rem",color:"var(--text2)",lineHeight:1.55}}>
                  <span style={{color:"var(--green)",fontWeight:700,flexShrink:0}}>4.</span>
                  <span>Submit your sitemap to Google Search Console and check back here weekly — the more data accumulates, the more useful these opportunities become.</span>
                </li>
              </ul>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th><Tip term="keyword">Keyword</Tip></th><th><Tip term="position">Position</Tip></th><th><Tip term="impressions">Impressions/mo</Tip></th><th>What to do</th><th>Action</th><th style={{width:"1%"}}></th></tr></thead>
                <tbody>
                  {seoRows.filter(row => !hiddenKws.has(row.kw)).map((row,i)=>{
                    const isWriteAction = row.action==="write_blog"||row.action==="write_page";
                    const btnLabel = row.action==="fix_title"   ? "✨ Fix title tag"
                                   : row.action==="write_page"  ? "✍ Write page"
                                   : "✍ Write blog post";
                    const btnColor = row.action==="fix_title" ? "var(--blue)" : "var(--green)";
                    return (
                      <tr key={i}>
                        <td style={{fontWeight:500}}>
                          {row.kw}
                          {row.opp&&<span className="td-opp">opp</span>}
                        </td>
                        <td className="td-mono" style={{color:row.pos<=10?"var(--amber)":"var(--text)"}}>#{row.pos}</td>
                        <td className="td-mono" style={{color:"var(--text2)"}}>{row.vol}</td>
                        <td style={{color:"var(--text2)",fontSize:"0.8rem"}}>{row.gap}</td>
                        <td>
                          {row.action==="fix_title" ? (
                            // Title tag fix → opens AI fix modal
                            <span className="td-link" style={{color:btnColor}} onClick={()=>openModal({
                              id:`seo-${raSlug(row.kw)}`, level:"medium", color:"#f5a623", label:"OPPORTUNITY", type:"SEO",
                              title:`Improve ranking for "${row.kw}"`,
                              desc:`Currently at position #${row.pos} with ${row.vol} impressions. ${row.gap}.`,
                              m1:`Position: #${row.pos}`, m2:row.vol,
                              field:"Title Tag & Page Content",
                              current:`Not fully optimised for "${row.kw}"`,
                              recommended:row.gap, metaDesc:null,
                            })}>
                              {btnLabel}
                            </span>
                          ) : isPro ? (
                            // Pro user → go to content generator pre-filled
                            <span className="td-link" style={{color:btnColor}} onClick={()=>{
                              contentPresetRef.current = { kw:row.kw, biz:"", notes:`Targeting position #${row.pos} — currently getting ${row.vol} impressions/month` };
                              setScreen("content");
                            }}>
                              {btnLabel}
                            </span>
                          ) : (
                            // Free user → show upgrade nudge
                            <span style={{display:"inline-flex",alignItems:"center",gap:".4rem"}}>
                              <span className="td-link" style={{color:"var(--amber)",fontSize:".75rem"}} onClick={()=>setShowUpgrade(true)}>
                                🔒 {btnLabel}
                              </span>
                            </span>
                          )}
                        </td>
                        <td>
                          {/* Real-but-irrelevant queries (personal names, domain-history
                              noise) can't be filtered reliably, so let the user dismiss
                              them. Shared with the Rank Tracker's hidden list. */}
                          <span
                            role="button"
                            tabIndex={0}
                            title="Not relevant — hide this keyword"
                            onClick={()=>hideKeywordGlobal(row.kw)}
                            onKeyDown={(e)=>{ if(e.key==="Enter"||e.key===" ") hideKeywordGlobal(row.kw); }}
                            style={{cursor:"pointer",color:"var(--text3)",padding:"0 .35rem",fontSize:".9rem",lineHeight:1}}
                          >✕</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!isPro && (
            <div style={{marginTop:"1rem",background:"var(--adim)",border:"1px solid rgba(245,166,35,.2)",borderRadius:10,padding:"1rem 1.25rem",display:"flex",alignItems:"center",gap:"1rem",flexWrap:"wrap"}}>
              <span style={{fontSize:".875rem",color:"var(--amber)"}}>🔒 <strong>Write page</strong> and <strong>Write blog post</strong> actions require Pro — they open the AI content generator pre-filled with the keyword ready to go.</span>
              <button style={{marginLeft:"auto",background:"var(--green)",color:"#000",border:"none",borderRadius:7,padding:".4rem .9rem",fontFamily:"var(--font)",fontSize:".82rem",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}} onClick={()=>setShowUpgrade(true)}>
                Upgrade →
              </button>
            </div>
          )}
        </>}

        {activeTab==="Conversions" && <>
          <div className="section-head" style={{marginBottom:"1.25rem"}}>
            <div className="section-title"><Tip term="cro">Conversion Issues</Tip></div>
            <div className="section-sub">Pages with traffic but low conversions — <Tip term="cta" label="industry average: 2.1%"/></div>
          </div>
          <div className="conv-list">
            {getConvData(selectedSite, siteData).map((row,i)=>(
              <div key={i} className="conv-card">
                <div className="conv-page-url">{row.page}</div>
                <div className="conv-stats">
                  <div className="conv-stat">
                    <div className="cv">{row.traffic}</div>
                    <div className="cl">Monthly traffic</div>
                  </div>
                  <div className="conv-stat">
                    <div className="cv" style={{color:parseFloat(row.rate)<1?"var(--red)":"var(--amber)"}}>{row.rate}</div>
                    <div className="cl">Conv. rate</div>
                  </div>
                  <div className="conv-stat">
                    <div className="cv" style={{color:"var(--text2)",fontSize:".875rem"}}>{row.industryAvg}</div>
                    <div className="cl">Industry avg</div>
                  </div>
                </div>
                <div className="conv-issue-text">⚠ {row.issue}</div>
                <div style={{fontSize:".8rem",color:"var(--text2)",lineHeight:1.6,margin:".5rem 0 .85rem"}}>{row.issueDetail}</div>
                <button className="conv-fix-btn" onClick={()=>openCroModal(row)}>
                  ✨ {row.action}
                </button>
              </div>
            ))}
          </div>
        </>}

        {activeTab==="Issues" && <>
          <div className="section-head" style={{marginBottom:"1.25rem"}}>
            <div className="section-title">Technical Issues</div>
            <div className="section-sub">{getIssuesData(selectedSite,siteData).reduce((a,i)=>a+i.pages.length,0)} affected pages across {getIssuesData(selectedSite,siteData).length} issue types</div>
          </div>
          <div className="issues-list">
            {getIssuesData(selectedSite,siteData).map((issue,i)=>{
              const isOpen = expandedFix===`issue-${i}`;
              return (
                <div key={i} className="issue-row">
                  {/* Header row — click to expand */}
                  <div className="issue-row-header" onClick={()=>setExpandedFix(isOpen?null:`issue-${i}`)}>
                    <div className={`issue-icon-wrap ${issue.t}`}>{issue.icon}</div>
                    <div className="issue-info">
                      <div className="issue-name">{issue.label}</div>
                      <div className="issue-fix-hint">{issue.summary}</div>
                    </div>
                    <div className="issue-pages-badge">{issue.pages.length} {issue.pages.length===1?"page":"pages"}</div>
                    <div className={`issue-chevron ${isOpen?"open":""}`}>▼</div>
                  </div>

                  {/* Expanded — page list */}
                  {isOpen && (
                    <div className="issue-pages">
                      <div className="issue-summary-bar">
                        💡 {issue.fix}
                      </div>
                      <div className="issue-pages-header">
                        <span>Page</span>
                        <span>Issue detail</span>
                        <span>Priority</span>
                        <span>Action</span>
                      </div>
                      {issue.pages.map((pg,j)=>(
                        <div key={j} className="issue-page-row">
                          <div className="issue-page-url">{pg.url}</div>
                          <div className="issue-page-detail">{pg.detail}</div>
                          <div><span className={`issue-priority ${pg.priority}`}>{pg.priority}</span></div>
                          <button className="issue-fix-btn" onClick={()=>openModal({
                            id:`issue-${i}-${j}`,
                            level: pg.priority==="high"?"high":"medium",
                            color: pg.priority==="high"?"#f03e5f":"#f5a623",
                            label: issue.label,
                            type:  "Technical",
                            title: `Fix: ${issue.label} on ${pg.url}`,
                            desc:  pg.detail,
                            m1:    pg.url,
                            m2:    pg.priority + " priority",
                            field: issue.label,
                            current: pg.detail,
                            recommended: issue.fix,
                            metaDesc: null,
                            page: pg.url,
                            fixCategory: issue.fixCategory,
                          })}>✨ Fix</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Data notice — only show when not connected */}
          {!siteData && (
          <div className="issue-data-note">
            🔍 <strong>These are demo issues.</strong> Connect Google Search Console to see real technical issues specific to your site — including actual slow pages, real broken links and missing meta descriptions detected by crawling your live site.
          </div>
          )}
        </>}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // TECHNICAL FIX INSTRUCTIONS — unified component for all issue types
  // ─────────────────────────────────────────────────────────────
  const TechnicalFixInstructions = ({ category, data, copiedId, copyText }) => {
    const [platform, setPlatform] = useState("wordpress");
    const platforms = [
      {id:"wordpress",   label:"WordPress"},
      {id:"squarespace", label:"Squarespace"},
      {id:"wix",         label:"Wix"},
      {id:"shopify",     label:"Shopify"},
      {id:"other",       label:"Other / Not sure"},
    ];
    const allSteps = {
      schema:{
        wordpress:["Log in to your WordPress dashboard","Go to Plugins → Add New and search for 'Insert Headers and Footers'","Install and activate the free plugin by WPBeginner","Go to Settings → Insert Headers and Footers","Copy the code above and paste it into the 'Scripts in Header' box","Click Save — Google will pick it up within a few days"],
        squarespace:["Log in to your Squarespace account","Go to Settings → Advanced → Code Injection","Copy the code above and paste it into the 'Header' box","Click Save — the schema is now live","For a specific page: edit the page → gear icon (⚙) → Advanced → Page Header Code Injection"],
        wix:["Log in to Wix and open your site editor","Click Settings (⚙) in the left panel → SEO → Structured Data Markup","Click + Add Markup and paste the code above","Click Apply — Wix adds it automatically"],
        shopify:["Go to Online Store → Themes → Actions → Edit Code","Click 'theme.liquid' in the left panel","Press Ctrl+F and search for </head>","Paste the code above on the line directly above </head>","Click Save"],
        other:["Find the HTML template file for this page","Locate the </head> tag near the top","Paste the code above on the line directly above </head>","Save and publish","Not sure? Send the code to your developer and ask them to add it to the <head> of this page"],
      },
      meta:{
        wordpress:["Install the free Yoast SEO plugin if you don't have it (Plugins → Add New → search 'Yoast SEO')","Edit the page: Pages → find the page → Edit","Scroll below the editor to the Yoast SEO box and click 'Edit snippet'","Paste the new meta description into the Meta description field","Update the SEO title field for the title tag","Click Update to save"],
        squarespace:["Log in and hover over the page in the Pages panel","Click the gear icon (⚙) next to the page name","Click the SEO tab","Paste the new description into 'SEO Description'","Update the 'SEO Title' for the title tag","Click Save"],
        wix:["Open the editor and click the Pages icon in the left panel","Hover over the page → three dots (...) → SEO Settings","Paste the new description into 'Meta Description'","Update 'Page Title' for the title tag","Click Save and publish"],
        shopify:["Go to Online Store → Pages → click the page to edit","Scroll down to 'Search engine listing preview' → click 'Edit website SEO'","Paste the new description into 'Meta description'","Update 'Page title' for the title tag","Click Save"],
        other:["Find the page in your CMS and open the SEO or Page Settings section","Paste the new description into the Meta Description field","Update the page title / SEO title field","Save and publish","If editing HTML directly: find the meta description tag in the page head and update the content value"],
      },
      broken_links:{
        wordpress:["Install the free 'Broken Link Checker' plugin (Plugins → Add New) — it will list all broken links","To fix manually: edit the page shown above (Pages → Edit)","Find the linked text → click it → press the link icon","Replace the broken URL with the suggested replacement above","Click Update to save"],
        squarespace:["Log in and navigate to the page shown in the issue","Click Edit Page","Find the linked text and click on it","In the link popup, replace the broken URL with the correct one from above","Click Apply, then Save"],
        wix:["Open the editor and navigate to the page","Find the linked text or button and click it","Click the link icon in the toolbar","Replace the broken URL with the correct one from above","Click Done, then Publish"],
        shopify:["Go to Online Store → Pages and edit the page shown","Find the linked text → click the link icon in the editor","Replace the broken URL with the correct one from above","Click Save","For broken nav links: go to Online Store → Navigation to fix those separately"],
        other:["Find the page shown in the issue in your CMS","Edit the page and locate the linked text","Replace the broken URL with the correct URL from the suggestion above","Save and publish","To find all broken links across your site for free: ahrefs.com/broken-link-checker"],
      },
      pagespeed:{
        wordpress:["Install 'WP Super Cache' (free) for caching — activate it, no setup needed","Install 'Smush' (free) to automatically compress images on your site","Install 'Autoptimize' and tick 'Optimise JavaScript' and 'Defer JavaScript'","Test your improvement at: pagespeed.web.dev — aim for 70+ on mobile"],
        squarespace:["Compress images before uploading — use squoosh.app (free) and resize to max 2500px wide","Go to Settings → Advanced and remove any unused code injections","Disable any third-party blocks you're not actively using","Test at: pagespeed.web.dev — share results with Squarespace support if still slow"],
        wix:["Replace any images over 500KB — click the image → Settings → Optimize for Web","Remove Wix apps you're not actively using (each one adds load time)","Check that lazy loading is enabled in your image settings","Test at: pagespeed.web.dev"],
        shopify:["Install TinyIMG (free plan available) to compress all product and page images","Remove any unused apps from your Apps page — every active app adds load time","In your theme settings, disable autoplay videos or large animations if present","Test at: pagespeed.web.dev — Shopify stores typically score 40-60 on mobile"],
        other:["Compress all images before uploading — use squoosh.app (free)","Enable browser caching — ask your hosting provider or add cache headers","Add 'defer' or 'async' to non-essential <script> tags in your HTML","Use Cloudflare's free CDN plan to speed up delivery globally","Test before and after at: pagespeed.web.dev"],
      },
    };
    const steps = allSteps[category]?.[platform] || [];
    return <>
      {category==="schema" && data.schemaCode && (
        <div className="option-card">
          <div className="option-num">Schema type: {data.schemaType}</div>
          <div style={{background:"#0d1117",borderRadius:7,padding:".85rem",marginTop:".5rem",overflowX:"auto"}}>
            <pre style={{fontFamily:"var(--mono)",fontSize:".72rem",color:"#a8d8d0",lineHeight:1.65,whiteSpace:"pre-wrap",wordBreak:"break-word",margin:0}}>{data.schemaCode}</pre>
          </div>
          <div className="option-actions" style={{marginTop:".65rem"}}>
            <button className={`opt-btn ${copiedId==="schema"?"copied":""}`} onClick={()=>copyText(data.schemaCode,"schema")}>
              {copiedId==="schema"?"✓ Copied":"📋 Copy code"}
            </button>
          </div>
        </div>
      )}
      {category==="broken_links" && <>
        {data.suggestedReplacement && <div className="option-card"><div className="option-num">Replace broken link with</div><div className="option-text">{data.suggestedReplacement}</div><div className="option-actions" style={{marginTop:".5rem"}}><button className={`opt-btn ${copiedId==="link1"?"copied":""}`} onClick={()=>copyText(data.suggestedReplacement,"link1")}>{copiedId==="link1"?"✓ Copied":"📋 Copy"}</button></div></div>}
        {data.alternativeReplacement && <div className="option-card"><div className="option-num">Alternative if above doesn't exist</div><div className="option-text">{data.alternativeReplacement}</div></div>}
        {data.anchorText && <div className="option-card"><div className="option-num">Better anchor text</div><div className="option-text">{data.anchorText}</div></div>}
      </>}
      {category==="pagespeed" && data.quickestFix && (
        <div className="option-card" style={{background:"var(--gdim)",border:"1px solid rgba(15,219,138,.2)"}}>
          <div className="option-num" style={{color:"var(--green)"}}>Quickest fix</div>
          <div className="option-text">{data.quickestFix}</div>
        </div>
      )}
      {category==="meta" && <>
        {data.option1 && <div className="option-card"><div className="option-num">Title tag option 1</div><div className="option-text">{data.option1}</div><div className="option-actions" style={{marginTop:".5rem"}}><button className={`opt-btn ${copiedId==="o1"?"copied":""}`} onClick={()=>copyText(data.option1,"o1")}>{copiedId==="o1"?"✓ Copied":"📋 Copy"}</button></div></div>}
        {data.option2 && <div className="option-card"><div className="option-num">Title tag option 2</div><div className="option-text">{data.option2}</div><div className="option-actions" style={{marginTop:".5rem"}}><button className={`opt-btn ${copiedId==="o2"?"copied":""}`} onClick={()=>copyText(data.option2,"o2")}>{copiedId==="o2"?"✓ Copied":"📋 Copy"}</button></div></div>}
        {data.metaDesc && <div className="option-card"><div className="option-num">Meta description</div><div className="option-text">{data.metaDesc}</div><div className="option-actions" style={{marginTop:".5rem"}}><button className={`opt-btn ${copiedId==="md"?"copied":""}`} onClick={()=>copyText(data.metaDesc,"md")}>{copiedId==="md"?"✓ Copied":"📋 Copy"}</button></div></div>}
      </>}
      <div className="option-card">
        <div className="option-num" style={{marginBottom:".75rem"}}>
          {category==="schema"?"How to add this to your site":category==="broken_links"?"How to fix this link in your CMS":category==="pagespeed"?"Step-by-step for your platform":"How to update this in your CMS"}
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:".4rem",marginBottom:"1rem"}}>
          {platforms.map(({id,label})=>(
            <button key={id} onClick={()=>setPlatform(id)}
              style={{padding:".35rem .8rem",borderRadius:6,border:`1px solid ${platform===id?"var(--blue)":"var(--border)"}`,background:platform===id?"var(--bdim)":"none",color:platform===id?"var(--blue)":"var(--text2)",fontFamily:"var(--font)",fontSize:".78rem",fontWeight:platform===id?700:400,cursor:"pointer"}}>
              {label}
            </button>
          ))}
        </div>
        <ol style={{paddingLeft:"1.25rem",display:"flex",flexDirection:"column",gap:".65rem"}}>
          {steps.map((step,i)=>(<li key={i} style={{fontSize:".85rem",color:"var(--text2)",lineHeight:1.65}}>{step}</li>))}
        </ol>
      </div>
      {data.tip && <div className="tip-box">💡 {data.tip}</div>}
    </>;
  };

  // ─────────────────────────────────────────────────────────────
  // FIX MODAL  // ─────────────────────────────────────────────────────────────
  // FIX MODAL
  // ─────────────────────────────────────────────────────────────
  const FixModal = () => {
    const category    = modal.fixCategory || null;
    const isTechnical = !!category;

    const OptCard = ({label, value, id}) => (
      <div className="option-card">
        <div className="option-num">{label}</div>
        <div className="option-text">{value}</div>
        <div className="option-actions">
          <button className={`opt-btn ${copiedId===id?"copied":""}`} onClick={()=>copyText(value,id)}>
            {copiedId===id?"✓ Copied":"📋 Copy"}
          </button>
        </div>
      </div>
    );

    const StepCard = ({step, text}) => (
      <div className="option-card" style={{display:"flex",gap:".75rem",alignItems:"flex-start"}}>
        <div style={{background:"var(--blue)",color:"#fff",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:".72rem",fontWeight:700,flexShrink:0}}>{step}</div>
        <div style={{flex:1}}>
          <div className="option-text">{text}</div>
        </div>
      </div>
    );

    return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="modal-h">{modal.title}</div>
            <div className="modal-sub">
              {isTechnical
                ? category==="broken_links" ? "Link fix suggestions"
                : category==="pagespeed"    ? "Performance improvements"
                : category==="schema"       ? "Schema markup code"
                : "SEO copy suggestions"
              : `${modal.field} — AI-generated alternatives`}
            </div>
          </div>
          <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
        </div>
        <div className="modal-content">
          <div className="modal-section-label">Issue</div>
          <div className="current-box">
            <div className="current-label">{modalPageMeta?.title ? "Current title tag (live from your page)" : modal.field}</div>
            <div className="current-val">{modalPageMeta?.title || modal.current}</div>
            {modalPageMeta?.metaDesc && (
              <div style={{marginTop:".55rem",paddingTop:".55rem",borderTop:"1px solid var(--border)"}}>
                <div className="current-label">Current meta description</div>
                <div className="current-val" style={{fontSize:".8rem"}}>{modalPageMeta.metaDesc}</div>
              </div>
            )}
          </div>
          <div className="modal-section-label">AI Suggestions</div>
          {modalLoading
            ? <div className="loading-center"><div className="spinner"/><span>Generating suggestions…</span></div>
            : modalData && <>
                {/* Technical issues — all routed through unified component */}
                {isTechnical && (
                  <TechnicalFixInstructions
                    category={category}
                    data={modalData}
                    copiedId={copiedId}
                    copyText={copyText}
                  />
                )}

                {/* SEO keyword fixes — title tag / meta copy */}
                {!isTechnical && <>
                  {[
                    {key:"option1", label:"Option 1",        text:modalData.option1},
                    {key:"option2", label:"Option 2",        text:modalData.option2},
                    ...(modalData.metaDesc?[{key:"meta",label:"Meta Description",text:modalData.metaDesc}]:[])
                  ].map(({key,label,text})=>(
                    <OptCard key={key} label={label} value={text} id={key}/>
                  ))}
                  {modalData.tip && <div className="tip-box">💡 {modalData.tip}</div>}
                </>}
              </>
          }
        </div>
        <div className="modal-footer">
          <div style={{width:"100%",fontSize:".68rem",color:"var(--text3)",lineHeight:1.5,marginBottom:".5rem",textAlign:"center"}}>⚠️ Back up your website before applying changes. Review all suggestions before implementing.</div>
          <button className="mf-btn" onClick={()=>openModal(modal)} disabled={modalLoading}>{modalLoading?"Generating…":"↻ Regenerate"}</button>
          <button className={`mf-btn ${modalApplied.has(modal.id)?"done":"primary"}`}
            onClick={()=>{setModalApplied(p=>new Set([...p,modal.id]));markFixDone(modal);}}>
            {modalApplied.has(modal.id)?"✓ Applied":"✅ Mark as applied"}
          </button>
          {modalApplied.has(modal.id) && siteData && (
            <button className={`mf-btn ${indexingStatus==="success"?"done":""}`}
              disabled={indexingStatus==="loading"||indexingStatus==="success"}
              onClick={()=>requestIndexing(modal.page || "/")}>
              {indexingStatus==="loading"?"⏳ Requesting…":indexingStatus==="success"?"✓ Indexed":"🔄 Request Google re-crawl"}
            </button>
          )}
          {indexingMsg && <div style={{width:"100%",textAlign:"center",fontSize:".7rem",color:indexingStatus==="success"?"var(--green)":"var(--red)",marginTop:".25rem"}}>{indexingMsg}</div>}
        </div>
      </div>
    </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // CRO FIX MODAL
  // ─────────────────────────────────────────────────────────────
  const CroModal = () => {
    const [copied, setCopied] = useState(null);
    const copy = (text, key) => {
      navigator.clipboard.writeText(text).catch(()=>{});
      setCopied(key); setTimeout(()=>setCopied(null), 1600);
    };
    const CopyBtn = ({text, id}) => (
      <button className={`cro-copy-btn ${copied===id?"copied":""}`} onClick={()=>copy(text,id)}>
        {copied===id ? "✓ Copied" : "📋 Copy"}
      </button>
    );
    const Row = ({label, value, id}) => (
      <div className="cro-card">
        <div className="cro-card-label">{label}</div>
        <div className="cro-card-value">{value}</div>
        <div className="cro-card-actions"><CopyBtn text={value} id={id}/></div>
      </div>
    );

    return (
      <div className="cro-overlay" onClick={e=>e.target===e.currentTarget&&setCroModal(null)}>
        <div className="cro-modal">
          <div className="cro-modal-head">
            <div>
              <div className="cro-modal-title">CRO Fix — {croModal.page}</div>
              <div className="cro-modal-sub">{croModal.issue} · {croModal.rate} conversion rate (avg: {croModal.industryAvg})</div>
            </div>
            <button className="modal-close" onClick={()=>setCroModal(null)}>✕</button>
          </div>
          <div className="cro-modal-body">
            {croLoading ? (
              <div className="loading-center"><div className="spinner"/><span>Generating CRO suggestions…</span></div>
            ) : croData?.error ? (
              <div style={{color:"var(--red)",fontSize:".875rem"}}>{croData.error}</div>
            ) : croData ? <>

              {/* CTA fixes */}
              {croModal.fixType==="cta" && <>
                <div>
                  <div className="cro-section-label">Rewritten headline</div>
                  <Row label="Place this at the top of the page" value={croData.headline} id="headline"/>
                </div>
                <div>
                  <div className="cro-section-label">CTA button copy</div>
                  <div className="cro-grid">
                    <Row label="Option 1" value={croData.ctaOption1} id="cta1"/>
                    <Row label="Option 2" value={croData.ctaOption2} id="cta2"/>
                  </div>
                </div>
                <div>
                  <div className="cro-section-label">Supporting text below CTA</div>
                  <Row label="Add directly below the button" value={croData.subtext} id="subtext"/>
                </div>
                <div>
                  <div className="cro-section-label">Where to place the CTA</div>
                  <div className="cro-card"><div className="cro-card-value" style={{color:"var(--text2)"}}>{croData.placement}</div></div>
                </div>
              </>}

              {/* Social proof fixes */}
              {croModal.fixType==="social_proof" && <>
                <div>
                  <div className="cro-section-label">Testimonials to add</div>
                  <div style={{display:"flex",flexDirection:"column",gap:".65rem"}}>
                    <Row label="Testimonial 1" value={croData.testimonial1} id="testi1"/>
                    <Row label="Testimonial 2" value={croData.testimonial2} id="testi2"/>
                  </div>
                </div>
                <div>
                  <div className="cro-section-label">Trust badge</div>
                  <Row label="Add near the CTA" value={croData.statBadge} id="badge"/>
                </div>
                <div>
                  <div className="cro-section-label">Where to place social proof</div>
                  <div className="cro-card"><div className="cro-card-value" style={{color:"var(--text2)"}}>{croData.placement}</div></div>
                </div>
              </>}

              {/* Form fixes */}
              {croModal.fixType==="form" && <>
                <div>
                  <div className="cro-section-label">Fields to keep (3 max)</div>
                  <div className="cro-card">
                    <div className="cro-list">
                      {(croData.keepFields||[]).map((f,i)=><div key={i} className="cro-list-item">{f}</div>)}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="cro-section-label">Fields to remove</div>
                  <div className="cro-card">
                    <div className="cro-list">
                      {(croData.removeFields||[]).map((f,i)=><div key={i} className="cro-list-item remove">{f}</div>)}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="cro-section-label">Form copy</div>
                  <div style={{display:"flex",flexDirection:"column",gap:".65rem"}}>
                    <Row label="Form heading" value={croData.formHeadline} id="formhead"/>
                    <Row label="Submit button" value={croData.submitButton} id="submit"/>
                    <Row label="Reassurance text below button" value={croData.reassuranceText} id="reassurance"/>
                  </div>
                </div>
              </>}

              {/* Tip */}
              {croData.tip && (
                <div className="cro-tip-box">💡 Quick win: {croData.tip}</div>
              )}

              <div style={{textAlign:"center"}}>
                <button style={{background:"none",border:"1px solid var(--border)",borderRadius:7,padding:".45rem 1rem",fontFamily:"var(--font)",fontSize:".8rem",color:"var(--text2)",cursor:"pointer"}}
                  onClick={()=>openCroModal(croModal)}>
                  ↻ Regenerate
                </button>
              </div>
            </> : null}
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // PORTFOLIO — Agency + Enterprise multi-site overview
  // ─────────────────────────────────────────────────────────────
  // Triage view for users managing multiple sites. Shows:
  //   - 4 KPI cards (clicks, delta, sites needing attention, stable count)
  //   - 12-week portfolio clicks trend line chart
  //   - Health donut + top risers/fallers
  //   - Per-site table with 6-week sparklines
  // Default sort surfaces declining sites first. Click any site row, riser,
  // or faller to drop into that site's full single-site experience.

  const Portfolio = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showOnlyAttention, setShowOnlyAttention] = useState(false);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await authFetch(`${WORKER_URL}/api/portfolio`);
          const json = await res.json();
          if (cancelled) return;
          if (!res.ok) {
            setError(json.error || 'load_failed');
            return;
          }
          setData(json);
        } catch (err) {
          if (!cancelled) setError(err.message || 'network_error');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, []);

    const goToSite = (siteUrl) => {
      setSelectedSite(siteUrl);
      localStorage.setItem("rankactions_selectedSite", siteUrl);
      setArrivedFromPortfolio(true);
      setCurrentView("site");
      setActiveTab("Overview");
    };

    const healthColor = {
      red:   "var(--red)",
      amber: "var(--amber)",
      green: "var(--green)",
      grey:  "var(--text3)",
    };
    const healthLabel = {
      red:   "Needs attention",
      amber: "Declining",
      green: "Stable",
      grey:  "No data yet",
    };

    // Small inline sparkline component — renders a 60×18 polyline given an
    // array of weekly click totals. Falls back to a dashed line for no-data.
    const Sparkline = ({ data: spk, color }) => {
      if (!spk || spk.length === 0 || spk.every(v => v === 0)) {
        return (
          <svg viewBox="0 0 60 18" style={{width:60,height:18,display:"block"}} aria-hidden="true">
            <line x1="1" y1="9" x2="59" y2="9" stroke="var(--text3)" strokeWidth="1" strokeDasharray="2 2"/>
          </svg>
        );
      }
      const mn = Math.min(...spk), mx = Math.max(...spk);
      const range = mx - mn || 1;
      const xStep = 58 / (spk.length - 1);
      const points = spk.map((v, i) => {
        const x = 1 + i * xStep;
        const y = 17 - ((v - mn) / range) * 16;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      return (
        <svg viewBox="0 0 60 18" style={{width:60,height:18,display:"block"}} aria-hidden="true">
          <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      );
    };

    // ──── Loading state ────
    if (loading) {
      return (
        <div style={{padding:"3rem 2rem",textAlign:"center"}}>
          <div className="spinner" style={{width:28,height:28,margin:"0 auto 1rem"}}/>
          <div style={{color:"var(--text2)",fontSize:".9rem"}}>Loading your portfolio...</div>
        </div>
      );
    }

    // ──── Tier-locked state ────
    if (error === 'tier_required') {
      return (
        <div style={{maxWidth:520,margin:"4rem auto",padding:"2.5rem 2rem",background:"var(--s1)",border:"1px solid var(--border)",borderRadius:14,textAlign:"center"}}>
          <div style={{fontSize:".7rem",color:"var(--text3)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:".5rem"}}>Agency Feature</div>
          <h2 style={{fontSize:"1.4rem",fontWeight:700,marginBottom:".75rem"}}>Portfolio is an Agency feature</h2>
          <p style={{color:"var(--text2)",fontSize:".92rem",lineHeight:1.55,marginBottom:"1.5rem"}}>
            Get a single overview of every site you manage — health status, traffic trends, what needs attention this week.
          </p>
          <button onClick={()=>setShowUpgrade(true)}
            style={{background:"var(--blue)",color:"#fff",border:"none",borderRadius:8,padding:".7rem 1.4rem",fontSize:".9rem",fontWeight:600,cursor:"pointer"}}>
            Upgrade to Agency
          </button>
        </div>
      );
    }

    // ──── Other error state ────
    if (error) {
      return (
        <div style={{maxWidth:520,margin:"3rem auto",padding:"1.25rem 1.5rem",background:"var(--rdim)",border:"1px solid var(--red)",borderRadius:10,color:"var(--red)",fontSize:".9rem"}}>
          Couldn't load portfolio: {error}. Try refreshing in a minute.
        </div>
      );
    }

    // ──── Empty / sub-2 site states ────
    if (!data || !data.sites || data.sites.length === 0) {
      const hint = data?.hint;
      return (
        <div style={{maxWidth:520,margin:"4rem auto",padding:"2.5rem 2rem",background:"var(--s1)",border:"1px solid var(--border)",borderRadius:14,textAlign:"center"}}>
          <h2 style={{fontSize:"1.3rem",fontWeight:700,marginBottom:".75rem"}}>
            {hint === 'single_site' ? "Add more sites to use Portfolio" : "Connect a site to get started"}
          </h2>
          <p style={{color:"var(--text2)",fontSize:".92rem",lineHeight:1.55,marginBottom:"1.5rem"}}>
            {hint === 'single_site'
              ? "Portfolio is designed for managing 2+ sites at once. Once you've connected your second site, this view will fill in."
              : "Connect Google Search Console to start tracking your sites."}
          </p>
          <button onClick={()=>{ setCurrentView("site"); }}
            style={{background:"var(--blue)",color:"#fff",border:"none",borderRadius:8,padding:".65rem 1.25rem",fontSize:".88rem",fontWeight:600,cursor:"pointer"}}>
            {hint === 'single_site' ? "Go to my site" : "Connect a site"}
          </button>
        </div>
      );
    }

    // ──── Main render ────
    const visibleSites = showOnlyAttention
      ? data.sites.filter(s => s.health === 'red' || s.health === 'amber')
      : data.sites;

    const counts  = data.healthCounts || { red:0, amber:0, green:0, grey:0 };
    const totals  = data.totals       || {};
    const trend   = data.portfolioTrend || [];
    const risers  = data.topRisers     || [];
    const fallers = data.topFallers    || [];
    const donutTotal = (counts.red||0) + (counts.amber||0) + (counts.green||0) + (counts.grey||0);

    const ageMs = Date.now() - (data.generatedAt || Date.now());
    // Clamp to non-negative: if server clock is slightly ahead of client clock,
    // ageMs would be negative and we'd render "-1 days ago" which is silly.
    const ageDays = Math.max(0, Math.floor(ageMs / 86_400_000));
    const ageStr = ageDays === 0 ? "today" : ageDays === 1 ? "yesterday" : `${ageDays} days ago`;

    // ── Build the line chart geometry (12-week portfolio trend) ──
    const CW = 660, CH = 200, padL = 40, padR = 20, padT = 30, padB = 30;
    const plotW = CW - padL - padR;
    const plotH = CH - padT - padB;
    let chartPolyline = "", chartArea = "", chartLast = null;
    let chartMin = 0, chartMax = 0, chartLineColor = "var(--text2)";
    if (trend.length > 0 && trend.some(v => v > 0)) {
      chartMax = Math.max(...trend);
      chartMin = Math.min(...trend);
      const range = chartMax - chartMin || 1;
      const yMin = Math.max(0, chartMin - range * 0.1);
      const yMax = chartMax + range * 0.1;
      const yRange = yMax - yMin || 1;
      const xStep = plotW / (trend.length - 1);
      const pts = trend.map((v, i) => {
        const x = padL + i * xStep;
        const y = padT + ((yMax - v) / yRange) * plotH;
        return [+x.toFixed(1), +y.toFixed(1)];
      });
      chartPolyline = pts.map(p => p.join(',')).join(' ');
      const baselineY = padT + plotH;
      chartArea = `M ${pts[0][0]},${pts[0][1]} ` +
                  pts.slice(1).map(p => `L ${p[0]},${p[1]}`).join(' ') +
                  ` L ${pts[pts.length-1][0]},${baselineY} L ${pts[0][0]},${baselineY} Z`;
      chartLast = pts[pts.length - 1];
      const direction = trend[trend.length - 1] - trend[0];
      const pctChange = trend[0] === 0 ? 0 : (direction / trend[0]);
      chartLineColor = pctChange < -0.05 ? "var(--amber)"
                     : pctChange > 0.05  ? "var(--green)"
                     : "var(--text2)";
    }

    // ── Build the donut chart segments ──
    const donutSegments = [];
    if (donutTotal > 0) {
      const order = [
        { key: 'red',   color: 'var(--red)',    count: counts.red   || 0 },
        { key: 'amber', color: 'var(--amber)',  count: counts.amber || 0 },
        { key: 'green', color: 'var(--green)',  count: counts.green || 0 },
        { key: 'grey',  color: 'var(--text3)',  count: counts.grey  || 0 },
      ];
      const cx = 90, cy = 90, R = 73, r = 48;
      let cum = 0;
      let segs = order.filter(o => o.count > 0).map(o => {
        const span = (o.count / donutTotal) * 2 * Math.PI;
        const seg = { ...o, startAngle: cum, endAngle: cum + span };
        cum += span;
        return seg;
      });
      // If only one segment fills the whole circle, split it so the arc renders
      if (segs.length === 1) {
        const only = segs[0];
        segs = [
          { ...only, startAngle: 0,       endAngle: Math.PI },
          { ...only, startAngle: Math.PI, endAngle: 2 * Math.PI },
        ];
      }
      for (const seg of segs) {
        const sXo = cx + R * Math.sin(seg.startAngle);
        const sYo = cy - R * Math.cos(seg.startAngle);
        const eXo = cx + R * Math.sin(seg.endAngle);
        const eYo = cy - R * Math.cos(seg.endAngle);
        const sXi = cx + r * Math.sin(seg.startAngle);
        const sYi = cy - r * Math.cos(seg.startAngle);
        const eXi = cx + r * Math.sin(seg.endAngle);
        const eYi = cy - r * Math.cos(seg.endAngle);
        const largeArc = (seg.endAngle - seg.startAngle) > Math.PI ? 1 : 0;
        seg.path = `M ${sXo.toFixed(2)} ${sYo.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${eXo.toFixed(2)} ${eYo.toFixed(2)} L ${eXi.toFixed(2)} ${eYi.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${sXi.toFixed(2)} ${sYi.toFixed(2)} Z`;
        donutSegments.push(seg);
      }
    }

    const portfolioDelta    = totals.delta || 0;
    const portfolioDeltaPct = totals.deltaPct || 0;
    const portfolioDeltaColor = portfolioDelta < 0 ? "var(--amber)" : portfolioDelta > 0 ? "var(--green)" : "var(--text2)";

    return (
      <div style={{padding:"2rem 2rem"}}>
        {/* Header */}
        <div style={{marginBottom:"1.5rem"}}>
          <div style={{fontSize:".7rem",color:"var(--text3)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:".35rem"}}>Portfolio</div>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",flexWrap:"wrap",gap:"1rem"}}>
            <h1 style={{fontSize:"1.65rem",fontWeight:700,letterSpacing:"-.02em"}}>
              {data.sites.length} {data.sites.length === 1 ? "site" : "sites"} under management
            </h1>
            <div style={{fontSize:".78rem",color:"var(--text3)"}}>
              Last updated {ageStr}
              {data.cached === false && <span style={{color:"var(--green)",marginLeft:".25rem"}}>· just refreshed</span>}
            </div>
          </div>
        </div>

        {/* KPI grid */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4, 1fr)",gap:12,marginBottom:"1.5rem"}}>
          <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
              <span style={{fontSize:14,opacity:.8}}>↗</span>
              <div style={{fontSize:11,color:"var(--text3)",letterSpacing:".04em",textTransform:"uppercase"}}>28-day clicks</div>
            </div>
            <div style={{fontSize:24,fontWeight:700,lineHeight:1.1}}>{(totals.clicks28d || 0).toLocaleString()}</div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>across all sites</div>
          </div>
          <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
              <span style={{fontSize:14,color:portfolioDeltaColor}}>{portfolioDelta < 0 ? "↘" : "↗"}</span>
              <div style={{fontSize:11,color:"var(--text3)",letterSpacing:".04em",textTransform:"uppercase"}}>Δ vs prior 28d</div>
            </div>
            <div style={{fontSize:24,fontWeight:700,lineHeight:1.1,color:portfolioDeltaColor}}>
              {portfolioDelta > 0 ? "+" : ""}{portfolioDelta.toLocaleString()}
            </div>
            <div style={{fontSize:11,color:portfolioDeltaColor,marginTop:4}}>
              {portfolioDeltaPct > 0 ? "+" : ""}{portfolioDeltaPct}% portfolio
            </div>
          </div>
          <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
              <span style={{fontSize:14,color:"var(--red)"}}>⚠</span>
              <div style={{fontSize:11,color:"var(--text3)",letterSpacing:".04em",textTransform:"uppercase"}}>Need attention</div>
            </div>
            <div style={{fontSize:24,fontWeight:700,lineHeight:1.1}}>{counts.red || 0}<span style={{fontSize:14,color:"var(--text3)",fontWeight:400}}> / {donutTotal}</span></div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>declining over 25%</div>
          </div>
          <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
              <span style={{fontSize:14,color:"var(--green)"}}>✓</span>
              <div style={{fontSize:11,color:"var(--text3)",letterSpacing:".04em",textTransform:"uppercase"}}>Stable</div>
            </div>
            <div style={{fontSize:24,fontWeight:700,lineHeight:1.1}}>{counts.green || 0}<span style={{fontSize:14,color:"var(--text3)",fontWeight:400}}> / {donutTotal}</span></div>
            <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>growing or flat</div>
          </div>
        </div>

        {/* Charts row: line chart (2/3) + donut (1/3) — fills horizontal
            space efficiently instead of stacking full-width sections. */}
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16,marginBottom:"1.5rem"}}>
          <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:12,padding:"16px 20px"}}>
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:12}}>
              <div>
                <div style={{fontSize:14,fontWeight:600}}>Portfolio clicks · last 12 weeks</div>
                <div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>Weekly totals across all connected sites</div>
              </div>
            </div>
            {chartPolyline ? (
              <svg viewBox={`0 0 ${CW} ${CH}`} style={{width:"100%",height:"auto",display:"block"}} role="img" aria-label="Portfolio clicks trend over 12 weeks">
                <line x1={padL} y1={padT} x2={CW-padR} y2={padT} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2 4"/>
                <line x1={padL} y1={padT + plotH/2} x2={CW-padR} y2={padT + plotH/2} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2 4"/>
                <line x1={padL} y1={padT + plotH} x2={CW-padR} y2={padT + plotH} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2 4"/>
                <text x={padL - 8} y={padT + 4} textAnchor="end" fontSize="10" fill="var(--text3)">{(chartMax/1000).toFixed(1)}k</text>
                <text x={padL - 8} y={padT + plotH + 4} textAnchor="end" fontSize="10" fill="var(--text3)">{(chartMin/1000).toFixed(1)}k</text>
                <path d={chartArea} fill={chartLineColor} fillOpacity="0.08"/>
                <polyline points={chartPolyline} fill="none" stroke={chartLineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
                {chartLast && (
                  <>
                    <circle cx={chartLast[0]} cy={chartLast[1]} r="3.5" fill={chartLineColor}/>
                    <text x={chartLast[0] - 8} y={chartLast[1] - 7} textAnchor="end" fontSize="11" fontWeight="600" fill={chartLineColor}>
                      {(trend[trend.length-1] || 0).toLocaleString()}
                    </text>
                  </>
                )}
                <text x={padL} y={CH - 8} fontSize="10" fill="var(--text3)">12 weeks ago</text>
                <text x={CW - padR} y={CH - 8} textAnchor="end" fontSize="10" fill="var(--text3)">this week</text>
              </svg>
            ) : (
              <div style={{padding:"3rem 1rem",textAlign:"center",color:"var(--text3)",fontSize:13}}>
                Not enough data yet for trend chart. Check back next week.
              </div>
            )}
          </div>
          <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:12,padding:16}}>
            <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Health mix</div>
            <svg viewBox="0 0 180 180" style={{width:"100%",maxWidth:200,height:"auto",display:"block",margin:"0 auto 12px"}} role="img" aria-label="Donut chart of portfolio health">
              {donutSegments.map((seg, i) => (
                <path key={i} d={seg.path} fill={seg.color}/>
              ))}
              <text x="90" y="95" textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--text)">{donutTotal}</text>
              <text x="90" y="113" textAnchor="middle" fontSize="11" fill="var(--text3)">sites</text>
            </svg>
            <div style={{display:"flex",flexDirection:"column",gap:6,fontSize:12}}>
              {['red','amber','green','grey'].map(k => (
                <div key={k} style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                    <span style={{width:8,height:8,borderRadius:"50%",background:healthColor[k]}}/>
                    {healthLabel[k]}
                  </span>
                  <span style={{color:"var(--text2)",fontFamily:"var(--mono)"}}>{counts[k] || 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Movers row: risers + fallers side by side */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:"1.5rem"}}>
          <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,fontSize:13,fontWeight:600}}>
              <span style={{color:"var(--green)"}}>↗</span>
              <span>Biggest risers this period</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4,fontSize:13}}>
              {risers.length === 0 ? (
                <div style={{color:"var(--text3)",fontSize:12}}>No sites improving this period.</div>
              ) : risers.map(s => (
                <div key={s.site} onClick={()=>goToSite(s.site)}
                  style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".25rem 0",cursor:"pointer"}}>
                  <span>{displaySite(s.site)}</span>
                  <span style={{fontFamily:"var(--mono)",color:"var(--green)",fontWeight:600,fontSize:12}}>
                    +{s.delta.toLocaleString()} <span style={{opacity:.7}}>(+{s.deltaPct}%)</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,fontSize:13,fontWeight:600}}>
              <span style={{color:"var(--red)"}}>↘</span>
              <span>Biggest fallers this period</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4,fontSize:13}}>
              {fallers.length === 0 ? (
                <div style={{color:"var(--text3)",fontSize:12}}>No sites declining this period.</div>
              ) : fallers.map(s => (
                <div key={s.site} onClick={()=>goToSite(s.site)}
                  style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".25rem 0",cursor:"pointer"}}>
                  <span>{displaySite(s.site)}</span>
                  <span style={{fontFamily:"var(--mono)",color:"var(--red)",fontWeight:600,fontSize:12}}>
                    {s.delta.toLocaleString()} <span style={{opacity:.7}}>({s.deltaPct}%)</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Filter row */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={{fontSize:14,fontWeight:600}}>All sites</div>
          <label style={{display:"inline-flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:"var(--text2)"}}>
            <input type="checkbox" checked={showOnlyAttention} onChange={e=>setShowOnlyAttention(e.target.checked)}
              style={{cursor:"pointer",accentColor:"var(--blue)"}}/>
            Only show sites needing attention
          </label>
        </div>

        {/* Table */}
        <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{background:"var(--s2)",textAlign:"left"}}>
                <th style={{padding:"11px 16px",fontSize:11,letterSpacing:".05em",textTransform:"uppercase",color:"var(--text3)",fontWeight:600,width:"32%"}}>Site</th>
                <th style={{padding:"11px 16px",fontSize:11,letterSpacing:".05em",textTransform:"uppercase",color:"var(--text3)",fontWeight:600,textAlign:"right",width:"13%"}}>Clicks</th>
                <th style={{padding:"11px 16px",fontSize:11,letterSpacing:".05em",textTransform:"uppercase",color:"var(--text3)",fontWeight:600,textAlign:"right",width:"18%"}}>Δ vs prior</th>
                <th style={{padding:"11px 16px",fontSize:11,letterSpacing:".05em",textTransform:"uppercase",color:"var(--text3)",fontWeight:600,width:"13%"}}>6w trend</th>
                <th style={{padding:"11px 16px",fontSize:11,letterSpacing:".05em",textTransform:"uppercase",color:"var(--text3)",fontWeight:600,width:"20%"}}>Health</th>
                <th style={{padding:"11px 16px",width:"4%"}}></th>
              </tr>
            </thead>
            <tbody>
              {visibleSites.length === 0 ? (
                <tr><td colSpan={6} style={{padding:"2rem 1rem",textAlign:"center",color:"var(--text3)",fontSize:13}}>
                  No sites match the current filter.
                </td></tr>
              ) : visibleSites.map((s) => {
                const dSign = s.delta > 0 ? "+" : "";
                const dColor = s.delta > 0
                  ? "var(--green)"
                  : s.delta < 0
                    ? (s.health === 'red' ? "var(--red)" : "var(--amber)")
                    : "var(--text3)";
                const sparkData = s.weeklyClicks ? s.weeklyClicks.slice(-6) : [];
                return (
                  <tr key={s.site} onClick={()=>goToSite(s.site)}
                    style={{borderTop:"1px solid var(--b2)",cursor:"pointer",transition:"background .12s"}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--s2)"}
                    onMouseLeave={e=>e.currentTarget.style.background=""}>
                    <td style={{padding:"12px 16px",fontWeight:600,color:"var(--text)"}}>
                      {displaySite(s.site)}
                      {s.error && <span style={{fontSize:11,color:"var(--red)",marginLeft:".5rem",fontWeight:400}}>· error</span>}
                    </td>
                    <td style={{padding:"12px 16px",textAlign:"right",fontFamily:"var(--mono)",color:"var(--text)"}}>
                      {s.clicks28d.toLocaleString()}
                    </td>
                    <td style={{padding:"12px 16px",textAlign:"right",fontFamily:"var(--mono)",color:dColor,fontWeight:600}}>
                      {s.health === 'grey' ? "—" : `${dSign}${s.delta.toLocaleString()} (${dSign}${s.deltaPct}%)`}
                    </td>
                    <td style={{padding:"12px 16px"}}>
                      <Sparkline data={sparkData} color={healthColor[s.health]}/>
                    </td>
                    <td style={{padding:"12px 16px"}}>
                      <div style={{display:"inline-flex",alignItems:"center",gap:".4rem"}}>
                        <span style={{width:9,height:9,borderRadius:"50%",background:healthColor[s.health]}}/>
                        <span style={{color:"var(--text2)",fontSize:12}}>{healthLabel[s.health]}</span>
                      </div>
                    </td>
                    <td style={{padding:"12px 16px",color:"var(--text3)",fontSize:"1rem",textAlign:"center"}}>→</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer note */}
        <div style={{marginTop:"1rem",fontSize:".75rem",color:"var(--text3)",textAlign:"center"}}>
          Click any site to open its full RankActions view · Data refreshes weekly
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // SUPPORT MODAL
  // ─────────────────────────────────────────────────────────────
  // Minimal v1 contact form. Posts message + category + UI context to
  // /api/support; the worker attaches verified identity (email, plan) and
  // emails the operator inbox. No ticketing/chat/uploads — email only.
  const SupportModal = () => {
    const [category, setCategory] = useState("bug");
    const [message, setMessage]   = useState("");
    const [sending, setSending]   = useState(false);
    const [sent, setSent]         = useState(false);
    const [error, setError]       = useState(null);
    // Honeypot — hidden from real users, only bots populate it.
    const [hp, setHp]             = useState("");

    const CATEGORIES = [
      ["bug",      "Bug / something broken"],
      ["question", "Question / how do I…"],
      ["billing",  "Billing"],
      ["feature",  "Feature request"],
      ["other",    "Other"],
    ];

    // The screen the user is on, for triage context. currentView/screen are
    // in scope from the parent component.
    const screenLabel = currentView === "portfolio" ? "Portfolio" : (screen || "dashboard");

    const submit = async () => {
      setError(null);
      if (message.trim().length < 10) {
        setError("Please describe the issue in a sentence or two.");
        return;
      }
      setSending(true);
      try {
        const res = await authFetch(`${WORKER_URL}/api/support`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category,
            message: message.trim(),
            site: selectedSite,
            screen: screenLabel,
            hp_extra_info: hp,
          }),
        });
        if (res.status === 429) {
          const d = await res.json().catch(()=>({}));
          setError(d.error || "Too many messages — please wait a little while.");
          setSending(false);
          return;
        }
        if (!res.ok) {
          const d = await res.json().catch(()=>({}));
          setError(d.error || "Couldn't send right now. Please email hello@rankactions.com directly.");
          setSending(false);
          return;
        }
        setSent(true);
      } catch {
        setError("Couldn't send right now. Please email hello@rankactions.com directly.");
      }
      setSending(false);
    };

    return (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&setShowSupport(false)}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="modal-h">Contact support</div>
            <div className="modal-sub">We typically reply within 1 business day</div>
          </div>
          <button className="modal-close" onClick={()=>setShowSupport(false)}>✕</button>
        </div>
        <div className="modal-content">
          {sent ? (
            <div style={{textAlign:"center",padding:"1.5rem 0"}}>
              <div style={{fontSize:"2rem",marginBottom:".5rem"}}>✓</div>
              <div style={{fontSize:"1rem",fontWeight:600,marginBottom:".35rem"}}>Message sent</div>
              <div style={{fontSize:".85rem",color:"var(--text3)",lineHeight:1.5}}>
                Thanks — we'll reply to your account email within 1 business day.
              </div>
            </div>
          ) : (
            <>
              <div className="modal-section-label">What's this about?</div>
              <select
                value={category}
                onChange={e=>setCategory(e.target.value)}
                style={{width:"100%",background:"var(--s2)",border:"1px solid var(--border)",borderRadius:7,padding:".55rem .7rem",color:"var(--text2)",fontFamily:"var(--font)",fontSize:".85rem",cursor:"pointer",marginBottom:".9rem"}}>
                {CATEGORIES.map(([id,label])=>(
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>

              <div className="modal-section-label">Message</div>
              <textarea
                value={message}
                onChange={e=>setMessage(e.target.value)}
                rows={6}
                maxLength={5000}
                placeholder="Tell us what's happening. The more detail the better — what you were doing, what you expected, and what went wrong."
                style={{width:"100%",background:"var(--s2)",border:"1px solid var(--border)",borderRadius:7,padding:".7rem",color:"var(--text2)",fontFamily:"var(--font)",fontSize:".85rem",lineHeight:1.5,resize:"vertical",boxSizing:"border-box"}}
              />

              {/* Honeypot — visually hidden, off-screen, not tab-reachable */}
              <input
                type="text"
                value={hp}
                onChange={e=>setHp(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                style={{position:"absolute",left:"-9999px",width:1,height:1,opacity:0}}
              />

              <div style={{fontSize:".7rem",color:"var(--text3)",marginTop:".6rem",lineHeight:1.5}}>
                We'll automatically include your account email, plan, and the site you're viewing ({displaySite(selectedSite)}) to help us help you faster.
              </div>

              {error && (
                <div style={{marginTop:".7rem",fontSize:".8rem",color:"var(--red,#d9534f)",lineHeight:1.45}}>{error}</div>
              )}
            </>
          )}
        </div>
        {!sent && (
          <div className="modal-footer">
            <button className="mf-btn" onClick={()=>setShowSupport(false)} disabled={sending}>Cancel</button>
            <button className="mf-btn primary" onClick={submit} disabled={sending}>
              {sending ? "Sending…" : "Send message"}
            </button>
          </div>
        )}
      </div>
    </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // UPGRADE MODAL
  // ─────────────────────────────────────────────────────────────

  const UpgradeModal = () => {
    const [upgradePlan, setUpgradePlan] = useState("individual");
    const [billing, setBilling] = useState("monthly");
    const [loading, setLoading] = useState(false);

    const prices = {
      individual:{ monthly: "£100", annual: "£1,200", save: "", monthlyEff: "£100" },
    };
    // Business & Agency are contact-form tiers (bespoke pricing, no Stripe).
    const isContactTier = upgradePlan === "business" || upgradePlan === "agency";
    const p = prices[upgradePlan] || { monthly: "", annual: "", save: "", monthlyEff: "" };

    const priceMap = {
      individual: billing==="annual" ? STRIPE_PRICES.individual_annual : STRIPE_PRICES.individual_monthly,
    };
    const priceId = priceMap[upgradePlan];

    return (
    <div className="upgrade-overlay" onClick={e=>e.target===e.currentTarget&&setShowUpgrade(false)}>
      <div className="upgrade-modal">
        <div className="upgrade-modal-badge">Upgrade</div>
        <h2>Unlock RankActions {upgradePlan.charAt(0).toUpperCase()+upgradePlan.slice(1)}</h2>
        <p>{upgradePlan === "individual" ? "More AI fixes, rank tracking, unlimited page audits, and weekly reports — for your one website."
          : upgradePlan === "business" ? "Unlimited AI fixes, content generation, strategy planner, and link building — tailored to your business."
          : "Everything in Business plus multiple sites, white-label reports and a dedicated account manager."}</p>

        {/* Plan toggle */}
        <div style={{display:"flex",background:"var(--s2)",borderRadius:999,padding:3,gap:3,marginBottom:".75rem"}}>
          {[["individual","Individual"],["business","Business"],["agency","Agency"]].filter(([id])=> id !== plan).map(([id,label])=>(
            <button key={id} onClick={()=>setUpgradePlan(id)}
              style={{flex:1,padding:".45rem",borderRadius:999,border:"none",fontFamily:"var(--font)",fontSize:".82rem",fontWeight:600,cursor:"pointer",background:upgradePlan===id?"var(--blue)":"none",color:upgradePlan===id?"#fff":"var(--text2)",transition:"all .15s"}}>
              {label}
            </button>
          ))}
        </div>

        {/* Billing toggle — only for Individual (the Stripe tier) */}
        {!isContactTier && (
        <div style={{display:"flex",background:"var(--s2)",borderRadius:999,padding:3,gap:3,marginBottom:"1.25rem"}}>
          {[["monthly",`${p.monthly}/month`],["annual",`${p.annual}/year`]].map(([b,label])=>(
            <button key={b} onClick={()=>setBilling(b)}
              style={{flex:1,padding:".45rem",borderRadius:999,border:"none",fontFamily:"var(--font)",fontSize:".82rem",fontWeight:600,cursor:"pointer",background:billing===b?"var(--green)":"none",color:billing===b?"#000":"var(--text2)",transition:"all .15s"}}>
              {label}
              {b==="annual" && p.save && <span style={{display:"block",fontSize:".68rem",fontWeight:500,opacity:.8}}>save {p.save}</span>}
            </button>
          ))}
        </div>
        )}

        <ul className="upgrade-modal-features">
          {upgradePlan === "individual" ? (
            <>
              <li>1 website</li>
              <li>20 AI fixes per month</li>
              <li>Rank Tracker</li>
              <li>Unlimited page audits</li>
              <li>Weekly email digest</li>
              <li>Full action list</li>
            </>
          ) : upgradePlan === "business" ? (
            <>
              <li>1 website</li>
              <li>Unlimited AI fixes</li>
              <li>AI content generator</li>
              <li>Strategy planner</li>
              <li>Link building tools</li>
              <li>Rank Tracker + Page Audit</li>
              <li>Priority support</li>
            </>
          ) : (
            <>
              <li>Everything in Business</li>
              <li>Multiple websites</li>
              <li>Dedicated account manager</li>
              <li>White-label reports (coming soon)</li>
              <li>Competitor tracking (coming soon)</li>
            </>
          )}
        </ul>
        {isContactTier ? (
          <button className="upgrade-modal-cta" onClick={()=>window.open(`https://rankactions.com/#enterprise-${upgradePlan}`,"_blank","noopener")}>
            Contact us about {upgradePlan.charAt(0).toUpperCase()+upgradePlan.slice(1)} →
          </button>
        ) : (
          <button className="upgrade-modal-cta" disabled={loading} onClick={async ()=>{
            setLoading(true);
            await startCheckout(priceId);
            setLoading(false);
          }}>
            {loading ? "Redirecting to checkout…" : billing==="annual" ? `Upgrade — ${p.annual}/year` : `Upgrade — ${p.monthly}/month`}
          </button>
        )}
        {!isContactTier && billing==="monthly" && p.save && (
          <div style={{fontSize:".75rem",color:"var(--green)",textAlign:"center",margin:".5rem 0",cursor:"pointer"}} onClick={()=>setBilling("annual")}>
            💡 Switch to annual and save {p.save}/year
          </div>
        )}
        {!isContactTier && <div style={{fontSize:".7rem",color:"var(--text3)",textAlign:"center",marginTop:".5rem"}}>Secure payment via Stripe · Cancel any time</div>}
        <div className="upgrade-modal-skip" onClick={()=>setShowUpgrade(false)}>Maybe later</div>
        {/* Enterprise nudge — opens the landing-page contact form in a new tab.
            Enterprise pricing is bespoke and managed manually, no Stripe flow. */}
        <div style={{textAlign:"center",marginTop:"1rem",paddingTop:"1rem",borderTop:"1px solid var(--b2)"}}>
          <div style={{fontSize:".72rem",color:"var(--text3)",marginBottom:".25rem"}}>Managing 20+ clients or need white-label?</div>
          <a href="https://rankactions.com/#enterprise" target="_blank" rel="noopener"
             style={{fontSize:".78rem",color:"var(--text2)",fontWeight:600,textDecoration:"underline",textDecorationStyle:"dotted",textUnderlineOffset:"3px"}}>
            Contact us about Enterprise →
          </a>
        </div>
      </div>
    </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // CONTENT GENERATOR
  // ─────────────────────────────────────────────────────────────
  const ContentGenerator = () => {
    const preset = contentPresetRef.current;
    const [kw,        setKw]        = useState(preset?.kw    || "");
    const [biz,       setBiz]       = useState(preset?.biz   || "");
    const [tone,      setTone]      = useState("professional");
    const [wordCount, setWordCount] = useState("1000");
    const [cta,       setCta]       = useState("");
    const [notes,     setNotes]     = useState(preset?.notes || "");
    const [prefilledKw] = useState(!!preset?.kw);
    const [loading,   setLoading]   = useState(false);
    const [output,    setOutput]    = useState(null);
    const [error,     setError]     = useState(null);
    const [tab,       setTab]       = useState("preview");
    const [copied,    setCopied]    = useState(false);
    const [loadMsg,   setLoadMsg]   = useState("Researching your keyword…");
    const [annotated, setAnnotated] = useState(false);

    const loadMsgs = [
      "Researching your keyword…",
      "Writing SEO-optimised content…",
      "Structuring headings and subheadings…",
      "Adding internal link suggestions…",
      "Applying RankActions branding…",
      "Finalising meta tags…",
    ];

    // Clear ref immediately so revisiting content tab starts fresh
    useEffect(()=>{ contentPresetRef.current = null; },[]);

    const suggestedKw = siteData?.topOpportunities?.[0]?.keyword || "";

    // Normalise text for keyword matching: lowercase, strip HTML tags,
    // collapse whitespace, strip punctuation, drop trailing 's' from
    // words to handle plural/singular forms ("gdpr consultancy" vs
    // "gdpr consultancies"). Returns a single space-separated string
    // suitable for substring matching.
    const normaliseForKw = (s) => String(s || "")
      .toLowerCase()
      .replace(/<[^>]+>/g, " ")            // strip HTML
      .replace(/[^a-z0-9\s]/g, " ")        // strip punctuation
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w.length > 3 ? w.replace(/s$/, "") : w)  // drop trailing s on words >3 chars
      .join(" ");

    const seoStats = output ? {
      titleLen: (output.match(/<title>(.*?)<\/title>/i)?.[1]||"").length,
      descLen:  (output.match(/meta name="description" content="(.*?)"/i)?.[1]||"").length,
      h2Count:  (output.match(/<h2/gi)||[]).length,
      h1Count:  (output.match(/<h1/gi)||[]).length,
      wordEst:  Math.round(output.replace(/<[^>]*>/g,"").split(/\s+/).length),
      hasKw:    !!(kw && normaliseForKw(output).includes(normaliseForKw(kw))),
      linkCount:(output.match(/<a\s/gi)||[]).length,
    } : null;

    // Build annotated version of HTML — adds visible labels to SEO elements
    const buildAnnotated = (html) => {
      const style = `
        <style>
        .ra-label{display:inline-block;font-family:monospace;font-size:11px;font-weight:700;padding:2px 7px;border-radius:3px;margin-bottom:4px;letter-spacing:.5px;}
        .ra-h1-wrap{border:2px solid #0fdb8a;border-radius:4px;padding:8px;margin:4px 0;position:relative;}
        .ra-h2-wrap{border:2px solid #4d7bff;border-radius:4px;padding:6px;margin:4px 0;}
        .ra-h3-wrap{border:2px dashed #f5a623;border-radius:4px;padding:4px;margin:4px 0;}
        .ra-meta-wrap{border:2px solid #a855f7;border-radius:4px;padding:4px 8px;margin:4px 0;background:#faf0ff;}
        .ra-link-wrap{border:1px solid #f03e5f;border-radius:3px;padding:1px 4px;}
        .ra-label-h1{background:#0fdb8a;color:#000;}
        .ra-label-h2{background:#4d7bff;color:#fff;}
        .ra-label-h3{background:#f5a623;color:#000;}
        .ra-label-link{background:#f03e5f;color:#fff;font-size:9px;}
        .ra-label-meta{background:#a855f7;color:#fff;}
        </style>`;
      return html
        .replace(/<h1([^>]*)>([\s\S]*?)<\/h1>/gi,
          `<div class="ra-h1-wrap"><span class="ra-label ra-label-h1">H1 — Primary keyword heading</span><h1$1>$2</h1></div>`)
        .replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi,
          `<div class="ra-h2-wrap"><span class="ra-label ra-label-h2">H2 — Section heading</span><h2$1>$2</h2></div>`)
        .replace(/<h3([^>]*)>([\s\S]*?)<\/h3>/gi,
          `<div class="ra-h3-wrap"><span class="ra-label ra-label-h3">H3 — Subsection heading</span><h3$1>$2</h3></div>`)
        .replace(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi,
          `<span class="ra-link-wrap"><span class="ra-label ra-label-link">LINK</span><a $1>$2</a></span>`)
        .replace(/<\/head>/i, `${style}</head>`);
    };

    // Guard every internal link in generated content. Two independent checks:
    //
    //  1. EXISTENCE. The link must point at a URL from the allowed pool (the pages
    //     Search Console actually reports for this site). The prompt forbids invented
    //     paths, but when the pool is thin — a new site with little GSC data — the
    //     model invents plausible ones anyway (e.g. /blog/sar-from-former-employee).
    //     Those are 404s in the customer's published article, so they must go.
    //  2. RELEVANCE. The anchor text must describe the destination, or the link is
    //     noise (e.g. "implementing structured testing frameworks" -> homepage).
    //
    // Failing links are UNWRAPPED, never deleted: the sentence keeps its words and
    // simply loses the link. External links and the RankActions footer are untouched.
    const enforceLinkRelevance = (html, base, allowedPool = []) => {
      if (!html || !base) return html;
      let host = "";
      try { host = new URL(base).hostname.replace(/^www\./, ""); } catch { return html; }
      // Brand tokens from the domain's first label. Hyphenated domains
      // ("sar-support.co.uk") must match anchors written as "SAR Support" or
      // "sar-support", so split on hyphens and keep the joined form too.
      const brandLabel  = host.split(".")[0].toLowerCase();
      const brandTokens = new Set([brandLabel, ...brandLabel.split("-")].filter(w => w.length > 2));
      const STOP = new Set(["the","and","for","with","your","our","this","that","from","into","about","more","what","how","why","are","you","its","their"]);
      const wordsOf = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
        .filter(w => w.length > 3 && !STOP.has(w));

      // Normalise the pool once: compare on host+path, ignoring scheme, www and
      // trailing slashes, so "https://x.co.uk/a/" and "http://www.x.co.uk/a" match.
      const normUrl = (u) => {
        try {
          const p = new URL(u, base);
          return p.hostname.replace(/^www\./, "") + p.pathname.replace(/\/+$/, "").toLowerCase();
        } catch { return null; }
      };
      const allowed = new Set(
        (Array.isArray(allowedPool) ? allowedPool : []).map(normUrl).filter(Boolean)
      );

      let stripped = 0, invented = 0;
      const out = html.replace(/(<!--\s*Internal link:[^>]*-->\s*)?<a\s+href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi,
        (full, comment, href, attrs, anchorHtml) => {
          let u;
          try { u = new URL(href, base); } catch { return full; }
          if (u.hostname.replace(/^www\./, "") !== host) return full;   // external — leave alone

          // EXISTENCE CHECK — unconditional. This originally only ran when the pool
          // held more than the homepage, on the theory that a thin pool shouldn't
          // strip everything. That was backwards: a site with no known pages is
          // EXACTLY the site where every deep link must have been invented, because
          // there is nothing real to link to. Enforce whenever we have any pool.
          if (allowed.size > 0) {
            const key = normUrl(u.href);
            if (key && !allowed.has(key)) {
              invented++;
              return anchorHtml;   // unwrap: this URL does not exist on the site
            }
          }

          const anchorText = anchorHtml.replace(/<[^>]+>/g, " ");
          const aWords = wordsOf(anchorText);
          const path = u.pathname.replace(/\/+$/, "");
          const isHome = path === "" || path === "/";
          let ok;
          if (isHome) {
            // Homepage links are only justified when the anchor names the company.
            // Match if the anchor contains any brand token, or is an explicit
            // homepage reference. "SAR Support" -> ["support"] hits "support".
            ok = aWords.some(w => brandTokens.has(w))
              || [...brandTokens].some(b => anchorText.toLowerCase().includes(b))
              || /\b(homepage|home page)\b/i.test(anchorText);
          } else {
            const pWords = wordsOf(path);
            ok = pWords.length === 0 || aWords.some(w => pWords.includes(w));
          }
          if (ok) return full;
          stripped++;
          return anchorHtml;   // unwrap: keep the words, drop the link (and its label comment)
        });
      if (invented > 0) console.warn(`[content] removed ${invented} internal link(s) pointing at URLs that don't exist on this site`);
      if (stripped > 0) console.info(`[content] removed ${stripped} internal link(s) with irrelevant anchor text`);
      return out;
    };

    // The prompt asks for the CTA to be a clickable button and specifies the exact
    // markup, but the model has repeatedly emitted bare text inside the CTA wrapper
    // instead — leaving the .cta-button class defined but unused and the article
    // with no working call to action. Fix it deterministically after generation.
    // The wrapper class varies between generations (.cta-section / .cta), so match
    // either, and only act when the block genuinely contains no anchor.
    const ensureCtaButton = (html, homeUrl, ctaText) => {
      if (!html) return html;
      const label = String(ctaText || "").trim() || "Get in touch today";
      let fixed = 0;

      let out = html.replace(
        /<div class="(cta-section|cta)">([\s\S]*?)<\/div>/gi,
        (full, cls, inner) => {
          if (/<a[\s>]/i.test(inner)) return full;                 // already a link
          // Split the block into the CTA label line(s) and any supporting markup
          // (e.g. a trailing <p> of explanatory copy), which must be preserved.
          const supporting = inner.match(/<(p|span|small)[\s>][\s\S]*$/i);
          const tail = supporting ? supporting[0] : "";
          const head = (supporting ? inner.slice(0, supporting.index) : inner).trim();
          const text = head.replace(/<[^>]+>/g, "").trim() || label;
          fixed++;
          return `<div class="${cls}">\n  <a href="${homeUrl}" class="cta-button">${text}</a>\n  ${tail.trim()}\n</div>`;
        }
      );

      // If the button class was never defined in <style>, add it — otherwise the
      // anchor renders as a plain link and looks broken.
      if (fixed > 0 && !/\.cta-button\s*\{/.test(out)) {
        out = out.replace(/<\/style>/i,
          `.cta-button{display:inline-block;background:#0e7a3c;color:#fff;padding:.9rem 2rem;border-radius:6px;font-weight:500;font-family:'Barlow Condensed',Impact,sans-serif;text-transform:uppercase;letter-spacing:1px;text-decoration:none}\n.cta-button:hover{background:#1ea863;color:#fff}\n</style>`);
      }
      if (fixed > 0) console.info(`[content] converted ${fixed} plain-text CTA(s) into a button`);
      return out;
    };

    const generate = async () => {
      if (!kw.trim()) return;
      setLoading(true); setError(null); setOutput(null);
      let mi = 0;
      const iv = setInterval(()=>{ mi=(mi+1)%loadMsgs.length; setLoadMsg(loadMsgs[mi]); }, 3200);

      // Load previously generated content to avoid duplication
      let contentHistory = [];
      try { contentHistory = JSON.parse(localStorage.getItem(`ra_content_history_${selectedSite}`) || "[]"); } catch {}
      const historyContext = contentHistory.length > 0
        ? `\nPREVIOUSLY GENERATED CONTENT (do NOT duplicate these topics or angles):\n${contentHistory.map(h => `- "${h.keyword}" (${h.date})`).join("\n")}\nWrite something genuinely different from the above — different angle, different subtopics, different structure.\n`
        : "";

      // Normalise the site URL once. selectedSite can come in as
      // "example.com", "https://example.com", "https://example.com/", or
      // "sc-domain:example.com". We need a clean "https://example.com"
      // (no trailing slash) to build consistent URLs without ending up
      // with double-protocol bugs like "https://https://example.com//".
      const siteBase = (() => {
        let s = String(selectedSite || "")
          .replace(/^sc-domain:/, "")
          .replace(/^https?:\/\//, "")
          .replace(/\/+$/, "");
        return s ? `https://${s}` : "";
      })();

      // Build the list of REAL pages on the user's site, sorted by traffic.
      // We pass these to Claude so internal links go somewhere real (no 404s).
      // Each page already includes the path; we strip the domain just in case and rebuild as a full URL.
      // Boilerplate pages (privacy, terms, cookies, legal) are real pages and
      // often rank, so they used to enter the link pool and the AI would link to
      // them for lack of anything better - producing anchors like "security
      // vulnerabilities" pointing at /privacy. They are never a relevant
      // destination for editorial content, so exclude them from the pool.
      const BOILERPLATE_RE = /\/(privacy|terms|cookie|cookies|legal|disclaimer|gdpr-notice|accessibility)([-/.]|$)/i;
      const realPages = (siteData?.pages || [])
        .slice()
        .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
        .map(p => {
          const path = (p.page || "").replace(/^https?:\/\/[^/]+/, "") || "/";
          return `${siteBase}${path}`;
        })
        .filter(u => !BOILERPLATE_RE.test(u))
        .slice(0, 8);
      // Always include the homepage as a guaranteed-valid fallback
      const homepageUrl = `${siteBase}/`;
      const linkPool = Array.from(new Set([homepageUrl, ...realPages]));
      const linkRules = `\nINTERNAL LINK RULES — these are absolute:
- You may ONLY link to URLs from the allowed list. Never invent a path; an invented path is a 404 and a serious error.
- RELEVANCE IS REQUIRED. Only link when the destination genuinely relates to the sentence it sits in. An irrelevant link is worse than no link.
- Anchor text MUST describe what the reader will find at the destination. Never wrap unrelated words (e.g. "security vulnerabilities", "adjustment tomorrow") in a link just to place one.
- If no allowed URL is genuinely relevant to a passage, DO NOT add a link there. Fewer good links beat more bad ones.
- 0 to 4 internal links total. Zero is acceptable and correct when nothing relevant exists.\n`;
      const linkPoolContext = linkPool.length > 1
        ? `\nALLOWED INTERNAL LINKS — these are the ONLY URLs that exist on the client's site:\n${linkPool.map(u => `- ${u}`).join("\n")}\n${linkRules}`
        : `\nALLOWED INTERNAL LINKS — the homepage (${homepageUrl}) is the ONLY confirmed URL on this site. Because there is no relevant deep page to link to, internal links are OPTIONAL in this article. Add AT MOST ONE link to the homepage, and ONLY on a phrase that refers to the company, product or service itself (e.g. the brand name, "our platform"). Do NOT wrap a general concept or descriptive phrase in a homepage link. If no sentence refers to the company directly, add NO internal links at all — that is the correct outcome.\n${linkRules}`;

      // Pillar link - only ever set when the pillar page was matched to a REAL
      // published URL on the site (see resolvePillarUrl). Without a verified URL
      // we say nothing: "link back to the pillar" with no URL contradicts the
      // no-invented-paths rule, and the model resolves that by inventing one.
      const pillarContext = preset?.pillarUrl
        ? `\nPILLAR PAGE — this article is a cluster post supporting a pillar page. Include exactly ONE contextual link back to it, placed where it reads naturally (usually near the conclusion), with descriptive anchor text about the pillar's topic:\n- ${preset.pillarUrl}${preset.pillarTitle ? ` ("${preset.pillarTitle}")` : ""}\nThis pillar link is in addition to the internal link rules below and does not count towards the 0-4 limit.\n`
        : "";

      // Dates must be injected, never left to the model. The prompt used to say
      // "datePublished today", which the model interpreted as its own training
      // cutoff — articles shipped stamped with dates up to a year in the past.
      const todayIso   = new Date().toISOString().slice(0, 10);
      const todayHuman = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

      // Volatile SEO facts. Models trained before these changes confidently
      // teach the retired versions, which is a credibility problem in an SEO
      // product. Keep this list short and update it when Google changes things.
      const freshnessContext = `\nFACTUAL ACCURACY — these SEO facts changed recently and MUST be stated correctly:
- Core Web Vitals are LCP, INP (Interaction to Next Paint) and CLS. INP replaced First Input Delay (FID) in March 2024. Never present FID as a current Core Web Vital. Targets: INP under 200ms, LCP under 2.5s, CLS under 0.1.
- Search Console's "Coverage" report is now "Page indexing". The standalone "Mobile Usability" report was retired - assess mobile experience via Core Web Vitals and PageSpeed Insights / Lighthouse.
- "Page Experience" is a set of signals, not a single ranking factor or score.
- Do not cite specific ranking-factor percentages or algorithm weightings; they are not published. Do not invent statistics, study results or dates. If you are not confident a number is accurate, describe the effect qualitatively instead.\n`;

      try {
        const prompt = `You are an expert SEO content writer. Generate a complete, production-ready HTML blog post styled with RankActions branding.

OUTPUT ONLY raw HTML starting with <!DOCTYPE html>. No markdown, no code fences, no explanation.

INPUTS:
- Target keyword: "${kw.trim()}"
- Business/niche: ${biz.trim() || "general business"}
- Tone: ${tone}
- Target word count: ~${wordCount} words
- Primary CTA: ${cta.trim() || "Contact us to find out more"}
- Additional notes: ${notes.trim() || "none"}
- Client website: ${displaySite(selectedSite)}
${linkPoolContext}${pillarContext}${freshnessContext}
TODAY'S DATE IS ${todayHuman} (${todayIso}). Any date shown anywhere in the article — the visible byline, the meta block, JSON-LD datePublished and dateModified — MUST be this exact date. Never output a date from memory.
${historyContext}

VISUAL DESIGN — RankActions brand (light cream body for readability, dark branded chrome with green accents):

CSS to include in <style>:
- Body: background #f5f1e8 (cream), color #0d0d0d, font-family 'DM Sans', -apple-system, sans-serif, line-height 1.65
- Heading font: 'Barlow Condensed', Impact, sans-serif (font-weight 500, no uppercase, no positive letter-spacing — see Heading style rule below)
- Brand primary green: #0e7a3c (use for links, CTA button background, callout border-left, H2 underlines)
- Brand accent green: #1ea863 (use for hover states, secondary highlights, "Actions" wordmark colour)
- Header bar: dark background #0d0d0d, white text, padding 1rem 2rem, contains the RankActions wordmark on the left — render it inline as TWO spans so colours match the brand: <span style="color:#ffffff">Rank</span><span style="color:#1ea863">Actions</span> in Barlow Condensed weight 500 (the brand font's heaviest weight loaded). On the right, small cream-coloured text "Generated for ${displaySite(selectedSite)}"
- Footer bar: dark background #0d0d0d, white text, padding 1.5rem 2rem, centered, says "Generated by RankActions — AI-powered SEO content" with "rankactions.com" linked in green #1ea863
- Article body: max-width 760px, margin auto, padding 3rem 2rem
- Hero section: lighter cream #faf6ed background, padding 3rem 2rem, centered
- Links: color #0e7a3c, text-decoration underline (hover: #1ea863)
- CTA button: background #0e7a3c, color white, padding .9rem 2rem, border-radius 6px, font-weight 500, no underline, font-family 'Barlow Condensed', text-transform uppercase, letter-spacing 1px (hover: #1ea863)
- Callout/tip box: background #faf6ed, border-left 3px solid #0e7a3c, padding 1rem 1.5rem, margin 1.5rem 0
- Include Google Fonts link: https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap
- Heading style: NOT all uppercase. Use sentence case or title case. Set CSS h1/h2/h3 with text-transform: none, font-weight 500 (the Google Fonts URL above loads ONLY weights 400 and 500 for Barlow Condensed — do NOT specify 600 or 700 in CSS, the browser will fall back to 500 automatically), color #0d0d0d, letter-spacing 0 or -0.5px (NOT positive tracking). The Barlow Condensed font is already strong at 500 weight; uppercase and 700 weight together make headings overpowering on cream backgrounds.

KEYWORD PLACEMENT — MANDATORY (this is an SEO tool, the article must pass an SEO check):
- The exact phrase "${kw.trim()}" MUST appear in the <title> tag — placed near the front (first 30 chars)
- The exact phrase "${kw.trim()}" MUST appear in the <meta name="description"> attribute
- The exact phrase "${kw.trim()}" MUST appear in the <h1> — verbatim, not paraphrased, not pluralised, not split across other words
- The exact phrase "${kw.trim()}" MUST appear in the FIRST sentence of the opening paragraph — in the first 25 words
- The exact phrase "${kw.trim()}" MUST appear in at least 2 of the H2 headings
- The exact phrase "${kw.trim()}" should appear in the body text 4-8 times total (natural usage, no stuffing)
- Use the keyword EXACTLY as written above — same wording, same word order. Do not paraphrase, do not synonymise, do not abbreviate. If the keyword has an awkward word order, you must still use it verbatim.

BUILD THIS STRUCTURE:
1. HEAD: title tag (primary keyword "${kw.trim()}" in the first 50-60 chars for SERP visibility, total title can extend up to ~100 chars if needed for clarity and click appeal), meta description (145-155 chars, MUST include "${kw.trim()}"), canonical URL (${siteBase}/[keyword-slug]/), robots, Open Graph tags (og:title MUST include "${kw.trim()}"), JSON-LD Article schema — it MUST contain headline, description, datePublished AND dateModified both set to EXACTLY "${todayIso}" (never invent or recall a date), plus BOTH an author and a publisher object naming the client (${displaySite(selectedSite)}) — the Google Fonts link, and a <style> block with the CSS above
2. HEADER BAR: dark, with the two-tone "RankActions" wordmark on the left (white "Rank" + green "Actions", Barlow Condensed weight 500) and "Generated for ${displaySite(selectedSite)}" on the right in small cream text
3. HERO SECTION: H1 containing the exact verbatim phrase "${kw.trim()}", followed by a subtitle, author byline, date, read time
4. ARTICLE BODY:
   - Opening paragraph: the FIRST SENTENCE must contain the exact phrase "${kw.trim()}" within the first 25 words
   - 4-6 H2 sections — at least 2 must contain the exact phrase "${kw.trim()}" in the heading text
   - At least one H3 subsection
   - One tip/callout box (green border-left)
   - Natural keyword usage — no stuffing, but the exact phrase "${kw.trim()}" should appear 4-8 times in body text
   - Internal links: follow the INTERNAL LINK RULES above exactly (0-4 links, only allowed URLs, relevance required, descriptive anchor text). Format: <a href="[URL from the allowed list]">[descriptive anchor text]</a>
   - Each internal link should have a comment: <!-- Internal link: link to your [page type] page -->
5. CTA SECTION: a real clickable button, NOT plain text. Use exactly this markup, substituting the client's homepage URL:
   <div class="cta-section"><a href="${homepageUrl}" class="cta-button">${cta.trim() || "Get in touch today"}</a></div>
   The .cta-button class must be defined in the <style> block (green background #0e7a3c, white text, padding .9rem 2rem, border-radius 6px, no underline).
6. FOOTER BAR: dark, centered, "Generated by RankActions — AI-powered SEO content" with "rankactions.com" linked in green #1ea863

IMPORTANT — The keyword "${kw.trim()}" MUST appear verbatim in the title, meta description, H1, first sentence, and at least 2 H2s. This is the single most important rule. Label internal links clearly so non-technical users know what they are. Every internal link MUST resolve to a real page (use only URLs from the ALLOWED INTERNAL LINKS list). The page must look professional and on-brand for RankActions while still being a usable blog post the client can publish.`;

        const text = await callClaude(prompt,
          "Expert SEO content writer. Output ONLY raw HTML starting with <!DOCTYPE html>. No markdown. No explanations.",
          "longform"
        );
        clearInterval(iv);
        let clean = text.replace(/^```html\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/i,"").trim();
        clean = enforceLinkRelevance(clean, siteBase, linkPool);
        clean = ensureCtaButton(clean, homepageUrl, cta);

        // Completeness check. Longform generations can hit the token ceiling and
        // stop mid-sentence; the HTML still previews fine until you reach the end.
        // Detect it and tell the user rather than letting a broken page be published.
        const looksComplete = /<\/html>\s*$/i.test(clean) && /<\/body>/i.test(clean);
        if (!looksComplete) {
          setError("The article came back incomplete — it was cut off before the end. Please regenerate" + (Number(wordCount) >= 1500 ? ", or try a shorter word count." : "."));
          setOutput(clean);
          setTab("preview");
          setLoading(false);
          return;
        }

        setOutput(clean);
        setTab("preview");

        // Track generated content to avoid future duplication
        try {
          const histKey = `ra_content_history_${selectedSite}`;
          const hist = JSON.parse(localStorage.getItem(histKey) || "[]");
          hist.push({ keyword: kw.trim(), date: new Date().toISOString().slice(0,10) });
          localStorage.setItem(histKey, JSON.stringify(hist.slice(-50))); // keep last 50
          saveUserData(selectedSite, 'content_history', hist.slice(-50));
        } catch {}
      } catch(e) {
        clearInterval(iv);
        setError("Generation failed — please try again. If the problem persists, check your Worker is deployed.");
      }
      setLoading(false);
    };

    // The <!-- Internal link: ... --> comments exist so the PREVIEW can label each
    // link for non-technical users. They are an editing aid, not content, and they
    // used to ship into whatever the customer published — leaving instructions like
    // "link to your homepage" in their page source. Strip them on the way out.
    const publishableHtml = (html) =>
      String(html || "")
        // Comment sitting on its own line: remove the whole line.
        .replace(/^[ \t]*<!--\s*Internal link:[^>]*-->[ \t]*\r?\n/gim, "")
        // Comment sitting inline: remove ONLY the comment, preserving the spaces
        // either side — stripping them would fuse words onto the link text.
        .replace(/<!--\s*Internal link:[^>]*-->/gi, "");

    const copyHtml = () => {
      if (!output) return;
      navigator.clipboard.writeText(publishableHtml(output)).catch(()=>{});
      setCopied(true); setTimeout(()=>setCopied(false), 1800);
    };

    const download = () => {
      if (!output) return;
      const slug = kw.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([publishableHtml(output)],{type:"text/html"}));
      a.download = `${slug || "article"}.html`;
      a.click();
    };

    // Gate for free users
    if (!isPro) return (
      <div className="content">
        <div className="cg-header">
          <div className="cg-title">Content Generator</div>
          <div className="cg-sub">AI-written SEO blog posts for your target keywords</div>
        </div>
        <div className="upgrade-wall" style={{maxWidth:480,margin:"3rem auto",textAlign:"center"}}>
          <div className="upgrade-wall-icon">✍</div>
          <div className="upgrade-wall-h">Content Generator is a Pro feature</div>
          <div className="upgrade-wall-sub">
            Pick a keyword from your dashboard, generate a fully SEO-optimised blog post in 30 seconds. Ready to publish, complete with meta tags, structured headings and a call to action.
          </div>
          <button className="upgrade-wall-btn" onClick={()=>setShowUpgrade(true)}>Upgrade — from £100/month</button>
        </div>
      </div>
    );

    return (
      <div className="cg-wrap">
        <div className="cg-header">
          <div className="cg-title">Content Generator</div>
          <div className="cg-sub">Generate SEO-optimised blog posts from your target keywords</div>
        </div>

        {/* Pre-fill notice — shown when arriving from SEO Opportunities */}
        {prefilledKw && (
          <div style={{background:"var(--gdim)",border:"1px solid rgba(15,219,138,.2)",borderRadius:10,padding:".85rem 1.1rem",fontSize:".85rem",color:"var(--green)",display:"flex",alignItems:"center",gap:".6rem"}}>
            ✓ Keyword pre-filled from your SEO Opportunities — review the settings below and click Generate
          </div>
        )}

        {/* Privacy notice — shown prominently per GDPR best practice */}
        <div className="cg-privacy">
          <span className="cg-privacy-icon">🔒</span>
          <span><strong>Data notice:</strong> Only the keyword, business context and tone you enter below are sent to the AI to generate content. No personal data, no Search Console data, and no user information is included in the request. Generated articles are not stored — they exist in your browser only until you download or copy them.</span>
        </div>

        <div className="cg-grid">
          {/* ── Input panel ── */}
          <div className="cg-panel">
            <div className="cg-panel-hd">
              <div className="cg-panel-hd-title">Article settings</div>
              <div className="cg-panel-hd-sub">Fill in the details below to generate</div>
            </div>
            <div className="cg-panel-bd">
              <div className="cg-field">
                <label>Target keyword *</label>
                <input placeholder={suggestedKw || "e.g. sar support services uk"}
                  value={kw} onChange={e=>setKw(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&kw.trim()&&!loading&&generate()}/>
                {suggestedKw && !kw && !prefilledKw && (
                  <div className="cg-tip" style={{cursor:"pointer"}} onClick={()=>setKw(suggestedKw)}>
                    💡 Suggested from your dashboard: "{suggestedKw}" — click to use
                  </div>
                )}
              </div>
              <div className="cg-field">
                <label>Business / niche</label>
                <input placeholder="e.g. Data protection consultancy"
                  value={biz} onChange={e=>setBiz(e.target.value)}/>
              </div>
              <div className="cg-field-row">
                <div className="cg-field">
                  <label>Tone</label>
                  <select value={tone} onChange={e=>setTone(e.target.value)}>
                    <option value="professional">Professional</option>
                    <option value="friendly">Friendly</option>
                    <option value="authoritative">Authoritative</option>
                    <option value="conversational">Conversational</option>
                    <option value="technical">Technical</option>
                  </select>
                </div>
                <div className="cg-field">
                  <label>Word count</label>
                  <select value={wordCount} onChange={e=>setWordCount(e.target.value)}>
                    <option value="600">~600 words</option>
                    <option value="1000">~1,000 words</option>
                    <option value="1500">~1,500 words</option>
                    <option value="2000">~2,000 words</option>
                  </select>
                </div>
              </div>
              <div className="cg-field">
                <label>Primary call to action</label>
                <input placeholder="e.g. Book a free consultation"
                  value={cta} onChange={e=>setCta(e.target.value)}/>
              </div>
              <div className="cg-divider"/>
              <div className="cg-field">
                <label>Additional notes (optional)</label>
                <textarea placeholder="Any specific points to cover, products to mention, things to avoid..."
                  value={notes} onChange={e=>setNotes(e.target.value)} rows={3}/>
              </div>
              <button className="cg-gen-btn" disabled={!kw.trim()||loading} onClick={generate}>
                {loading ? <><span className="spinner-sm"/>{" Generating…"}</> : "✨ Generate article"}
              </button>
              <div className="cg-tip">
                ⏱ Generation takes 20–40 seconds. Articles are styled with RankActions branding and ready to share. Content is created in your browser and never stored on our servers.
              </div>
            </div>
          </div>

          {/* ── Output panel ── */}
          <div className="cg-output">
            <div className="cg-toolbar">
              <div className="cg-status">
                <div className={`cg-status-dot ${loading?"loading":output?"ready":error?"error":""}`}/>
                <span>{loading ? loadMsg : output ? "Article ready" : error ? "Error" : "Ready to generate"}</span>
              </div>
              <div className="cg-actions">
                {output && (
                  <button
                    style={{padding:".35rem .85rem",borderRadius:6,border:`1px solid ${annotated?"var(--green)":"var(--border)"}`,background:annotated?"var(--gdim)":"var(--s1)",color:annotated?"var(--green)":"var(--text2)",fontFamily:"var(--font)",fontSize:".775rem",cursor:"pointer"}}
                    onClick={()=>setAnnotated(p=>!p)}>
                    {annotated ? "✓ Labels on" : "🏷 Show labels"}
                  </button>
                )}
                <button className="cg-act" disabled={!output} onClick={copyHtml}>
                  {copied ? "✓ Copied" : "📋 Copy HTML"}
                </button>
                <button className="cg-act primary" disabled={!output} onClick={download}>
                  ⬇ Download
                </button>
              </div>
            </div>

            {output && (
              <div className="cg-tabs">
                {["preview","html","seo"].map(t=>(
                  <button key={t} className={`cg-tab ${tab===t?"on":""}`} onClick={()=>setTab(t)}>
                    {t==="preview"?"Preview":t==="html"?"HTML":"SEO Check"}
                  </button>
                ))}
              </div>
            )}

            {/* SEO stats bar */}
            {output && tab==="seo" && seoStats && (
              <div className="cg-seo-bar">
                <div className="cg-seo-c">
                  <div className="cg-seo-l">Title tag</div>
                  <div className={`cg-seo-v ${seoStats.titleLen>=50&&seoStats.titleLen<=60?"ok":"warn"}`}>
                    {seoStats.titleLen} chars {seoStats.titleLen>=50&&seoStats.titleLen<=60?"✓ Good":"⚠ Adjust"}
                  </div>
                </div>
                <div className="cg-seo-c">
                  <div className="cg-seo-l">Meta description</div>
                  <div className={`cg-seo-v ${seoStats.descLen>=145&&seoStats.descLen<=160?"ok":"warn"}`}>
                    {seoStats.descLen} chars {seoStats.descLen>=145&&seoStats.descLen<=160?"✓ Good":"⚠ Adjust"}
                  </div>
                </div>
                <div className="cg-seo-c">
                  <div className="cg-seo-l">H1 heading</div>
                  <div className={`cg-seo-v ${seoStats.h1Count===1?"ok":"warn"}`}>
                    {seoStats.h1Count} found {seoStats.h1Count===1?"✓ Correct":"⚠ Should be 1"}
                  </div>
                </div>
                <div className="cg-seo-c">
                  <div className="cg-seo-l">H2 headings</div>
                  <div className={`cg-seo-v ${seoStats.h2Count>=3?"ok":"warn"}`}>
                    {seoStats.h2Count} found {seoStats.h2Count>=3?"✓ Good":"⚠ Add more"}
                  </div>
                </div>
                <div className="cg-seo-c">
                  <div className="cg-seo-l">Keyword present</div>
                  <div className={`cg-seo-v ${seoStats.hasKw?"ok":"warn"}`}>
                    {seoStats.hasKw?"✓ Found in content":"⚠ Not detected"}
                  </div>
                </div>
                <div className="cg-seo-c">
                  <div className="cg-seo-l">Internal links</div>
                  <div className={`cg-seo-v ${seoStats.linkCount>=3?"ok":"warn"}`}>
                    {seoStats.linkCount} links {seoStats.linkCount>=3?"✓ Good":"⚠ Add more"}
                  </div>
                </div>
                <div className="cg-seo-c">
                  <div className="cg-seo-l">Est. word count</div>
                  <div className={`cg-seo-v ${seoStats.wordEst>=600?"ok":"warn"}`}>
                    ~{seoStats.wordEst.toLocaleString()} words
                  </div>
                </div>
                <div className="cg-seo-c">
                  <div className="cg-seo-l">Data stored</div>
                  <div className="cg-seo-v ok">✓ None — browser only</div>
                </div>
              </div>
            )}

            {/* Legend shown when annotated */}
            {output && annotated && tab==="preview" && (
              <div style={{display:"flex",gap:".5rem",padding:".65rem 1rem",background:"var(--s3)",borderBottom:"1px solid var(--border)",flexWrap:"wrap"}}>
                <span style={{fontSize:".72rem",color:"var(--text2)",marginRight:".25rem"}}>Labels:</span>
                {[["H1","#0fdb8a","#000","Primary keyword heading"],["H2","#4d7bff","#fff","Section heading"],["H3","#f5a623","#000","Subsection"],["LINK","#f03e5f","#fff","Internal link"]].map(([l,bg,c,tip])=>(
                  <span key={l} style={{display:"inline-flex",alignItems:"center",gap:".3rem"}}>
                    <span style={{background:bg,color:c,fontSize:".65rem",fontWeight:700,padding:"1px 6px",borderRadius:3,fontFamily:"monospace"}}>{l}</span>
                    <span style={{fontSize:".72rem",color:"var(--text2)"}}>{tip}</span>
                  </span>
                ))}
              </div>
            )}

            {/* States */}
            {loading && (
              <div className="cg-loading-msgs">
                <div className="spinner"/>
                <div className="cg-loading-msg">{loadMsg}</div>
              </div>
            )}
            {!loading && error && <div className="cg-error">⚠ {error}</div>}
            {!loading && !output && !error && (
              <div className="cg-empty">
                <div className="cg-empty-icon">✍</div>
                <h3>Your article will appear here</h3>
                <p>Fill in the keyword and settings, then click Generate. Your article will be ready in about 30 seconds.</p>
              </div>
            )}
            {!loading && output && tab==="preview" && (
              <div className="cg-preview" style={{display:"flex",flexDirection:"column",background:"var(--s2)"}}>
                <div style={{padding:".5rem 1rem",background:"rgba(245,166,35,.06)",borderBottom:"1px solid rgba(245,166,35,.15)",fontSize:".72rem",color:"var(--amber)",lineHeight:1.5}}>
                  ⚠️ AI-generated content requires review. Check facts, links, and legal claims before publishing. Always back up existing pages before replacing content. RankActions is not responsible for changes made to your website.
                </div>
                <div style={{padding:".65rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid var(--border)",flexWrap:"wrap",gap:".5rem"}}>
                  <div style={{fontSize:".78rem",color:"var(--text2)"}}>
                    {annotated ? "🏷 Labels visible — toggle off to see clean version" : "Clean preview — toggle labels to see SEO structure"}
                  </div>
                  <button
                    style={{background:"var(--blue)",color:"#fff",border:"none",borderRadius:7,padding:".4rem .9rem",fontFamily:"var(--font)",fontSize:".8rem",fontWeight:600,cursor:"pointer"}}
                    onClick={()=>{
                      const w = window.open("","_blank");
                      if(w){ w.document.open(); w.document.write(sanitizeAiHtml(output)); w.document.close(); }
                    }}>
                    🔍 Open in new tab
                  </button>
                </div>
                <iframe
                  key={annotated ? "annotated" : "clean"}
                  srcDoc={(() => {
                    const sanitised = sanitizeAiPreview(annotated ? buildAnnotated(output) : output);
                    // Override heading weight regardless of what Claude wrote.
                    // We inject a <link> for the correct font weights + a <style>
                    // block right before </head> so cascading puts our rules last.
                    // !important is used because Claude's CSS uses the same
                    // h1/h2/h3 selectors at the same specificity.
                    const override = `
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500&display=swap" rel="stylesheet">
<style id="ra-heading-override">
h1, h2, h3, h4, h5, h6 {
  font-weight: 500 !important;
  text-transform: none !important;
  letter-spacing: -0.5px !important;
}
.wordmark { font-weight: 500 !important; }
.cta-button, button.cta-button {
  font-weight: 500 !important;
}
</style>`;
                    return sanitised.includes("</head>")
                      ? sanitised.replace("</head>", `${override}\n</head>`)
                      : sanitised;
                  })()}
                  style={{width:"100%",minHeight:580,border:"none",background:"white",flex:1}}
				  sandbox="allow-same-origin"
                  title="Article preview"
                />
              </div>
            )}
            {!loading && output && tab==="html" && (
              <div className="cg-code">
                <pre>{output}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Admin — replace with your Clerk user ID once you have it ──
  const ADMIN_CLERK_IDS = [
    "user_3CMXybSmGDdSNc2caXRZraMoZdt", // Dan
    "user_3Ckg4xABwhpj6NJBhgnOrjZeoZs", // Team
    "user_3CkepthSy1EC7ugb5GSc5ZiOx0N", // Team
    "user_3CkeqYD7Sl5vMeojdoDbmAUeCqV", // Team
  ];
  const isAdmin = ADMIN_CLERK_IDS.includes(user?.id) || isAdminFlag;

  // ─────────────────────────────────────────────────────────────
  // ADMIN PANEL
  // ─────────────────────────────────────────────────────────────
  const AdminPanel = () => {
    const [users,      setUsers]      = useState([]);
    const [loading,    setLoading]    = useState(true);
    const [error,      setError]      = useState(null);
    const [search,     setSearch]     = useState("");
    const [filter,     setFilter]     = useState("all");
    const [selected,   setSelected]   = useState(null);
    const [saving,     setSaving]     = useState(false);

    const fetchUsers = async () => {
      setLoading(true); setError(null);
      try {
        const res  = await authFetch(`${WORKER_URL}/api/admin/users`);
        if (res.status === 401) { setError("Unauthorised — admin access denied"); return; }
        const data = await res.json();
        setUsers(data.users || []);
      } catch(e) { setError("Failed to load users"); }
      setLoading(false);
    };

    useEffect(()=>{ fetchUsers(); },[]);

    const updateUser = async (id, changes) => {
      setSaving(true);
      try {
        await authFetch(`${WORKER_URL}/api/admin/user/${id}`, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify(changes)
        });
        setUsers(prev => prev.map(u => u._id===id ? {...u,...changes} : u));
        setSelected(prev => prev?._id===id ? {...prev,...changes} : prev);
      } catch(e) { alert("Update failed"); }
      setSaving(false);
    };

    const deleteUser = async (id) => {
      if (!window.confirm("Permanently delete this user and all their data? This cannot be undone.")) return;
      setSaving(true);
      try {
        await authFetch(`${WORKER_URL}/api/admin/user/${id}`, {
          method:"DELETE",
        });
        setUsers(prev => prev.filter(u => u._id!==id));
        setSelected(null);
      } catch(e) { alert("Delete failed"); }
      setSaving(false);
    };

    const filtered = users.filter(u => {
      const matchSearch = !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.name?.toLowerCase().includes(search.toLowerCase());
      const matchFilter = filter==="all"
        || (filter==="agency"  && u.plan==="agency")
        || (filter==="business" && u.plan==="business")
        || (filter==="individual" && u.plan==="individual")
        || (filter==="pro"     && u.plan==="pro")
        || (filter==="starter" && u.plan==="starter")
        || (filter==="free"    && (!u.plan||u.plan==="free"))
        || (filter==="disabled"&& u.disabled);
      return matchSearch && matchFilter;
    });

    const stats = {
      total:    users.length,
      agency:   users.filter(u=>u.plan==="agency").length,
      pro:      users.filter(u=>u.plan==="pro").length,
      starter:  users.filter(u=>u.plan==="starter").length,
      free:     users.filter(u=>!u.plan||u.plan==="free").length,
      disabled: users.filter(u=>u.disabled).length,
    };

    const fmt = (iso) => iso ? new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "—";

    // Admin auth is handled by Clerk JWT — no manual secret needed
    if (error) return (
      <div className="admin-wrap" style={{maxWidth:420,margin:"4rem auto",textAlign:"center"}}>
        <div style={{fontSize:"1.5rem",marginBottom:".5rem"}}>🔐</div>
        <div style={{fontSize:"1rem",fontWeight:700,marginBottom:".35rem"}}>Admin access denied</div>
        <div style={{fontSize:".85rem",color:"var(--text2)",marginBottom:"1.5rem"}}>{error}</div>
        <button style={{padding:".5rem 1rem",background:"var(--s2)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text2)",fontFamily:"var(--font)",fontSize:".85rem",cursor:"pointer"}}
          onClick={fetchUsers}>Retry</button>
      </div>
    );

    return (
      <div className="admin-wrap">
        <div className="admin-header">
          <div>
            <div className="admin-title">Admin Panel</div>
            <div style={{fontSize:".8rem",color:"var(--text2)",marginTop:".2rem"}}>Manage RankActions users</div>
          </div>
          <div style={{display:"flex",gap:".75rem",alignItems:"center"}}>
            <button className="admin-refresh" onClick={fetchUsers} disabled={loading}>
              {loading?"Loading…":"↻ Refresh"}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="admin-stats">
          {[["Total users",stats.total,"var(--text)"],["Agency",stats.agency,"#a855f7"],["Pro",stats.pro,"var(--green)"],["Starter",stats.starter,"var(--blue)"],["Free",stats.free,"var(--text3)"],["Disabled",stats.disabled,"var(--red)"]].map(([l,v,c])=>(
            <div key={l} className="admin-stat">
              <div className="admin-stat-label">{l}</div>
              <div className="admin-stat-value" style={{color:c}}>{v}</div>
            </div>
          ))}
        </div>

        {/* Search + filter */}
        <div className="admin-search">
          <input className="admin-search-input" placeholder="Search by email or name…"
            value={search} onChange={e=>setSearch(e.target.value)}/>
          <select className="admin-filter" value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="all">All users</option>
            <option value="agency">Agency only</option>
            <option value="business">Business only</option>
            <option value="individual">Individual only</option>
            <option value="pro">Pro only (legacy)</option>
            <option value="starter">Starter only (legacy)</option>
            <option value="free">Free only</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        {/* Table */}
        {error && <div style={{color:"var(--red)",fontSize:".875rem",marginBottom:"1rem"}}>⚠ {error}</div>}
        {loading ? (
          <div className="admin-empty"><div className="spinner" style={{width:20,height:20,margin:"0 auto"}}/></div>
        ) : filtered.length === 0 ? (
          <div className="admin-empty"><div className="admin-empty-icon">👥</div><div>No users found</div></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Plan</th>
                  <th>Sites</th>
                  <th>AI fixes used</th>
                  <th>Signed up</th>
                  <th>Last seen</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u=>(
                  <tr key={u._id} className={u.disabled?"disabled-row":""} onClick={()=>setSelected(u)}>
                    <td>
                      <div style={{fontWeight:600}}>{u.name || "—"}</div>
                      <div style={{fontSize:".75rem",color:"var(--text2)"}}>{u.email}</div>
                    </td>
                    <td><span className={`plan-badge ${u.plan==="agency"?"agency":u.plan==="pro"?"pro":u.plan==="starter"?"starter":"free"}`}>{u.plan||"free"}</span></td>
                    <td style={{fontFamily:"var(--mono)",fontSize:".8rem"}}>{(u.sites||[]).length}</td>
                    <td style={{fontFamily:"var(--mono)",fontSize:".8rem"}}>{u.aiFixCount||0}</td>
                    <td style={{fontSize:".8rem",color:"var(--text2)"}}>{fmt(u.signedUpAt)}</td>
                    <td style={{fontSize:".8rem",color:"var(--text2)"}}>{fmt(u.lastSeenAt)}</td>
                    <td><span className={`status-badge ${u.disabled?"disabled":"active"}`}>{u.disabled?"Disabled":"Active"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* User drawer */}
        {selected && <>
          <div className="drawer-overlay" onClick={()=>setSelected(null)}/>
          <div className="drawer">
            <div className="drawer-head">
              <div>
                <div style={{fontWeight:700,fontSize:".95rem"}}>{selected.name||"User"}</div>
                <div style={{fontSize:".78rem",color:"var(--text2)"}}>{selected.email}</div>
              </div>
              <button className="drawer-close" onClick={()=>setSelected(null)}>✕</button>
            </div>
            <div className="drawer-body">
              <div>
                <div className="drawer-section-label">Account</div>
                <div style={{display:"flex",flexDirection:"column",gap:".5rem"}}>
                  {[
                    ["User ID",     selected._id,     true],
                    ["Clerk ID",    selected.clerkId||"—",true],
                    ["Email",       selected.email,      false],
                    ...(selected.googleEmail && selected.googleEmail !== selected.email ? [["GSC account", selected.googleEmail, false]] : []),
                    ["Signed up",   fmt(selected.signedUpAt), false],
                    ["Last seen",   fmt(selected.lastSeenAt), false],
                    ["Login count", selected.loginCount||0,  false],
                  ].map(([label,value,mono])=>(
                    <div key={label} className="drawer-field">
                      <div className="drawer-field-label">{label}</div>
                      <div className={`drawer-field-value ${mono?"mono":""}`}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="drawer-section-label">Plan & usage</div>
                <div style={{display:"flex",flexDirection:"column",gap:".5rem"}}>
                  <div className="drawer-field">
                    <div className="drawer-field-label">Current plan</div>
                    <div className="drawer-field-value"><span className={`plan-badge ${selected.plan==="agency"?"agency":selected.plan==="pro"?"pro":selected.plan==="starter"?"starter":"free"}`}>{selected.plan||"free"}</span></div>
                  </div>
                  <div className="drawer-field">
                    <div className="drawer-field-label">AI fixes used this month</div>
                    <div className="drawer-field-value">{selected.aiFixCount||0}</div>
                  </div>
                </div>
              </div>
              <div>
                <div className="drawer-section-label">Sites ({(selected.sites||[]).length})</div>
                {(selected.sites||[]).length===0
                  ? <div style={{fontSize:".82rem",color:"var(--text3)"}}>No sites added yet</div>
                  : (selected.sites||[]).map((s,i)=>(
                      <div key={i} className="drawer-field" style={{marginBottom:".4rem"}}>
                        <div className="drawer-field-value mono">{s}</div>
                      </div>
                    ))
                }
              </div>
              <div className="drawer-actions">
                <div className="drawer-section-label">Actions</div>
                {/* Admin role toggle */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:".5rem .75rem",background:"var(--s2)",borderRadius:8,marginBottom:".5rem"}}>
                  <div>
                    <div style={{fontSize:".82rem",fontWeight:600}}>Admin access</div>
                    <div style={{fontSize:".7rem",color:"var(--text3)"}}>Can view admin panel and manage users</div>
                  </div>
                  <div onClick={()=>{
                    if (ADMIN_CLERK_IDS.includes(selected.clerkId || selected._id)) { alert("This admin is hardcoded and cannot be removed via the UI."); return; }
                    updateUser(selected._id, { isAdmin: !selected.isAdmin });
                  }}
                    style={{width:40,height:22,background:selected.isAdmin?"var(--green)":"var(--s3)",borderRadius:999,position:"relative",cursor:"pointer",flexShrink:0,transition:"background .2s"}}>
                    <div style={{position:"absolute",top:3,left:3,width:16,height:16,background:"#fff",borderRadius:"50%",transition:"transform .2s",transform:selected.isAdmin?"translateX(18px)":"translateX(0)"}}/>
                  </div>
                </div>
                {selected.plan!=="agency" && (
                  <button className="drawer-btn upgrade" style={{background:"#a855f7"}} disabled={saving} onClick={()=>updateUser(selected._id,{plan:"agency"})}>
                    ↑ Upgrade to Agency
                  </button>
                )}
                {selected.plan!=="business" && (
                  <button className="drawer-btn upgrade" disabled={saving} onClick={()=>updateUser(selected._id,{plan:"business"})}>
                    {selected.plan==="agency" ? "↓ Downgrade to Business" : "↑ Upgrade to Business"}
                  </button>
                )}
                {selected.plan!=="individual" && (
                  <button className="drawer-btn upgrade" style={{background:"var(--blue)"}} disabled={saving} onClick={()=>updateUser(selected._id,{plan:"individual"})}>
                    {selected.plan==="business"||selected.plan==="agency" ? "↓ Downgrade to Individual" : "↑ Upgrade to Individual"}
                  </button>
                )}
                {selected.plan!=="free" && (
                  <button className="drawer-btn downgrade" disabled={saving} onClick={()=>updateUser(selected._id,{plan:"free"})}>
                    ↓ Downgrade to Free
                  </button>
                )}
                {selected.disabled
                  ? <button className="drawer-btn enable" disabled={saving} onClick={()=>updateUser(selected._id,{disabled:false})}>
                      ✓ Re-enable account
                    </button>
                  : <button className="drawer-btn disable" disabled={saving} onClick={()=>updateUser(selected._id,{disabled:true})}>
                      ⊘ Disable account
                    </button>
                }
                <button className="drawer-btn delete" disabled={saving} onClick={()=>deleteUser(selected._id)}>
                  🗑 Delete user permanently
                </button>
              </div>
            </div>
          </div>
        </>}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // REPORTS
  // ─────────────────────────────────────────────────────────────
  const ReportsTab = () => {
    const [reportSummary, setReportSummary] = useState(null);
    const [summaryGen, setSummaryGen] = useState(false);

    const fixes = getPriorityFixes();
    const seoRows = getSeoRows();
    const completedFixes = [...doneFixes];
    const prospects = linkProspects;
    const actionImpact = computeActionImpact(doneMeta, snapshots);

    // Keyword groupings from real data
    const kwPage1    = siteData?.keywords?.filter(k => k.position <= 10) || [];
    const kwStriking = siteData?.keywords?.filter(k => k.position > 10 && k.position <= 20) || [];
    const kwPage2Plus= siteData?.keywords?.filter(k => k.position > 20) || [];

    // Link building stats
    const linkStats = {
      identified: prospects.filter(p=>p.status==="identified").length,
      contacted:  prospects.filter(p=>p.status==="contacted").length,
      replied:    prospects.filter(p=>p.status==="replied").length,
      secured:    prospects.filter(p=>p.status==="secured").length,
      declined:   prospects.filter(p=>p.status==="declined").length,
      total:      prospects.length,
    };

    // Generate AI weekly summary
    const generateSummary = async () => {
      if (!siteData) return;
      setSummaryGen(true);
      try {
        const kwSummary = siteData.keywords?.slice(0,10).map(k=>`"${k.keyword}" #${k.position} (${k.clicks} clicks)`).join(", ");
        const txt = await callClaude(
          `Write a concise weekly SEO performance summary for ${selectedSite}.

DATA:
- Total clicks: ${siteData.totals.clicks} in last ${siteData.dateRange?.days||28} days
- Total impressions: ${siteData.totals.impressions}
- Average position: ${siteData.totals.avgPosition}
- Average CTR: ${siteData.totals.avgCtr}
- Top keywords: ${kwSummary}
- Keywords on page 1: ${kwPage1.length}
- Keywords on page 2 (striking distance): ${kwStriking.length}
- Actions completed: ${completedFixes.length}
- Link prospects tracked: ${linkStats.total} (${linkStats.secured} secured)

Write 3-4 short paragraphs: overall performance, biggest opportunities, what to focus on this week. Be specific, use the actual numbers. Plain English, no jargon. Under 200 words.`,
          "SEO analyst writing a weekly client report. Be specific, data-driven and actionable. No fluff."
        );
        setReportSummary(txt.trim());
      } catch { setReportSummary("Could not generate summary — please try again."); }
      setSummaryGen(false);
    };

    // Export report as formatted PDF (via print)
    const exportReport = () => {
      const t = siteData?.totals;
      const kwData = siteData?.keywords?.slice(0,20) || [];
      const strikingKws = siteData?.keywords?.filter(k => k.position > 10 && k.position <= 20) || [];
      let stratHtml = "";
      try {
        const strat = JSON.parse(localStorage.getItem(`ra_strategy_${selectedSite}`) || "null");
        if (strat) {
          const pub = strat.clusters.filter(c=>c.status==="published").length + (strat.pillar.status==="published"?1:0);
          const total = strat.clusters.length + 1;
          stratHtml = `<div class="section"><h3>Strategy Progress</h3><p><strong>${strat.topic}</strong></p><p>Pillar: ${strat.pillar.title}</p><p>Progress: ${pub}/${total} published (${Math.round((pub/total)*100)}%)</p></div>`;
        }
      } catch {}
      let contentHtml = "";
      try {
        const hist = JSON.parse(localStorage.getItem(`ra_content_history_${selectedSite}`) || "[]");
        if (hist.length > 0) {
          contentHtml = `<div class="section"><h3>Content Generated</h3><p>${hist.length} blog posts</p><table><tr><th>Keyword</th><th>Date</th></tr>${hist.slice(-8).reverse().map(h=>`<tr><td>"${h.keyword}"</td><td>${h.date}</td></tr>`).join("")}</table></div>`;
        }
      } catch {}

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>RankActions Report — ${displaySite(selectedSite)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;padding:2rem;max-width:800px;margin:0 auto;font-size:14px;line-height:1.6}
.header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0fdb8a;padding-bottom:1rem;margin-bottom:2rem}
.logo{font-size:1.4rem;font-weight:800;letter-spacing:-.03em;color:#1a1a2e}
.logo em{color:#0fdb8a;font-style:normal}
.date{color:#666;font-size:.85rem}
.kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2rem}
.kpi{background:#f8f9fa;border-radius:8px;padding:1rem;text-align:center}
.kpi-val{font-size:1.5rem;font-weight:800;font-family:monospace}
.kpi-label{font-size:.7rem;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-top:.25rem}
.kpi-good{color:#0a7c4e} .kpi-warn{color:#c77d15} .kpi-bad{color:#c0392b}
.section{margin-bottom:1.5rem}
h2{font-size:1.1rem;font-weight:700;margin-bottom:.75rem;padding-bottom:.35rem;border-bottom:1px solid #eee}
h3{font-size:.95rem;font-weight:700;margin-bottom:.5rem}
table{width:100%;border-collapse:collapse;font-size:.82rem;margin-top:.5rem}
th{text-align:left;padding:.5rem;border-bottom:2px solid #ddd;color:#666;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em}
td{padding:.4rem .5rem;border-bottom:1px solid #eee}
.pos{font-weight:700;font-family:monospace}
.p1{color:#0a7c4e} .p2{color:#c77d15} .p3{color:#c0392b}
.badge{display:inline-block;font-size:.65rem;font-weight:700;padding:.15rem .4rem;border-radius:4px}
.badge-high{background:#fde8ec;color:#c0392b} .badge-med{background:#fef3e2;color:#c77d15} .badge-low{background:#e8f8ef;color:#0a7c4e}
.summary-box{background:#f0faf5;border-left:3px solid #0fdb8a;padding:1rem;border-radius:0 8px 8px 0;margin-bottom:1.5rem;white-space:pre-line}
.footer{text-align:center;color:#999;font-size:.75rem;padding-top:1rem;border-top:1px solid #eee;margin-top:2rem}
.print-btn{background:#0fdb8a;color:#000;border:none;padding:.6rem 1.5rem;border-radius:8px;font-weight:700;font-size:.85rem;cursor:pointer;margin-bottom:1.5rem}
@media print{.print-btn{display:none!important} body{padding:1rem}}
</style></head><body>
<button class="print-btn" onclick="window.print()">📥 Save as PDF</button>
<div class="header">
  <div class="logo">Rank<em>Actions</em></div>
  <div class="date">Weekly Report · ${displaySite(selectedSite)} · ${new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})}</div>
</div>
${t ? `<div class="kpi-strip">
  <div class="kpi"><div class="kpi-val">${t.clicks.toLocaleString()}</div><div class="kpi-label">Clicks (28d)</div></div>
  <div class="kpi"><div class="kpi-val">${t.impressions.toLocaleString()}</div><div class="kpi-label">Impressions</div></div>
  <div class="kpi"><div class="kpi-val ${parseFloat(t.avgPosition)<=10?"kpi-good":"kpi-warn"}">${t.avgPosition}</div><div class="kpi-label">Avg Position</div></div>
  <div class="kpi"><div class="kpi-val ${parseFloat(t.avgCtr)>=4?"kpi-good":"kpi-warn"}">${t.avgCtr}</div><div class="kpi-label">Click Rate</div></div>
</div>` : `<p style="color:#999;margin-bottom:1.5rem">No live data — connect Google Search Console</p>`}
${reportSummary ? `<div class="summary-box"><strong>AI Summary</strong>\n${reportSummary}</div>` : ""}
<div class="section"><h2>Keyword Rankings</h2>
<p style="margin-bottom:.5rem;font-size:.85rem;color:#666">Page 1: ${kwPage1.length} · Striking distance: ${kwStriking.length} · Page 2+: ${kwPage2Plus.length}</p>
${kwData.length > 0 ? `<table><tr><th>Keyword</th><th>Position</th><th>Clicks</th><th>Impressions</th></tr>
${kwData.map(k=>`<tr><td>${k.keyword}</td><td class="pos ${k.position<=10?"p1":k.position<=20?"p2":"p3"}">#${k.position}</td><td>${k.clicks}</td><td>${k.impressions}</td></tr>`).join("")}
</table>` : `<p style="color:#999">Connect GSC to see keywords</p>`}
</div>
<div class="section"><h2>Priority Actions</h2>
${fixes.map(f=>`<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem 0;border-bottom:1px solid #eee"><span class="badge ${f.level==="high"?"badge-high":f.level==="medium"?"badge-med":"badge-low"}">${f.label}</span> ${f.title}</div>`).join("")}
</div>
${strikingKws.length > 0 ? `<div class="section"><h2>Striking Distance Keywords</h2><p style="font-size:.82rem;color:#666;margin-bottom:.5rem">Positions 11-20 — close to page 1</p><table><tr><th>Keyword</th><th>Position</th><th>Impressions</th></tr>${strikingKws.slice(0,10).map(k=>`<tr><td>${k.keyword}</td><td class="pos p2">#${k.position}</td><td>${k.impressions}</td></tr>`).join("")}</table></div>` : ""}
<div class="section"><h2>Link Building Pipeline</h2>
<p>Identified: ${linkStats.identified} · Contacted: ${linkStats.contacted} · Replied: ${linkStats.replied} · Secured: ${linkStats.secured}</p>
</div>
${stratHtml}${contentHtml}
<div class="footer">Report generated by RankActions · rankactions.com · ${new Date().toLocaleDateString("en-GB")}</div>
</body></html>`;

      const w = window.open("", "_blank");
      w.document.write(sanitizeAiHtml(html));
      w.document.close();
    };

    const cardStyle = {background:"var(--card)",border:"1px solid var(--b2)",borderRadius:12,padding:"1.25rem"};
    const headStyle = {fontSize:".72rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text3)",marginBottom:".75rem"};
    const kpiVal = {fontSize:"1.6rem",fontWeight:800,fontFamily:"var(--mono)",letterSpacing:"-.02em"};
    const kpiLabel = {fontSize:".7rem",color:"var(--text3)",marginTop:".15rem"};

    return (
      <div className="reports-wrap">
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"1rem",marginBottom:"1.5rem"}}>
          <div>
            <div style={{fontSize:"1.1rem",fontWeight:700,letterSpacing:"-.03em"}}>Weekly Report</div>
            <div style={{fontSize:".82rem",color:"var(--text2)",marginTop:".2rem"}}>
              {displaySite(selectedSite)} · {siteData ? `Live data · Last ${siteData.dateRange?.days||28} days` : "Demo data"} · {new Date().toLocaleDateString("en-GB")}
            </div>
          </div>
          <div style={{display:"flex",gap:".5rem"}}>
            <button style={{background:"none",border:"1px solid var(--b2)",borderRadius:8,padding:".45rem .9rem",fontSize:".78rem",color:"var(--text2)",cursor:"pointer",fontFamily:"inherit"}} onClick={exportReport}>
              📥 Export as PDF
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:".75rem",marginBottom:"1rem"}}>
          {[
            {val: siteData?.totals?.clicks?.toLocaleString() || "—", lbl:"Clicks (28d)", color:"var(--text)", tip:"clicks"},
            {val: siteData?.totals?.impressions?.toLocaleString() || "—", lbl:"Impressions", color:"var(--text)", tip:"impressions"},
            {val: siteData?.totals?.avgPosition || "—", lbl:"Avg Position", color: siteData && parseFloat(siteData.totals.avgPosition) < 15 ? "var(--green)" : "var(--amber)", tip:"avgPosition",
              bench: siteData ? <Benchmark value={parseFloat(siteData.totals.avgPosition)} thresholds={{good:10,ok:20,invert:true,goodLabel:"page 1",okLabel:"page 2",badLabel:"page 3+"}}/> : null},
            {val: siteData?.totals?.avgCtr || "—", lbl:"Click-Through Rate", color: siteData && parseFloat(siteData.totals.avgCtr) > 3 ? "var(--green)" : "var(--amber)", tip:"ctr",
              bench: siteData ? <Benchmark value={parseFloat(siteData.totals.avgCtr)} thresholds={{good:4,ok:2,goodLabel:"above avg",okLabel:"average",badLabel:"below avg"}}/> : null},
          ].map((k,i) => (
            <div key={i} style={cardStyle}>
              <div style={{...kpiVal, color:k.color}}>{k.val}{k.bench || null}</div>
              <div style={kpiLabel}>{k.tip ? <Tip term={k.tip}>{k.lbl}</Tip> : k.lbl}</div>
            </div>
          ))}
        </div>

        {/* AI Weekly Summary */}
        <div style={{...cardStyle, marginBottom:"1rem"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".75rem"}}>
            <div style={headStyle}>📝 Weekly Summary</div>
            <button style={{background:"var(--green)",color:"white",border:"none",borderRadius:6,padding:".35rem .75rem",fontSize:".75rem",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}} disabled={summaryGen || !siteData} onClick={generateSummary}>
              {summaryGen ? "⏳ Generating…" : reportSummary ? "🔄 Regenerate" : "✨ Generate summary"}
            </button>
          </div>
          {reportSummary ? (
            <div style={{fontSize:".85rem",color:"var(--text2)",lineHeight:1.75,whiteSpace:"pre-wrap"}}>{reportSummary}</div>
          ) : (
            <div style={{fontSize:".82rem",color:"var(--text3)",textAlign:"center",padding:"1rem 0"}}>
              {siteData ? "Click 'Generate summary' for an AI-written weekly performance review" : "Connect Google Search Console to generate your weekly summary"}
            </div>
          )}
        </div>

        {/* Two-column: Keyword Rankings + Priority Actions */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"1rem"}}>

          {/* Keyword Rankings */}
          <div style={cardStyle}>
            <div style={headStyle}>📊 Keyword Rankings</div>
            {siteData?.keywords?.length > 0 ? (
              <>
                {/* Position distribution bar */}
                <div style={{display:"flex",gap:2,marginBottom:"1rem",borderRadius:6,overflow:"hidden",height:28}}>
                  {kwPage1.length > 0 && <div style={{flex:kwPage1.length,background:"#0fdb8a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".65rem",fontWeight:700,color:"#000"}}>{kwPage1.length} on page 1</div>}
                  {kwStriking.length > 0 && <div style={{flex:kwStriking.length,background:"#f5a623",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".65rem",fontWeight:700,color:"#000"}}>{kwStriking.length} striking</div>}
                  {kwPage2Plus.length > 0 && <div style={{flex:kwPage2Plus.length,background:"#f03e5f",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".65rem",fontWeight:700,color:"#fff"}}>{kwPage2Plus.length} page 2+</div>}
                </div>
                {/* Top keywords table */}
                <div style={{maxHeight:300,overflow:"auto"}}>
                  <table style={{width:"100%",fontSize:".78rem",borderCollapse:"collapse"}}>
                    <thead>
                      <tr style={{borderBottom:"1px solid var(--b2)"}}>
                        <th style={{textAlign:"left",padding:".4rem .3rem",color:"var(--text3)",fontWeight:600,fontSize:".68rem"}}>KEYWORD</th>
                        <th style={{textAlign:"right",padding:".4rem .3rem",color:"var(--text3)",fontWeight:600,fontSize:".68rem"}}>POS</th>
                        <th style={{textAlign:"right",padding:".4rem .3rem",color:"var(--text3)",fontWeight:600,fontSize:".68rem"}}>CLICKS</th>
                        <th style={{textAlign:"right",padding:".4rem .3rem",color:"var(--text3)",fontWeight:600,fontSize:".68rem"}}>IMP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {siteData.keywords.slice(0,12).map((k,i) => (
                        <tr key={i} style={{borderBottom:"1px solid var(--b2)"}}>
                          <td style={{padding:".35rem .3rem",color:"var(--text)",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k.keyword}</td>
                          <td style={{textAlign:"right",padding:".35rem .3rem",fontWeight:700,fontFamily:"var(--mono)",color: k.position<=10?"#0fdb8a":k.position<=20?"#f5a623":"#f03e5f"}}>#{k.position}</td>
                          <td style={{textAlign:"right",padding:".35rem .3rem",color:"var(--text2)"}}>{k.clicks}</td>
                          <td style={{textAlign:"right",padding:".35rem .3rem",color:"var(--text3)"}}>{k.impressions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div style={{fontSize:".82rem",color:"var(--text3)",textAlign:"center",padding:"2rem 0"}}>Connect Google Search Console to see keyword rankings</div>
            )}
          </div>

          {/* Priority Actions */}
          <div style={cardStyle}>
            <div style={headStyle}>🎯 Priority Actions</div>
            {fixes.length > 0 ? fixes.map((fix,i) => {
              const isDone = doneFixes.has(fix.id);
              return (
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:".6rem",padding:".55rem 0",borderBottom: i<fixes.length-1 ? "1px solid var(--b2)" : "none",opacity:isDone?.5:1}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:fix.color,flexShrink:0,marginTop:".35rem"}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:".82rem",fontWeight:600,color:isDone?"var(--text3)":"var(--text)",textDecoration:isDone?"line-through":"none"}}>{fix.title}</div>
                    <div style={{fontSize:".72rem",color:"var(--text3)",marginTop:".15rem"}}>{fix.label} · {fix.desc?.slice(0,60)||""}</div>
                  </div>
                  {isDone && <span style={{fontSize:".7rem",color:"var(--green)",fontWeight:600}}>Done ✓</span>}
                </div>
              );
            }) : (
              <div style={{fontSize:".82rem",color:"var(--green)",textAlign:"center",padding:"2rem 0"}}>✓ No actions outstanding</div>
            )}
            <div style={{marginTop:".75rem",textAlign:"center"}}>
              <span style={{fontSize:".75rem",color:"var(--blue)",cursor:"pointer"}} onClick={()=>setScreen("siteDetail")}>View all in Site Detail →</span>
            </div>
          </div>
        </div>

        {/* Two-column: Striking Distance + Completed Actions */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"1rem"}}>

          {/* Striking Distance Keywords */}
          <div style={cardStyle}>
            <div style={headStyle}><Tip term="strikingDistance">🎯 Striking Distance (positions 11-20)</Tip></div>
            <div style={{fontSize:".78rem",color:"var(--text2)",marginBottom:".75rem"}}>These keywords are close to page 1 — small improvements could unlock significant traffic</div>
            {kwStriking.length > 0 ? kwStriking.slice(0,8).map((k,i) => (
              <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:".4rem 0",borderBottom:"1px solid var(--b2)"}}>
                <div style={{fontSize:".8rem",color:"var(--text)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                  title={k.keyword}>{k.keyword.replace(/^["']+|["']+$/g, '')}</div>
                <div style={{display:"flex",alignItems:"center",gap:".75rem",flexShrink:0}}>
                  <span style={{fontSize:".75rem",fontWeight:700,fontFamily:"var(--mono)",color:"#f5a623"}}>#{k.position}</span>
                  <span style={{fontSize:".7rem",color:"var(--text3)"}}>{k.impressions} imp</span>
                </div>
              </div>
            )) : (
              <div style={{fontSize:".82rem",color:"var(--text3)",textAlign:"center",padding:"1.5rem 0"}}>
                {siteData ? "No keywords in striking distance right now" : "Connect GSC to see opportunities"}
              </div>
            )}
          </div>

          {/* Completed Actions */}
          <div style={cardStyle}>
            <div style={headStyle}>✅ Completed Actions</div>
            {/* Impact — did the work actually move anything? Only shown once there
                is a snapshot either side of the action and enough time has passed;
                otherwise we say nothing rather than present noise as a result. */}
            {actionImpact.measured.length > 0 && (
              <div style={{marginBottom:".9rem",paddingBottom:".9rem",borderBottom:"1px solid var(--border)"}}>
                <div style={{fontSize:".72rem",fontWeight:700,letterSpacing:".05em",textTransform:"uppercase",color:"var(--text3)",marginBottom:".5rem"}}>
                  Measured impact
                </div>
                {actionImpact.measured.slice(0,4).map((m) => {
                  const up = m.posDelta > 0;
                  const flat = m.posDelta === 0;
                  return (
                    <div key={m.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:".5rem",padding:".3rem 0",fontSize:".78rem"}}>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={`Marked done ${m.doneDate}`}>
                        "{m.kw}"
                      </span>
                      <span style={{fontFamily:"var(--mono)",whiteSpace:"nowrap",color: flat ? "var(--text2)" : up ? "var(--green)" : "var(--red, #f03e5f)"}}>
                        #{m.posBefore} → #{m.posAfter}{!flat && ` (${up ? "▲" : "▼"}${Math.abs(m.posDelta)})`}
                      </span>
                    </div>
                  );
                })}
                <div style={{fontSize:".7rem",color:"var(--text3)",marginTop:".4rem"}}>
                  Position change since each action was marked done. Correlation, not proof of cause.
                </div>
              </div>
            )}
            {actionImpact.measured.length === 0 && actionImpact.pending === 0 && actionImpact.unmeasurable > 0 && (
              <div style={{fontSize:".74rem",color:"var(--text3)",marginBottom:".8rem",paddingBottom:".8rem",borderBottom:"1px solid var(--border)"}}>
                Impact tracking starts from now — actions completed earlier can't be measured, because they weren't dated. Anything you tick off from today will be compared against your Search Console history.
              </div>
            )}
            {actionImpact.measured.length === 0 && actionImpact.pending > 0 && (
              <div style={{fontSize:".74rem",color:"var(--text3)",marginBottom:".8rem",paddingBottom:".8rem",borderBottom:"1px solid var(--border)"}}>
                {actionImpact.pending} action{actionImpact.pending === 1 ? "" : "s"} awaiting results — rankings need about two weeks to settle before there's anything meaningful to show.
              </div>
            )}
            {completedFixes.length > 0 ? (
              <>
                <div style={{fontSize:"1.4rem",fontWeight:800,fontFamily:"var(--mono)",color:"var(--green)",marginBottom:".5rem"}}>{completedFixes.length}</div>
                <div style={{fontSize:".78rem",color:"var(--text2)",marginBottom:".75rem"}}>actions completed for {selectedSite}</div>
                {completedFixes.slice(0,6).map((id,i) => {
                  // Resolve the action ID to a human-readable label. IDs are now
                  // stable keyword-slug based: live-<slug> / seo-<slug>. We match
                  // the slug back against current source data for an exact label,
                  // and fall back to un-slugifying the id if the keyword is no
                  // longer in the current list.
                  const stripQuotes = (s) => (s || "").replace(/^["']+|["']+$/g, '');
                  const unslug = (sl) => sl.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                  let label = id;
                  if (id.startsWith("live-ext-")) {
                    label = "Ranking improvement (extended list)";
                  } else if (id.startsWith("live-")) {
                    const slug = id.slice(5);
                    const opp = (siteData?.topOpportunities || []).find(o => raSlug(o.keyword) === slug);
                    label = opp?.keyword ? `Improve "${stripQuotes(opp.keyword)}"` : `Improve "${unslug(slug)}"`;
                  } else if (id.startsWith("seo-")) {
                    const slug = id.slice(4);
                    const kw = (siteData?.keywords || []).find(k => raSlug(k.keyword || k.kw) === slug);
                    label = kw ? `Improve "${stripQuotes(kw.keyword || kw.kw)}"` : `Improve "${unslug(slug)}"`;
                  } else if (id.startsWith("demo-")) {
                    label = `Fix: ${id.slice(5)}`;
                  } else if (id.startsWith("issue-")) {
                    // Technical issues from the Issues tab, e.g. "issue-3-0".
                    // Previously fell through and rendered the raw id.
                    label = "Technical issue resolved";
                  }
                  return (
                    <div key={i} style={{display:"flex",alignItems:"center",gap:".5rem",padding:".3rem 0",fontSize:".78rem"}}>
                      <span style={{color:"var(--green)",flexShrink:0}}>✓</span>
                      <span style={{color:"var(--text2)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                        title={id}>{label}</span>
                    </div>
                  );
                })}
              </>
            ) : (
              <div style={{textAlign:"center",padding:"1.5rem 0"}}>
                <div style={{fontSize:"1.5rem",marginBottom:".5rem"}}>📋</div>
                <div style={{fontSize:".82rem",color:"var(--text3)"}}>No actions completed yet for this site</div>
                <div style={{fontSize:".75rem",color:"var(--text3)",marginTop:".25rem"}}>Mark actions as done on the Dashboard to track progress here</div>
              </div>
            )}
          </div>
        </div>

        {/* Link Building Progress */}
        <div style={{...cardStyle, marginBottom:"1rem"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={headStyle}>🔗 Link Building Progress</div>
            <span style={{fontSize:".75rem",color:"var(--blue)",cursor:"pointer"}} onClick={()=>setScreen("links")}>Full tracker →</span>
          </div>
          {linkStats.total > 0 ? (
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:".5rem",marginBottom:"1rem"}}>
                {[
                  {label:"Identified", count:linkStats.identified, color:"var(--text3)"},
                  {label:"Contacted",  count:linkStats.contacted,  color:"var(--blue)"},
                  {label:"Replied",    count:linkStats.replied,    color:"#f5a623"},
                  {label:"Secured",    count:linkStats.secured,    color:"var(--green)"},
                  {label:"Declined",   count:linkStats.declined,   color:"var(--red)"},
                ].map(s => (
                  <div key={s.label} style={{textAlign:"center",padding:".6rem",background:"var(--bdim)",borderRadius:8}}>
                    <div style={{fontSize:"1.2rem",fontWeight:800,fontFamily:"var(--mono)",color:s.color}}>{s.count}</div>
                    <div style={{fontSize:".68rem",color:"var(--text3)",marginTop:".2rem"}}>{s.label}</div>
                  </div>
                ))}
              </div>
              {/* Pipeline bar */}
              {linkStats.total > 0 && (
                <div style={{display:"flex",gap:2,borderRadius:6,overflow:"hidden",height:22}}>
                  {linkStats.identified > 0 && <div style={{flex:linkStats.identified,background:"var(--text3)"}}/>}
                  {linkStats.contacted > 0 && <div style={{flex:linkStats.contacted,background:"var(--blue)"}}/>}
                  {linkStats.replied > 0 && <div style={{flex:linkStats.replied,background:"#f5a623"}}/>}
                  {linkStats.secured > 0 && <div style={{flex:linkStats.secured,background:"var(--green)"}}/>}
                  {linkStats.declined > 0 && <div style={{flex:linkStats.declined,background:"var(--red)"}}/>}
                </div>
              )}
            </>
          ) : (
            <div style={{textAlign:"center",padding:"1.5rem 0"}}>
              <div style={{fontSize:".82rem",color:"var(--text3)"}}>No link prospects tracked yet</div>
              <button style={{marginTop:".5rem",background:"none",border:"1px solid var(--b2)",borderRadius:6,padding:".35rem .75rem",fontSize:".78rem",color:"var(--blue)",cursor:"pointer",fontFamily:"inherit"}} onClick={()=>setScreen("links")}>Start link building →</button>
            </div>
          )}
        </div>

        {/* Top Pages Performance */}
        <div style={{...cardStyle, marginBottom:"1rem"}}>
          <div style={headStyle}>📄 Top Pages by Clicks</div>
          {siteData?.pages?.length > 0 ? (
            <table style={{width:"100%",fontSize:".78rem",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{borderBottom:"1px solid var(--b2)"}}>
                  <th style={{textAlign:"left",padding:".4rem .3rem",color:"var(--text3)",fontWeight:600,fontSize:".68rem"}}>PAGE</th>
                  <th style={{textAlign:"right",padding:".4rem .3rem",color:"var(--text3)",fontWeight:600,fontSize:".68rem"}}>CLICKS</th>
                  <th style={{textAlign:"right",padding:".4rem .3rem",color:"var(--text3)",fontWeight:600,fontSize:".68rem"}}>IMPRESSIONS</th>
                  <th style={{textAlign:"right",padding:".4rem .3rem",color:"var(--text3)",fontWeight:600,fontSize:".68rem"}}>CTR</th>
                  <th style={{textAlign:"right",padding:".4rem .3rem",color:"var(--text3)",fontWeight:600,fontSize:".68rem"}}>POSITION</th>
                </tr>
              </thead>
              <tbody>
                {siteData.pages.slice(0,10).map((p,i) => (
                  <tr key={i} style={{borderBottom:"1px solid var(--b2)"}}>
                    <td style={{padding:".35rem .3rem",color:"var(--text)",maxWidth:250,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.page}</td>
                    <td style={{textAlign:"right",padding:".35rem .3rem",fontWeight:600,color:"var(--text)"}}>{p.clicks}</td>
                    <td style={{textAlign:"right",padding:".35rem .3rem",color:"var(--text2)"}}>{p.impressions}</td>
                    <td style={{textAlign:"right",padding:".35rem .3rem",color: parseFloat(p.ctr)>3?"var(--green)":"var(--text3)"}}>{p.ctr}</td>
                    <td style={{textAlign:"right",padding:".35rem .3rem",fontFamily:"var(--mono)",color: p.position<=10?"#0fdb8a":p.position<=20?"#f5a623":"#f03e5f"}}>#{p.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{fontSize:".82rem",color:"var(--text3)",textAlign:"center",padding:"2rem 0"}}>Connect Google Search Console to see page performance</div>
          )}
        </div>

        {/* Rank Movement */}
        {(() => {
          const movers = (siteData?.keywords || []).filter(k => k.positionChange && k.positionChange !== 0)
            .map(k => ({ keyword: k.keyword, position: k.position, change: k.positionChange }));
          if (movers.length === 0) return null;
          return (
            <div style={{...cardStyle, marginBottom:"1rem"}}>
              <div style={headStyle}><Tip term="rankTracker">📈 Rank Movement</Tip></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:".75rem"}}>
                <div>
                  <div style={{fontSize:".72rem",color:"var(--green)",fontWeight:600,marginBottom:".4rem"}}>↑ Climbers</div>
                  {movers.filter(m=>m.change>0).sort((a,b)=>b.change-a.change).slice(0,5).map((m,i) => (
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:".3rem 0",borderBottom:"1px solid var(--b2)",fontSize:".78rem"}}>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{m.keyword}</span>
                      <span style={{color:"var(--green)",fontWeight:600,flexShrink:0,marginLeft:".5rem"}}>↑{m.change.toFixed(1)} → #{m.position}</span>
                    </div>
                  ))}
                  {movers.filter(m=>m.change>0).length === 0 && <div style={{fontSize:".78rem",color:"var(--text3)"}}>No upward movement</div>}
                </div>
                <div>
                  <div style={{fontSize:".72rem",color:"var(--red)",fontWeight:600,marginBottom:".4rem"}}>↓ Dropped</div>
                  {movers.filter(m=>m.change<0).sort((a,b)=>a.change-b.change).slice(0,5).map((m,i) => (
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:".3rem 0",borderBottom:"1px solid var(--b2)",fontSize:".78rem"}}>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{m.keyword}</span>
                      <span style={{color:"var(--red)",fontWeight:600,flexShrink:0,marginLeft:".5rem"}}>↓{Math.abs(m.change).toFixed(1)} → #{m.position}</span>
                    </div>
                  ))}
                  {movers.filter(m=>m.change<0).length === 0 && <div style={{fontSize:".78rem",color:"var(--text3)"}}>No drops</div>}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Strategy Progress */}
        {(() => {
          let strat = null;
          try { strat = JSON.parse(localStorage.getItem(`ra_strategy_${selectedSite}`) || "null"); } catch {}
          if (!strat) return null;
          const published = strat.clusters.filter(c=>c.status==="published").length + (strat.pillar.status==="published"?1:0);
          const drafted = strat.clusters.filter(c=>c.status==="drafted").length + (strat.pillar.status==="drafted"?1:0);
          const notStarted = strat.clusters.filter(c=>c.status==="not_started").length + (strat.pillar.status==="not_started"?1:0);
          const total = published + drafted + notStarted;
          const pct = total > 0 ? Math.round((published / total) * 100) : 0;
          return (
            <div style={{...cardStyle, marginBottom:"1rem"}}>
              <div style={headStyle}><Tip term="pillarPage">🗺 Strategy Progress</Tip></div>
              <div style={{fontSize:".88rem",fontWeight:600,marginBottom:".35rem"}}>{strat.topic}</div>
              <div style={{fontSize:".78rem",color:"var(--text2)",marginBottom:".75rem"}}>
                Pillar: {strat.pillar.title} · {strat.clusters.length} cluster posts
              </div>
              <div style={{display:"flex",gap:2,borderRadius:4,overflow:"hidden",height:20,marginBottom:".5rem"}}>
                {published > 0 && <div style={{flex:published,background:"var(--green)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".6rem",fontWeight:700,color:"#000"}}>{published} published</div>}
                {drafted > 0 && <div style={{flex:drafted,background:"var(--amber)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".6rem",fontWeight:700,color:"#000"}}>{drafted} drafted</div>}
                {notStarted > 0 && <div style={{flex:notStarted,background:"var(--s3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".6rem",fontWeight:700,color:"var(--text3)"}}>{notStarted} to do</div>}
              </div>
              <div style={{fontSize:".78rem",color:pct>=75?"var(--green)":pct>=50?"var(--amber)":"var(--text3)"}}>{pct}% complete</div>
            </div>
          );
        })()}

        {/* Content Generation History */}
        {(() => {
          let history = [];
          try { history = JSON.parse(localStorage.getItem(`ra_content_history_${selectedSite}`) || "[]"); } catch {}
          if (history.length === 0) return null;
          return (
            <div style={{...cardStyle, marginBottom:"1rem"}}>
              <div style={headStyle}>✍ Content Generated</div>
              <div style={{fontSize:".78rem",color:"var(--text2)",marginBottom:".65rem"}}>{history.length} blog {history.length===1?"post":"posts"} generated for this site</div>
              {history.slice(-8).reverse().map((h,i) => (
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:".35rem 0",borderBottom:"1px solid var(--b2)",fontSize:".78rem"}}>
                  <span style={{color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>"{h.keyword}"</span>
                  <span style={{color:"var(--text3)",flexShrink:0,marginLeft:".75rem",fontSize:".72rem"}}>{h.date}</span>
                </div>
              ))}
            </div>
          );
        })()}

        <div style={{fontSize:".75rem",color:"var(--text3)",textAlign:"center",padding:".5rem 0"}}>
          Report generated by RankActions · {new Date().toLocaleDateString("en-GB")} · Data from Google Search Console
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // GSC SITE PICKER
  // Shown when user's Google account has multiple GSC properties
  // ─────────────────────────────────────────────────────────────
  const GscSitePicker = () => {
    const { sites: pickerSites, pending } = gscSitePicker;
    const [search,   setSearch]   = useState("");
    const [selected, setSelected] = useState(() => {
      // Pre-select any site that matches what they typed
      if (!pending) return new Set();
      const match = pickerSites.find(s =>
        s.displayUrl.includes(pending.replace(/^https?:\/\//,"").replace(/\/$/,"")) ||
        s.siteUrl.toLowerCase().includes(pending.toLowerCase())
      );
      return match ? new Set([match.siteUrl]) : new Set();
    });

    const toggle = (siteUrl) => {
      setSelected(prev => {
        const next = new Set(prev);
        next.has(siteUrl) ? next.delete(siteUrl) : next.add(siteUrl);
        return next;
      });
    };

    const confirm = () => {
      const chosen = [...selected];
      if (chosen.length === 0) return;
      const primary = chosen[0];
      setSelectedSite(primary);
      localStorage.setItem("rankactions_selectedSite", primary);
      setSites(chosen);
      localStorage.setItem("rankactions_sites", JSON.stringify(chosen));
      setGscSitePicker(null);
    };

    const filtered = pickerSites.filter(s =>
      !search ||
      s.displayUrl.toLowerCase().includes(search.toLowerCase()) ||
      s.siteUrl.toLowerCase().includes(search.toLowerCase())
    );

    return (
      <div className="site-picker-overlay">
        <div className="site-picker-modal">
          <div className="site-picker-head">
            <div className="site-picker-title">Choose your website{isPro ? "s" : ""}</div>
            <div className="site-picker-sub">
              {isPro
                ? "Select all the sites you want to track. You can add or remove sites later."
                : "Select one site to track. Upgrade to a paid plan to track more sites."
              } Your Google account has access to {pickerSites.length} sites.
            </div>
          </div>
          <div className="site-picker-list">
            <input
              className="site-picker-search"
              placeholder="Search sites…"
              value={search}
              onChange={e=>setSearch(e.target.value)}
            />
            {filtered.map(site => {
              const isSel = selected.has(site.siteUrl);
              const isDomain = site.siteUrl.startsWith("sc-domain:");
              return (
                <div key={site.siteUrl}
                  className={`site-picker-item ${isSel?"selected":""}`}
                  onClick={()=>{
                    if (!isPro && !isSel && selected.size >= 1) return; // free: 1 site max
                    toggle(site.siteUrl);
                  }}>
                  <div className="site-picker-checkbox">{isSel?"✓":""}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div className="site-picker-url">{site.displayUrl}</div>
                    <div className="site-picker-type">
                      {isDomain ? "Domain property" : "URL prefix property"}
                      {site.permissionLevel === "siteOwner" ? " · Owner" : " · Verified user"}
                    </div>
                  </div>
                </div>
              );
            })}
            {!isPro && selected.size >= 1 && (
              <div style={{fontSize:".75rem",color:"var(--amber)",padding:".5rem .85rem",background:"var(--adim)",borderRadius:7,marginTop:".25rem"}}>
                🔒 Free plan: 1 site only. <span style={{color:"var(--green)",cursor:"pointer",fontWeight:600}} onClick={()=>setShowUpgrade(true)}>Upgrade</span> to add more sites.
              </div>
            )}
          </div>
          <div className="site-picker-foot">
            <div className="site-picker-count">
              {selected.size} site{selected.size!==1?"s":""} selected
            </div>
            <button
              className="site-picker-confirm"
              disabled={selected.size === 0}
              onClick={confirm}>
              Confirm selection →
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // LINK BUILDING — generate opportunities and outreach emails
  // ─────────────────────────────────────────────────────────────
  const generateLinkOpps = async () => {
    setLinkOppsLoading(true);
    const topKws = siteData?.keywords?.slice(0,8).map(k=>`${k.keyword} (#${k.position})`).join(", ") || "your main keywords";
    const topPages = siteData?.pages?.slice(0,5).map(p=>p.page).join(", ") || "";

    // Load previous opportunities and prospects to avoid duplication
    let prevOpps = [];
    try { prevOpps = JSON.parse(localStorage.getItem(`ra_link_history_${selectedSite}`) || "[]"); } catch {}
    const prevOppContext = prevOpps.length > 0
      ? `\nPREVIOUSLY SUGGESTED (do NOT repeat these — suggest completely different platforms, sites, and approaches):\n${prevOpps.map(o => `- "${o.title}" (${o.type}) — ${o.target || "no target"}`).join("\n")}\n`
      : "";

    // Also include current prospect pipeline
    const pipelineContext = linkProspects.length > 0
      ? `\nUSER'S EXISTING PROSPECT PIPELINE (already being pursued — do NOT suggest these again):\n${linkProspects.map(p => `- ${p.domain} (${p.type}, status: ${p.status})`).join("\n")}\n`
      : "";

    try {
      const prompt = `You are an expert UK link building strategist. Generate 8 specific, actionable link building opportunities for this website.

Site: ${displaySite(selectedSite)}
Top keywords and positions: ${topKws}
Top pages: ${topPages}
Country: UK
${prevOppContext}${pipelineContext}
CRITICAL RULES:
- Search Google for REAL websites and platforms this business can approach — include actual verified URLs
- For each opportunity, provide a SPECIFIC contact method — where to find the contact form, email pattern, or submission page
- Include step-by-step instructions a complete beginner could follow
- Never promise guaranteed results — use language like "may improve rankings" or "can help build authority"
- Only suggest ethical, white-hat link building approaches
- Be specific to the site's industry — infer from the domain and keywords

Return ONLY valid JSON array:
[
  {
    "title": "specific opportunity title",
    "type": "Guest Post | Directory | Resource Page | Broken Link | Testimonial | Partnership | Local Citation | Press | HARO",
    "difficulty": "easy | medium | hard",
    "description": "2-3 sentences explaining exactly what this is and why it matters for SEO",
    "targets": [
      {"name": "specific platform or site name", "url": "https://actual-url.com", "contactMethod": "how to find the contact"}
    ],
    "steps": ["Step 1: Go to...", "Step 2: Click...", "Step 3: Fill in...", "Step 4: Submit and wait for..."],
    "value": "High | Medium | Low",
    "timeToResult": "e.g. 2-4 weeks",
    "complianceNote": "any important caveats"
  }
]

Include a mix of: 2 easy/quick wins (directories, citations), 3 medium (resource pages, HARO, testimonials), 2 hard but high value (guest posts, press), 1 creative/unexpected approach.`;

      // Use Gemini research endpoint (grounded in real Google search results)
      // Falls back to Claude automatically if Gemini isn't configured
      const res = await authFetch(`${WORKER_URL}/api/ai/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          systemPrompt: "Expert UK link building strategist. Return valid JSON array only. Be extremely specific — name real platforms with verified URLs from your search results. Never fabricate URLs.",
          task: "link_building",
        }),
      });
      const data = await res.json();
      const txt = data.text || "";
      // Extract JSON array robustly — Gemini sometimes wraps grounded responses in commentary
      // like "Based on my search, here are…" before the JSON. Find the first [ to last ].
      const cleaned = txt.replace(/```json|```/g, "").trim();
      const firstBracket = cleaned.indexOf("[");
      const lastBracket = cleaned.lastIndexOf("]");
      const jsonCandidate = (firstBracket !== -1 && lastBracket > firstBracket)
        ? cleaned.slice(firstBracket, lastBracket + 1)
        : cleaned;
      const parsed = JSON.parse(jsonCandidate);

      // If Gemini provided grounding sources, enrich the opportunities
      if (data.sources?.length > 0) {
        parsed.forEach(opp => {
          if (!opp.verified) opp.verified = data.provider === "gemini";
        });
      }

      setLinkOpps(parsed);
      // Save to history for deduplication
      try {
        const histKey = `ra_link_history_${selectedSite}`;
        const hist = JSON.parse(localStorage.getItem(histKey) || "[]");
        parsed.forEach(o => hist.push({ title: o.title, type: o.type, target: o.targets?.[0]?.name || "", date: new Date().toISOString().slice(0,10) }));
        localStorage.setItem(histKey, JSON.stringify(hist.slice(-40))); // keep last 40
        saveUserData(selectedSite, 'link_history', hist.slice(-40));
      } catch {}
    } catch {
      setLinkOpps([
        { title:"Google Business Profile", type:"Local Citation", difficulty:"easy", description:`Claim and optimise your Google Business Profile. This is the single most important local citation and directly impacts Google Maps rankings.`, targets:[{name:"Google Business Profile",url:"https://business.google.com",contactMethod:"Sign in with your Google account and follow the verification steps"}], steps:["Go to business.google.com","Click 'Manage now'","Search for your business or add it","Fill in all details — name, address, phone, hours, categories","Verify via postcard, phone or email","Add photos, services and a description with your keywords"], value:"High", timeToResult:"1-2 weeks", complianceNote:"Ensure your business name, address and phone match exactly across all citations" },
        { title:"Industry directory listings", type:"Directory", difficulty:"easy", description:`Submit ${selectedSite} to relevant industry directories. Consistent directory listings build domain authority and help Google verify your business.`, targets:[{name:"Yell.com",url:"https://www.yell.com/free-listing/",contactMethod:"Use the free listing submission form"},{name:"Thomson Local",url:"https://www.thomsonlocal.com/advertise/",contactMethod:"Free listing via advertise page"},{name:"Bing Places",url:"https://www.bingplaces.com",contactMethod:"Sign in with Microsoft account"}], steps:["Visit each directory and look for 'Add a listing' or 'Claim your business'","Use identical business name, address and phone number (NAP) on every listing","Choose the most specific category available","Add a unique description for each — don't copy-paste the same one","Submit and wait for verification"], value:"Medium", timeToResult:"1-2 weeks", complianceNote:"Never pay for basic directory listings — most offer free tiers. Ensure NAP consistency across all listings" },
        { title:"Guest posts on industry blogs", type:"Guest Post", difficulty:"hard", description:`Write expert articles for blogs in your niche. Guest posting builds high-quality editorial links and positions you as an authority.`, targets:[{name:"Search Google",url:"https://www.google.com",contactMethod:'Search: "your industry" + "write for us" or "guest post" or "contribute"'}], steps:["Search Google for industry blogs accepting guest posts","Read their guidelines carefully before pitching","Write a personalised email referencing a specific article they published","Pitch 2-3 unique topic ideas relevant to their audience","If accepted, write genuinely useful content — not a sales pitch","Include one natural link to your site within the article"], value:"High", timeToResult:"4-8 weeks", complianceNote:"Never pay for guest posts — Google considers paid links a violation. Focus on genuine, valuable content" },
        { title:"HARO / journalist requests", type:"Press", difficulty:"medium", description:`Respond to journalist queries on platforms like HARO, Qwoted or SourceBottle. When quoted in an article, you often receive a backlink to your site.`, targets:[{name:"HARO (Help a Reporter Out)",url:"https://www.helpareporter.com",contactMethod:"Sign up as a source — free tier available"},{name:"Qwoted",url:"https://www.qwoted.com",contactMethod:"Create a source profile"},{name:"SourceBottle",url:"https://www.sourcebottle.com",contactMethod:"Sign up for email alerts"}], steps:["Sign up on HARO, Qwoted or SourceBottle as a source","Set up alerts for your industry keywords","When a relevant query arrives, respond within 1-2 hours — speed matters","Keep your response concise (3-4 sentences), specific and quotable","Include your name, title, and website URL","Follow up once if you don't hear back within a week"], value:"High", timeToResult:"2-6 weeks", complianceNote:"Only respond to genuine queries where you have real expertise. Never fabricate credentials" },
        { title:"Supplier and partner links", type:"Partnership", difficulty:"easy", description:`Ask your existing suppliers, partners and clients to link to ${selectedSite} from their website. These are warm relationships and often convert quickly.`, targets:[{name:"Your existing contacts",url:"",contactMethod:"Email your account manager or main contact at each partner"}], steps:["List all suppliers, partners and clients you work with","Check if they have a 'partners', 'clients' or 'links' page on their website","Send a friendly email asking if they would add your site","Offer to reciprocate — add their link to your site too","Follow up once after a week if no response"], value:"Medium", timeToResult:"1-2 weeks", complianceNote:"Reciprocal linking in moderation is fine — avoid excessive link exchange schemes" },
        { title:"Broken link building", type:"Broken Link", difficulty:"medium", description:`Find broken links on relevant websites and offer your content as a replacement. This provides genuine value to the site owner while earning you a link.`, targets:[{name:"Check My Links (Chrome extension)",url:"https://chrome.google.com/webstore/detail/check-my-links",contactMethod:"Install the extension and run it on competitor resource pages"}], steps:["Install the 'Check My Links' Chrome extension","Visit resource pages and blog posts in your industry","Run the extension — it highlights broken links in red","Note the broken URL and the page it appears on","Create or identify content on your site that covers the same topic","Email the site owner: explain the broken link and suggest your page as a replacement"], value:"High", timeToResult:"2-4 weeks", complianceNote:"Be genuinely helpful — only suggest your content if it truly replaces what the broken link pointed to" },
      ]);
    }
    setLinkOppsLoading(false);
  };

  const generateOutreachEmail = async () => {
    if (!linkTemplateTarget.trim()) return;
    setLinkTemplateLoading(true);
    const templates = {
      guest_post: `Write a guest post pitch email from the owner of ${selectedSite} to ${linkTemplateTarget}. Context: ${linkTemplateContextRef.current||"general industry expertise"}. The email should be concise (under 150 words), personal, specific about their site, and end with a clear ask. No subject line needed — just the email body.`,
      resource_page: `Write a resource page outreach email from the owner of ${selectedSite} to ${linkTemplateTarget} asking them to add our site to their resource page. Context: ${linkTemplateContextRef.current||"we have helpful content"}. Keep it under 100 words, friendly and specific. Just the email body.`,
      broken_link: `Write a broken link outreach email from the owner of ${selectedSite} to ${linkTemplateTarget}. We found a broken link on their site and are offering our content as a replacement. Context: ${linkTemplateContextRef.current||"similar content topic"}. Under 100 words, helpful tone, not pushy. Just the email body.`,
      testimonial: `Write a testimonial offer email from the owner of ${selectedSite} to ${linkTemplateTarget}. We use their product/service and want to offer a testimonial in exchange for a link back to our site. Context: ${linkTemplateContextRef.current||"happy customer"}. Under 80 words, genuine and warm. Just the email body.`,
      partnership: `Write a partnership link exchange email from the owner of ${selectedSite} to ${linkTemplateTarget}. We want to explore a mutually beneficial link exchange or co-marketing opportunity. Context: ${linkTemplateContextRef.current||"complementary businesses"}. Under 120 words, professional. Just the email body.`,
      directory: `Write a brief follow-up email from the owner of ${selectedSite} to ${linkTemplateTarget} after submitting to their directory, asking to confirm listing and check any requirements. Context: ${linkTemplateContextRef.current||"directory submission"}. Under 60 words, polite and professional. Just the email body.`,
    };
    try {
      const txt = await callClaude(
        templates[linkTemplate],
        "Expert outreach copywriter. Write natural, human-sounding emails. Never use buzzwords like 'synergy' or 'leverage'. Be specific and concise.",
        "quality"
      );
      setLinkTemplateOutput(txt.trim());
    } catch {
      setLinkTemplateOutput("Could not generate email — please try again.");
    }
    setLinkTemplateLoading(false);
  };

  const saveProspect = (domain, type, status="identified") => {
    const prospect = { id: Date.now(), domain, type, status, date: new Date().toLocaleDateString("en-GB"), notes:"" };
    const updated = [prospect, ...linkProspects];
    setLinkProspects(updated);
    saveUserData(selectedSite, 'prospects', updated);
  };

  const moveProspect = (id, newStatus) => {
    const updated = linkProspects.map(p => p.id===id ? {...p, status:newStatus} : p);
    setLinkProspects(updated);
    saveUserData(selectedSite, 'prospects', updated);
  };

  const deleteProspect = (id) => {
    const updated = linkProspects.filter(p => p.id!==id);
    setLinkProspects(updated);
    saveUserData(selectedSite, 'prospects', updated);
  };

  // ─────────────────────────────────────────────────────────────
  // STRATEGY PLANNER
  // Pillar + Cluster content strategy based on GSC data
  // ─────────────────────────────────────────────────────────────
  const StrategyPlanner = () => {
    const [view, setView] = useState(() => {
      try { return JSON.parse(localStorage.getItem(`ra_strategy_${selectedSite}`) || "null") ? "planner" : "suggestions"; } catch { return "suggestions"; }
    });
    const [generating, setGenerating] = useState(false);
    // Recover a strategy that finished while the user was on another screen.
    // Session-scoped and short-lived: anything older than SUGG_TTL_MS is ignored,
    // and it is cleared once a strategy is accepted or a new run starts.
    const SUGG_TTL_MS = 60 * 60 * 1000; // 1 hour
    const [recoveredSugg, setRecoveredSugg] = useState(false);
    const [suggestions, setSuggestions] = useState(() => {
      try {
        const raw = JSON.parse(localStorage.getItem(`ra_sugg_pending_${selectedSite}`) || "null");
        if (raw?.strategies?.length && Date.now() - (raw.ts || 0) < SUGG_TTL_MS) return raw.strategies;
      } catch {}
      return null;
    });
    const [customTopic, setCustomTopic] = useState("");

    // Flag the restored state once, on mount, so we can tell the user where it came from.
    useEffect(() => {
      try {
        const raw = JSON.parse(localStorage.getItem(`ra_sugg_pending_${selectedSite}`) || "null");
        setRecoveredSugg(!!(raw?.strategies?.length && Date.now() - (raw.ts || 0) < SUGG_TTL_MS));
      } catch { setRecoveredSugg(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Load saved strategy for this site
    const [strategy, setStrategy] = useState(() => {
      try { return JSON.parse(localStorage.getItem(`ra_strategy_${selectedSite}`) || "null"); } catch { return null; }
    });

    // Keyword enrichment via DataForSEO. Map of normalised keyword → { volume, cpc, competition, ... }
    // Persisted to localStorage so the user doesn't lose their data on reload.
    const [keywordEnrichment, setKeywordEnrichment] = useState(() => {
      try { return JSON.parse(localStorage.getItem(`ra_kw_enrich_${selectedSite}`) || "{}"); } catch { return {}; }
    });
    const [enriching, setEnriching] = useState(false);
    const [enrichError, setEnrichError] = useState(null);
    const [enrichQuota, setEnrichQuota] = useState(null); // { used, limit }

    // When user switches sites, reload that site's saved enrichment cache
    // (or empty it if the new site has none). Same ref-tracking pattern
    // as RankTracker's loadedSite — only fires on actual changes.
    const enrichSiteRef = useRef(selectedSite);
    useEffect(() => {
      if (enrichSiteRef.current === selectedSite) return;
      enrichSiteRef.current = selectedSite;
      try {
        const cached = JSON.parse(localStorage.getItem(`ra_kw_enrich_${selectedSite}`) || "{}");
        setKeywordEnrichment(cached);
      } catch {
        setKeywordEnrichment({});
      }
      setEnrichError(null);
      setEnrichQuota(null);
    }, [selectedSite]);

    // Gate for non-Pro users — placed after hooks so the hook count stays
    // stable across renders if the user upgrades mid-session. Mirrors the
    // ContentGenerator pattern.
    if (!isPro) return (
      <div className="content">
        <div className="cg-header">
          <div className="cg-title">Strategy Planner</div>
          <div className="cg-sub">AI-powered pillar content strategy for your target keywords</div>
        </div>
        <div className="upgrade-wall" style={{maxWidth:480,margin:"3rem auto",textAlign:"center"}}>
          <div className="upgrade-wall-icon">🗺</div>
          <div className="upgrade-wall-h">Strategy Planner is a Pro feature</div>
          <div className="upgrade-wall-sub">
            Build a complete pillar content strategy in 60 seconds. AI analyses your keyword data, groups related terms into topic clusters, and creates a roadmap of one authority page plus 6–8 supporting blog posts.
          </div>
          <button className="upgrade-wall-btn" onClick={()=>setShowUpgrade(true)}>Upgrade — from £100/month</button>
        </div>
      </div>
    );

    const normaliseKw = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");

    const enrichWithKeywordData = async () => {
      if (!strategy) return;
      setEnriching(true);
      setEnrichError(null);
      try {
        // Gather all strategy keywords (pillar + clusters), dedup
        const keywords = [
          strategy.pillar?.keyword,
          ...(strategy.clusters || []).map(c => c.keyword),
        ].filter(Boolean).map(normaliseKw).filter(k => k.length > 0);
        const unique = [...new Set(keywords)];
        if (unique.length === 0) {
          setEnrichError("No keywords to enrich");
          setEnriching(false);
          return;
        }

        const res = await authFetch(`${WORKER_URL}/api/keyword-data`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keywords: unique, country: "gb" }),
        });
        const data = await res.json();

        if (res.status === 402) {
          // Quota or plan-tier issue
          if (data.upgrade) {
            setEnrichError(`Keyword research is a Pro feature. Upgrade to enrich your strategy with real search volume data.`);
          } else {
            setEnrichError(`Quota reached (${data.used}/${data.limit}). Resets next month.`);
          }
          setEnriching(false);
          return;
        }
        if (!res.ok) {
          setEnrichError(data?.error || "Couldn't fetch keyword data — please try again");
          setEnriching(false);
          return;
        }

        // Merge into existing enrichment cache
        const merged = { ...keywordEnrichment };
        for (const item of (data.keywords || [])) {
          if (item.keyword) {
            merged[normaliseKw(item.keyword)] = item;
          }
        }
        setKeywordEnrichment(merged);
        saveUserData(selectedSite, 'kw_enrich', merged);
        if (data.quotaLimit !== null && data.quotaLimit !== undefined) {
          setEnrichQuota({ used: data.quotaUsed, limit: data.quotaLimit });
        }
        if (data.partial) {
          setEnrichError(`Some data unavailable (cached results shown). Reason: ${data.reason || "unknown"}`);
        }
      } catch (err) {
        setEnrichError("Couldn't fetch keyword data — network error");
      }
      setEnriching(false);
    };

    // Helper: render keyword volume + difficulty as a small badge.
    // Returns null when no data is available for this keyword.
    const KeywordBadge = ({ keyword }) => {
      const data = keywordEnrichment[normaliseKw(keyword)];
      if (!data || data.available === false) return null;
      // Defensive: bail if there's nothing useful to render. Guards against
      // future partial-response shapes (e.g. DFS prod returning volume but
      // null competitionIndex on degraded responses, or vice versa).
      if (data.volume == null && data.competitionIndex == null) return null;
      const vol = data.volume;
      const comp = data.competitionIndex; // 0-100 from DataForSEO
      const compLabel = comp == null ? null : comp < 33 ? "Easy" : comp < 66 ? "Medium" : "Hard";
      const compColor = comp == null ? "var(--text3)" : comp < 33 ? "var(--green)" : comp < 66 ? "var(--amber)" : "var(--red)";
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem", marginLeft: ".5rem", fontSize: ".7rem", color: "var(--text3)" }}>
          {vol != null && <span style={{ fontFamily: "var(--mono)" }}>📊 {vol.toLocaleString()}/mo</span>}
          {compLabel && <span style={{ color: compColor, fontWeight: 600 }}>· {compLabel}</span>}
        </span>
      );
    };

    const saveStrategy = (s) => {
      setStrategy(s);
      saveUserData(selectedSite, 'strategy', s);
    };

    // Generate cluster suggestions from GSC data
    const generateSuggestions = async (topic) => {
      setGenerating(true);
      setSuggestions(null);
      setRecoveredSugg(false);
      try { localStorage.removeItem(`ra_sugg_pending_${selectedSite}`); } catch {}
      try {
        const kwData = siteData?.keywords?.slice(0, 30).map(k => `"${k.keyword}" (pos #${k.position}, ${k.impressions} impressions, ${k.clicks} clicks)`).join("\n") || "No keyword data available";
        const pages = siteData?.pages?.slice(0, 10).map(p => p.page).join("\n") || "No page data";

        // Load previous strategies and content to avoid duplication
        let prevStrategies = [];
        try { prevStrategies = JSON.parse(localStorage.getItem(`ra_strategy_history_${selectedSite}`) || "[]"); } catch {}
        let contentHistory = [];
        try { contentHistory = JSON.parse(localStorage.getItem(`ra_content_history_${selectedSite}`) || "[]"); } catch {}
        const currentStrategy = strategy;

        const dupeContext = (prevStrategies.length > 0 || contentHistory.length > 0 || currentStrategy)
          ? `\nPREVIOUSLY USED — do NOT suggest these topics or keywords again:
${currentStrategy ? `- Current active strategy: "${currentStrategy.topic}" with clusters: ${currentStrategy.clusters.map(c=>c.keyword).join(", ")}` : ""}
${prevStrategies.map(s => `- Previous strategy: "${s.topic}" (${s.date})`).join("\n")}
${contentHistory.map(h => `- Blog already written: "${h.keyword}" (${h.date})`).join("\n")}
Suggest DIFFERENT topics, keywords, and angles from the above.\n`
          : "";

        // Titles generated here are passed verbatim into the content generator via
        // the preset, so a stale year here ends up published in a real article. The
        // model has no idea what today is and defaults to its training cutoff — it
        // produced "…Complete Guide to Computer Aided Design in 2024" for an article
        // written in 2026. A year in a title also dates the page the moment it's
        // published, so the default is to leave it out entirely.
        const currentYear = new Date().getFullYear();
        const dateRule = `\nDATE RULE: today's date is ${new Date().toISOString().slice(0,10)} (year ${currentYear}). Do NOT put a year in any title unless the topic genuinely requires one (e.g. an annual statistics roundup). If a year is truly needed it MUST be ${currentYear} — never an earlier year. Titles without years stay accurate for longer.\n`;

        const prompt = topic
          ? `I want to build a pillar content strategy around this topic: "${topic}".

My website is ${displaySite(selectedSite)}. Here are my current keywords:
${kwData}

My current pages:
${pages}
${dupeContext}
Based on this data, suggest a pillar + cluster strategy. Return ONLY valid JSON, no markdown, in this format:
{
  "strategies": [
    {
      "topic": "the main topic/service",
      "reasoning": "2-3 sentences explaining why this topic based on the data",
      "trafficPotential": "estimated monthly search volume for the cluster",
      "difficulty": "easy|medium|hard",
      "pillar": {
        "keyword": "main target keyword",
        "title": "suggested pillar page title (H1)",
        "description": "2-3 sentence description of what the pillar page should cover",
        "wordCount": "2000-3000"
      },
      "clusters": [
        {
          "keyword": "specific long-tail keyword",
          "title": "suggested blog post title",
          "angle": "1 sentence describing the unique angle/what it covers",
          "wordCount": "800-1200",
          "internalLink": "how this links back to the pillar — be specific"
        }
      ]
    }
  ]
}

Generate exactly 1 strategy with 6-8 cluster posts. Make sure keywords are specific and realistic for a UK audience.
${dateRule}`

          : `Analyse my website data and suggest 3 pillar content strategies I should build.

My website is ${displaySite(selectedSite)}. Here are my current keywords:
${kwData}

My current pages:
${pages}
${dupeContext}
Group my keywords into topic clusters. For each cluster, suggest a pillar + supporting blog strategy. Return ONLY valid JSON, no markdown:
{
  "strategies": [
    {
      "topic": "the main topic/service area",
      "reasoning": "2-3 sentences explaining why this topic — reference actual keyword data",
      "trafficPotential": "estimated combined monthly impressions from the cluster",
      "difficulty": "easy|medium|hard",
      "currentPositions": "summary of where keywords in this cluster currently rank",
      "pillar": {
        "keyword": "main target keyword for the pillar page",
        "title": "suggested pillar page title (H1)",
        "description": "2-3 sentence description of what the pillar page should cover",
        "wordCount": "2000-3000"
      },
      "clusters": [
        {
          "keyword": "specific long-tail keyword",
          "title": "suggested blog post title",
          "angle": "1 sentence describing the unique angle",
          "wordCount": "800-1200",
          "internalLink": "how this links back to the pillar"
        }
      ]
    }
  ]
}

Generate exactly 3 strategies, each with 6-8 cluster posts. Pick topics with the highest combined impression volume where I'm currently underperforming. Target UK audience. Be specific — use my actual keywords.
${dateRule}`;

        const txt = await callClaude(prompt,
          "You are an expert SEO content strategist. You specialise in pillar/cluster content strategies for small businesses. Return valid JSON only. No markdown backticks. No text before or after the JSON. Be specific and actionable.",
          "longform"
        );
        // Clean and parse — handle various AI response formats
        let cleaned = txt.replace(/```json|```/g, "").trim();
        // Try to extract JSON if wrapped in other text
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) cleaned = jsonMatch[0];
        const data = JSON.parse(cleaned);
        let result = data.strategies || [data]; // handle single strategy response too

        // Backstop for the date rule above. Prompt instructions are not guarantees,
        // and a wrong year in a title is both embarrassing and bad for rankings, so
        // remove any past year from generated titles rather than trusting compliance.
        // Future years are left alone (a legitimate forward-looking title), as is
        // the current year.
        const stripStaleYear = (s) => {
          if (typeof s !== "string") return s;
          return s
            .replace(/\s+in\s+(19|20)\d{2}\b/g, (m, _p, o) => {
              const yr = parseInt(m.match(/(19|20)\d{2}/)[0], 10);
              return yr < currentYear ? "" : m;
            })
            .replace(/\s*\((19|20)\d{2}\)\s*/g, (m) => {
              const yr = parseInt(m.match(/(19|20)\d{2}/)[0], 10);
              return yr < currentYear ? " " : m;
            })
            .replace(/\s{2,}/g, " ")
            .trim();
        };
        result = result.map(st => ({
          ...st,
          pillar: st.pillar ? { ...st.pillar, title: stripStaleYear(st.pillar.title) } : st.pillar,
          clusters: Array.isArray(st.clusters)
            ? st.clusters.map(c => ({ ...c, title: stripStaleYear(c.title) }))
            : st.clusters,
        }));
        // Write to localStorage BEFORE touching React state. The AI call completes
        // server-side even if the user navigates away, but by then this component
        // has unmounted and setSuggestions() lands nowhere — so the strategy (and
        // the AI credit spent on it) was silently lost. localStorage doesn't care
        // whether the component is mounted, so the work survives the navigation.
        try {
          localStorage.setItem(`ra_sugg_pending_${selectedSite}`, JSON.stringify({
            ts: Date.now(),
            topic: topic || "",
            strategies: result,
          }));
        } catch {}
        setSuggestions(result);
      } catch (err) {
        console.error("Strategy generation error:", err.message);
        if (err.message?.startsWith("UPGRADE_REQUIRED")) {
          setShowUpgrade(true);
          setSuggestions(null);
        } else {
          setSuggestions([]);
        }
      }
      setGenerating(false);
    };

    // Accept a suggestion and turn it into an active strategy
    const acceptStrategy = (s) => {
      // Save current strategy to history before replacing
      if (strategy) {
        try {
          const histKey = `ra_strategy_history_${selectedSite}`;
          const hist = JSON.parse(localStorage.getItem(histKey) || "[]");
          hist.push({ topic: strategy.topic, date: strategy.createdAt?.slice(0,10) || new Date().toISOString().slice(0,10), clusters: strategy.clusters.map(c => c.keyword) });
          localStorage.setItem(histKey, JSON.stringify(hist.slice(-20)));
          saveUserData(selectedSite, 'strategy_history', hist.slice(-20)); // keep last 20
          saveUserData(selectedSite, 'strategy_history', hist.slice(-20));
        } catch {}
      }
      const newStrategy = {
        topic: s.topic,
        reasoning: s.reasoning,
        trafficPotential: s.trafficPotential,
        difficulty: s.difficulty,
        createdAt: new Date().toISOString(),
        pillar: { ...s.pillar, status: "not_started", url: "" },
        clusters: s.clusters.map((c, i) => ({ ...c, id: `cluster-${i}`, status: "not_started", url: "" })),
      };
      saveStrategy(newStrategy);
      // The suggestion set has served its purpose — drop the recovery copy so it
      // can't reappear later looking like a fresh result.
      try { localStorage.removeItem(`ra_sugg_pending_${selectedSite}`); } catch {}
      setRecoveredSugg(false);
      setView("planner");
    };

    // Update a cluster's status
    const updateCluster = (id, changes) => {
      if (!strategy) return;
      const updated = {
        ...strategy,
        clusters: strategy.clusters.map(c => c.id === id ? { ...c, ...changes } : c),
      };
      saveStrategy(updated);
    };

    const updatePillar = (changes) => {
      if (!strategy) return;
      saveStrategy({ ...strategy, pillar: { ...strategy.pillar, ...changes } });
    };

    // Jump to content generator with prefilled keyword
    // Resolve the pillar page to a REAL published URL by matching its keyword
    // against the pages Search Console reports for this site. Returns "" unless
    // confident: a wrong or invented pillar URL is a 404 in published content,
    // which is worse than omitting the link entirely.
    const resolvePillarUrl = () => {
      const p = strategy?.pillar;
      if (!p || p.status !== "published") return "";
      const words = String(p.keyword || "")
        .toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/)
        .filter(w => w.length > 2);
      if (words.length < 2) return "";
      const need = Math.max(2, Math.ceil(words.length * 0.6));
      let best = "", bestScore = 0;
      for (const pg of (siteData?.pages || [])) {
        const url = String(pg.page || "");
        if (!url) continue;
        const path = url.toLowerCase().replace(/^https?:\/\/[^/]+/, "");
        if (path === "" || path === "/") continue;           // homepage is not the pillar
        const score = words.filter(w => path.includes(w)).length;
        if (score > bestScore) { bestScore = score; best = url; }
      }
      if (bestScore < need) return "";
      return /^https?:\/\//i.test(best) ? best : "";
    };

    // Jump to content generator with prefilled keyword
    const writeContent = (keyword, title) => {
      if (!isPro) { setShowUpgrade(true); return; }
      const pillarUrl = resolvePillarUrl();
      contentPresetRef.current = {
        kw: keyword,
        biz: selectedSite,
        notes: `Part of pillar strategy: "${strategy?.topic}". Blog title suggestion: "${title}".`,
        pillarUrl,
        pillarTitle: pillarUrl ? (strategy?.pillar?.title || "") : "",
      };
      setScreen("content");
    };

    const statusColors = { not_started: "var(--text3)", drafted: "var(--amber)", published: "var(--green)" };
    const statusLabels = { not_started: "Not started", drafted: "Drafted", published: "Published" };
    const statusIcons  = { not_started: "○", drafted: "◐", published: "●" };
    const diffColors   = { easy: "var(--green)", medium: "var(--amber)", hard: "#f03e5f" };

    const cardStyle = { background: "var(--card)", border: "1px solid var(--b2)", borderRadius: 12, padding: "1.25rem" };
    const headStyle = { fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text3)", marginBottom: ".75rem" };

    // Content-type metadata for badges on pillar/cluster cards.
    // These fields only exist on wizard-generated strategies but the
    // rendering is a no-op when the field is absent — backwards-compatible
    // with strategies created via the existing AI suggestion flow.
    const CONTENT_TYPE_META = {
      "service-page": { icon: "🛠️", label: "Service page" },
      "landing-page": { icon: "🎯", label: "Landing page" },
      "blog":         { icon: "📝", label: "Blog post" },
      "guide":        { icon: "📚", label: "Guide" },
      "comparison":   { icon: "⚖️", label: "Comparison" },
      "listicle":     { icon: "📋", label: "Listicle" },
      "how-to":       { icon: "🧭", label: "How-to" },
    };
    const PHASE_META = {
      "now":   { icon: "🟢", label: "Build first" },
      "soon":  { icon: "🔵", label: "Build next" },
      "later": { icon: "🟡", label: "Build later" },
    };

    // Progress stats
    const progress = strategy ? {
      total: strategy.clusters.length + 1,
      published: strategy.clusters.filter(c => c.status === "published").length + (strategy.pillar.status === "published" ? 1 : 0),
      drafted: strategy.clusters.filter(c => c.status === "drafted").length + (strategy.pillar.status === "drafted" ? 1 : 0),
      notStarted: strategy.clusters.filter(c => c.status === "not_started").length + (strategy.pillar.status === "not_started" ? 1 : 0),
    } : null;

    return (
      <div className="content">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
          <div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, letterSpacing: "-.03em" }}>Content Strategy</div>
            <div style={{ fontSize: ".82rem", color: "var(--text2)", marginTop: ".2rem" }}>
              {displaySite(selectedSite)} · {strategy ? `Active strategy: ${strategy.topic}` : "No active strategy"} · {siteData ? "Live data" : "Demo data"}
            </div>
          </div>
          <div style={{ display: "flex", gap: ".35rem" }}>
            {["suggestions", "planner", "tracker"].map(v => (
              <button key={v} onClick={() => setView(v)}
                style={{ background: view === v ? "var(--blue)" : "var(--s2)", color: view === v ? "#fff" : "var(--text2)", border: "none", borderRadius: 8, padding: ".4rem .85rem", fontSize: ".78rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>
                {v === "suggestions" ? "🔍 Suggestions" : v === "planner" ? "🗺 Planner" : "📈 Tracker"}
              </button>
            ))}
          </div>
        </div>

        {/* ── SUGGESTIONS VIEW ── */}
        {view === "suggestions" && (
          <div>
            {/* Explainer */}
            <div style={{ ...cardStyle, marginBottom: "1rem", background: "var(--bdim)", borderColor: "rgba(77,123,255,.15)" }}>
              <div style={{ fontSize: ".9rem", fontWeight: 700, color: "var(--text)", marginBottom: ".5rem" }}>💡 What is a pillar content strategy?</div>
              <div style={{ fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.7 }}>
                A pillar strategy is one of the most effective ways to rank for competitive keywords. You create one comprehensive "pillar" page about a broad topic (e.g. "GDPR Compliance Guide"), then write 6-8 supporting blog posts about specific subtopics. Each blog post links back to the pillar page, telling Google that your pillar is the authority on that topic. Over time, the whole cluster rises in rankings together.
              </div>
            </div>

            {/* Custom topic input */}
            <div style={{ ...cardStyle, marginBottom: "1rem" }}>
              <div style={headStyle}>Generate Strategy</div>
              <div style={{ fontSize: ".82rem", color: "var(--text2)", marginBottom: ".75rem" }}>
                {siteData
                  ? "We'll analyse your keyword data and suggest the best topics to build a strategy around. Or type a specific topic you want to target."
                  : "Connect Google Search Console for data-driven suggestions, or type a topic below."}
              </div>
              <div style={{ display: "flex", gap: ".5rem", marginBottom: ".5rem" }}>
                <input
                  type="text" placeholder="e.g. GDPR compliance, web design services, kitchen renovations..."
                  value={customTopic} onChange={e => setCustomTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !generating) generateSuggestions(customTopic.trim()); }}
                  style={{ flex: 1, background: "var(--s2)", border: "1px solid var(--border)", borderRadius: 8, padding: ".65rem .85rem", color: "var(--text)", fontFamily: "inherit", fontSize: ".85rem", outline: "none" }}
                />
                <button disabled={generating} onClick={() => generateSuggestions(customTopic.trim())}
                  style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: 8, padding: ".65rem 1.2rem", fontSize: ".82rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                  {generating ? "⏳ Analysing..." : customTopic.trim() ? "Build strategy →" : "✨ Auto-suggest"}
                </button>
              </div>
              <div style={{ fontSize: ".72rem", color: "var(--text3)" }}>
                {customTopic.trim() ? "We'll build a strategy specifically around this topic" : "Leave blank and we'll pick the best opportunities from your keyword data"}
              </div>
            </div>

            {/* Suggestions list */}
            {generating && (
              <div style={{ ...cardStyle, textAlign: "center", padding: "3rem" }}>
                <div className="spinner" style={{ width: 24, height: 24, margin: "0 auto .75rem" }}/>
                <div style={{ fontSize: ".85rem", color: "var(--text2)" }}>Analysing your keywords and building strategies...</div>
                <div style={{ fontSize: ".75rem", color: "var(--text3)", marginTop: ".35rem" }}>This can take up to a minute</div>
                {/* The request completes server-side even if the user navigates away.
                    The result is now written to localStorage on arrival, so it survives
                    the component unmounting and is restored when they return. */}
                <div style={{ fontSize: ".75rem", color: "var(--text3)", marginTop: ".6rem" }}>
                  You can navigate away — we'll save the result and show it when you come back.
                </div>
              </div>
            )}

            {recoveredSugg && suggestions?.length > 0 && !generating && (
              <div style={{ ...cardStyle, marginBottom: "1rem", borderLeft: "3px solid var(--green)" }}>
                <div style={{ fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.6 }}>
                  ✓ <strong>These strategies finished while you were away.</strong> They're held temporarily
                  in this browser only — pick one below to save it properly, or generate again to replace them.
                </div>
              </div>
            )}

            {suggestions && suggestions.length === 0 && !generating && (
              <div style={{ ...cardStyle, textAlign: "center", padding: "2rem" }}>
                <div style={{ fontSize: ".85rem", color: "var(--text3)" }}>Could not generate suggestions — try a specific topic or connect more data.</div>
              </div>
            )}

            {suggestions && suggestions.length > 0 && suggestions.map((s, si) => (
              <div key={si} style={{ ...cardStyle, marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: ".75rem" }}>
                  <div>
                    <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text)" }}>{s.topic}</div>
                    <div style={{ display: "flex", gap: ".5rem", marginTop: ".35rem", flexWrap: "wrap" }}>
                      {s.difficulty && <span style={{ fontSize: ".68rem", fontWeight: 700, padding: ".15rem .5rem", borderRadius: 5, background: `${diffColors[s.difficulty]}22`, color: diffColors[s.difficulty] }}>{s.difficulty.toUpperCase()}</span>}
                      {s.trafficPotential && <span style={{ fontSize: ".68rem", fontWeight: 600, padding: ".15rem .5rem", borderRadius: 5, background: "var(--bdim)", color: "var(--blue)" }}>{s.trafficPotential} est. traffic</span>}
                      <span style={{ fontSize: ".68rem", padding: ".15rem .5rem", borderRadius: 5, background: "var(--s2)", color: "var(--text3)" }}>1 pillar + {s.clusters?.length || 0} posts</span>
                    </div>
                  </div>
                  <button onClick={() => acceptStrategy(s)}
                    style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: 8, padding: ".5rem 1rem", fontSize: ".78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
                    Use this strategy →
                  </button>
                </div>
                <div style={{ fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.65, marginBottom: ".75rem" }}>{s.reasoning}</div>
                {s.currentPositions && <div style={{ fontSize: ".78rem", color: "var(--amber)", marginBottom: ".75rem" }}>📊 {s.currentPositions}</div>}

                {/* Pillar preview */}
                <div style={{ background: "var(--s2)", borderRadius: 10, padding: "1rem", marginBottom: ".75rem", borderLeft: "3px solid var(--green)" }}>
                  <div style={{ fontSize: ".68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--green)", marginBottom: ".35rem" }}>Pillar Page</div>
                  <div style={{ fontSize: ".88rem", fontWeight: 700, color: "var(--text)" }}>{s.pillar?.title}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text2)", marginTop: ".25rem" }}>Target: "{s.pillar?.keyword}" · {s.pillar?.wordCount} words</div>
                  {s.pillar?.description && <div style={{ fontSize: ".78rem", color: "var(--text3)", marginTop: ".35rem", lineHeight: 1.5 }}>{s.pillar.description}</div>}
                </div>

                {/* Cluster preview */}
                <div style={headStyle}>Supporting Blog Posts</div>
                <div style={{ display: "grid", gap: ".5rem" }}>
                  {(s.clusters || []).map((c, ci) => (
                    <div key={ci} style={{ display: "flex", alignItems: "flex-start", gap: ".6rem", padding: ".55rem .65rem", background: "var(--s2)", borderRadius: 8 }}>
                      <span style={{ color: "var(--text3)", fontSize: ".75rem", fontWeight: 700, fontFamily: "var(--mono)", width: 20, flexShrink: 0, textAlign: "center", marginTop: ".1rem" }}>{ci + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--text)" }}>{c.title}</div>
                        <div style={{ fontSize: ".72rem", color: "var(--text3)", marginTop: ".15rem" }}>"{c.keyword}" · {c.wordCount} words</div>
                        {c.angle && <div style={{ fontSize: ".72rem", color: "var(--text2)", marginTop: ".2rem" }}>{c.angle}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── PLANNER VIEW ── */}
        {view === "planner" && (
          <div>
            {!strategy ? (
              <div style={{ ...cardStyle, textAlign: "center", padding: "3rem" }}>
                <div style={{ fontSize: "2rem", marginBottom: ".75rem" }}>🗺</div>
                <div style={{ fontSize: "1rem", fontWeight: 700, marginBottom: ".5rem" }}>No active strategy yet</div>
                <div style={{ fontSize: ".85rem", color: "var(--text2)", marginBottom: "1rem" }}>Generate suggestions first, then pick a strategy to work on.</div>
                <button onClick={() => setView("suggestions")}
                  style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: 8, padding: ".55rem 1.2rem", fontSize: ".85rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  Generate suggestions →
                </button>
              </div>
            ) : (
              <>
                {/* Wizard-source banner — only shown for strategies created by the
                    Starting Out wizard. Subtle but persistent so users understand
                    the origin of this plan and that they can re-run the wizard. */}
                {strategy.source === "wizard" && (
                  <div style={{
                    background: "rgba(15,219,138,.06)",
                    border: "1px solid rgba(15,219,138,.2)",
                    borderRadius: 8,
                    padding: ".55rem .85rem",
                    fontSize: ".75rem",
                    color: "var(--text2)",
                    marginBottom: ".75rem",
                    display: "flex",
                    alignItems: "center",
                    gap: ".5rem",
                    flexWrap: "wrap",
                  }}>
                    <span>📋</span>
                    <span style={{ fontWeight: 600, color: "var(--green)" }}>From your Starting Out wizard</span>
                    <span style={{ color: "var(--text3)" }}>·</span>
                    <span style={{ color: "var(--text2)", flex: 1, minWidth: 0 }}>Content plan based on your business profile and competitor analysis</span>
                    <button onClick={() => setScreen("startingOut")}
                      style={{ background: "transparent", color: "var(--green)", border: "1px solid rgba(15,219,138,.3)", borderRadius: 6, padding: ".2rem .55rem", fontSize: ".7rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                      Open wizard
                    </button>
                  </div>
                )}

                {/* Progress bar */}
                <div style={{ ...cardStyle, marginBottom: "1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".75rem" }}>
                    <div>
                      <div style={{ fontSize: ".95rem", fontWeight: 700 }}>{strategy.topic}</div>
                      <div style={{ fontSize: ".75rem", color: "var(--text3)", marginTop: ".15rem" }}>Created {new Date(strategy.createdAt).toLocaleDateString("en-GB")}{strategy.difficulty && ` · ${strategy.difficulty} difficulty`}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "1.4rem", fontWeight: 800, fontFamily: "var(--mono)", color: "var(--green)" }}>{Math.round((progress.published / progress.total) * 100)}%</div>
                      <div style={{ fontSize: ".7rem", color: "var(--text3)" }}>{progress.published}/{progress.total} published</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 2, borderRadius: 6, overflow: "hidden", height: 20 }}>
                    {progress.published > 0 && <div style={{ flex: progress.published, background: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".6rem", fontWeight: 700, color: "#000" }}>{progress.published} published</div>}
                    {progress.drafted > 0 && <div style={{ flex: progress.drafted, background: "var(--amber)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".6rem", fontWeight: 700, color: "#000" }}>{progress.drafted} drafted</div>}
                    {progress.notStarted > 0 && <div style={{ flex: progress.notStarted, background: "var(--s3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: ".6rem", fontWeight: 700, color: "var(--text3)" }}>{progress.notStarted} to do</div>}
                  </div>
                </div>

                {/* Pillar card */}
                <div style={{ ...cardStyle, marginBottom: ".75rem", borderLeft: "3px solid var(--green)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".5rem" }}>
                    <div style={{ fontSize: ".68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--green)" }}><Tip term="pillarPage">★ Pillar Page</Tip></div>
                    <select value={strategy.pillar.status} onChange={e => updatePillar({ status: e.target.value })}
                      style={{ background: "var(--s2)", border: "1px solid var(--border)", borderRadius: 6, padding: ".25rem .5rem", color: statusColors[strategy.pillar.status], fontSize: ".75rem", fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                      <option value="not_started">Not started</option>
                      <option value="drafted">Drafted</option>
                      <option value="published">Published</option>
                    </select>
                  </div>
                  <div style={{ fontSize: ".95rem", fontWeight: 700, color: "var(--text)", marginBottom: ".25rem" }}>{strategy.pillar.title}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text2)", marginBottom: ".25rem" }}>
                    Target keyword: "{strategy.pillar.keyword}"
                    <KeywordBadge keyword={strategy.pillar.keyword} />
                    · {strategy.pillar.wordCount} words recommended
                    {strategy.pillar.contentType && CONTENT_TYPE_META[strategy.pillar.contentType] && (
                      <> · <span style={{ color: "var(--text2)" }}>{CONTENT_TYPE_META[strategy.pillar.contentType].icon} {CONTENT_TYPE_META[strategy.pillar.contentType].label}</span></>
                    )}
                    {strategy.pillar.phase && PHASE_META[strategy.pillar.phase] && (
                      <> · <span style={{ color: "var(--text3)", fontSize: ".74rem" }}>{PHASE_META[strategy.pillar.phase].icon} {PHASE_META[strategy.pillar.phase].label}</span></>
                    )}
                  </div>
                  {strategy.pillar.description && <div style={{ fontSize: ".78rem", color: "var(--text3)", lineHeight: 1.5, marginBottom: ".75rem" }}>{strategy.pillar.description}</div>}
                  <div style={{ display: "flex", gap: ".5rem" }}>
                    <button onClick={() => writeContent(strategy.pillar.keyword, strategy.pillar.title)}
                      style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: 7, padding: ".4rem .85rem", fontSize: ".78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      {isPro ? "✍ Write this page" : "🔒 Write (Pro)"}
                    </button>
                    {strategy.pillar.status === "published" && (
                      <input placeholder="Paste published URL..." value={strategy.pillar.url || ""} onChange={e => updatePillar({ url: e.target.value })}
                        style={{ flex: 1, background: "var(--s2)", border: "1px solid var(--border)", borderRadius: 7, padding: ".4rem .65rem", color: "var(--text)", fontFamily: "inherit", fontSize: ".78rem", outline: "none" }}/>
                    )}
                  </div>
                </div>

                {/* Enrich with real keyword data — Pro+ only.
                    One click fetches search volume + competition for every keyword
                    in the strategy (pillar + all clusters). Costs 1 quota credit
                    per click; data caches for 30 days. */}
                <div style={{ ...cardStyle, marginBottom: ".75rem", background: Object.keys(keywordEnrichment).length > 0 ? "rgba(15,219,138,.04)" : "var(--s1)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: ".5rem" }}>
                    <div>
                      <div style={{ fontSize: ".85rem", fontWeight: 600, color: "var(--text)" }}>
                        {Object.keys(keywordEnrichment).length > 0 ? "📊 Keyword data loaded" : "Enrich with real keyword data"}
                      </div>
                      <div style={{ fontSize: ".7rem", color: "var(--text3)", marginTop: ".15rem" }}>
                        {Object.keys(keywordEnrichment).length > 0
                          ? "Search volume + competition shown next to each keyword below"
                          : isPro
                            ? "Pulls real Google search volume and competition for every keyword in this strategy"
                            : "Available on Pro plans — see real search volume + competition data"}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: ".25rem" }}>
                      <button onClick={enrichWithKeywordData} disabled={enriching || !isPro}
                        style={{ background: isPro ? "var(--blue)" : "var(--s2)", color: isPro ? "#fff" : "var(--text3)", border: "none", borderRadius: 7, padding: ".45rem .9rem", fontSize: ".78rem", fontWeight: 700, cursor: isPro ? "pointer" : "not-allowed", fontFamily: "inherit", opacity: enriching ? 0.6 : 1 }}>
                        {enriching ? "Loading…" : isPro ? (Object.keys(keywordEnrichment).length > 0 ? "↻ Refresh data" : "📊 Get keyword data") : "🔒 Pro feature"}
                      </button>
                      {enrichQuota && (
                        <div style={{ fontSize: ".68rem", color: "var(--text3)", fontFamily: "var(--mono)" }}>
                          {enrichQuota.used}/{enrichQuota.limit} sessions used this month
                        </div>
                      )}
                    </div>
                  </div>
                  {enrichError && (
                    <div style={{ marginTop: ".6rem", padding: ".5rem .65rem", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", borderRadius: 6, fontSize: ".75rem", color: "var(--red)" }}>
                      {enrichError}
                    </div>
                  )}
                </div>

                {/* How linking works */}
                <div style={{ textAlign: "center", padding: ".5rem", fontSize: ".75rem", color: "var(--text3)" }}>
                  ↕ Each <Tip term="clusterPost">blog post</Tip> below should <Tip term="internalLinks">link back</Tip> to your pillar page to build <Tip term="topicalAuthority">topical authority</Tip>
                </div>

                {/* Cluster posts */}
                {strategy.clusters.map((c, i) => (
                  <div key={c.id} style={{ ...cardStyle, marginBottom: ".5rem", opacity: c.status === "published" ? .8 : 1 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: ".75rem" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: ".5rem", marginBottom: ".3rem" }}>
                          <span style={{ fontSize: ".7rem", fontWeight: 700, fontFamily: "var(--mono)", color: "var(--text3)" }}>POST {i + 1}</span>
                          <span style={{ fontSize: ".65rem", color: statusColors[c.status], fontWeight: 600 }}>{statusIcons[c.status]} {statusLabels[c.status]}</span>
                        </div>
                        <div style={{ fontSize: ".88rem", fontWeight: 600, color: "var(--text)", marginBottom: ".2rem" }}>{c.title}</div>
                        <div style={{ fontSize: ".75rem", color: "var(--text3)" }}>
                          "{c.keyword}"
                          <KeywordBadge keyword={c.keyword} />
                          · {c.wordCount} words
                          {c.contentType && CONTENT_TYPE_META[c.contentType] && (
                            <> · <span style={{ color: "var(--text2)" }}>{CONTENT_TYPE_META[c.contentType].icon} {CONTENT_TYPE_META[c.contentType].label}</span></>
                          )}
                          {c.phase && PHASE_META[c.phase] && (
                            <> · <span style={{ color: "var(--text3)" }}>{PHASE_META[c.phase].icon} {PHASE_META[c.phase].label}</span></>
                          )}
                        </div>
                        {c.angle && <div style={{ fontSize: ".75rem", color: "var(--text2)", marginTop: ".2rem" }}>{c.angle}</div>}
                        {c.internalLink && <div style={{ fontSize: ".72rem", color: "var(--blue)", marginTop: ".25rem" }}>🔗 {c.internalLink}</div>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: ".35rem", flexShrink: 0 }}>
                        <select value={c.status} onChange={e => updateCluster(c.id, { status: e.target.value })}
                          style={{ background: "var(--s2)", border: "1px solid var(--border)", borderRadius: 6, padding: ".25rem .4rem", color: statusColors[c.status], fontSize: ".72rem", fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
                          <option value="not_started">Not started</option>
                          <option value="drafted">Drafted</option>
                          <option value="published">Published</option>
                        </select>
                        <button onClick={() => writeContent(c.keyword, c.title)}
                          style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: ".25rem .5rem", fontSize: ".72rem", color: "var(--text2)", cursor: "pointer", fontFamily: "inherit" }}>
                          {isPro ? "✍ Write" : "🔒 Pro"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Strategy actions */}
                <div style={{ display: "flex", gap: ".5rem", marginTop: "1rem", justifyContent: "center" }}>
                  <button onClick={() => { if (window.confirm("Start a new strategy? Your current progress will be replaced.")) { saveStrategy(null); setView("suggestions"); } }}
                    style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: ".45rem .9rem", fontSize: ".78rem", color: "var(--text3)", cursor: "pointer", fontFamily: "inherit" }}>
                    Start new strategy
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TRACKER VIEW ── */}
        {view === "tracker" && (
          <div>
            {!strategy ? (
              <div style={{ ...cardStyle, textAlign: "center", padding: "3rem" }}>
                <div style={{ fontSize: "2rem", marginBottom: ".75rem" }}>📈</div>
                <div style={{ fontSize: "1rem", fontWeight: 700, marginBottom: ".5rem" }}>No strategy to track yet</div>
                <div style={{ fontSize: ".85rem", color: "var(--text2)", marginBottom: "1rem" }}>Create a strategy first, then track your progress here.</div>
                <button onClick={() => setView("suggestions")}
                  style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: 8, padding: ".55rem 1.2rem", fontSize: ".85rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  Generate suggestions →
                </button>
              </div>
            ) : (
              <>
                {/* Strategy overview */}
                <div style={{ ...cardStyle, marginBottom: "1rem" }}>
                  <div style={headStyle}>📋 Strategy Overview</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: ".75rem" }}>
                    {[
                      { label: "Total content", value: progress.total, color: "var(--text)" },
                      { label: "Published", value: progress.published, color: "var(--green)" },
                      { label: "In progress", value: progress.drafted, color: "var(--amber)" },
                      { label: "To write", value: progress.notStarted, color: "var(--text3)" },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign: "center", padding: ".75rem", background: "var(--s2)", borderRadius: 8 }}>
                        <div style={{ fontSize: "1.5rem", fontWeight: 800, fontFamily: "var(--mono)", color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: ".7rem", color: "var(--text3)", marginTop: ".2rem" }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Content checklist */}
                <div style={{ ...cardStyle, marginBottom: "1rem" }}>
                  <div style={headStyle}>✅ Content Checklist — {strategy.topic}</div>
                  <div style={{ fontSize: ".78rem", color: "var(--text2)", marginBottom: ".75rem" }}>Work through this list top to bottom. Publish the pillar page first, then add supporting posts one by one.</div>

                  {/* Pillar */}
                  <div style={{ display: "flex", alignItems: "center", gap: ".65rem", padding: ".6rem .75rem", background: strategy.pillar.status === "published" ? "rgba(15,219,138,.08)" : "var(--s2)", borderRadius: 8, marginBottom: ".5rem", borderLeft: "3px solid var(--green)" }}>
                    <span style={{ fontSize: "1rem" }}>{strategy.pillar.status === "published" ? "✅" : strategy.pillar.status === "drafted" ? "📝" : "⬜"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: ".82rem", fontWeight: 700, color: "var(--text)", textDecoration: strategy.pillar.status === "published" ? "none" : "none" }}>PILLAR: {strategy.pillar.title}</div>
                      <div style={{ fontSize: ".72rem", color: "var(--text3)" }}>"{strategy.pillar.keyword}" · {strategy.pillar.wordCount} words</div>
                    </div>
                    <span style={{ fontSize: ".72rem", fontWeight: 600, color: statusColors[strategy.pillar.status] }}>{statusLabels[strategy.pillar.status]}</span>
                  </div>

                  {/* Clusters */}
                  {strategy.clusters.map((c, i) => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: ".65rem", padding: ".5rem .75rem", background: c.status === "published" ? "rgba(15,219,138,.05)" : "transparent", borderRadius: 8, borderBottom: i < strategy.clusters.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <span style={{ fontSize: ".9rem" }}>{c.status === "published" ? "✅" : c.status === "drafted" ? "📝" : "⬜"}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: ".8rem", fontWeight: 600, color: c.status === "published" ? "var(--text2)" : "var(--text)" }}>{c.title}</div>
                        <div style={{ fontSize: ".7rem", color: "var(--text3)" }}>"{c.keyword}"</div>
                      </div>
                      <span style={{ fontSize: ".72rem", fontWeight: 600, color: statusColors[c.status] }}>{statusLabels[c.status]}</span>
                    </div>
                  ))}
                </div>

                {/* Tips */}
                <div style={{ ...cardStyle, background: "var(--bdim)", borderColor: "rgba(77,123,255,.15)" }}>
                  <div style={{ fontSize: ".88rem", fontWeight: 700, color: "var(--text)", marginBottom: ".5rem" }}>💡 Tips for pillar strategy success</div>
                  <div style={{ fontSize: ".8rem", color: "var(--text2)", lineHeight: 1.75 }}>
                    <strong>1. Publish the pillar first</strong> — it's your authority page. Make it comprehensive (2,000+ words), covering the topic broadly.
                    <br/><br/><strong>2. Add cluster posts weekly</strong> — consistency matters more than speed. One quality post per week for 6-8 weeks builds momentum.
                    <br/><br/><strong>3. Internal linking is critical</strong> — every cluster post should link to the pillar using the target keyword as anchor text. The pillar should link out to each cluster post too.
                    <br/><br/><strong>4. Update the pillar</strong> — as you publish cluster posts, add links from the pillar page to each new post. This strengthens the whole cluster.
                    <br/><br/><strong>5. Give it 8-12 weeks</strong> — Google takes time to recognise topical authority. Most pillar strategies show meaningful ranking improvements after 2-3 months.
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // ONBOARDING TOUR
  // Step-by-step guide shown on first login
  // ─────────────────────────────────────────────────────────────
  const tourSteps = [
    {
      target: "site-selector",
      title: "Your connected site",
      body: "This shows which website you're currently viewing. If you connect multiple sites to Google Search Console, you can switch between them here or add new ones.",
      icon: "🌐",
    },
    {
      target: "kpi-strip",
      title: "Performance at a glance",
      body: "These are your key metrics pulled live from Google Search Console — organic clicks, impressions, average position, and click-through rate. They update automatically.",
      icon: "📊",
    },
    {
      target: "priority-actions",
      title: "Your weekly action list",
      body: "This is the heart of RankActions. Each week we analyse your data and give you the 3 highest-impact things to fix. Click any action to expand it and see the AI-generated fix suggestion.",
      icon: "🎯",
    },
    {
      target: "nav-siteDetail",
      title: "Site Detail",
      body: "Deep dive into your SEO opportunities, technical issues, and conversion improvements. Each keyword shows its position and a specific action you can take.",
      icon: "◎",
    },
    {
      target: "nav-strategy",
      title: "Content Strategy",
      body: "Build a pillar content strategy based on your keyword data. The AI suggests which topics to target, creates a content plan with 6-8 blog posts, and connects straight to the Content Generator to write them.",
      icon: "🗺",
    },
    {
      target: "nav-content",
      title: "Content Generator",
      body: "See a keyword you should be ranking for? Click here and our AI writes a full SEO-optimised blog post in 30 seconds — styled to match your site's colours and fonts.",
      icon: "✍",
    },
    {
      target: "nav-links",
      title: "Link Building",
      body: "AI generates specific link building opportunities for your site with real targets, step-by-step instructions, and outreach email templates. Track your prospects through the pipeline.",
      icon: "🔗",
    },
    {
      target: "nav-reports",
      title: "Weekly Reports",
      body: "Your full performance report — keyword rankings, completed actions, link building progress, and an AI-written summary. You'll also get this emailed every Monday morning.",
      icon: "📄",
    },
    {
      target: "nav-settings",
      title: "Settings",
      body: "Manage your account, connected sites, Google connection, cookie preferences, and data exports. You can also change your plan here.",
      icon: "⚙",
    },
  ];

  const closeTour = () => {
    setShowTour(false);
    setTourStep(0);
    localStorage.setItem("ra_tour_complete", "1");
  };

  const OnboardingTour = () => {
    const [pos, setPos] = useState({ top: 0, left: 0, width: 0, height: 0 });
    const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
    const [arrowDir, setArrowDir] = useState("left");
    const step = tourSteps[tourStep];

    useEffect(() => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const pad = 6;
      setPos({
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      });

      // Position tooltip to the right of the element by default
      const tooltipWidth = 340;
      const tooltipHeight = 220;
      let tTop = rect.top;
      let tLeft = rect.right + 16;
      let arrow = "left";

      // If tooltip would go off right edge, position to the left
      if (tLeft + tooltipWidth > window.innerWidth - 20) {
        tLeft = rect.left - tooltipWidth - 16;
        arrow = "right";
      }
      // If tooltip would go off left edge, position below
      if (tLeft < 20) {
        tLeft = rect.left;
        tTop = rect.bottom + 16;
        arrow = "top";
      }
      // If tooltip would go off bottom, adjust up
      if (tTop + tooltipHeight > window.innerHeight - 20) {
        tTop = window.innerHeight - tooltipHeight - 20;
      }
      // Keep tooltip on screen
      if (tTop < 10) tTop = 10;

      setTooltipPos({ top: tTop, left: tLeft });
      setArrowDir(arrow);

      // Scroll element into view if needed
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [tourStep]);

    return (
      <>
        {/* Spotlight cutout */}
        <div className="tour-spotlight" style={{
          top: pos.top,
          left: pos.left,
          width: pos.width,
          height: pos.height,
        }}/>

        {/* Tooltip */}
        <div className="tour-tooltip" style={{ top: tooltipPos.top, left: tooltipPos.left }}>
          <div className={`tour-arrow ${arrowDir}`}/>
          <div className="tour-tooltip-title">
            <span className="tour-step-num">{tourStep + 1}</span>
            <span>{step.icon} {step.title}</span>
          </div>
          <div className="tour-tooltip-body">{step.body}</div>
          <div className="tour-tooltip-footer">
            <div className="tour-dots">
              {tourSteps.map((_, i) => (
                <div key={i} className={`tour-dot ${i === tourStep ? "active" : i < tourStep ? "done" : ""}`}/>
              ))}
            </div>
            <div style={{display:"flex",gap:".5rem"}}>
              <button className="tour-skip" onClick={closeTour}>
                {tourStep === tourSteps.length - 1 ? "" : "Skip tour"}
              </button>
              <button className="tour-next" onClick={() => {
                if (tourStep < tourSteps.length - 1) {
                  setTourStep(tourStep + 1);
                } else {
                  closeTour();
                }
              }}>
                {tourStep === tourSteps.length - 1 ? "Get started →" : "Next →"}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // SETTINGS SCREEN
  // ─────────────────────────────────────────────────────────────
  const SettingsScreen = () => {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const removeSite = (siteToRemove) => {
      if (sites.length <= 1) return;
      const updated = sites.filter(s => s !== siteToRemove);
      setSites(updated);
      localStorage.setItem("rankactions_sites", JSON.stringify(updated));
      if (selectedSite === siteToRemove) {
        setSelectedSite(updated[0]);
        localStorage.setItem("rankactions_selectedSite", updated[0]);
        setSiteData(null); setAiSummary(null);
      }
    };

    const disconnectGoogle = async () => {
    if (!confirm("Disconnect Google? This will revoke our access to your Search Console data. You can reconnect anytime.")) return;
    try {
      const res = await authFetch(`${WORKER_URL}/api/auth/disconnect`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Disconnect failed: ${data.error || res.statusText}. Your local session has been cleared but Google tokens may still be active. Please contact support.`);
      }
    } catch (err) {
      alert(`Disconnect error: ${err.message}. Your local session has been cleared.`);
    }
    localStorage.removeItem("rankactions_userId");
    setUserId(null);
    setIsConnected(false);
    setSiteData(null);
  };
  
  const deleteMyAccount = async () => {
    const confirm1 = confirm("Delete your account? This will permanently remove your profile, sites, snapshots, and revoke Google access. This cannot be undone.");
    if (!confirm1) return;
    const confirm2 = prompt('Type "DELETE" (in capitals) to confirm permanent account deletion:');
    if (confirm2 !== "DELETE") {
      alert("Account deletion cancelled.");
      return;
    }
    try {
      const res = await authFetch(`${WORKER_URL}/api/me`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Deletion failed: ${data.error || res.statusText}. Please contact support@rankactions.com.`);
        return;
      }
      // Clear all client state and sign out
      try { localStorage.clear(); } catch {}
      alert("Your account has been deleted. You will now be signed out.");
      try { await signOut(); } catch {}
      window.location.href = "https://rankactions.com";
    } catch (err) {
      alert(`Deletion error: ${err.message}. Please contact support@rankactions.com.`);
    }
  };

    // ── localStorage backup / restore (data-loss safety net) ─────
    // Downloads EVERY ra_* / rankactions_* key as a raw JSON file the user
    // can re-import to restore their work after a browser-data wipe. Does NOT
    // touch the server — purely a client-side backup. Belt-and-braces until
    // server-side persistence is fully in place.
    const backupLocalData = () => {
      try {
        const dump = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith("ra_") || k.startsWith("rankactions_"))) {
            dump[k] = localStorage.getItem(k);
          }
        }
        const payload = {
          _format: "rankactions-localstorage-backup",
          _version: 1,
          _exportedAt: new Date().toISOString(),
          keys: dump,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `rankactions-backup-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (err) {
        alert("Couldn't create backup. Please try again.");
      }
    };

    const restoreLocalData = (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (!parsed || parsed._format !== "rankactions-localstorage-backup" || !parsed.keys) {
            alert("That doesn't look like a RankActions backup file.");
            return;
          }
          const keys = parsed.keys;
          const count = Object.keys(keys).length;
          if (!window.confirm(`Restore ${count} saved items from this backup? This will overwrite any matching data currently in this browser.`)) return;
          Object.keys(keys).forEach(k => {
            if (k && (k.startsWith("ra_") || k.startsWith("rankactions_"))) {
              try { localStorage.setItem(k, keys[k]); } catch {}
            }
          });
          alert("Backup restored. The app will now reload to apply it.");
          window.location.reload();
        } catch (err) {
          alert("Couldn't read that backup file — it may be corrupted.");
        }
      };
      reader.readAsText(file);
    };

    const exportData = () => {
      const prospectData = {};
      const fixData = {};
      const contentData = {};
      const strategyData = {};
      sites.forEach(s => {
        try { prospectData[s] = JSON.parse(localStorage.getItem(`ra_prospects_${s}`) || "[]"); } catch {}
        try { fixData[s] = JSON.parse(localStorage.getItem(`ra_done_${s}`) || "[]"); } catch {}
        try { contentData[s] = JSON.parse(localStorage.getItem(`ra_content_history_${s}`) || "[]"); } catch {}
        try { strategyData[s] = JSON.parse(localStorage.getItem(`ra_strategy_${s}`) || "null"); } catch {}
      });
      const realSites = sites.filter(s => s && s !== "mywebsite.com");

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>RankActions — Your Data Export</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;padding:2rem;max-width:800px;margin:0 auto;font-size:14px;line-height:1.6}
.header{border-bottom:3px solid #0fdb8a;padding-bottom:1rem;margin-bottom:2rem}
.logo{font-size:1.4rem;font-weight:800;letter-spacing:-.03em}.logo em{color:#0fdb8a;font-style:normal}
.date{color:#666;font-size:.85rem;margin-top:.25rem}
h2{font-size:1rem;font-weight:700;margin:1.5rem 0 .5rem;padding-bottom:.3rem;border-bottom:1px solid #eee}
table{width:100%;border-collapse:collapse;font-size:.82rem;margin-bottom:1rem}
th{text-align:left;padding:.4rem .5rem;border-bottom:2px solid #ddd;color:#666;font-size:.7rem;text-transform:uppercase}
td{padding:.35rem .5rem;border-bottom:1px solid #eee}
.field{display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #f0f0f0}
.field-label{color:#666;font-size:.82rem}.field-value{font-weight:600;font-size:.82rem}
.footer{text-align:center;color:#999;font-size:.75rem;padding-top:1rem;border-top:1px solid #eee;margin-top:2rem}
.print-btn{background:#0fdb8a;color:#000;border:none;padding:.6rem 1.5rem;border-radius:8px;font-weight:700;font-size:.85rem;cursor:pointer;margin-bottom:1.5rem}
@media print{.print-btn{display:none!important}}
</style></head><body>
<button class="print-btn" onclick="window.print()">📥 Save as PDF</button>
<div class="header">
  <div class="logo">Rank<em>Actions</em> — Data Export</div>
  <div class="date">${new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})}</div>
</div>

<h2>Account</h2>
<div class="field"><span class="field-label">Name</span><span class="field-value">${user?.fullName || user?.firstName || "—"}</span></div>
<div class="field"><span class="field-label">Email</span><span class="field-value">${user?.primaryEmailAddress?.emailAddress || "—"}</span></div>
<div class="field"><span class="field-label">Plan</span><span class="field-value">${plan}</span></div>
<div class="field"><span class="field-label">Connected sites</span><span class="field-value">${realSites.length > 0 ? realSites.join(", ") : "None"}</span></div>

${realSites.map(s => {
  const prospects = prospectData[s] || [];
  const fixes = fixData[s] || [];
  const content = contentData[s] || [];
  const strat = strategyData[s];
  return `<h2>${s}</h2>
${fixes.length > 0 ? `<h3 style="font-size:.85rem;margin:.75rem 0 .3rem">Completed Fixes (${fixes.length})</h3><table><tr><th>Fix</th></tr>${fixes.map(f=>`<tr><td>${f}</td></tr>`).join("")}</table>` : ""}
${prospects.length > 0 ? `<h3 style="font-size:.85rem;margin:.75rem 0 .3rem">Link Prospects (${prospects.length})</h3><table><tr><th>Site</th><th>Type</th><th>Status</th></tr>${prospects.map(p=>`<tr><td>${p.site||p.name||"—"}</td><td>${p.type||"—"}</td><td>${p.status||"—"}</td></tr>`).join("")}</table>` : ""}
${content.length > 0 ? `<h3 style="font-size:.85rem;margin:.75rem 0 .3rem">Generated Content (${content.length})</h3><table><tr><th>Keyword</th><th>Date</th></tr>${content.map(c=>`<tr><td>${c.keyword}</td><td>${c.date||"—"}</td></tr>`).join("")}</table>` : ""}
${strat ? `<h3 style="font-size:.85rem;margin:.75rem 0 .3rem">Content Strategy</h3><div class="field"><span class="field-label">Topic</span><span class="field-value">${strat.topic}</span></div><div class="field"><span class="field-label">Pillar</span><span class="field-value">${strat.pillar?.title||"—"}</span></div>${strat.clusters?.map((c,i)=>`<div class="field"><span class="field-label">Post ${i+1}</span><span class="field-value">${c.title} (${c.status})</span></div>`).join("")||""}` : ""}`;
}).join("")}

<div class="footer">Exported from RankActions · rankactions.com · ${new Date().toLocaleDateString("en-GB")}</div>
</body></html>`;
      const w = window.open("", "_blank");
      w.document.write(sanitizeAiHtml(html));
      w.document.close();
    };

    // GDPR Article 15 — full server-side data archive download.
    // Different from exportData() above (which is a printable HTML report
    // of client-side state). This pulls everything the server stores about
    // the user as a complete JSON file — required for regulatory compliance.
    const [downloadingArchive, setDownloadingArchive] = useState(false);
    const downloadGdprArchive = async () => {
      setDownloadingArchive(true);
      try {
        const res = await authFetch(`${WORKER_URL}/api/me/export`);
        if (!res.ok) {
          alert("Couldn't generate your data archive — please try again or contact hello@rankactions.com");
          setDownloadingArchive(false);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `rankactions-data-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        alert("Couldn't generate your data archive — please try again or contact hello@rankactions.com");
      }
      setDownloadingArchive(false);
    };

    const sectionStyle = {background:"var(--card)",border:"1px solid var(--b2)",borderRadius:12,padding:"1.5rem",marginBottom:"1rem"};
    const labelStyle = {fontSize:".72rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text3)",marginBottom:".75rem"};
    const rowStyle = {display:"flex",justifyContent:"space-between",alignItems:"center",padding:".6rem 0",borderBottom:"1px solid var(--b2)"};
    const valStyle = {fontSize:".88rem",color:"var(--text1)"};
    const subStyle = {fontSize:".78rem",color:"var(--text3)"};
    const btnStyle = {fontSize:".78rem",padding:".4rem .8rem",borderRadius:6,border:"1px solid var(--b2)",background:"transparent",color:"var(--text2)",cursor:"pointer",fontFamily:"inherit"};
    const dangerBtn = {...btnStyle, borderColor:"var(--red)", color:"var(--red)"};

    return (
      <div className="content" style={{maxWidth:700}}>
        <div className="page-head">
          <div className="page-title">Settings</div>
          <div className="page-sub">Manage your account, connected sites and preferences</div>
        </div>

        {/* Account */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Account</div>
          <div style={rowStyle}>
            <div><div style={valStyle}>{user?.fullName || user?.primaryEmailAddress?.emailAddress || "—"}</div><div style={subStyle}>Name</div></div>
          </div>
          <div style={rowStyle}>
            <div><div style={valStyle}>{user?.primaryEmailAddress?.emailAddress || "—"}</div><div style={subStyle}>Email</div></div>
          </div>
          <div style={{...rowStyle,borderBottom:"none"}}>
            <div><div style={valStyle}><span className={`plan-pill ${plan==="pro"||plan==="business"?"pro":plan==="agency"?"agency":plan==="starter"||plan==="individual"?"starter":""}`} style={{fontSize:".75rem"}}>{planLabel(plan)}</span></div><div style={subStyle}>Current plan</div></div>
            <div style={{display:"flex",gap:".5rem"}}>
              {isPro ? (
                <button style={btnStyle} onClick={openBillingPortal}>Manage subscription</button>
              ) : (
                <button style={{...btnStyle,color:"var(--green)",borderColor:"var(--green)"}} onClick={()=>setShowUpgrade(true)}>Upgrade</button>
              )}
            </div>
          </div>
        </div>

        {/* Connected sites */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Connected Sites</div>
          {sites.map(s => (
            <div key={s} style={{...rowStyle,borderBottom:"1px solid var(--b2)"}}>
              <div>
                <div style={valStyle}>🌐 {typeof s === "string" ? s.replace(/^https?:\/\//,"").replace(/\/$/,"") : s}</div>
                <div style={subStyle}>{s === selectedSite ? "Currently active" : "Inactive"}</div>
              </div>
              <div style={{display:"flex",gap:".5rem"}}>
                {s !== selectedSite && (
                  <button style={btnStyle} onClick={()=>{setSelectedSite(s);localStorage.setItem("rankactions_selectedSite",s);setSiteData(null);setAiSummary(null);}}>Switch to</button>
                )}
                {sites.length > 1 && (
                  <button style={{...btnStyle,color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>removeSite(s)}>Remove</button>
                )}
              </div>
            </div>
          ))}
          <div style={{paddingTop:".75rem"}}>
            <button style={{...btnStyle,color:"var(--green)",borderColor:"var(--green)"}} onClick={()=>{setScreen("dashboard");setTimeout(()=>{setSiteOpen(true);setTimeout(()=>addSite(),100);},100);}}>+ Add site</button>
          </div>
        </div>

        {/* Google connection */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Google Connection</div>
          <div style={{...rowStyle,borderBottom:"none"}}>
            <div>
              <div style={valStyle}>{isConnected ? "✓ Connected" : "✕ Not connected"}</div>
              <div style={subStyle}>{isConnected ? "Read-only access to Google Search Console" : "Connect to pull live SEO data"}</div>
            </div>
            {isConnected ? (
              <button style={dangerBtn} onClick={disconnectGoogle}>Disconnect</button>
            ) : (
              <button style={{...btnStyle,color:"var(--green)",borderColor:"var(--green)"}} onClick={startGoogleOAuth}>Connect Google</button>
            )}
          </div>
        </div>

        {/* Help */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Help</div>
          <div style={{...rowStyle,borderBottom:"none"}}>
            <div><div style={valStyle}>Onboarding tour</div><div style={subStyle}>Replay the guided tour of the app</div></div>
            <button style={btnStyle} onClick={()=>{localStorage.removeItem("ra_tour_complete");setScreen("dashboard");setTimeout(()=>setShowTour(true),500);}}>Replay tour</button>
          </div>
        </div>

        {/* Privacy & cookies */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Privacy & Cookies</div>
          <div style={rowStyle}>
            <div><div style={valStyle}>Cookie preferences</div><div style={subStyle}>{localStorage.getItem("ra_cookies_accepted") === "all" ? "All cookies accepted" : localStorage.getItem("ra_cookies_accepted") === "essential" ? "Essential only" : "Not set"}</div></div>
            <button style={btnStyle} onClick={()=>{localStorage.removeItem("ra_cookies_accepted");window.location.reload();}}>Reset</button>
          </div>
          <div style={{...rowStyle,borderBottom:"none"}}>
            <div><div style={valStyle}>Privacy Policy</div><div style={subStyle}>View how we handle your data</div></div>
            <a href="https://rankactions.com/privacy.html" target="_blank" rel="noopener noreferrer" style={{...btnStyle,textDecoration:"none"}}>View</a>
          </div>
        </div>

        {/* Data management */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Data Management</div>
          <div style={rowStyle}>
            <div><div style={valStyle}>Export your data</div><div style={subStyle}>Printable summary of your sites, fixes, content and strategy</div></div>
            <button style={btnStyle} onClick={exportData}>Export</button>
          </div>
          <div style={rowStyle}>
            <div><div style={valStyle}>Back up your work</div><div style={subStyle}>Download a JSON backup of your saved data. Keep it safe — you can restore it if you clear your browser or switch devices.</div></div>
            <button style={btnStyle} onClick={backupLocalData}>Back up</button>
          </div>
          <div style={rowStyle}>
            <div><div style={valStyle}>Restore from backup</div><div style={subStyle}>Import a previously downloaded backup file to restore your saved data in this browser.</div></div>
            <button style={btnStyle} onClick={()=>document.getElementById("ra-restore-input").click()}>Restore</button>
            <input id="ra-restore-input" type="file" accept="application/json,.json" style={{display:"none"}} onChange={(e)=>{ const f=e.target.files&&e.target.files[0]; restoreLocalData(f); e.target.value=""; }} />
          </div>
          <div style={rowStyle}>
            <div><div style={valStyle}>Download data archive (GDPR)</div><div style={subStyle}>Complete JSON of everything we hold about you — for your records or to take to another service</div></div>
            <button style={btnStyle} onClick={downloadGdprArchive} disabled={downloadingArchive}>
              {downloadingArchive ? "Generating…" : "Download"}
            </button>
          </div>
          <div style={{...rowStyle,borderBottom:"none"}}>
            <div><div style={valStyle}>Delete account</div><div style={subStyle}>Permanently remove your account and all data</div></div>
            {!showDeleteConfirm ? (
              <button style={dangerBtn} onClick={()=>setShowDeleteConfirm(true)}>Delete</button>
            ) : (
              <div style={{display:"flex",gap:".5rem",alignItems:"center"}}>
                <span style={{fontSize:".78rem",color:"var(--red)"}}>Are you sure?</span>
                <button style={dangerBtn} onClick={deleteMyAccount}>Yes, delete</button>
                <button style={btnStyle} onClick={()=>setShowDeleteConfirm(false)}>Cancel</button>
              </div>
            )}
          </div>
        </div>

        <div style={{fontSize:".75rem",color:"var(--text3)",textAlign:"center",padding:"1rem 0"}}>
          RankActions by E2E Integration · <a href="https://rankactions.com/privacy.html" target="_blank" rel="noopener" style={{color:"var(--text3)"}}>Privacy Policy</a> · <a href="mailto:hello@rankactions.com" style={{color:"var(--text3)"}}>hello@rankactions.com</a>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // RANK TRACKER
  // ─────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  // RANK TRACKER (Phase 2)
  // Parent component manages tab state. Two sub-components:
  // - RankTrackerTrackedTab: pinned keywords via DataForSEO (Phase 2)
  // - RankTrackerDiscoveredTab: GSC snapshot view (existing system)
  // ─────────────────────────────────────────────────────────────

  // Pinned-keyword tab (Phase 2). Data layer here; visuals come in
  // subsequent steps (12c–f). Uses /api/tracker/* endpoints we built.
  const RankTrackerTrackedTab = () => {
    const [trackedKeywords, setTrackedKeywords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filterStriking, setFilterStriking] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [addInput, setAddInput] = useState("");
    const [adding, setAdding] = useState(false);
    const [addError, setAddError] = useState(null);
    const [checkingId, setCheckingId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    const [usage, setUsage] = useState(null);  // { used, limit, remaining }
    const [limit, setLimit] = useState(null);  // tracked-keywords limit from server

    const loadedSite = useRef(null);

    // Resolve siteUrl in the same shape the API expects (matches existing tracker pattern)
    const siteUrl = (() => {
      if (!selectedSite) return "";
      if (selectedSite.startsWith("sc-domain:")) return `https://${selectedSite.replace("sc-domain:","")}`;
      if (selectedSite.startsWith("http")) return selectedSite;
      return `https://${selectedSite}`;
    })();

    useEffect(() => {
      if (loadedSite.current === selectedSite) return;
      loadedSite.current = selectedSite;
      const load = async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await authFetch(`${WORKER_URL}/api/tracker/keywords?siteUrl=${encodeURIComponent(siteUrl)}`);
          const data = await res.json();
          if (!res.ok) {
            setError(data.error || `Failed to load (${res.status})`);
            setTrackedKeywords([]);
            return;
          }
          setTrackedKeywords(data.keywords || []);
          setLimit(data.limit ?? null);
        } catch (e) {
          setError(e.message || "Network error");
          setTrackedKeywords([]);
        } finally {
          setLoading(false);
        }
      };
      load();
    }, [selectedSite]);

    // Refresh just the keyword list (after add / remove / check-now)
    const refreshList = async () => {
      try {
        const res = await authFetch(`${WORKER_URL}/api/tracker/keywords?siteUrl=${encodeURIComponent(siteUrl)}`);
        const data = await res.json();
        if (res.ok) {
          setTrackedKeywords(data.keywords || []);
          setLimit(data.limit ?? null);
        }
      } catch {}
    };

    const handleAdd = async () => {
      const lines = addInput.split("\n").map(l => l.trim()).filter(l => l);
      if (lines.length === 0) {
        setAddError("Enter at least one keyword.");
        return;
      }
      setAdding(true);
      setAddError(null);
      try {
        const res = await authFetch(`${WORKER_URL}/api/tracker/keywords`, {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ siteUrl, keywords: lines }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 403 && data.upgrade) {
            setAddError(`${data.error} — upgrade for more.`);
          } else if (res.status === 409) {
            setAddError("All those keywords are already tracked for this site.");
          } else {
            setAddError(data.error || `Add failed (${res.status})`);
          }
          return;
        }
        setAddInput("");
        setShowAddForm(false);
        // Re-fetch with full enrichment (latest/delta/sparkline) — the POST
        // response only includes raw keyword records without history fields.
        await refreshList();
      } catch (e) {
        setAddError(e.message || "Network error");
      } finally {
        setAdding(false);
      }
    };

    const handleRemove = async (kwId, keywordLabel) => {
      if (!confirm(`Remove "${keywordLabel}" and its rank history?`)) return;
      setDeletingId(kwId);
      try {
        const res = await authFetch(`${WORKER_URL}/api/tracker/keywords`, {
          method: "DELETE",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ ids: [kwId] }),
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || `Remove failed (${res.status})`);
          return;
        }
        // Re-fetch with full enrichment (latest/delta/sparkline) — the DELETE
        // response only includes raw keyword records without history fields.
        await refreshList();
      } catch (e) {
        alert(e.message || "Network error");
      } finally {
        setDeletingId(null);
      }
    };

    const handleCheckNow = async (kwId) => {
      setCheckingId(kwId);
      try {
        const res = await authFetch(`${WORKER_URL}/api/tracker/check-now`, {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ kwId }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 429 && data.limit !== undefined) {
            alert(`Out of on-demand checks this month (${data.currentUsage}/${data.limit} used).`);
          } else if (res.status === 403 && data.upgrade) {
            alert("On-demand checks require Pro or Agency plan.");
          } else {
            alert(data.error || `Check failed (${res.status})`);
          }
          return;
        }
        setUsage({ used: data.usage, limit: data.limit, remaining: data.remaining });
        await refreshList();  // pick up new latest point in the list
      } catch (e) {
        alert(e.message || "Network error");
      } finally {
        setCheckingId(null);
      }
    };

    // Striking distance = positions 11-30 (page 2 territory — focused effort can move these)
    const visibleKeywords = filterStriking
      ? trackedKeywords.filter(kw => kw.latest?.position != null && kw.latest.position >= 11 && kw.latest.position <= 30)
      : trackedKeywords;

    // ── Cell renderers ──────────────────────────────────────
    const renderPosition = (pos) => {
      if (pos == null) return <span style={{color:"var(--text3)",fontSize:".78rem"}}>100+</span>;
      const color = pos <= 10 ? "var(--green)" : pos <= 20 ? "#b85c00" : "#f03e5f";
      return <span style={{color,fontWeight:700,fontFamily:"monospace",fontSize:".85rem"}}>#{pos}</span>;
    };

    const renderDelta = (delta) => {
      if (delta == null) return <span style={{color:"var(--text3)",fontSize:".78rem"}}>—</span>;
      if (delta > 0)  return <span style={{color:"var(--green)",fontWeight:600,fontSize:".78rem"}}>↑{delta}</span>;
      if (delta < 0)  return <span style={{color:"#f03e5f",fontWeight:600,fontSize:".78rem"}}>↓{Math.abs(delta)}</span>;
      return <span style={{color:"var(--text3)",fontSize:".78rem"}}>→</span>;
    };

    // Compact 100×30 SVG sparkline of the last ~12 history points.
    // Null positions ("not in top 100") are skipped — line connects only ranked checks.
    const renderSparkline = (points) => {
      const valid = (points || []).filter(p => p.position != null);
      if (valid.length < 2) {
        return <div style={{color:"var(--text3)",fontSize:".7rem",lineHeight:"30px"}}>—</div>;
      }
      const w = 100, h = 30;
      const positions = valid.map(p => p.position);
      const maxP = Math.max(...positions, 30);
      const minP = Math.min(...positions, 1);
      const range = Math.max(maxP - minP, 5);
      const pts = valid.map((p, i) => ({
        x: (i / (valid.length - 1)) * w,
        y: ((p.position - minP) / range) * (h - 4) + 2,  // 2px padding top/bottom
      }));
      const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const last = pts[pts.length - 1];
      // Last point color matches the position-band convention (green/amber/red)
      const lastPos = valid[valid.length - 1].position;
      const dotColor = lastPos <= 10 ? "var(--green)" : lastPos <= 20 ? "#b85c00" : "#f03e5f";
      return (
        <svg viewBox={`0 0 ${w} ${h}`} style={{width:w,height:h,display:"block"}} preserveAspectRatio="none">
          <path d={line} fill="none" stroke="var(--green)" strokeWidth={1.4} strokeLinejoin="round"/>
          <circle cx={last.x} cy={last.y} r={2.2} fill={dotColor}/>
        </svg>
      );
    };

    // Small badge for SERP-feature flags. The AI Overview badge is the
    // only one with two states: amber if present-but-not-cited, green if cited.
    const Badge = ({color, text, title}) => {
      const colors = {
        green: { bg: "rgba(15,219,138,.15)", fg: "#0fdb8a", brd: "rgba(15,219,138,.3)" },
        amber: { bg: "rgba(184,92,0,.15)",   fg: "#e08a3c", brd: "rgba(184,92,0,.35)" },
        blue:  { bg: "rgba(60,120,200,.15)", fg: "#6aa3e8", brd: "rgba(60,120,200,.35)" },
        purple:{ bg: "rgba(140,90,200,.15)", fg: "#b08ee0", brd: "rgba(140,90,200,.35)" },
      }[color] || { bg: "var(--s2)", fg: "var(--text2)", brd: "var(--border)" };
      return (
        <span title={title}
          style={{display:"inline-block",fontSize:".65rem",padding:"1px 6px",
            borderRadius:4,background:colors.bg,color:colors.fg,border:`1px solid ${colors.brd}`,
            fontWeight:600,whiteSpace:"nowrap"}}>
          {text}
        </span>
      );
    };

    const renderFeatures = (kw) => {
      const f = kw.latest?.features;
      const cited = kw.latest?.aiOverviewCited;
      const badges = [];
      if (f?.aiOverview)       badges.push(<Badge key="aio" color={cited ? "green" : "amber"} text="AI Overview" title={cited ? "Google's AI Overview appeared and cited your site" : "Google's AI Overview appeared but did NOT cite your site — an opportunity to optimise content"}/>);
      if (f?.featuredSnippet)  badges.push(<Badge key="fs"  color="purple" text="Featured Snippet" title="Google's answer box appeared above the regular results"/>);
      if (f?.localPack)        badges.push(<Badge key="lp"  color="blue"   text="Local Pack" title="Google's map + nearby business listings appeared (typically for 'near me' queries)"/>);
      if (badges.length === 0) return <span style={{color:"var(--text3)",fontSize:".7rem"}}>—</span>;
      return <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{badges}</div>;
    };

    const renderLastChecked = (kw) => {
      const d = kw.latest?.date;
      if (!d) return <span style={{color:"var(--text3)",fontSize:".7rem"}}>Never</span>;
      const dt = new Date(d);
      return <span style={{color:"var(--text3)",fontSize:".72rem"}}>{dt.toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</span>;
    };

    // ── Render ──────────────────────────────────────────────
    if (loading) {
      return <div style={{textAlign:"center",padding:"3rem",color:"var(--text3)"}}><div className="spinner-sm" style={{margin:"0 auto .75rem"}}/>Loading tracked keywords...</div>;
    }
    if (error) {
      return <div style={{padding:"1rem 1.25rem",background:"rgba(240,62,95,.12)",border:"1px solid rgba(240,62,95,.35)",borderRadius:10,color:"#f03e5f",fontSize:".85rem"}}>Error: {error}</div>;
    }

    // Plan-state derivations
    const planLimit  = limit ?? 0;
    const canAdd     = planLimit > 0;
    const atLimit    = planLimit > 0 && trackedKeywords.length >= planLimit;
    const remaining  = Math.max(0, planLimit - trackedKeywords.length);

    // Empty-state copy varies by plan tier
    const EmptyState = () => (
      <div style={{textAlign:"center",padding:"3rem 1.5rem",background:"var(--s1)",borderRadius:12,border:"1px solid var(--border)"}}>
        <div style={{fontSize:"2rem",marginBottom:".5rem"}}>📌</div>
        <div style={{fontWeight:600,marginBottom:".4rem"}}>No keywords tracked yet</div>
        <div style={{fontSize:".82rem",color:"var(--text3)",maxWidth:440,margin:"0 auto 1rem",lineHeight:1.5}}>
          {canAdd
            ? <>Pin keywords you care about and we'll check their real position in Google every Sunday night. You can track up to <b>{planLimit}</b> keywords on your plan.</>
            : <>Your plan doesn't include tracked keywords. Upgrade to a paid plan to start tracking. Meanwhile, browse the <b>Discovered</b> tab for your existing rankings from Search Console.</>
          }
        </div>
        {canAdd && (
          <button onClick={()=>setShowAddForm(true)}
            style={{
              background:"var(--green)", color:"#fff",
              border:"1px solid var(--green)", borderRadius:6,
              padding:".55rem 1.1rem", fontSize:".85rem", fontWeight:600,
              cursor:"pointer",
            }}>
            + Add your first keyword
          </button>
        )}
      </div>
    );

    return (
      <div>
        {/* Header bar — count, limit, filter toggle, add button */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:".75rem",fontSize:".82rem",flexWrap:"wrap",gap:".5rem"}}>
          <div style={{color:"var(--text3)"}}>
            {trackedKeywords.length === 0
              ? <>0 keywords · limit {planLimit}</>
              : <>{visibleKeywords.length} of {trackedKeywords.length} keyword{trackedKeywords.length===1?"":"s"} · limit {planLimit}</>
            }
            {usage && <span> · on-demand checks: {usage.used}/{usage.limit}</span>}
          </div>
          {canAdd && trackedKeywords.length > 0 && (
            <div style={{display:"flex",gap:".75rem",alignItems:"center"}}>
              <label style={{display:"flex",gap:".35rem",alignItems:"center",cursor:"pointer",fontSize:".78rem",color:"var(--text2)"}}>
                <input type="checkbox" checked={filterStriking} onChange={e=>setFilterStriking(e.target.checked)} style={{cursor:"pointer"}}/>
                <span title="Show only keywords currently ranking on page 2 (positions 11-30)">Striking distance only</span>
              </label>
              <button onClick={()=>{ if (!atLimit) { setShowAddForm(!showAddForm); setAddError(null); } }}
                disabled={atLimit && !showAddForm}
                title={atLimit ? `At plan limit (${planLimit}). Remove a keyword or upgrade to add more.` : undefined}
                style={{
                  background: showAddForm ? "transparent" : atLimit ? "var(--s2)" : "var(--green)",
                  color: showAddForm ? "var(--text2)" : atLimit ? "var(--text3)" : "#fff",
                  border: showAddForm ? "1px solid var(--border)" : atLimit ? "1px solid var(--border)" : "1px solid var(--green)",
                  borderRadius:6, padding:".4rem .85rem", fontSize:".78rem", fontWeight:600,
                  cursor: (atLimit && !showAddForm) ? "not-allowed" : "pointer", whiteSpace:"nowrap",
                  opacity: (atLimit && !showAddForm) ? 0.6 : 1,
                }}>
                {showAddForm ? "Cancel" : atLimit ? `At limit (${planLimit})` : "+ Add keywords"}
              </button>
            </div>
          )}
        </div>

        {/* Help toggle — subtle text link, expands the column key below */}
        {trackedKeywords.length > 0 && (
          <button onClick={()=>setShowHelp(!showHelp)}
            style={{
              background:"transparent", border:"none", cursor:"pointer",
              color:"var(--text3)", fontSize:".74rem", padding:".2rem 0",
              marginBottom:".5rem", textAlign:"left",
              textDecoration:"underline", textDecorationStyle:"dotted", textUnderlineOffset:"3px",
            }}>
            {showHelp ? "✕ Hide column key" : "ⓘ What do these columns mean?"}
          </button>
        )}
        {showHelp && (
          <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:8,padding:".9rem 1.1rem",marginBottom:".75rem",fontSize:".78rem",lineHeight:1.55}}>
            <div style={{fontWeight:600,marginBottom:".55rem",fontSize:".82rem"}}>Column reference</div>
            <div style={{color:"var(--text2)",display:"grid",gridTemplateColumns:"auto 1fr",gap:".4rem .85rem"}}>
              <div style={{fontWeight:600,color:"var(--text1)"}}>Position</div>
              <div>Where your site ranks in Google's <i>live</i> search results (not Search Console averages). <span style={{color:"#0fdb8a",fontWeight:600}}>Green</span> ≤ 10 (page 1) · <span style={{color:"#e08a3c",fontWeight:600}}>amber</span> 11-20 (page 2) · <span style={{color:"#f03e5f",fontWeight:600}}>red</span> below.</div>

              <div style={{fontWeight:600,color:"var(--text1)"}}>Change</div>
              <div>Position movement since the previous check. <span style={{color:"#0fdb8a",fontWeight:600}}>↑ green</span> = climbed (good); <span style={{color:"#f03e5f",fontWeight:600}}>↓ red</span> = dropped.</div>

              <div style={{fontWeight:600,color:"var(--text1)"}}>Trend</div>
              <div>Mini chart of the last 12 checks. Useful for spotting gradual climbs or sudden drops.</div>

              <div style={{fontWeight:600,color:"var(--text1)"}}>Features</div>
              <div>
                Special elements Google shows alongside the regular blue links — these affect how visible your site really is:
                <div style={{paddingLeft:".5rem",marginTop:".35rem",lineHeight:1.7}}>
                  • <b style={{color:"#0fdb8a"}}>AI Overview (green)</b> — Google's AI-generated summary appeared at the top, and your site was one of the sources it cited.<br/>
                  • <b style={{color:"#e08a3c"}}>AI Overview (amber)</b> — AI summary appeared but did <i>not</i> cite your site. Opportunity: optimise content to get cited.<br/>
                  • <b style={{color:"#b08ee0"}}>Featured Snippet</b> — Google's "answer box" appeared above the regular results.<br/>
                  • <b style={{color:"#6aa3e8"}}>Local Pack</b> — Map + nearby business listings (usually shown for "near me" or location-based queries).
                </div>
              </div>

              <div style={{fontWeight:600,color:"var(--text1)"}}>Last checked</div>
              <div>When this keyword was last refreshed. Cron runs every Sunday night automatically.</div>

              <div style={{fontWeight:600,color:"var(--text1)"}}>↻ Check (Pro+)</div>
              <div>Refresh this keyword's position immediately — uses one of your monthly on-demand checks.</div>
            </div>
          </div>
        )}

        {/* Add-keyword form — slides below the header when toggled open */}
        {showAddForm && (
          <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:10,padding:"1rem 1.25rem",marginBottom:"1rem"}}>
            <div style={{fontSize:".82rem",fontWeight:600,marginBottom:".4rem"}}>Add keywords</div>
            <div style={{fontSize:".72rem",color:"var(--text3)",marginBottom:".6rem"}}>
              Enter one keyword per line. Each one gets a real Google SERP check every Sunday night.
              {planLimit > 0 && (
                <span> You can add up to {remaining} more keyword{remaining===1?"":"s"} on your plan.</span>
              )}
            </div>
            <textarea
              value={addInput}
              onChange={e=>setAddInput(e.target.value)}
              placeholder={"data protection consultancy\noutsourced DPO services\ngdpr compliance audit"}
              disabled={adding}
              rows={6}
              style={{
                width:"100%", boxSizing:"border-box",
                background:"var(--s2)", color:"var(--text1)",
                border:"1px solid var(--border)", borderRadius:6,
                padding:".55rem .7rem", fontSize:".82rem", fontFamily:"inherit",
                resize:"vertical", outline:"none",
              }}
            />
            {addError && (
              <div style={{marginTop:".5rem",padding:".5rem .65rem",background:"rgba(240,62,95,.12)",border:"1px solid rgba(240,62,95,.35)",borderRadius:6,color:"#f03e5f",fontSize:".75rem"}}>
                {addError}
              </div>
            )}
            <div style={{display:"flex",gap:".5rem",justifyContent:"flex-end",marginTop:".75rem"}}>
              <button onClick={()=>{ setShowAddForm(false); setAddInput(""); setAddError(null); }}
                disabled={adding}
                style={{
                  background:"transparent", color:"var(--text2)",
                  border:"1px solid var(--border)", borderRadius:6,
                  padding:".4rem .85rem", fontSize:".78rem", cursor: adding ? "not-allowed" : "pointer", opacity: adding ? 0.5 : 1,
                }}>
                Cancel
              </button>
              <button onClick={handleAdd}
                disabled={adding || !addInput.trim()}
                style={{
                  background:"var(--green)", color:"#fff",
                  border:"1px solid var(--green)", borderRadius:6,
                  padding:".4rem .85rem", fontSize:".78rem", fontWeight:600,
                  cursor: (adding || !addInput.trim()) ? "not-allowed" : "pointer",
                  opacity: (adding || !addInput.trim()) ? 0.6 : 1,
                }}>
                {adding ? "Adding..." : "Add keywords"}
              </button>
            </div>
          </div>
        )}

        {/* Body — either empty state or keyword table */}
        {trackedKeywords.length === 0 ? <EmptyState/> : (
          <div style={{background:"var(--s1)",borderRadius:12,border:"1px solid var(--border)",overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:".82rem"}}>
              <thead>
                <tr style={{borderBottom:"1px solid var(--border)",background:"var(--s2)"}}>
                  <th style={{padding:".55rem .85rem",textAlign:"left",fontWeight:600,color:"var(--text3)",fontSize:".72rem",textTransform:"uppercase",letterSpacing:".03em"}}>Keyword</th>
                  <th title="Where your site ranks in Google's live search results"
                      style={{padding:".55rem .65rem",textAlign:"center",fontWeight:600,color:"var(--text3)",fontSize:".72rem",textTransform:"uppercase",letterSpacing:".03em"}}>Position</th>
                  <th title="Position movement since the previous check"
                      style={{padding:".55rem .65rem",textAlign:"center",fontWeight:600,color:"var(--text3)",fontSize:".72rem",textTransform:"uppercase",letterSpacing:".03em"}}>Change</th>
                  <th title="Mini chart of the last 12 checks"
                      style={{padding:".55rem .65rem",textAlign:"center",fontWeight:600,color:"var(--text3)",fontSize:".72rem",textTransform:"uppercase",letterSpacing:".03em"}}>Trend</th>
                  <th title="Special Google features (AI Overview, Featured Snippet, Local Pack) that appeared alongside the regular results"
                      style={{padding:".55rem .65rem",textAlign:"left",fontWeight:600,color:"var(--text3)",fontSize:".72rem",textTransform:"uppercase",letterSpacing:".03em"}}>Features</th>
                  <th title="When this keyword was last checked"
                      style={{padding:".55rem .65rem",textAlign:"left",fontWeight:600,color:"var(--text3)",fontSize:".72rem",textTransform:"uppercase",letterSpacing:".03em"}}>Last checked</th>
                  <th style={{padding:".55rem .65rem",textAlign:"right",fontWeight:600,color:"var(--text3)",fontSize:".72rem",textTransform:"uppercase",letterSpacing:".03em"}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleKeywords.length === 0 ? (
                  <tr><td colSpan={7} style={{padding:"1.5rem",textAlign:"center",color:"var(--text3)",fontSize:".82rem"}}>
                    No keywords match the striking-distance filter. Untick to see all.
                  </td></tr>
                ) : visibleKeywords.map(kw => (
                  <tr key={kw.id} style={{borderBottom:"1px solid var(--b2)"}}>
                    <td style={{padding:".6rem .85rem"}}>
                      <div style={{fontWeight:600,fontSize:".82rem"}}>{kw.keyword}</div>
                      {kw.latest?.url && <a href={kw.latest.url} target="_blank" rel="noopener" style={{fontSize:".68rem",color:"var(--text3)",textDecoration:"none",display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:280}}>{kw.latest.url}</a>}
                    </td>
                    <td style={{padding:".6rem .65rem",textAlign:"center"}}>{renderPosition(kw.latest?.position)}</td>
                    <td style={{padding:".6rem .65rem",textAlign:"center"}}>{renderDelta(kw.delta)}</td>
                    <td style={{padding:".6rem .65rem",textAlign:"center",width:110}}>{renderSparkline(kw.sparkline)}</td>
                    <td style={{padding:".6rem .65rem"}}>{renderFeatures(kw)}</td>
                    <td style={{padding:".6rem .65rem"}}>{renderLastChecked(kw)}</td>
                    <td style={{padding:".6rem .65rem",textAlign:"right",whiteSpace:"nowrap"}}>
                      <div style={{display:"inline-flex",gap:".35rem",justifyContent:"flex-end",alignItems:"center"}}>
                        {isPro && (
                          <button onClick={()=>handleCheckNow(kw.id)}
                            disabled={checkingId === kw.id || deletingId === kw.id}
                            title="Refresh this keyword's position now (uses one on-demand check from your monthly quota)"
                            style={{
                              background:"transparent", color: checkingId===kw.id ? "var(--text3)" : "var(--text2)",
                              border:"1px solid var(--border)", borderRadius:5,
                              padding:".22rem .55rem", fontSize:".7rem", fontWeight:500,
                              cursor: (checkingId===kw.id || deletingId===kw.id) ? "wait" : "pointer",
                              opacity: (checkingId===kw.id || deletingId===kw.id) ? 0.6 : 1,
                            }}>
                            {checkingId === kw.id ? "Checking…" : "↻ Check"}
                          </button>
                        )}
                        <button onClick={()=>handleRemove(kw.id, kw.keyword)}
                          disabled={checkingId === kw.id || deletingId === kw.id}
                          title="Stop tracking this keyword and delete its history"
                          style={{
                            background:"transparent", color: deletingId===kw.id ? "var(--text3)" : "#f03e5f",
                            border:"1px solid rgba(240,62,95,.3)", borderRadius:5,
                            padding:".22rem .55rem", fontSize:".7rem", fontWeight:500,
                            cursor: (checkingId===kw.id || deletingId===kw.id) ? "wait" : "pointer",
                            opacity: (checkingId===kw.id || deletingId===kw.id) ? 0.6 : 1,
                          }}>
                          {deletingId === kw.id ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // GSC-snapshot tab — existing implementation lifted verbatim, just
  // unwrapped from its outer container (page header moved to parent).
  // Phase 2 step 13 adds a per-row "+ Track" button that pins the keyword
  // into the new tracker system. Free users get the upgrade modal.
  const RankTrackerDiscoveredTab = ({ setActiveTab }) => {
    const [trackedKws, setTrackedKws] = useState([]);
    const [selectedKw, setSelectedKw] = useState(null);
    const [localSnapshots, setLocalSnapshots] = useState([]);
    const [loading, setLoading] = useState(false);
    const [tracking, setTracking] = useState({});  // { [keyword]: true } — in-flight
    const [tracked, setTracked]   = useState({});  // { [keyword]: true } — already pinned (this session or before)
    // Manually hidden keywords — for relevance junk no syntax filter can catch
    // (e.g. construction queries appearing on a GDPR consultancy's GSC data,
    // usually from domain history or stray indexed pages). Persisted per-site.
    // Uses the app-level hidden set so hiding here also removes the keyword from
    // Priority Actions and Keyword Opportunities (and vice versa).
    const [showHidden, setShowHidden] = useState(false);
    const hideKeyword = (keyword) => {
      hideKeywordGlobal(keyword);
      if (selectedKw === keyword) setSelectedKw(null);
    };
    const unhideKeyword = (keyword) => unhideKeywordGlobal(keyword);
    const loadedSite = useRef(null);

    const siteUrl = (() => {
      if (!selectedSite) return "";
      if (selectedSite.startsWith("sc-domain:")) return `https://${selectedSite.replace("sc-domain:","")}`;
      if (selectedSite.startsWith("http")) return selectedSite;
      return `https://${selectedSite}`;
    })();

    useEffect(() => {
      if (loadedSite.current === selectedSite) return;
      loadedSite.current = selectedSite;
      // Hidden keywords are reloaded app-side when the site changes.
      setShowHidden(false);
      const load = async () => {
        setLoading(true);
        try {
          const siteUrlLocal = selectedSite.startsWith("http") || selectedSite.startsWith("sc-domain:") ? selectedSite : `https://${selectedSite}`;
          // Auto-save a snapshot for today
          if (userId) {
            await authFetch(`${WORKER_URL}/api/rank-snapshot/save`, {
              method: "POST", headers: {"Content-Type":"application/json"},
              body: JSON.stringify({ siteUrl: siteUrlLocal })
            }).catch(()=>{});
          }
          // Fetch snapshots
          const res = await authFetch(`${WORKER_URL}/api/rank-snapshots?siteUrl=${encodeURIComponent(siteUrlLocal)}`);
          const data = await res.json();
          if (data.snapshots) {
            setLocalSnapshots(data.snapshots);
            const kwMap = {};
            data.snapshots.forEach(snap => {
              // Historical snapshots may contain GSC noise stored before
              // server-side filtering existed (operator strings, verbatim
              // questions) — apply the same guard on display.
              snap.keywords.filter(k => isUsableKeyword(k.keyword)).forEach(k => {
                if (!kwMap[k.keyword]) kwMap[k.keyword] = { keyword: k.keyword, history: [] };
                kwMap[k.keyword].history.push({ date: snap.date, position: k.position, clicks: k.clicks, impressions: k.impressions });
              });
            });
            const sorted = Object.values(kwMap).sort((a,b) => b.history.length - a.history.length);
            setTrackedKws(sorted);
            if (sorted.length > 0) setSelectedKw(sorted[0].keyword);
          }
          // Also fetch the user's pinned keywords so we can mark already-tracked ones
          const pinnedRes = await authFetch(`${WORKER_URL}/api/tracker/keywords?siteUrl=${encodeURIComponent(siteUrl)}`).catch(()=>null);
          if (pinnedRes && pinnedRes.ok) {
            const pinnedData = await pinnedRes.json();
            const map = {};
            (pinnedData.keywords || []).forEach(kw => { map[kw.keyword.toLowerCase()] = true; });
            setTracked(map);
          }
        } catch {}
        setLoading(false);
      };
      load();
    }, [selectedSite]);

    const trackKeyword = async (keyword) => {
      // Free tier (no tracked-keyword allowance) → upgrade modal, not API call
      if (!isStarter) {
        setShowUpgrade(true);
        return;
      }
      const lookup = keyword.toLowerCase();
      if (tracked[lookup] || tracking[lookup]) return;
      setTracking(prev => ({...prev, [lookup]: true}));
      try {
        const res = await authFetch(`${WORKER_URL}/api/tracker/keywords`, {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ siteUrl, keywords: [keyword] }),
        });
        const data = await res.json();
        if (res.ok) {
          setTracked(prev => ({...prev, [lookup]: true}));
          // Deliberately DO NOT switch tabs here. This used to jump to the Tracked
          // tab 600ms after each success, so users could only add one keyword per
          // visit and had to navigate back for the next — painful for agencies
          // working through a long Discovered list. The button's own "✓ Tracked"
          // state is sufficient confirmation; staying put lets them add several
          // in a row and switch tabs when they choose.
        } else if (res.status === 403 && data.upgrade) {
          setShowUpgrade(true);
        } else if (res.status === 409) {
          // Already tracked — treat as success
          setTracked(prev => ({...prev, [lookup]: true}));
        } else {
          alert(data.error || `Track failed (${res.status})`);
        }
      } catch (e) {
        alert(e.message || "Network error");
      } finally {
        setTracking(prev => { const next = {...prev}; delete next[lookup]; return next; });
      }
    };

    const getChange = (kw) => {
      const h = trackedKws.find(t => t.keyword === kw)?.history || [];
      if (h.length < 2) return null;
      return parseFloat((h[h.length-2].position - h[h.length-1].position).toFixed(1));
    };

    const kwData = trackedKws.find(t => t.keyword === selectedKw);
    const history = kwData?.history || [];

    const renderChart = () => {
      if (history.length < 2) return <div style={{textAlign:"center",padding:"2rem",color:"var(--text3)",fontSize:".85rem"}}>Need at least 2 snapshots to show a chart. Data is captured weekly — check back next week.</div>;
      const w=700,h=220,pL=50,pR=20,pT=20,pB=40;
      const positions = history.map(d=>d.position);
      const maxP = Math.max(...positions,30), minP = Math.min(...positions,1), range = Math.max(maxP-minP,5);
      const cW=w-pL-pR, cH=h-pT-pB;
      const invertPts = history.map((d,i)=>({ x:pL+(i/(history.length-1))*cW, y:pT+((d.position-minP)/range)*cH }));
      const line = invertPts.map((p,i)=>`${i===0?"M":"L"}${p.x},${p.y}`).join(" ");
      const area = `${line} L${invertPts[invertPts.length-1].x},${pT+cH} L${invertPts[0].x},${pT+cH} Z`;
      return (
        <svg viewBox={`0 0 ${w} ${h}`} style={{width:"100%",maxWidth:700,background:"var(--s1)",borderRadius:10,border:"1px solid var(--border)"}}>
          {[0,.25,.5,.75,1].map((pct,i)=>{
            const y=pT+pct*cH, pos=Math.round(minP+pct*range);
            return <g key={i}><line x1={pL} y1={y} x2={w-pR} y2={y} stroke="var(--border)" strokeWidth={.5}/>
              <text x={pL-8} y={y+4} textAnchor="end" fill="var(--text3)" fontSize={10}>#{pos}</text></g>;
          })}
          <path d={area} fill="rgba(10,124,78,.08)"/>
          <path d={line} fill="none" stroke="#0A7C4E" strokeWidth={2.5} strokeLinejoin="round"/>
          {invertPts.map((p,i)=>(
            <g key={i}><circle cx={p.x} cy={p.y} r={4} fill="#0A7C4E" stroke="var(--s1)" strokeWidth={2}/>
              <text x={p.x} y={pT+cH+16} textAnchor="middle" fill="var(--text3)" fontSize={9}>{history[i].date.slice(5)}</text></g>
          ))}
        </svg>
      );
    };

    return (
      <div>
        <div style={{fontSize:".78rem",color:"var(--text3)",marginBottom:".35rem"}}>{localSnapshots.length} snapshots · {trackedKws.length} keywords discovered from Search Console</div>
        <div style={{fontSize:".72rem",color:"var(--text3)",marginBottom:"1rem",lineHeight:1.5}}>
          These are real searches where your site appeared in Google, straight from your Search Console data — some may surprise you. If one isn't relevant to your business, hide it with the ✕.
        </div>
        {loading ? (
          <div style={{textAlign:"center",padding:"3rem",color:"var(--text3)"}}><div className="spinner-sm" style={{margin:"0 auto .75rem"}}/>Loading rank history...</div>
        ) : trackedKws.length === 0 ? (
          <div style={{textAlign:"center",padding:"3rem",background:"var(--s1)",borderRadius:12,border:"1px solid var(--border)"}}>
            <div style={{fontSize:"2rem",marginBottom:".5rem"}}>🔍</div>
            <div style={{fontWeight:600,marginBottom:".4rem"}}>No rank data yet</div>
            <div style={{fontSize:".82rem",color:"var(--text3)",maxWidth:400,margin:"0 auto"}}>
              RankActions captures keywords from Search Console automatically. Your first snapshot will appear after your next Monday digest, or reload this page to capture one now.
            </div>
          </div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"320px 1fr",gap:"1.5rem",alignItems:"start"}}>
            <div style={{background:"var(--s1)",borderRadius:12,border:"1px solid var(--border)",overflow:"hidden"}}>
              <div style={{padding:".65rem 1rem",borderBottom:"1px solid var(--border)",fontWeight:600,fontSize:".78rem",color:"var(--text3)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:".5rem"}}>
                <span>Keywords ({trackedKws.filter(kw=>!hiddenKws.has(kw.keyword)).length})</span>
                {hiddenKws.size > 0 && (
                  <button onClick={()=>setShowHidden(s=>!s)}
                    style={{background:"transparent",border:"none",color:"var(--blue)",fontSize:".68rem",fontWeight:600,cursor:"pointer",fontFamily:"inherit",padding:0}}>
                    {showHidden ? "Hide hidden" : `Show hidden (${hiddenKws.size})`}
                  </button>
                )}
              </div>
              <div style={{maxHeight:480,overflow:"auto"}}>
                {trackedKws.filter(kw => showHidden || !hiddenKws.has(kw.keyword)).map(kw=>{
                  const ch = getChange(kw.keyword);
                  const latest = kw.history[kw.history.length-1];
                  const lookup = kw.keyword.toLowerCase();
                  const isTracked  = !!tracked[lookup];
                  const isTracking = !!tracking[lookup];
                  const isHidden   = hiddenKws.has(kw.keyword);
                  return (
                    <div key={kw.keyword} onClick={()=>setSelectedKw(kw.keyword)}
                      style={{padding:".5rem .85rem",cursor:"pointer",borderBottom:"1px solid var(--b2)",
                        background:selectedKw===kw.keyword?"var(--s2)":"transparent",
                        borderLeft:selectedKw===kw.keyword?"3px solid var(--green)":"3px solid transparent",
                        display:"flex",alignItems:"center",gap:".5rem",
                        opacity: isHidden ? .5 : 1}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:".78rem",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{kw.keyword}</div>
                        <div style={{display:"flex",gap:".6rem",fontSize:".68rem",color:"var(--text3)"}}>
                          <span>#{latest.position}</span>
                          {ch!==null && <span style={{color:ch>0?"var(--green)":ch<0?"#f03e5f":"var(--text3)",fontWeight:600}}>{ch>0?`↑${ch}`:ch<0?`↓${Math.abs(ch)}`:"→"}</span>}
                          <span>{kw.history.length}wk</span>
                        </div>
                      </div>
                      {isHidden ? (
                        <button onClick={(e)=>{ e.stopPropagation(); unhideKeyword(kw.keyword); }}
                          title="Show this keyword again"
                          style={{background:"transparent",color:"var(--blue)",border:"1px solid var(--border)",borderRadius:5,padding:".2rem .5rem",fontSize:".66rem",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                          Unhide
                        </button>
                      ) : (
                      <button onClick={(e)=>{ e.stopPropagation(); trackKeyword(kw.keyword); }}
                        disabled={isTracked || isTracking}
                        title={isTracked ? "Already tracked — view in Tracked tab" : isStarter ? "Pin this keyword to track its real position weekly" : "Upgrade to a paid plan to track keywords"}
                        style={{
                          background: isTracked ? "transparent" : "transparent",
                          color: isTracked ? "var(--green)" : isTracking ? "var(--text3)" : isStarter ? "var(--green)" : "var(--text3)",
                          border: `1px solid ${isTracked ? "rgba(15,219,138,.35)" : "var(--border)"}`,
                          borderRadius:5, padding:".2rem .5rem", fontSize:".66rem", fontWeight:600,
                          cursor: isTracked ? "default" : isTracking ? "wait" : "pointer",
                          whiteSpace:"nowrap", flexShrink:0,
                          opacity: isTracking ? 0.6 : 1,
                        }}>
                        {isTracked ? "✓ Tracked" : isTracking ? "..." : "+ Track"}
                      </button>
                      )}
                      {!isHidden && (
                        <button onClick={(e)=>{ e.stopPropagation(); hideKeyword(kw.keyword); }}
                          title="Hide — not relevant to my business"
                          style={{background:"transparent",color:"var(--text3)",border:"none",borderRadius:5,padding:".2rem .3rem",fontSize:".72rem",cursor:"pointer",flexShrink:0,lineHeight:1}}>
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              {selectedKw && <>
                <div style={{marginBottom:"1rem"}}>
                  <div style={{fontSize:"1.05rem",fontWeight:700,marginBottom:".2rem"}}>{selectedKw}</div>
                  {history.length>=2 && (()=>{
                    const diff=parseFloat((history[0].position-history[history.length-1].position).toFixed(1));
                    return <div style={{fontSize:".8rem",color:diff>0?"var(--green)":diff<0?"#f03e5f":"var(--text3)"}}>
                      {diff>0?`↑ Improved ${diff} positions`:diff<0?`↓ Dropped ${Math.abs(diff)} positions`:"→ No change"} since {history[0].date}
                    </div>;
                  })()}
                </div>
                {renderChart()}
                <div style={{marginTop:"1rem",background:"var(--s1)",borderRadius:10,border:"1px solid var(--border)",overflow:"hidden"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:".75rem"}}>
                    <thead><tr style={{borderBottom:"1px solid var(--border)"}}>
                      <th style={{padding:".45rem .65rem",textAlign:"left",color:"var(--text3)",fontWeight:600}}>Date</th>
                      <th style={{padding:".45rem .65rem",textAlign:"right",color:"var(--text3)",fontWeight:600}}>Position</th>
                      <th style={{padding:".45rem .65rem",textAlign:"right",color:"var(--text3)",fontWeight:600}}>Change</th>
                      <th style={{padding:".45rem .65rem",textAlign:"right",color:"var(--text3)",fontWeight:600}}>Clicks</th>
                      <th style={{padding:".45rem .65rem",textAlign:"right",color:"var(--text3)",fontWeight:600}}>Impr.</th>
                    </tr></thead>
                    <tbody>{[...history].reverse().map((d,i,arr)=>{
                      const prev=arr[i+1]; const ch=prev?parseFloat((prev.position-d.position).toFixed(1)):null;
                      return <tr key={d.date} style={{borderBottom:"1px solid var(--b2)"}}>
                        <td style={{padding:".4rem .65rem"}}>{new Date(d.date).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</td>
                        <td style={{padding:".4rem .65rem",textAlign:"right",fontWeight:700,fontFamily:"monospace",color:d.position<=10?"var(--green)":d.position<=20?"#b85c00":"#f03e5f"}}>#{d.position}</td>
                        <td style={{padding:".4rem .65rem",textAlign:"right",fontWeight:600,color:ch===null?"var(--text3)":ch>0?"var(--green)":ch<0?"#f03e5f":"var(--text3)"}}>{ch===null?"—":ch>0?`↑${ch}`:ch<0?`↓${Math.abs(ch)}`:"→"}</td>
                        <td style={{padding:".4rem .65rem",textAlign:"right"}}>{d.clicks}</td>
                        <td style={{padding:".4rem .65rem",textAlign:"right",color:"var(--text3)"}}>{d.impressions}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              </>}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Parent — owns tab state, renders page header and tab switcher
  const RankTracker = () => {
    const [activeTab, setActiveTab] = useState('tracked');
    return (
      <div className="content" style={{padding:"1.5rem 2rem",maxWidth:1100}}>
        <div style={{marginBottom:"1rem"}}>
          <div style={{fontSize:"1.3rem",fontWeight:700}}><Tip term="rankTracker">Rank Tracker</Tip></div>
          <div style={{fontSize:".82rem",color:"var(--text3)"}}>{displaySite(selectedSite)}</div>
        </div>
        <div style={{display:"flex",gap:0,borderBottom:"1px solid var(--border)",marginBottom:"1.5rem"}}>
          {[
            {id:'tracked',    label:'📌 Tracked keywords'},
            {id:'discovered', label:'🔍 Discovered from Search Console'},
          ].map(tab => (
            <button key={tab.id} onClick={()=>setActiveTab(tab.id)}
              style={{
                background:"transparent",border:"none",cursor:"pointer",
                padding:".65rem 1rem",fontSize:".85rem",
                color: activeTab===tab.id ? "var(--text1)" : "var(--text3)",
                fontWeight: activeTab===tab.id ? 700 : 500,
                borderBottom: activeTab===tab.id ? "2px solid var(--green)" : "2px solid transparent",
                marginBottom:"-1px",
              }}>
              {tab.label}
            </button>
          ))}
        </div>
        {activeTab === 'tracked' ? <RankTrackerTrackedTab/> : <RankTrackerDiscoveredTab setActiveTab={setActiveTab}/>}
      </div>
    );
  };


  // ─────────────────────────────────────────────────────────────
  // PAGE AUDIT
  // ─────────────────────────────────────────────────────────────
  const PageAudit = () => {
    // Compute the URL the audit field should default to for a given site.
    // Centralises the protocol + sc-domain: handling so the initial value
    // and the on-site-change reset can't drift apart.
    const urlForSite = (site) => {
      if (!site) return "";
      if (site.startsWith("sc-domain:")) return `https://${site.replace("sc-domain:","")}`;
      if (site.startsWith("http")) return site;
      return `https://${site}`;
    };

    const [url, setUrl] = useState(auditUrl || urlForSite(selectedSite));

    // Track which site this component last *observed* in state. Initialised
    // to selectedSite so first mount is treated as a no-op — we only act
    // when the site actually changes, never on initial render. Same pattern
    // as RankTracker's loadedSite ref.
    const observedSite = useRef(selectedSite);

    useEffect(() => {
      if (observedSite.current === selectedSite) return;
      observedSite.current = selectedSite;
      // Site genuinely changed — point the URL field at the new site and
      // clear stale audit/perf scores so the user can't accidentally read
      // results from the previous site.
      setUrl(urlForSite(selectedSite));
      setAuditData(null);
      setPerfData(null);
      setAuditUrl("");
    }, [selectedSite]);

    const runAudit = async () => {
      if (!url.trim()) return;
      const target = url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`;
      setAuditLoading(true); setAuditData(null); setAuditUrl(url);
      setPerfData(null); setPerfLoading(true);

      // Run SEO audit (Worker) and PageSpeed (browser, direct to Google) in parallel
      const seoPromise = authFetch(`${WORKER_URL}/api/page-audit`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({url:target}) })
        .then(r=>r.json()).catch(e=>({error:e.message,audited:false}));

      const psiKey = import.meta.env.VITE_PSI_KEY || "";
      const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(target)}&category=PERFORMANCE&strategy=MOBILE${psiKey ? `&key=${psiKey}` : ""}`;
      console.log("[RankActions] PSI request:", psiUrl);
      const psiPromise = fetch(psiUrl)
        .then(r => {
          console.log("[RankActions] PSI response status:", r.status);
          return r.json();
        })
        .then(psi => {
          console.log("[RankActions] PSI data:", psi?.lighthouseResult ? "OK" : "No lighthouse data", psi?.error || "");
          if (!psi?.lighthouseResult) return null;
          const lhr = psi.lighthouseResult;
          const audits = lhr.audits || {};
          return {
            score: lhr.categories?.performance ? Math.round(lhr.categories.performance.score * 100) : null,
            cwv: {
              lcp: audits['largest-contentful-paint']?.numericValue,
              cls: audits['cumulative-layout-shift']?.numericValue,
              fcp: audits['first-contentful-paint']?.numericValue,
              si:  audits['speed-index']?.numericValue,
              tbt: audits['total-blocking-time']?.numericValue,
            },
            opportunities: Object.values(audits)
              .filter(a => a.details?.type === 'opportunity' && a.details?.overallSavingsMs > 100)
              .sort((a,b) => (b.details?.overallSavingsMs||0) - (a.details?.overallSavingsMs||0))
              .slice(0, 8)
              .map(a => ({
                title: a.title, description: a.description,
                savings: a.details?.overallSavingsMs ? `${(a.details.overallSavingsMs/1000).toFixed(1)}s` : null,
                savingsBytes: a.details?.overallSavingsBytes ? `${(a.details.overallSavingsBytes/1024).toFixed(0)}KB` : null,
                score: a.score,
              })),
            diagnostics: Object.values(audits)
              .filter(a => a.details?.type === 'table' && a.score !== null && a.score < 0.9 && !a.details?.overallSavingsMs)
              .slice(0, 5)
              .map(a => ({ title: a.title, description: a.description, score: a.score })),
          };
        }).catch(err => { console.error("[RankActions] PSI error:", err); return null; });

      // SEO finishes first (2-3s), then PSI catches up (10-20s)
      const seoResult = await seoPromise;
      setAuditData(seoResult);
      setAuditLoading(false);

      const psiResult = await psiPromise;
      setPerfData(psiResult);
      setPerfLoading(false);
    };
    const scoreColor = (s) => s>=90?"#0A7C4E":s>=75?"#0fdb8a":s>=60?"#f5a623":s>=40?"#e67e22":"#f03e5f";
    const typeIcon = (t) => t==="critical"?"🔴":t==="warning"?"🟡":t==="info"?"🔵":"🟢";
    const typeColor = (t) => t==="critical"?"#f03e5f":t==="warning"?"#f5a623":t==="info"?"#4d7bff":"#0fdb8a";
    const auditTipMap = {"Title Tag":"titleTag","Meta Description":"metaDesc","H1 Heading":"h1","Content Structure":"h2","Canonical Tag":"canonical","Mobile Friendliness":"viewport","Image Alt Text":"altText","Structured Data":"schema","Social Meta Tags":"openGraph","Internal Links":"internalLinks","HTTPS":"ssl","Page Speed":"pageSpeed","Content Length":"wordCount"};

    return (
      <div className="content" style={{padding:"1.5rem 2rem",maxWidth:1100}}>
        <div style={{marginBottom:"1.5rem"}}>
          <div style={{fontSize:"1.3rem",fontWeight:700}}>Page SEO Audit</div>
          <div style={{fontSize:".82rem",color:"var(--text3)"}}>Enter any URL for an instant SEO + performance + AI readiness health check</div>
        </div>
        <div style={{display:"flex",gap:".75rem",marginBottom:"1.5rem"}}>
          <input value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&runAudit()}
            placeholder="https://example.com/page"
            style={{flex:1,padding:".65rem 1rem",background:"var(--s1)",border:"1px solid var(--border)",borderRadius:8,color:"var(--text)",fontFamily:"var(--font)",fontSize:".85rem"}}/>
          <button onClick={runAudit} disabled={auditLoading||!url.trim()}
            style={{padding:".65rem 1.5rem",background:"var(--green)",color:"#fff",border:"none",borderRadius:8,fontFamily:"var(--font)",fontWeight:600,fontSize:".85rem",cursor:"pointer",opacity:auditLoading?.6:1}}>
            {auditLoading?"Auditing...":"🔍 Audit page"}
          </button>
        </div>
        {auditLoading && <div style={{textAlign:"center",padding:"3rem",color:"var(--text3)"}}><div className="spinner-sm" style={{margin:"0 auto .75rem"}}/>Scanning SEO and performance — this may take 10-15 seconds...</div>}
        {auditData?.error && <div style={{padding:"1rem",background:"rgba(240,62,95,.08)",border:"1px solid rgba(240,62,95,.2)",borderRadius:10,color:"#f03e5f",fontSize:".85rem"}}>Could not audit: {auditData.error}</div>}
        {auditData?.audited && <>
          {/* ── Indexability banner — only when page won't appear in Google.
              Renders above everything else because nothing matters until
              indexability is fixed. ── */}
          {auditData.indexability && !auditData.indexability.indexable && (
            <div style={{padding:"1rem 1.25rem",background:"rgba(240,62,95,.12)",border:"1px solid rgba(240,62,95,.35)",borderRadius:10,marginBottom:"1rem"}}>
              <div style={{fontWeight:700,fontSize:".95rem",marginBottom:".35rem",color:"#f03e5f"}}>⚠ This page cannot appear in Google — fix this before anything else</div>
              <div style={{fontSize:".8rem",color:"var(--text2)"}}>Blocked by: {auditData.indexability.reasons.join(' · ')}. See the Indexability issues below for the exact fix.</div>
            </div>
          )}
          {/* ── Download PDF button ── */}
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:".75rem"}}>
            <button
              type="button"
              onClick={()=>exportAuditPdf({audit:auditData,perf:perfData,tier:plan})}
              disabled={perfLoading}
              title={perfLoading?"Wait for page speed scan to finish for a complete report":"Download branded PDF report"}
              style={{padding:".5rem 1rem",background:"transparent",color:"var(--green)",border:"1px solid var(--green)",borderRadius:8,fontFamily:"var(--font)",fontWeight:600,fontSize:".8rem",cursor:perfLoading?"wait":"pointer",opacity:perfLoading?.5:1,display:"inline-flex",alignItems:"center",gap:".4rem"}}>
              {perfLoading?"⏳ Waiting for page speed…":"📄 Download PDF report"}
            </button>
          </div>
          {/* ── Triple score gauges + summary ── */}
          <div style={{display:"grid",gridTemplateColumns:"auto auto auto 1fr",gap:"1rem",marginBottom:"1.25rem",alignItems:"center"}}>
            {/* SEO Score */}
            <div style={{textAlign:"center"}}>
              <svg viewBox="0 0 120 120" style={{width:105,height:105}}>
                <circle cx={60} cy={60} r={52} fill="none" stroke="var(--border)" strokeWidth={8}/>
                <circle cx={60} cy={60} r={52} fill="none" stroke={scoreColor(auditData.score)} strokeWidth={8}
                  strokeDasharray={`${(auditData.score/100)*327} 327`} strokeLinecap="round" transform="rotate(-90 60 60)"/>
                <text x={60} y={52} textAnchor="middle" fill={scoreColor(auditData.score)} fontSize={26} fontWeight={800} fontFamily="Arial">{auditData.score}</text>
                <text x={60} y={70} textAnchor="middle" fill="var(--text3)" fontSize={10}>SEO · {auditData.grade}</text>
              </svg>
              <div style={{fontSize:".62rem",color:"var(--text3)",marginTop:".1rem"}}>On-page SEO</div>
            </div>
            {/* Performance Score */}
            <div style={{textAlign:"center"}}>
              {perfData ? (
                <>
                <svg viewBox="0 0 120 120" style={{width:105,height:105}}>
                  <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="8"/>
                  <circle cx="60" cy="60" r="52" fill="none" stroke={scoreColor(perfData.score)} strokeWidth="8"
                    strokeDasharray={`${(perfData.score/100)*327} 327`}
                    strokeLinecap="round" transform="rotate(-90 60 60)"/>
                  <text x="60" y="52" textAnchor="middle" fill={scoreColor(perfData.score)} fontSize="26" fontWeight="800" fontFamily="Arial">{perfData.score}</text>
                  <text x="60" y="70" textAnchor="middle" fill="var(--text3)" fontSize="10">Performance</text>
                </svg>
                <div style={{fontSize:".62rem",color:"var(--text3)",marginTop:".1rem"}}>Page speed</div>
                </>
              ) : perfLoading ? (
                <div>
                  <div style={{width:105,height:105,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",borderRadius:"50%",border:"8px solid var(--border)"}}>
                    <div className="spinner-sm"/>
                    <div style={{fontSize:".5rem",color:"var(--text3)",marginTop:".2rem"}}>Loading...</div>
                  </div>
                  <div style={{fontSize:".62rem",color:"var(--text3)",marginTop:".1rem"}}>Page speed</div>
                </div>
              ) : (
                <div>
                <svg viewBox="0 0 120 120" style={{width:105,height:105}}>
                  <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="8"/>
                  <text x="60" y="55" textAnchor="middle" fill="var(--text3)" fontSize="16">—</text>
                  <text x="60" y="70" textAnchor="middle" fill="var(--text3)" fontSize="10">Performance</text>
                </svg>
                <div style={{fontSize:".62rem",color:"var(--text3)",marginTop:".1rem"}}>Page speed</div>
                </div>
              )}
            </div>
            {/* AI Readiness Score */}
            <div style={{textAlign:"center"}}>
              {auditData.aiReadiness ? (
                <>
                <svg viewBox="0 0 120 120" style={{width:105,height:105}}>
                  <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="8"/>
                  <circle cx="60" cy="60" r="52" fill="none" stroke={auditData.aiReadiness.score>=80?"#a855f7":auditData.aiReadiness.score>=50?"var(--amber)":"var(--red)"} strokeWidth="8"
                    strokeDasharray={`${(auditData.aiReadiness.score/100)*327} 327`}
                    strokeLinecap="round" transform="rotate(-90 60 60)"/>
                  <text x="60" y="52" textAnchor="middle" fill={auditData.aiReadiness.score>=80?"#a855f7":auditData.aiReadiness.score>=50?"var(--amber)":"var(--red)"} fontSize="26" fontWeight="800" fontFamily="Arial">{auditData.aiReadiness.score}</text>
                  <text x="60" y="70" textAnchor="middle" fill="var(--text3)" fontSize="10">{auditData.aiReadiness.grade}</text>
                </svg>
                <div style={{fontSize:".62rem",color:"var(--text3)",marginTop:".1rem"}}>AI Search Ready</div>
                </>
              ) : (
                <div>
                <svg viewBox="0 0 120 120" style={{width:105,height:105}}>
                  <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="8"/>
                  <text x="60" y="55" textAnchor="middle" fill="var(--text3)" fontSize="16">—</text>
                  <text x="60" y="70" textAnchor="middle" fill="var(--text3)" fontSize="10">AI Ready</text>
                </svg>
                <div style={{fontSize:".62rem",color:"var(--text3)",marginTop:".1rem"}}>AI Search Ready</div>
                </div>
              )}
            </div>
            {/* Summary counts */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:".5rem"}}>
              <div style={{background:"rgba(240,62,95,.06)",borderRadius:10,padding:".75rem",textAlign:"center",border:"1px solid rgba(240,62,95,.15)"}}>
                <div style={{fontSize:"1.3rem",fontWeight:800,color:"#f03e5f"}}>{auditData.summary.critical}</div>
                <div style={{fontSize:".7rem",color:"var(--text3)"}}>Critical</div>
              </div>
              <div style={{background:"rgba(245,166,35,.06)",borderRadius:10,padding:".75rem",textAlign:"center",border:"1px solid rgba(245,166,35,.15)"}}>
                <div style={{fontSize:"1.3rem",fontWeight:800,color:"#f5a623"}}>{auditData.summary.warnings}</div>
                <div style={{fontSize:".7rem",color:"var(--text3)"}}>Warnings</div>
              </div>
              <div style={{background:"rgba(15,219,138,.06)",borderRadius:10,padding:".75rem",textAlign:"center",border:"1px solid rgba(15,219,138,.15)"}}>
                <div style={{fontSize:"1.3rem",fontWeight:800,color:"#0fdb8a"}}>{auditData.summary.passed}</div>
                <div style={{fontSize:".7rem",color:"var(--text3)"}}>Passed</div>
              </div>
            </div>
          </div>

          {/* ── Metrics strip: CWV + load time + word count ── */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:".5rem",marginBottom:"1.25rem"}}>
            {[
              ...(perfData ? [
                {l:"LCP",v:perfData.cwv.lcp!=null?`${(perfData.cwv.lcp/1000).toFixed(1)}s`:"—",ok:perfData.cwv.lcp<=2500,warn:perfData.cwv.lcp<=4000},
                {l:"CLS",v:perfData.cwv.cls!=null?perfData.cwv.cls.toFixed(3):"—",ok:perfData.cwv.cls<=0.1,warn:perfData.cwv.cls<=0.25},
                {l:"FCP",v:perfData.cwv.fcp!=null?`${(perfData.cwv.fcp/1000).toFixed(1)}s`:"—",ok:perfData.cwv.fcp<=1800,warn:perfData.cwv.fcp<=3000},
              ] : [
                {l:"LCP",v:perfLoading?"...":"—",ok:true,warn:true},
                {l:"CLS",v:perfLoading?"...":"—",ok:true,warn:true},
                {l:"FCP",v:perfLoading?"...":"—",ok:true,warn:true},
              ]),
              {l:"Load time",v:`${auditData.loadTime}ms`,ok:auditData.loadTime<2000,warn:auditData.loadTime<4000},
              {l:"Word count",v:`~${auditData.wordCount}`,ok:auditData.wordCount>=300,warn:auditData.wordCount>=150},
            ].map(m=>(
              <div key={m.l} style={{background:"var(--s1)",borderRadius:8,padding:".6rem .75rem",border:"1px solid var(--border)",textAlign:"center"}}>
                <div style={{fontSize:".68rem",color:"var(--text3)",fontWeight:600,marginBottom:".2rem"}}>{m.l}</div>
                <div style={{fontSize:"1.05rem",fontWeight:700,fontFamily:"var(--mono)",color:m.v==="—"||m.v==="..."?"var(--text3)":m.ok?"var(--green)":m.warn?"var(--amber)":"var(--red)"}}>{m.v}</div>
                {m.v!=="—"&&m.v!=="..."&&<div style={{fontSize:".58rem",fontWeight:600,marginTop:".15rem",color:m.ok?"var(--green)":m.warn?"var(--amber)":"var(--red)"}}>{m.ok?"Good":m.warn?"Needs work":"Poor"}</div>}
              </div>
            ))}
          </div>

          {/* ── What do these scores mean? ── */}
          <details style={{marginBottom:"1.25rem",background:"var(--s1)",borderRadius:10,border:"1px solid var(--border)",overflow:"hidden"}}>
            <summary style={{padding:".75rem 1rem",cursor:"pointer",fontSize:".82rem",fontWeight:600,color:"var(--blue)",listStyle:"none",display:"flex",alignItems:"center",gap:".4rem"}}>
              <span style={{fontSize:".7rem"}}>ℹ</span> What do these scores mean?
            </summary>
            <div style={{padding:"0 1rem 1rem",fontSize:".8rem",color:"var(--text2)",lineHeight:1.7}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginTop:".5rem"}}>
                <div>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:".3rem"}}>SEO Score (0-100)</div>
                  <p>How well your page is set up for search engines. Checks things like your page title, description, headings, images, and links. Aim for 80+.</p>
                  <div style={{fontWeight:700,color:"var(--text)",margin:".6rem 0 .3rem"}}>Performance Score (0-100)</div>
                  <p>How fast your page loads on a mobile phone (from Google). Under 50 is slow, 50-89 needs improvement, 90+ is fast.</p>
                </div>
                <div>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:".3rem"}}>Core Web Vitals</div>
                  <p><strong style={{color:"var(--text)"}}>LCP</strong> — How long until the main content appears. Under 2.5 seconds is good.</p>
                  <p><strong style={{color:"var(--text)"}}>CLS</strong> — How much the page jumps around while loading. Under 0.1 means things stay put.</p>
                  <p><strong style={{color:"var(--text)"}}>FCP</strong> — How long until anything appears on screen. Under 1.8 seconds is good.</p>
                  <p style={{marginTop:".4rem"}}><span style={{color:"var(--green)"}}>Green</span> = good, <span style={{color:"var(--amber)"}}>amber</span> = needs work, <span style={{color:"var(--red)"}}>red</span> = poor. Google uses these to rank your site.</p>
                </div>
              </div>
            </div>
          </details>

          {/* ── SEO Issues ── */}
          <div style={{display:"flex",flexDirection:"column",gap:".5rem"}}>
            {auditData.issues.filter(i=>i.type!=="pass").map((issue,i)=>(
              <div key={i} style={{background:"var(--s1)",borderRadius:10,border:"1px solid var(--border)",padding:"1rem 1.15rem",borderLeft:`3px solid ${typeColor(issue.type)}`}}>
                <div style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".3rem"}}>
                  <span>{typeIcon(issue.type)}</span>
                  <span style={{fontSize:".75rem",fontWeight:700,color:typeColor(issue.type),textTransform:"uppercase",letterSpacing:".04em"}}>{issue.type}</span>
                  <span style={{fontSize:".75rem",color:"var(--text3)"}}>· {auditTipMap[issue.category] ? <Tip term={auditTipMap[issue.category]}>{issue.category}</Tip> : issue.category}</span>
                </div>
                <div style={{fontSize:".92rem",fontWeight:600,marginBottom:".3rem"}}>{issue.issue}</div>
                {issue.fix && <div style={{fontSize:".85rem",color:"var(--text2)",lineHeight:1.55}}>{issue.fix}</div>}
                {issue.current && <div style={{fontSize:".75rem",color:"var(--text3)",marginTop:".3rem",fontFamily:"monospace",wordBreak:"break-all"}}>Current: {issue.current}</div>}
              </div>
            ))}
            <div style={{marginTop:".4rem"}}>
              <div style={{fontSize:".78rem",fontWeight:600,color:"var(--text3)",marginBottom:".4rem"}}>Passed ({auditData.issues.filter(i=>i.type==="pass").length})</div>
              {auditData.issues.filter(i=>i.type==="pass").map((issue,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:".4rem",padding:".35rem 0",fontSize:".82rem",color:"var(--text3)"}}>🟢 {auditTipMap[issue.category] ? <Tip term={auditTipMap[issue.category]}>{issue.category}</Tip> : issue.category}: {issue.issue}</div>
              ))}
            </div>
          </div>

          {/* ── Performance Opportunities + Diagnostics ── */}
          {perfData && (perfData.opportunities?.length > 0 || perfData.diagnostics?.length > 0) && (
            <div style={{marginTop:"1.5rem"}}>
              {perfData.opportunities?.length > 0 && (
                <div style={{marginBottom:".75rem"}}>
                  <div style={{fontSize:".78rem",fontWeight:700,color:"var(--text3)",marginBottom:".5rem",textTransform:"uppercase",letterSpacing:".06em"}}>Performance Opportunities</div>
                  {perfData.opportunities.map((opp,i)=>(
                    <div key={i} style={{background:"var(--s1)",borderRadius:8,padding:".75rem .95rem",border:"1px solid var(--border)",borderLeft:`3px solid ${opp.score<=0.5?"var(--red)":"var(--amber)"}`,marginBottom:".4rem"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{fontSize:".88rem",fontWeight:600}}>{opp.title}</div>
                        <div style={{display:"flex",gap:".4rem",flexShrink:0}}>
                          {opp.savings && <span style={{fontSize:".68rem",fontWeight:700,padding:".15rem .4rem",borderRadius:4,background:"var(--gdim)",color:"var(--green)"}}>Save {opp.savings}</span>}
                          {opp.savingsBytes && <span style={{fontSize:".68rem",fontWeight:700,padding:".15rem .4rem",borderRadius:4,background:"var(--bdim)",color:"var(--blue)"}}>{opp.savingsBytes}</span>}
                        </div>
                      </div>
                      <div style={{fontSize:".72rem",color:"var(--text3)",marginTop:".2rem"}}>{opp.description}</div>
                    </div>
                  ))}
                </div>
              )}
              {perfData.diagnostics?.length > 0 && (
                <div>
                  <div style={{fontSize:".78rem",fontWeight:700,color:"var(--text3)",marginBottom:".5rem",textTransform:"uppercase",letterSpacing:".06em"}}>Diagnostics</div>
                  {perfData.diagnostics.map((d,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:".5rem",padding:".35rem 0",borderBottom:"1px solid var(--border)",fontSize:".78rem"}}>
                      <span style={{color:d.score<=0.5?"var(--red)":"var(--amber)"}}>{d.score<=0.5?"🔴":"🟡"}</span>
                      <span style={{color:"var(--text)"}}>{d.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {perfLoading && !perfData && (
            <div style={{marginTop:"1rem",padding:"1rem",textAlign:"center",background:"var(--s1)",borderRadius:10,border:"1px solid var(--border)"}}>
              <div className="spinner-sm" style={{margin:"0 auto .5rem"}}/>
              <div style={{fontSize:".82rem",color:"var(--text3)"}}>Loading performance opportunities from Google...</div>
            </div>
          )}

          {/* ── AI Search Readiness ── */}
          {auditData.aiReadiness && (
            <div style={{marginTop:"1.5rem"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".75rem"}}>
                <div style={{fontSize:".85rem",fontWeight:700}}>🤖 AI Search Readiness</div>
                <div style={{fontSize:".75rem",color:auditData.aiReadiness.score>=80?"#a855f7":auditData.aiReadiness.score>=50?"var(--amber)":"var(--red)",fontWeight:600}}>
                  {auditData.aiReadiness.passed}/{auditData.aiReadiness.total} checks passed · {auditData.aiReadiness.grade}
                </div>
              </div>
              <div style={{fontSize:".78rem",color:"var(--text3)",marginBottom:".75rem",lineHeight:1.6}}>
                How well this page is structured for AI search engines like Google AI Overviews, ChatGPT, and Perplexity. Pages that score higher here are more likely to be cited in AI-generated answers.
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:".4rem"}}>
                {auditData.aiReadiness.checks.map((check,i) => (
                  <div key={i} style={{background:"var(--s1)",borderRadius:8,padding:".7rem .9rem",border:"1px solid var(--border)",
                    borderLeft:`3px solid ${check.status==="pass"?"#a855f7":check.status==="partial"?"var(--amber)":check.status==="neutral"?"var(--text3)":"var(--red)"}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:".4rem",marginBottom:".2rem"}}>
                      <span>{check.status==="pass"?"🟣":check.status==="partial"?"🟡":check.status==="neutral"?"⚪":"🔴"}</span>
                      <span style={{fontSize:".82rem",fontWeight:600}}>{check.check}</span>
                    </div>
                    <div style={{fontSize:".78rem",color:"var(--text2)",lineHeight:1.5}}>{check.detail}</div>
                    {check.fix && <div style={{fontSize:".75rem",color:"var(--text3)",marginTop:".3rem",lineHeight:1.5,fontStyle:"italic"}}>💡 {check.fix}</div>}
                    {check.examples && check.examples.length > 0 && (
                      <div style={{marginTop:".3rem",display:"flex",gap:".3rem",flexWrap:"wrap"}}>
                        {check.examples.map((ex,j) => (
                          <span key={j} style={{fontSize:".65rem",background:"rgba(168,85,247,.08)",color:"#a855f7",padding:".15rem .4rem",borderRadius:4}}>"{ex}"</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Collapsible guide */}
              <details style={{marginTop:".75rem",background:"var(--s1)",borderRadius:8,border:"1px solid var(--border)",overflow:"hidden"}}>
                <summary style={{padding:".65rem .9rem",cursor:"pointer",fontSize:".78rem",fontWeight:600,color:"#a855f7",listStyle:"none",display:"flex",alignItems:"center",gap:".4rem"}}>
                  <span style={{fontSize:".65rem"}}>ℹ</span> Why does AI search readiness matter?
                </summary>
                <div style={{padding:"0 .9rem .75rem",fontSize:".78rem",color:"var(--text2)",lineHeight:1.7}}>
                  <p style={{marginTop:".4rem"}}>Google AI Overviews, ChatGPT, and Perplexity are increasingly answering questions directly instead of showing traditional search results. When they do, they cite sources — and the sources they choose tend to have:</p>
                  <p style={{marginTop:".4rem"}}><strong style={{color:"var(--text)"}}>FAQ and HowTo schema</strong> — structured data that AI can extract directly without interpreting prose.</p>
                  <p><strong style={{color:"var(--text)"}}>Question-based headings</strong> — H2s phrased as questions that match how people ask AI assistants.</p>
                  <p><strong style={{color:"var(--text)"}}>Concise direct answers</strong> — the first sentence after a heading should directly answer the question.</p>
                  <p><strong style={{color:"var(--text)"}}>Author and date signals</strong> — AI engines prioritise recent, authoritative content.</p>
                  <p><strong style={{color:"var(--text)"}}>Structured content</strong> — lists, tables, and short paragraphs that AI can parse reliably.</p>
                  <p style={{marginTop:".4rem",color:"var(--text3)"}}>Traditional SEO still matters — you need to rank in the top 3-5 results for AI to consider citing you. AI readiness is the next layer on top of good SEO fundamentals.</p>
                </div>
              </details>
            </div>
          )}

          <div style={{marginTop:"1rem",fontSize:".7rem",color:"var(--text3)",background:"var(--s1)",borderRadius:8,padding:".55rem .85rem",lineHeight:1.6,border:"1px solid var(--border)"}}>
            ⚠️ SEO checks are based on HTML analysis. Performance data is from Google PageSpeed Insights (mobile). Always back up your site before making changes.
          </div>
        </>}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // LINK BUILDING SCREEN
  // ─────────────────────────────────────────────────────────────
  const LinkBuildingScreen = () => {
    const [addingTo,  setAddingTo]  = useState(null);
    const [newDomain, setNewDomain] = useState("");
    const [newType,   setNewType]   = useState("Guest Post");
    const [copiedEmail, setCopiedEmail] = useState(false);

    // Gate for non-Pro users — placed after hooks so the hook count stays
    // stable across renders if the user upgrades mid-session. Mirrors the
    // ContentGenerator pattern.
    if (!isPro) return (
      <div className="content">
        <div className="cg-header">
          <div className="cg-title">Link Building</div>
          <div className="cg-sub">AI-generated link opportunities and outreach templates</div>
        </div>
        <div className="upgrade-wall" style={{maxWidth:480,margin:"3rem auto",textAlign:"center"}}>
          <div className="upgrade-wall-icon">🔗</div>
          <div className="upgrade-wall-h">Link Building is a Pro feature</div>
          <div className="upgrade-wall-sub">
            Get AI-generated link opportunities specific to your site, plus personalised outreach emails for guest posts, resource pages, broken-link campaigns and more. Track every prospect from identified to secured.
          </div>
          <button className="upgrade-wall-btn" onClick={()=>setShowUpgrade(true)}>Upgrade — from £100/month</button>
        </div>
      </div>
    );

    const cols = [
      { id:"identified", label:"Identified",   color:"var(--blue)"  },
      { id:"contacted",  label:"Contacted",    color:"var(--amber)" },
      { id:"replied",    label:"Replied",      color:"var(--green)" },
      { id:"secured",    label:"Link Secured", color:"#a855f7"      },
      { id:"declined",   label:"Not Interested",color:"var(--red)"  },
    ];

    const templateTypes = [
      { id:"guest_post",   label:"Guest Post",    tip:"guestPost" },
      { id:"resource_page",label:"Resource Page",  tip:"resourcePage" },
      { id:"broken_link",  label:"Broken Link",    tip:"brokenLink" },
      { id:"testimonial",  label:"Testimonial"    },
      { id:"partnership",  label:"Partnership"    },
      { id:"directory",    label:"Directory"      },
    ];

    const diffColor = d => d==="easy"?"easy":d==="medium"?"medium":"hard";
    const valColor  = v => v==="High"?"var(--green)":v==="Medium"?"var(--amber)":"var(--text3)";

    return (
      <div className="links-wrap">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"1rem"}}>
          <div>
            <div style={{fontSize:"1.1rem",fontWeight:700,letterSpacing:"-.03em"}}>Link Building</div>
            <div style={{fontSize:".82rem",color:"var(--text2)",marginTop:".2rem"}}>
              {selectedSite} · {linkProspects.filter(p=>p.status==="secured").length} links secured · {linkProspects.length} prospects tracked
            </div>
          </div>
        </div>

        {/* ── Section 1: Opportunities ── */}
        <div className="links-section">
          <div className="links-section-head">
            <div>
              <div className="links-section-title"><Tip term="backlinks">Link Opportunities</Tip></div>
              <div className="links-section-sub">AI-generated opportunities specific to {displaySite(selectedSite)}</div>
            </div>
            <button className="links-generate-btn" disabled={linkOppsLoading} onClick={generateLinkOpps}>
              {linkOppsLoading ? "⏳ Generating…" : "✨ Generate opportunities"}
            </button>
          </div>
          {linkOpps.length === 0 && !linkOppsLoading && (
            <div style={{padding:"3rem",textAlign:"center",color:"var(--text3)"}}>
              <div style={{fontSize:"2rem",marginBottom:"1rem"}}>🔗</div>
              <div style={{fontSize:".9rem",marginBottom:".5rem"}}>No opportunities generated yet</div>
              <div style={{fontSize:".8rem"}}>Click "Generate opportunities" to get AI-powered link building ideas specific to {selectedSite}</div>
            </div>
          )}
          {linkOppsLoading && (
            <div style={{padding:"3rem",textAlign:"center"}}>
              <div className="spinner" style={{margin:"0 auto 1rem"}}/>
              <div style={{fontSize:".85rem",color:"var(--text2)"}}>Analysing {selectedSite} and finding link opportunities…</div>
            </div>
          )}
          {linkOpps.length > 0 && (
            <div className="links-opp-grid">
              {linkOpps.map((opp,i) => (
                <div key={i} className="links-opp-card">
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:".4rem"}}>
                    <span className={`links-opp-type ${diffColor(opp.difficulty)}`}>{opp.difficulty} · {opp.type}</span>
                    <span style={{display:"flex",alignItems:"center",gap:".4rem"}}>
                      {opp.verified && <span style={{fontSize:".6rem",fontWeight:700,color:"var(--blue)",background:"var(--bdim)",padding:".15rem .4rem",borderRadius:4}}>✓ Verified by Google</span>}
                      <span style={{fontSize:".72rem",color:valColor(opp.value),fontWeight:700}}>{opp.value} value · {opp.timeToResult}</span>
                    </span>
                  </div>
                  <div className="links-opp-title">{opp.title}</div>
                  <div className="links-opp-desc">{opp.description}</div>

                  {/* Targets / contacts */}
                  {opp.targets && opp.targets.length > 0 && (
                    <div style={{background:"var(--bdim)",borderRadius:8,padding:".6rem .75rem",marginTop:".5rem"}}>
                      <div style={{fontSize:".7rem",fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text3)",marginBottom:".4rem"}}>📍 Where to go</div>
                      {opp.targets.map((t,j) => (
                        <div key={j} style={{fontSize:".8rem",color:"var(--text2)",marginBottom:".3rem",display:"flex",flexDirection:"column",gap:".15rem"}}>
                          <div style={{display:"flex",alignItems:"center",gap:".4rem"}}>
                            <strong style={{color:"var(--text1)"}}>{t.name}</strong>
                            {t.url && <a href={t.url} target="_blank" rel="noopener noreferrer" style={{fontSize:".72rem",color:"var(--blue)",textDecoration:"none"}}>↗ Visit</a>}
                          </div>
                          {t.contactMethod && <div style={{fontSize:".72rem",color:"var(--text3)"}}>📧 {t.contactMethod}</div>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Step-by-step instructions */}
                  {opp.steps && opp.steps.length > 0 && (
                    <details style={{marginTop:".5rem",fontSize:".8rem",color:"var(--text2)"}}>
                      <summary style={{cursor:"pointer",fontWeight:600,color:"var(--text1)",fontSize:".78rem",padding:".3rem 0"}}>📋 Step-by-step instructions</summary>
                      <ol style={{paddingLeft:"1.2rem",marginTop:".4rem",display:"flex",flexDirection:"column",gap:".3rem"}}>
                        {opp.steps.map((s,j) => <li key={j} style={{lineHeight:1.5}}>{s.replace(/^Step \d+:?\s*/i,"")}</li>)}
                      </ol>
                    </details>
                  )}

                  {/* Compliance note */}
                  {opp.complianceNote && (
                    <div style={{fontSize:".7rem",color:"var(--amber)",background:"rgba(184,92,0,.08)",borderRadius:5,padding:".35rem .6rem",marginTop:".5rem"}}>
                      ⚠ {opp.complianceNote}
                    </div>
                  )}

                  {/* Legacy example field for fallback data */}
                  {!opp.targets && opp.example && (
                    <div style={{fontSize:".75rem",color:"var(--blue)",background:"var(--bdim)",borderRadius:5,padding:".35rem .6rem"}}>
                      💡 Example: {opp.example}
                    </div>
                  )}

                  <div className="links-opp-actions" style={{marginTop:".6rem"}}>
                    <button className="links-opp-btn primary" onClick={()=>{
                      setLinkTemplate(opp.type.toLowerCase().replace(/ /g,"_").replace("local_citation","directory").replace("press","guest_post").replace("haro","guest_post") || "guest_post");
                      if (opp.targets?.[0]?.name) setLinkTemplateTarget(opp.targets[0].name);
                      document.getElementById("links-outreach-section")?.scrollIntoView({behavior:"smooth"});
                    }}>✍ Write outreach</button>
                    <button className="links-opp-btn" onClick={()=>saveProspect(opp.targets?.[0]?.name || opp.title, opp.type)}>
                      + Add to tracker
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Section 2: Outreach Templates ── */}
        <div className="links-section" id="links-outreach-section">
          <div className="links-section-head">
            <div>
              <div className="links-section-title">Outreach Email Generator</div>
              <div className="links-section-sub">AI writes a personalised pitch — you send it</div>
            </div>
          </div>
          <div className="links-template-tabs">
            {templateTypes.map(t=>(
              <div key={t.id} className={`links-template-tab ${linkTemplate===t.id?"active":""}`}
                onClick={()=>{setLinkTemplate(t.id);setLinkTemplateOutput("");}}>
                {t.label}
              </div>
            ))}
          </div>
          <div className="links-template-body">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem"}}>
              <div className="links-template-field">
                <div className="links-template-label">Target site / contact</div>
                <input className="links-template-input" placeholder="e.g. searchengineland.com or John at Acme Ltd"
                  value={linkTemplateTarget} onChange={e=>setLinkTemplateTarget(e.target.value)}/>
              </div>
              <div className="links-template-field">
                <div className="links-template-label">Additional context (optional)</div>
                <input className="links-template-input" placeholder="e.g. we both serve HR professionals"
                  defaultValue="" onChange={e=>{linkTemplateContextRef.current=e.target.value;}}/>
              </div>
            </div>
            <button className="links-generate-btn" style={{width:"fit-content"}}
              disabled={linkTemplateLoading||!linkTemplateTarget.trim()}
              onClick={generateOutreachEmail}>
              {linkTemplateLoading ? "⏳ Writing…" : "✨ Generate email"}
            </button>
            {linkTemplateOutput && (
              <>
                <div className="links-template-field">
                  <div className="links-template-label">Your outreach email</div>
                  <div className="links-template-output">{linkTemplateOutput}</div>
                </div>
                <div style={{display:"flex",gap:".65rem",flexWrap:"wrap"}}>
                  <button className="links-opp-btn primary" onClick={()=>{
                    navigator.clipboard.writeText(linkTemplateOutput).catch(()=>{});
                    setCopiedEmail(true); setTimeout(()=>setCopiedEmail(false),1600);
                  }}>{copiedEmail?"✓ Copied":"📋 Copy email"}</button>
                  <button className="links-opp-btn" onClick={()=>{saveProspect(linkTemplateTarget,"Outreach");}}>
                    + Add to tracker
                  </button>
                  <button className="links-opp-btn" onClick={()=>{setLinkTemplateOutput("");generateOutreachEmail();}}>
                    ↻ Regenerate
                  </button>
                </div>
                <div style={{fontSize:".75rem",color:"var(--text3)",background:"var(--s2)",borderRadius:7,padding:".65rem .85rem",lineHeight:1.6}}>
                  💡 <strong>Before sending:</strong> personalise the opening line with something specific about their site, find the right contact using LinkedIn or Hunter.io, and follow up once after 5-7 days if no reply.
                </div>
                <div style={{fontSize:".72rem",color:"var(--text3)",background:"var(--s2)",borderRadius:7,padding:".55rem .85rem",lineHeight:1.6}}>
                  ⚠️ You are responsible for all outreach communications sent on behalf of your business. RankActions generates templates only — review and personalise before sending.
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Section 3: Prospect Tracker ── */}
        <div className="links-section">
          <div className="links-section-head">
            <div>
              <div className="links-section-title">Prospect Tracker</div>
              <div className="links-section-sub">Track every outreach — drag prospects between columns as they progress</div>
            </div>
            <button className="links-opp-btn primary" onClick={()=>setAddingTo("identified")}>+ Add prospect</button>
          </div>
          <div className="links-tracker-cols">
            {cols.map(col=>{
              const colProspects = linkProspects.filter(p=>p.status===col.id);
              return (
                <div key={col.id} className="links-tracker-col">
                  <div className="links-tracker-col-head">
                    <span style={{color:col.color}}>{col.label}</span>
                    <span className="links-tracker-col-count">{colProspects.length}</span>
                  </div>
                  <div className="links-tracker-cards">
                    {colProspects.map(p=>(
                      <div key={p.id} className="links-prospect-card">
                        <div className="links-prospect-domain">{p.domain}</div>
                        <div className="links-prospect-type">{p.type}</div>
                        <div className="links-prospect-date">{p.date}</div>
                        <div style={{display:"flex",gap:".35rem",marginTop:".5rem",flexWrap:"wrap"}}>
                          {col.id!=="secured" && (
                            <button className="links-opp-btn" style={{fontSize:".65rem",padding:".2rem .5rem"}}
                              onClick={()=>{
                                const next = cols[cols.findIndex(c=>c.id===col.id)+1];
                                if(next) moveProspect(p.id, next.id);
                              }}>→ Move forward</button>
                          )}
                          <button className="links-opp-btn" style={{fontSize:".65rem",padding:".2rem .5rem",color:"var(--red)"}}
                            onClick={()=>deleteProspect(p.id)}>✕</button>
                        </div>
                      </div>
                    ))}
                    {/* Add form */}
                    {addingTo===col.id ? (
                      <div className="links-add-form">
                        <input className="links-add-input" placeholder="Domain or site name"
                          value={newDomain} onChange={e=>setNewDomain(e.target.value)}
                          onKeyDown={e=>e.key==="Enter"&&newDomain.trim()&&(saveProspect(newDomain.trim(),newType,col.id),setNewDomain(""),setAddingTo(null))}
                          autoFocus/>
                        <select className="links-add-input" value={newType} onChange={e=>setNewType(e.target.value)}>
                          {["Guest Post","Resource Page","Broken Link","Testimonial","Partnership","Directory","Other"].map(t=>(
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                        <div className="links-add-row">
                          <button className="links-add-save" onClick={()=>{
                            if(newDomain.trim()){saveProspect(newDomain.trim(),newType,col.id);setNewDomain("");setAddingTo(null);}
                          }}>Save</button>
                          <button className="links-add-cancel" onClick={()=>{setNewDomain("");setAddingTo(null);}}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button className="links-add-btn" onClick={()=>setAddingTo(col.id)}>+ Add here</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {linkProspects.length === 0 && (
            <div style={{padding:"2rem",textAlign:"center",color:"var(--text3)",fontSize:".82rem"}}>
              No prospects tracked yet — generate opportunities above and click "Add to tracker"
            </div>
          )}
        </div>

        {/* Guide */}
        <div style={{background:"var(--s1)",border:"1px solid var(--border)",borderRadius:12,padding:"1.25rem 1.5rem"}}>
          <div style={{fontWeight:700,marginBottom:"1rem",fontSize:".9rem"}}>📖 Link building in 6 steps</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"1rem"}}>
            {[
              ["1. Generate opportunities","Click Generate above to get AI-powered link ideas specific to your site and industry"],
              ["2. Pick your targets","Start with Easy difficulty — directories and partner links require the least effort"],
              ["3. Find the contact","Use LinkedIn or Hunter.io (free tier) to find the right person to email"],
              ["4. Write your pitch","Use the Outreach Generator — enter the target site and get a ready-to-send email"],
              ["5. Send and track","Add prospects to the tracker as you contact them. Move them forward as they progress"],
              ["6. Follow up once","If no reply after 7 days, send one polite follow-up. Most links come from the second email"],
            ].map(([title,desc])=>(
              <div key={title} style={{background:"var(--s2)",borderRadius:8,padding:".85rem 1rem"}}>
                <div style={{fontSize:".78rem",fontWeight:700,marginBottom:".35rem"}}>{title}</div>
                <div style={{fontSize:".75rem",color:"var(--text2)",lineHeight:1.6}}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // Starting Out — guided onboarding wizard for new sites
  // ─────────────────────────────────────────────────────────────
  // 6-step wizard that helps users with brand-new sites (no GSC
  // data yet) build their SEO foundation. State is persisted to
  // localStorage `ra_starting_out_${selectedSite}` so users can
  // save & exit at any point and resume later.
  //
  // PHASE 1 (Business Profile) is fully built. Phases 2-6 show a
  // "coming soon" placeholder but the wizard shell + state +
  // navigation are all wired up so we can drop them in incrementally.
  const StartingOutWizard = () => {
    const STEPS = [
      { num: 1, id: "profile",     title: "Your Business",   sub: "Tell us about your business so we can find the right keywords" },
      { num: 2, id: "seeds",       title: "Seed Keywords",   sub: "AI suggests starter keywords clustered by intent" },
      { num: 3, id: "data",        title: "Real Data",       sub: "Pull search volume + difficulty from DataForSEO" },
      { num: 4, id: "competitors", title: "Competitors",     sub: "See what your rivals are ranking for" },
      { num: 5, id: "targets",     title: "Your Targets",    sub: "AI prioritises 10-15 keywords to focus on" },
      { num: 6, id: "roadmap",     title: "Content Plan",    sub: "Build a roadmap to start ranking" },
    ];

    const STORAGE_KEY = `ra_starting_out_${selectedSite}`;
    const DEFAULT_STATE = {
      currentStep: 1,
      profile: {
        businessName: "",
        description: "",
        services: [],
        location: "",
        // Coverage scale, set by the user in step 1. "" = auto (infer from the
        // location text, the pre-existing behaviour). Explicit values override
        // inference. Old saved wizards lack this key and fall through to auto.
        coverage: "",
        targetCustomer: "",
        country: "gb",
      },
      seedKeywords: null,
      enrichedKeywords: null,
      competitors: null,
      targets: null,
      roadmap: null,
      updatedAt: null,
    };

    const loadState = (siteKey) => {
      try {
        const stored = JSON.parse(localStorage.getItem(`ra_starting_out_${siteKey}`) || "null");
        if (stored && stored.profile) return { ...DEFAULT_STATE, ...stored, profile: { ...DEFAULT_STATE.profile, ...stored.profile }};
      } catch {}
      return DEFAULT_STATE;
    };

    const [state, setState] = useState(() => loadState(selectedSite));
    const [serviceInput, setServiceInput] = useState("");

    // Reload state when site changes (same ref pattern as RankTracker/StrategyPlanner)
    const wizardSiteRef = useRef(selectedSite);
    useEffect(() => {
      if (wizardSiteRef.current === selectedSite) return;
      wizardSiteRef.current = selectedSite;
      setState(loadState(selectedSite));
      setServiceInput("");
    }, [selectedSite]);

    // Persist on every state change (cheap, single key, debouncing not worth it)
    useEffect(() => {
      const toSave = { ...state, updatedAt: new Date().toISOString() };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave)); } catch {}
      saveUserData(selectedSite, 'starting_out', toSave);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    const updateProfile = (patch) => setState(s => ({ ...s, profile: { ...s.profile, ...patch }}));
    const goToStep = (n) => setState(s => ({ ...s, currentStep: Math.max(1, Math.min(STEPS.length, n)) }));

    // Phase 2 — transient state for the AI call. Kept outside `state` so
    // we don't persist loading flags to localStorage.
    const [generating, setGenerating] = useState(false);
    const [generateError, setGenerateError] = useState(null);

    // Call the worker's seed-keyword endpoint. AI generates 24 keywords
    // organised by intent. No DataForSEO quota burn — that comes in Phase 3.
    const generateSeedKeywords = async () => {
      setGenerating(true);
      setGenerateError(null);
      try {
        const res = await authFetch(`${WORKER_URL}/api/starting-out/seed-keywords`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: state.profile,
            country: state.profile.country,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setGenerateError(data?.error || "Couldn't generate keywords — please try again");
          setGenerating(false);
          return;
        }
        setState(s => ({
          ...s,
          seedKeywords: {
            buckets: {
              informational: data.informational || [],
              commercial:    data.commercial    || [],
              navigational:  data.navigational  || [],
            },
            generatedAt: data.generatedAt,
            provider:    data.provider,
            // Default = everything selected. Track DESELECTED list (typically
            // shorter than selected) so the data structure is compact.
            deselected: [],
          },
        }));
      } catch (err) {
        setGenerateError("Couldn't reach the server — please check your connection");
      }
      setGenerating(false);
    };

    // Selection helpers for the keyword chips
    const isKwSelected = (kw) => !!state.seedKeywords && !state.seedKeywords.deselected.includes(kw);
    const toggleKw = (kw) => {
      setState(s => {
        const ds = s.seedKeywords?.deselected || [];
        return {
          ...s,
          seedKeywords: {
            ...s.seedKeywords,
            deselected: ds.includes(kw) ? ds.filter(x => x !== kw) : [...ds, kw],
          },
        };
      });
    };
    const allSeedKeywords = () => {
      if (!state.seedKeywords) return [];
      const b = state.seedKeywords.buckets;
      return [...(b.informational || []), ...(b.commercial || []), ...(b.navigational || [])];
    };
    const selectedSeedKeywords = () => allSeedKeywords().filter(kw => isKwSelected(kw));

    // Phase 3 — DataForSEO enrichment. Takes the user's selected seed
    // keywords from Phase 2 and pulls real search volume + difficulty.
    // Costs 1 quota credit per session (max 50 keywords). Pro+ only.
    const [enrichingPh3, setEnrichingPh3] = useState(false);
    const [enrichErrorPh3, setEnrichErrorPh3] = useState(null);

    // Lightweight normaliser — matches worker's normaliseKeyword. Used
    // for matching response keywords back to seed bucket origins so we
    // can colour-code by intent in the result UI.
    const normaliseKw = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");

    const fetchKeywordData = async () => {
      const keywords = selectedSeedKeywords();
      if (keywords.length === 0) {
        setEnrichErrorPh3("No keywords selected — go back and select at least one.");
        return;
      }
      if (keywords.length > 50) {
        setEnrichErrorPh3(`You've selected ${keywords.length} keywords. The maximum per session is 50 — please go back and deselect some.`);
        return;
      }
      setEnrichingPh3(true);
      setEnrichErrorPh3(null);
      try {
        const res = await authFetch(`${WORKER_URL}/api/keyword-data`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keywords, country: state.profile.country }),
        });
        const data = await res.json();

        if (res.status === 402) {
          if (data.upgrade) {
            setEnrichErrorPh3("Real keyword data is a Pro feature. Upgrade your plan to continue.");
          } else {
            setEnrichErrorPh3(`Monthly quota reached (${data.used}/${data.limit}). Resets next month.`);
          }
          setEnrichingPh3(false);
          return;
        }
        if (!res.ok) {
          setEnrichErrorPh3(data?.error || "Couldn't fetch keyword data — please try again.");
          setEnrichingPh3(false);
          return;
        }

        setState(s => ({
          ...s,
          enrichedKeywords: {
            list: Array.isArray(data.keywords) ? data.keywords : [],
            fetchedAt: new Date().toISOString(),
            quotaUsed:  data.quotaUsed  ?? null,
            quotaLimit: data.quotaLimit ?? null,
            country: state.profile.country,
            deselected: [],
          },
        }));

        if (data.partial) {
          setEnrichErrorPh3(`Some data unavailable — showing cached results where possible. Reason: ${data.reason || "unknown"}`);
        }
      } catch (err) {
        setEnrichErrorPh3("Couldn't reach the server — please check your connection.");
      }
      setEnrichingPh3(false);
    };

    // Phase 3 selection — separate deselected list so users can refine
    // based on real data without losing their Phase 2 reasoning
    const isPh3Selected = (kw) => !!state.enrichedKeywords && !state.enrichedKeywords.deselected.includes(kw);
    const togglePh3Kw = (kw) => {
      setState(s => {
        const ds = s.enrichedKeywords?.deselected || [];
        return {
          ...s,
          enrichedKeywords: {
            ...s.enrichedKeywords,
            deselected: ds.includes(kw) ? ds.filter(x => x !== kw) : [...ds, kw],
          },
        };
      });
    };
    const ph3SelectedCount = () => {
      if (!state.enrichedKeywords?.list) return 0;
      return state.enrichedKeywords.list.filter(item => isPh3Selected(item.keyword)).length;
    };

    // Map a keyword to its Phase 2 intent bucket (for colour-coding rows)
    const bucketOf = (keyword) => {
      const b = state.seedKeywords?.buckets;
      if (!b) return null;
      const target = normaliseKw(keyword);
      if ((b.informational || []).some(k => normaliseKw(k) === target)) return "informational";
      if ((b.commercial    || []).some(k => normaliseKw(k) === target)) return "commercial";
      if ((b.navigational  || []).some(k => normaliseKw(k) === target)) return "navigational";
      return null;
    };

    // Phase 4 — Competitor keyword discovery via DataForSEO Labs
    const [enrichingPh4, setEnrichingPh4] = useState(false);
    const [enrichErrorPh4, setEnrichErrorPh4] = useState(null);
    const [domainInput, setDomainInput] = useState("");
    // Local list of competitor domains being assembled before submitting.
    // Once submitted, the canonical list lives in state.competitors.domains.
    const [pendingDomains, setPendingDomains] = useState(() => {
      return state.competitors?.domains || [];
    });

    // Sync pendingDomains when the wizard state's competitors change
    // (e.g. when user switches sites or restores a session)
    useEffect(() => {
      setPendingDomains(state.competitors?.domains || []);
    }, [state.competitors?.domains, selectedSite]);

    // Strip protocol/www/paths to a bare hostname — matches worker's
    // normaliseDomain so what the user types matches what gets cached
    const normaliseDomain = (s) => String(s || "")
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .split("?")[0]
      .split(":")[0]
      .trim();

    const isValidDomain = (d) => d.includes(".") && d.length >= 4 && d.length <= 100 && !/\s/.test(d);

    const addDomain = () => {
      const v = normaliseDomain(domainInput);
      if (!v || !isValidDomain(v)) return;
      if (pendingDomains.includes(v)) {
        setDomainInput("");
        return;
      }
      if (pendingDomains.length >= 5) return;
      setPendingDomains([...pendingDomains, v]);
      setDomainInput("");
    };
    const removeDomain = (d) => setPendingDomains(pendingDomains.filter(x => x !== d));

    // ── AI competitor suggestions ────────────────────────────────
    // Asks the AI (Claude, via /api/ai) to suggest likely competitor
    // domains from the business profile the user already entered. These
    // are SUGGESTIONS ONLY — they pre-fill the review list and NEVER
    // trigger a DataForSEO pull on their own. The user checkbox-selects
    // the ones they want, clicks "Add selected", reviews/edits the chips,
    // then runs the existing paid analysis on confirmed domains only.
    const [suggesting, setSuggesting]       = useState(false);
    const [suggestError, setSuggestError]   = useState(null);
    // null = not yet asked; [] = asked but nothing usable; [...] = suggestions
    const [suggestions, setSuggestions]     = useState(null);
    // The geographic scale we inferred for the last suggestion run, shown to
    // the user so they can spot (and correct, by editing step 1) a wrong call.
    const [suggestScale, setSuggestScale]   = useState(null); // "local" | "national" | null
    // Set of domains the user has ticked in the suggestion list.
    const [selectedSuggestions, setSelectedSuggestions] = useState(new Set());

    const toggleSuggestion = (domain) => {
      setSelectedSuggestions(prev => {
        const next = new Set(prev);
        if (next.has(domain)) next.delete(domain); else next.add(domain);
        return next;
      });
    };

    // How many of the currently-selected suggestions can actually be added
    // given the 5-domain cap and any already-present chips.
    const addableSelectedCount = () => {
      const room = Math.max(0, 5 - pendingDomains.length);
      const notAlready = [...selectedSuggestions].filter(d => !pendingDomains.includes(d));
      return Math.min(room, notAlready.length);
    };

    const addSelectedSuggestions = () => {
      const room = Math.max(0, 5 - pendingDomains.length);
      if (room === 0) return;
      const toAdd = [...selectedSuggestions]
        .filter(d => !pendingDomains.includes(d))
        .slice(0, room);
      if (toAdd.length === 0) return;
      setPendingDomains([...pendingDomains, ...toAdd]);
      // Clear the ticks for the ones we just added; leave any overflow ticked
      // so the user can see what didn't fit.
      setSelectedSuggestions(prev => {
        const next = new Set(prev);
        toAdd.forEach(d => next.delete(d));
        return next;
      });
    };

    const suggestCompetitors = async () => {
      setSuggesting(true);
      setSuggestError(null);
      try {
        const p = state.profile || {};

        // Determine the business's geographic SCALE. An explicit coverage
        // choice from step 1 always wins; if the user left it blank we fall
        // back to inferring from the location text (the original behaviour).
        // This stops a local plumber being matched against national giants —
        // and a wasted DataForSEO pull on unwinnable national keywords.
        const loc = String(p.location || "").trim();
        const locLower = loc.toLowerCase();
        const NATIONWIDE_HINTS = [
          "uk", "u.k.", "united kingdom", "gb", "great britain", "britain",
          "england", "scotland", "wales", "northern ireland",
          "nationwide", "national", "nation-wide", "country-wide", "countrywide",
          "whole of the uk", "across the uk", "all of the uk", "remote", "online", "worldwide", "global",
        ];
        const explicit = ["local", "regional", "national"].includes(p.coverage) ? p.coverage : "";
        const inferred = (!loc || NATIONWIDE_HINTS.includes(locLower)) ? "national" : "local";
        const scale = explicit || inferred;
        setSuggestScale(scale);

        const scaleInstruction =
          scale === "local"
            ? `IMPORTANT — SCALE: This business competes at a LOCAL level, serving the area "${loc || "(their town/city)"}". Suggest competitors of a SIMILAR scale — other independent or single-location businesses serving the same town/area or immediately neighbouring areas. Do NOT suggest large national chains, multi-branch giants, marketplaces, or directories — a local operator cannot realistically compete with those, and including them would mislead the analysis. If you genuinely can't name local rivals, return fewer suggestions rather than padding the list with national brands.`
          : scale === "regional"
            ? `IMPORTANT — SCALE: This business competes at a REGIONAL level, based around "${loc || "their area"}". Suggest competitors operating across that wider region (multiple towns / a county or two), not tiny single-street operators and not UK-wide national giants. Aim for the middle ground.`
            : `SCALE: This business competes NATIONALLY across ${(p.country || "gb").toUpperCase()}${loc ? ` (it may be based in ${loc}, but serves the whole country)` : ""}. Suggest competitors that operate at a national level. Avoid purely local single-town operators.`;

        const profileLines = [
          p.businessName ? `Business name: ${p.businessName}` : "",
          p.description  ? `What they do: ${p.description}`    : "",
          (p.services && p.services.length) ? `Services/products: ${p.services.join(", ")}` : "",
          loc            ? `Location / area served: ${loc}` : "Location / area served: (not specified)",
          p.targetCustomer ? `Target customer: ${p.targetCustomer}` : "",
          `Country: ${(p.country || "gb").toUpperCase()}`,
        ].filter(Boolean).join("\n");

        const txt = await callClaude(
          `A business has the following profile:
${profileLines}

${scaleInstruction}

Suggest 5 to 8 REAL, likely direct competitor websites — businesses offering similar services to a similar audience, at the scale described above. Prefer genuine operators in their niche over generic directories or marketplaces.

For each, give the bare domain (hostname only, no http/www/paths) and a short reason (max 12 words) why they're a likely competitor — and where relevant, note their locality.

These are best-effort guesses from a description — if you are unsure, still suggest your most plausible candidates but keep the list realistic and scale-appropriate. Do not invent domains you don't believe exist.

Return ONLY valid JSON — no markdown:
{
  "suggestions": [
    { "domain": "example.com", "reason": "short reason" }
  ]
}`,
          "SEO competitor researcher. Return valid JSON only, no markdown. Domains must be bare hostnames (no protocol, no www, no path). Match competitors to the business's geographic SCALE — never pit a local operator against national giants. Suggest only plausible real businesses; never fabricate obviously fake domains.",
          "quality"
        );

        let parsed;
        try {
          parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
        } catch {
          setSuggestError("Couldn't read the AI suggestions. Please try again, or add competitors manually below.");
          setSuggesting(false);
          return;
        }

        // Normalise + validate with the SAME helpers the manual add uses, so
        // anything we surface is guaranteed addable. Dedupe and drop any that
        // are already in the pending list.
        const seen = new Set();
        const clean = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
          .map(s => ({
            domain: normaliseDomain(s?.domain),
            reason: String(s?.reason || "").trim().slice(0, 90),
          }))
          .filter(s => s.domain && isValidDomain(s.domain))
          .filter(s => {
            if (seen.has(s.domain)) return false;
            seen.add(s.domain);
            return true;
          });

        setSuggestions(clean);
        if (clean.length === 0) {
          setSuggestError("The AI couldn't suggest competitors from this profile. Try adding more detail in step 1, or add competitors manually below.");
        }
      } catch (e) {
        console.error("suggestCompetitors error:", e);
        // Mirror callClaude's known error signals
        const msg = String(e?.message || "");
        if (msg.startsWith("UPGRADE_REQUIRED:")) {
          setSuggestError("Suggestions need a paid plan. You can still add competitors manually below.");
        } else if (msg === "RATE_LIMITED") {
          setSuggestError("Too many AI requests just now — wait a moment and try again.");
        } else {
          setSuggestError("Couldn't get suggestions right now. You can add competitors manually below.");
        }
      }
      setSuggesting(false);
    };

    const fetchCompetitorKeywords = async () => {
      if (pendingDomains.length === 0) {
        setEnrichErrorPh4("Add at least one competitor domain.");
        return;
      }
      setEnrichingPh4(true);
      setEnrichErrorPh4(null);
      try {
        const res = await authFetch(`${WORKER_URL}/api/starting-out/competitor-keywords`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domains: pendingDomains,
            country: state.profile.country,
            limit: 50,
          }),
        });
        const data = await res.json();

        if (res.status === 402) {
          if (data.upgrade) {
            setEnrichErrorPh4("Competitor analysis is a Pro feature. Upgrade your plan to continue.");
          } else {
            setEnrichErrorPh4(`Monthly quota reached (${data.used}/${data.limit}). Resets next month.`);
          }
          setEnrichingPh4(false);
          return;
        }
        if (!res.ok) {
          setEnrichErrorPh4(data?.error || "Couldn't fetch competitor data — please try again.");
          setEnrichingPh4(false);
          return;
        }

        // Check if we got useful data — if every domain returned 0 keywords
        // it's likely a domain-not-in-DFS situation worth flagging
        const totalKeywords = (data.keywords || []).length;
        if (totalKeywords === 0) {
          setEnrichErrorPh4("No ranking keywords found for those domains. Either they don't have organic visibility, or DataForSEO doesn't have data for them. Try different competitors.");
          setEnrichingPh4(false);
          return;
        }

        setState(s => ({
          ...s,
          competitors: {
            domains: pendingDomains,
            list: data.keywords || [],
            competitorSummary: data.competitors || [],
            fetchedAt: new Date().toISOString(),
            quotaUsed:  data.quotaUsed  ?? null,
            quotaLimit: data.quotaLimit ?? null,
            country: state.profile.country,
            // Phase 4 default: NOTHING selected. User opts in to keywords
            // they want to add to their list (different model from Phase 2/3
            // where we default-select everything).
            selected: [],
          },
        }));
      } catch (err) {
        setEnrichErrorPh4("Couldn't reach the server — please check your connection.");
      }
      setEnrichingPh4(false);
    };

    const isCompetitorKwSelected = (kw) => {
      return !!state.competitors && state.competitors.selected.includes(kw);
    };
    const toggleCompetitorKw = (kw) => {
      setState(s => {
        const sel = s.competitors?.selected || [];
        return {
          ...s,
          competitors: {
            ...s.competitors,
            selected: sel.includes(kw) ? sel.filter(x => x !== kw) : [...sel, kw],
          },
        };
      });
    };
    const competitorSelectedCount = () => state.competitors?.selected?.length || 0;

    // Check whether a competitor keyword is already in the user's list
    // (from Phase 2 selected → Phase 3 selected). Lets us deprioritise
    // duplicates in the UI.
    const ph3SelectedSet = () => {
      const set = new Set();
      // Phase 3 enriched list, filtered by deselected
      (state.enrichedKeywords?.list || [])
        .filter(item => isPh3Selected(item.keyword))
        .forEach(item => set.add(normaliseKw(item.keyword)));
      // Plus Phase 2 selected (in case user came directly from there)
      selectedSeedKeywords().forEach(kw => set.add(normaliseKw(kw)));
      return set;
    };

    // Phase 5 — Recommended Target List (AI synthesis)
    const [generatingPh5, setGeneratingPh5] = useState(false);
    const [generateErrorPh5, setGenerateErrorPh5] = useState(null);

    // Build the unified candidate list from Phases 2/3/4 selections.
    // This is what gets sent to the AI for synthesis.
    const candidateKeywords = () => {
      const out = [];
      const seen = new Set();

      // Phase 3 enrichment lookup map
      const ph3Map = new Map();
      if (state.enrichedKeywords?.list) {
        for (const item of state.enrichedKeywords.list) {
          ph3Map.set(normaliseKw(item.keyword), item);
        }
      }

      // Phase 2 selected → enriched if available
      for (const kw of selectedSeedKeywords()) {
        const norm = normaliseKw(kw);
        if (seen.has(norm)) continue;
        const ph3 = ph3Map.get(norm);
        // Skip if user deselected in Phase 3 (only relevant if enrichment exists)
        if (ph3 && state.enrichedKeywords?.deselected?.includes(ph3.keyword)) continue;
        seen.add(norm);
        out.push({
          keyword: norm,
          intent: bucketOf(kw) || "unknown",
          volume: ph3?.volume ?? null,
          competitionIndex: ph3?.competitionIndex ?? null,
          source: "seed",
        });
      }

      // Phase 4 explicitly-selected competitor keywords
      if (state.competitors?.list && Array.isArray(state.competitors.selected)) {
        for (const item of state.competitors.list) {
          if (!state.competitors.selected.includes(item.keyword)) continue;
          const norm = normaliseKw(item.keyword);
          if (seen.has(norm)) continue;
          seen.add(norm);
          out.push({
            keyword: norm,
            intent: item.intent || "unknown",
            volume: item.volume ?? null,
            competitionIndex: item.competitionIndex ?? null,
            competitors: item.competitors?.length || 0,
            source: "competitor",
          });
        }
      }

      return out;
    };

    const generateRecommendedTargets = async () => {
      const candidates = candidateKeywords();
      if (candidates.length === 0) {
        setGenerateErrorPh5("No candidate keywords available — go back and select some.");
        return;
      }
      setGeneratingPh5(true);
      setGenerateErrorPh5(null);
      try {
        const res = await authFetch(`${WORKER_URL}/api/starting-out/recommended-targets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: state.profile,
            country: state.profile.country,
            candidates,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setGenerateErrorPh5(data?.error || "Couldn't generate target list — please try again.");
          setGeneratingPh5(false);
          return;
        }
        setState(s => ({
          ...s,
          targets: {
            summary: data.summary || "",
            list: Array.isArray(data.targets) ? data.targets : [],
            generatedAt: data.generatedAt,
            provider: data.provider,
            // All AI-recommended targets selected by default — user can deselect
            deselected: [],
          },
        }));
      } catch (err) {
        setGenerateErrorPh5("Couldn't reach the server — please check your connection.");
      }
      setGeneratingPh5(false);
    };

    const isTargetSelected = (kw) => {
      return !!state.targets && !state.targets.deselected.includes(kw);
    };
    const toggleTarget = (kw) => {
      setState(s => {
        const ds = s.targets?.deselected || [];
        return {
          ...s,
          targets: {
            ...s.targets,
            deselected: ds.includes(kw) ? ds.filter(x => x !== kw) : [...ds, kw],
          },
        };
      });
    };
    const targetSelectedCount = () => {
      if (!state.targets?.list) return 0;
      return state.targets.list.filter(t => isTargetSelected(t.keyword)).length;
    };

    // Phase 6 — Content Roadmap (AI synthesis)
    const [generatingPh6, setGeneratingPh6] = useState(false);
    const [generateErrorPh6, setGenerateErrorPh6] = useState(null);

    // Build the list of selected targets to send to the AI
    const selectedTargets = () => {
      if (!state.targets?.list) return [];
      return state.targets.list.filter(t => isTargetSelected(t.keyword));
    };

    const generateContentRoadmap = async () => {
      const targets = selectedTargets();
      if (targets.length === 0) {
        setGenerateErrorPh6("No targets selected — go back and pick at least one.");
        return;
      }
      setGeneratingPh6(true);
      setGenerateErrorPh6(null);
      try {
        const res = await authFetch(`${WORKER_URL}/api/starting-out/content-roadmap`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: state.profile,
            country: state.profile.country,
            targets,
            siteUrl: selectedSite || "",
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setGenerateErrorPh6(data?.error || "Couldn't generate roadmap — please try again.");
          setGeneratingPh6(false);
          return;
        }
        setState(s => ({
          ...s,
          roadmap: {
            summary: data.summary || "",
            items: Array.isArray(data.items) ? data.items : [],
            generatedAt: data.generatedAt,
            provider: data.provider,
          },
        }));
      } catch (err) {
        setGenerateErrorPh6("Couldn't reach the server — please check your connection.");
      }
      setGeneratingPh6(false);
    };

    // Mark wizard as complete and hand off to Strategy Planner.
    // Converts the AI-generated roadmap into the Strategy Planner's
    // pillar+clusters shape so users have a single home for their plan.
    const completeWizard = () => {
      const items = state.roadmap?.items || [];

      // Edge case: no roadmap → just mark complete and exit
      if (items.length === 0) {
        setState(s => ({ ...s, completed: true, completedAt: new Date().toISOString() }));
        setScreen("dashboard");
        return;
      }

      // Backup any existing strategy to history before replacing
      try {
        const existing = JSON.parse(localStorage.getItem(`ra_strategy_${selectedSite}`) || "null");
        if (existing && (existing.clusters || []).length > 0) {
          const histKey = `ra_strategy_history_${selectedSite}`;
          const hist = JSON.parse(localStorage.getItem(histKey) || "[]");
          hist.push({
            topic: existing.topic,
            date: existing.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
            clusters: (existing.clusters || []).map(c => c.keyword),
          });
          localStorage.setItem(histKey, JSON.stringify(hist.slice(-20)));
          saveUserData(selectedSite, 'strategy_history', hist.slice(-20));
        }
      } catch {}

      // Pick the pillar item — prefer authoritative content with broad scope
      // Priority: must-target guide > any guide > must-target > first item
      const pillarItem =
        items.find(i => i.contentType === "guide" && i.tier === "must") ||
        items.find(i => i.contentType === "guide") ||
        items.find(i => i.tier === "must") ||
        items[0];

      // Order remaining items by phase, then tier, then title
      const phaseOrder = { now: 0, soon: 1, later: 2 };
      const tierOrder  = { must: 0, opportunity: 1, "long-shot": 2 };
      const remaining = items.filter(i => i !== pillarItem).sort((a, b) => {
        const ap = phaseOrder[a.phase] ?? 99;
        const bp = phaseOrder[b.phase] ?? 99;
        if (ap !== bp) return ap - bp;
        const at = tierOrder[a.tier] ?? 99;
        const bt = tierOrder[b.tier] ?? 99;
        if (at !== bt) return at - bt;
        return (a.title || a.keyword).localeCompare(b.title || b.keyword);
      });

      const newStrategy = {
        topic: state.profile.businessName
          ? `${state.profile.businessName} — content roadmap`
          : "Starting Out content roadmap",
        reasoning: state.roadmap.summary || "Generated from Starting Out wizard",
        createdAt: new Date().toISOString(),
        source: "wizard",
        wizardCompletedAt: new Date().toISOString(),
        pillar: {
          keyword: pillarItem.keyword,
          title: pillarItem.title || pillarItem.keyword,
          description: pillarItem.angle || "",
          wordCount: pillarItem.wordCount || 1500,
          status: "not_started",
          url: "",
          // Wizard metadata — optional, won't affect non-wizard strategies
          contentType: pillarItem.contentType || "guide",
          phase:       pillarItem.phase || "now",
          tier:        pillarItem.tier || "must",
        },
        clusters: remaining.map((item, i) => ({
          id: `cluster-${i}`,
          keyword: item.keyword,
          title: item.title || item.keyword,
          description: item.angle || "",
          wordCount: item.wordCount || 1200,
          status: "not_started",
          url: "",
          angle: item.angle || "",
          contentType: item.contentType || "blog",
          phase:       item.phase || "soon",
          tier:        item.tier || "opportunity",
        })),
      };

      // Save the strategy and mark wizard complete
      try {
        saveUserData(selectedSite, 'strategy', newStrategy);
      } catch {}

      setState(s => ({
        ...s,
        completed: true,
        completedAt: new Date().toISOString(),
      }));

      // Hand off to Strategy Planner
      setScreen("strategy");
    };

    // Phase 1 validation — keep thresholds modest so users aren't blocked
    // by perfectionism, strict enough to give the AI useful signal
    const p = state.profile;
    const profileValid =
      p.businessName.trim().length >= 2 &&
      p.description.trim().length >= 20 &&
      p.services.length > 0 &&
      p.location.trim().length >= 2 &&
      p.targetCustomer.trim().length >= 10;

    // Services chip input
    const addService = () => {
      const v = serviceInput.trim().replace(/,$/, "");
      if (!v) return;
      if (v.length > 60) return;
      if (p.services.some(s => s.toLowerCase() === v.toLowerCase())) {
        setServiceInput("");
        return;
      }
      if (p.services.length >= 10) return;
      updateProfile({ services: [...p.services, v] });
      setServiceInput("");
    };
    const removeService = (s) => updateProfile({ services: p.services.filter(x => x !== s) });

    const inputStyle = {
      width: "100%",
      background: "var(--bg)",
      border: "1.5px solid var(--border)",
      borderRadius: 8,
      padding: ".7rem .9rem",
      color: "var(--text)",
      fontFamily: "inherit",
      fontSize: ".88rem",
      outline: "none",
      transition: "border-color .15s",
    };
    const labelStyle = {
      display: "block",
      fontSize: ".78rem",
      fontWeight: 600,
      color: "var(--text)",
      marginBottom: ".4rem",
    };
    const helpStyle = {
      fontSize: ".72rem",
      color: "var(--text3)",
      marginTop: ".35rem",
      lineHeight: 1.5,
    };
    const requiredMark = <span style={{ color: "var(--green)", marginLeft: ".15rem" }}>*</span>;

    const COUNTRIES = [
      { code: "gb", name: "United Kingdom" },
      { code: "us", name: "United States" },
      { code: "ca", name: "Canada" },
      { code: "au", name: "Australia" },
      { code: "ie", name: "Ireland" },
      { code: "nz", name: "New Zealand" },
    ];

    return (
      <div className="content" style={{ maxWidth: 760, margin: "0 auto", padding: "1.25rem 1rem 4rem" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.75rem", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 280px" }}>
            <div style={{ fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".14em", color: "var(--green)", fontWeight: 700, marginBottom: ".3rem" }}>
              🚀 Starting Out
            </div>
            <div style={{ fontSize: "1.45rem", fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.2, color: "var(--text)" }}>
              Build your SEO foundation
            </div>
            <div style={{ fontSize: ".82rem", color: "var(--text2)", marginTop: ".35rem", lineHeight: 1.5 }}>
              {STEPS[state.currentStep - 1].sub}
            </div>
          </div>
          <button onClick={() => setScreen("dashboard")}
            style={{ background: "var(--s2)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 7, padding: ".5rem .9rem", fontSize: ".78rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
            Save & exit
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ marginBottom: "1.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".5rem", fontSize: ".75rem", color: "var(--text2)" }}>
            <span>Step {state.currentStep} of {STEPS.length}</span>
            <span style={{ color: "var(--text3)" }}>{Math.round((state.currentStep / STEPS.length) * 100)}% complete</span>
          </div>
          <div style={{ height: 4, background: "var(--s1)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(state.currentStep / STEPS.length) * 100}%`, background: "var(--green)", transition: "width .3s ease" }} />
          </div>
          {/* Desktop step labels — hidden on narrow screens via media-style flex behaviour */}
          <div style={{ display: "flex", marginTop: ".85rem", gap: ".4rem", flexWrap: "wrap" }}>
            {STEPS.map(step => {
              const isCurrent = state.currentStep === step.num;
              const isDone = state.currentStep > step.num;
              const canClick = isDone;
              return (
                <div key={step.id}
                  onClick={() => canClick && goToStep(step.num)}
                  style={{
                    fontSize: ".68rem",
                    color: isCurrent ? "var(--green)" : isDone ? "var(--text2)" : "var(--text3)",
                    fontWeight: isCurrent ? 700 : 500,
                    cursor: canClick ? "pointer" : "default",
                    flex: "1 1 90px",
                    minWidth: 80,
                    textAlign: "center",
                    padding: ".25rem 0",
                    borderTop: isCurrent ? "2px solid var(--green)" : isDone ? "2px solid var(--text3)" : "2px solid var(--border)",
                    transition: "border-color .15s",
                  }}>
                  {isDone && "✓ "}{step.num}. {step.title}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Step 1: Business Profile ───────────────────────────── */}
        {state.currentStep === 1 && (
          <>
            <div style={{ background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.5rem 1.25rem" }}>
              {/* Business name */}
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={labelStyle}>Business name{requiredMark}</label>
                <input type="text" value={p.businessName}
                  onChange={e => updateProfile({ businessName: e.target.value })}
                  placeholder="e.g. Acme Plumbing Services"
                  maxLength={120}
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = "var(--green)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"} />
              </div>

              {/* Description */}
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={labelStyle}>What does your business do?{requiredMark}</label>
                <textarea value={p.description}
                  onChange={e => updateProfile({ description: e.target.value })}
                  placeholder="e.g. We're a family-run plumbing firm serving homeowners across Birmingham. We handle emergency call-outs, boiler installations, bathroom refits, and routine maintenance."
                  rows={3}
                  maxLength={500}
                  style={{ ...inputStyle, resize: "vertical", minHeight: 80, fontFamily: "inherit", lineHeight: 1.5 }}
                  onFocus={e => e.target.style.borderColor = "var(--green)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"} />
                <div style={{ ...helpStyle, display: "flex", justifyContent: "space-between" }}>
                  <span>Be specific — this is what the AI uses to find your keywords.</span>
                  <span style={{ color: p.description.length >= 20 ? "var(--text2)" : "var(--text3)" }}>{p.description.length}/500</span>
                </div>
              </div>

              {/* Services chips */}
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={labelStyle}>Your services or specialties{requiredMark}</label>
                <div style={{ display: "flex", gap: ".4rem", marginBottom: p.services.length > 0 ? ".6rem" : 0 }}>
                  <input type="text" value={serviceInput}
                    onChange={e => {
                      const v = e.target.value;
                      // Auto-add on comma
                      if (v.endsWith(",")) {
                        setServiceInput(v.slice(0, -1));
                        setTimeout(addService, 0);
                      } else {
                        setServiceInput(v);
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addService();
                      } else if (e.key === "Backspace" && serviceInput === "" && p.services.length > 0) {
                        removeService(p.services[p.services.length - 1]);
                      }
                    }}
                    placeholder={p.services.length === 0 ? "e.g. Boiler repair (press Enter to add)" : "Add another…"}
                    maxLength={60}
                    disabled={p.services.length >= 10}
                    style={{ ...inputStyle, flex: 1 }}
                    onFocus={e => e.target.style.borderColor = "var(--green)"}
                    onBlur={e => e.target.style.borderColor = "var(--border)"} />
                  <button type="button" onClick={addService}
                    disabled={!serviceInput.trim() || p.services.length >= 10}
                    style={{
                      background: serviceInput.trim() && p.services.length < 10 ? "var(--green)" : "var(--s2)",
                      color: serviceInput.trim() && p.services.length < 10 ? "#000" : "var(--text3)",
                      border: "none",
                      borderRadius: 8,
                      padding: ".7rem 1rem",
                      fontSize: ".82rem",
                      fontWeight: 700,
                      cursor: serviceInput.trim() && p.services.length < 10 ? "pointer" : "not-allowed",
                      fontFamily: "inherit",
                      flexShrink: 0,
                    }}>
                    Add
                  </button>
                </div>
                {p.services.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem" }}>
                    {p.services.map(s => (
                      <span key={s} style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: ".4rem",
                        background: "var(--gdim)",
                        color: "var(--green)",
                        border: "1px solid rgba(15,219,138,.25)",
                        borderRadius: 16,
                        padding: ".3rem .65rem .3rem .8rem",
                        fontSize: ".78rem",
                        fontWeight: 500,
                      }}>
                        {s}
                        <button type="button" onClick={() => removeService(s)}
                          aria-label={`Remove ${s}`}
                          style={{ background: "transparent", border: "none", color: "var(--green)", cursor: "pointer", fontSize: ".95rem", lineHeight: 1, padding: 0, opacity: .65, fontFamily: "inherit" }}
                          onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                          onMouseLeave={e => e.currentTarget.style.opacity = ".65"}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div style={helpStyle}>
                  {p.services.length}/10 services · Press Enter or comma to add. Backspace removes the last one.
                </div>
              </div>

              {/* Location */}
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={labelStyle}>Where do you serve customers?{requiredMark}</label>
                <input type="text" value={p.location}
                  onChange={e => updateProfile({ location: e.target.value })}
                  placeholder="e.g. Birmingham and the West Midlands"
                  maxLength={120}
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = "var(--green)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"} />
                <div style={helpStyle}>City, region, or "UK-wide" if you serve customers nationally or remotely.</div>

                {/* Coverage scale — explicit control so we match competitors and
                    keywords to the right scale instead of guessing from the text. */}
                <div style={{ marginTop: ".85rem" }}>
                  <label style={{ ...labelStyle, fontSize: ".78rem" }}>How far do you compete?</label>
                  <div style={{ display: "flex", background: "var(--s2)", borderRadius: 999, padding: 3, gap: 3 }}>
                    {[
                      ["local",    "Local"],
                      ["regional", "Regional"],
                      ["national", "National"],
                    ].map(([id, lab]) => (
                      <button key={id} type="button"
                        onClick={() => updateProfile({ coverage: p.coverage === id ? "" : id })}
                        style={{
                          flex: 1, padding: ".5rem", borderRadius: 999, border: "none",
                          fontFamily: "inherit", fontSize: ".8rem", fontWeight: 600,
                          cursor: "pointer",
                          background: p.coverage === id ? "var(--green)" : "transparent",
                          color: p.coverage === id ? "#000" : "var(--text2)",
                          transition: "all .15s",
                        }}>
                        {lab}
                      </button>
                    ))}
                  </div>
                  <div style={helpStyle}>
                    {p.coverage === "local"    ? "We'll suggest nearby competitors at your scale — not national chains."
                     : p.coverage === "regional" ? "We'll suggest competitors across your wider region."
                     : p.coverage === "national" ? "We'll suggest national competitors, even if you're based in one town."
                     : "Optional — leave blank and we'll work it out from your location above."}
                  </div>
                </div>
              </div>

              {/* Target customer */}
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={labelStyle}>Who's your ideal customer?{requiredMark}</label>
                <textarea value={p.targetCustomer}
                  onChange={e => updateProfile({ targetCustomer: e.target.value })}
                  placeholder="e.g. Homeowners aged 35-65 in mid-to-high income areas, typically dealing with an urgent boiler problem or planning a bathroom upgrade."
                  rows={2}
                  maxLength={400}
                  style={{ ...inputStyle, resize: "vertical", minHeight: 64, fontFamily: "inherit", lineHeight: 1.5 }}
                  onFocus={e => e.target.style.borderColor = "var(--green)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"} />
                <div style={{ ...helpStyle, display: "flex", justifyContent: "space-between" }}>
                  <span>Demographics, situation, what they're trying to solve.</span>
                  <span style={{ color: p.targetCustomer.length >= 10 ? "var(--text2)" : "var(--text3)" }}>{p.targetCustomer.length}/400</span>
                </div>
              </div>

              {/* Country */}
              <div style={{ marginBottom: 0 }}>
                <label style={labelStyle}>Primary market</label>
                <select value={p.country}
                  onChange={e => updateProfile({ country: e.target.value })}
                  style={{ ...inputStyle, cursor: "pointer", appearance: "none", backgroundImage: "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3e%3cpath fill='%238590b8' d='M6 8L0 0h12z'/%3e%3c/svg%3e\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 1rem center", paddingRight: "2.5rem" }}>
                  {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
                <div style={helpStyle}>Used to fetch country-specific search volumes from DataForSEO.</div>
              </div>
            </div>

            {/* Continue button */}
            <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
              <button onClick={() => goToStep(2)}
                disabled={!profileValid}
                style={{
                  flex: "1 1 200px",
                  background: profileValid ? "var(--green)" : "var(--s2)",
                  color: profileValid ? "#000" : "var(--text3)",
                  border: "none",
                  borderRadius: 8,
                  padding: ".85rem 1.25rem",
                  fontSize: ".9rem",
                  fontWeight: 700,
                  cursor: profileValid ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                  transition: "background .15s",
                }}>
                Continue to seed keywords →
              </button>
            </div>
            {!profileValid && (p.businessName || p.description || p.services.length || p.location || p.targetCustomer) && (
              <div style={{ marginTop: ".75rem", fontSize: ".75rem", color: "var(--text3)", textAlign: "center" }}>
                Fill in all required fields (marked <span style={{ color: "var(--green)" }}>*</span>) to continue.
              </div>
            )}

            {/* Why we need this — context card */}
            <div style={{ marginTop: "2rem", background: "rgba(77,123,255,.06)", border: "1px solid rgba(77,123,255,.2)", borderRadius: 10, padding: "1rem 1.1rem" }}>
              <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--blue)", marginBottom: ".4rem" }}>
                💡 Why we need this
              </div>
              <div style={{ fontSize: ".78rem", color: "var(--text2)", lineHeight: 1.6 }}>
                Without Google Search Console data, we can't see what people are already finding you for. So we work backwards from what your business does, where you operate, and who you serve. The more specific you are here, the more useful the keywords we suggest in the next step.
              </div>
            </div>
          </>
        )}

        {/* ── Step 2: Seed Keywords ──────────────────────────────── */}
        {state.currentStep === 2 && (
          <>
            {/* Empty state — no keywords generated yet */}
            {!state.seedKeywords && (
              <div style={{ background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.75rem 1.5rem" }}>
                <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: ".75rem" }}>🤖</div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text)", marginBottom: ".5rem" }}>
                    Generate your seed keywords
                  </div>
                  <div style={{ fontSize: ".85rem", color: "var(--text2)", maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>
                    AI will suggest 24 starter keywords based on your profile, organised by search intent. You'll review and refine them next.
                  </div>
                </div>

                {/* Profile preview — so user can sanity-check what AI will see */}
                <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "1rem", marginBottom: "1.25rem" }}>
                  <div style={{ color: "var(--text3)", fontWeight: 700, fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: ".5rem" }}>
                    Generating for
                  </div>
                  <div style={{ color: "var(--text)", fontWeight: 600, fontSize: ".88rem", marginBottom: ".3rem" }}>{p.businessName}</div>
                  <div style={{ color: "var(--text2)", fontSize: ".78rem", lineHeight: 1.5, marginBottom: ".5rem" }}>{p.description}</div>
                  <div style={{ color: "var(--text3)", fontSize: ".72rem", lineHeight: 1.5 }}>
                    <strong style={{ color: "var(--text2)" }}>Services:</strong> {p.services.join(" · ")}
                    <br />
                    <strong style={{ color: "var(--text2)" }}>Location:</strong> {p.location} · <strong style={{ color: "var(--text2)" }}>Market:</strong> {COUNTRIES.find(c => c.code === p.country)?.name}
                  </div>
                </div>

                {generateError && (
                  <div style={{ background: "var(--rdim)", border: "1px solid rgba(240,62,95,.3)", borderRadius: 8, padding: ".75rem 1rem", color: "var(--red)", fontSize: ".82rem", marginBottom: "1rem", lineHeight: 1.5 }}>
                    {generateError}
                  </div>
                )}

                <button onClick={generateSeedKeywords} disabled={generating}
                  style={{
                    width: "100%",
                    background: generating ? "var(--s2)" : "var(--green)",
                    color: generating ? "var(--text3)" : "#000",
                    border: "none",
                    borderRadius: 8,
                    padding: ".9rem 1.25rem",
                    fontSize: ".9rem",
                    fontWeight: 700,
                    cursor: generating ? "wait" : "pointer",
                    fontFamily: "inherit",
                  }}>
                  {generating ? "🤖 Generating keywords… (10-20s)" : "✨ Generate keywords"}
                </button>

                <div style={{ marginTop: ".75rem", fontSize: ".72rem", color: "var(--text3)", textAlign: "center", lineHeight: 1.5 }}>
                  Don't worry — this doesn't use any of your DataForSEO quota. Real keyword data comes in the next step.
                </div>
              </div>
            )}

            {/* Result state — keywords loaded, render buckets */}
            {state.seedKeywords && (() => {
              const total = allSeedKeywords().length;
              const selected = selectedSeedKeywords().length;
              const handleRegenerate = () => {
                if (window.confirm("Regenerate will replace your current keywords. Your selections will be lost. Continue?")) {
                  generateSeedKeywords();
                }
              };
              const buckets = [
                { key: "informational", title: "Informational", desc: "Questions and educational queries — early-funnel traffic", color: "var(--blue)", bg: "rgba(77,123,255,.06)", border: "rgba(77,123,255,.2)" },
                { key: "commercial",    title: "Commercial",    desc: "Research queries from people close to buying",        color: "var(--amber)", bg: "rgba(245,166,35,.06)", border: "rgba(245,166,35,.2)" },
                { key: "navigational",  title: "Transactional", desc: "High-intent queries — ready to engage now",            color: "var(--green)", bg: "rgba(15,219,138,.06)", border: "rgba(15,219,138,.2)" },
              ];
              return (
                <>
                  {/* Summary header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: ".75rem", padding: ".75rem 1rem", background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: ".88rem", fontWeight: 700, color: "var(--text)" }}>
                        Review your keywords
                      </div>
                      <div style={{ fontSize: ".74rem", color: "var(--text2)", marginTop: ".15rem" }}>
                        <strong style={{ color: "var(--green)" }}>{selected}</strong> of {total} selected
                        {state.seedKeywords.provider && <> · via {state.seedKeywords.provider}</>}
                      </div>
                    </div>
                    <button onClick={handleRegenerate} disabled={generating}
                      style={{ background: "var(--s2)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 7, padding: ".45rem .85rem", fontSize: ".75rem", fontWeight: 600, cursor: generating ? "wait" : "pointer", fontFamily: "inherit" }}>
                      {generating ? "Regenerating…" : "↻ Regenerate"}
                    </button>
                  </div>

                  {generateError && (
                    <div style={{ background: "var(--rdim)", border: "1px solid rgba(240,62,95,.3)", borderRadius: 8, padding: ".75rem 1rem", color: "var(--red)", fontSize: ".82rem", marginBottom: "1rem", lineHeight: 1.5 }}>
                      {generateError}
                    </div>
                  )}

                  {/* Three intent buckets */}
                  {buckets.map(bucket => {
                    const items = state.seedKeywords.buckets[bucket.key] || [];
                    if (items.length === 0) return null;
                    const bucketSelected = items.filter(kw => isKwSelected(kw)).length;
                    return (
                      <div key={bucket.key} style={{ background: bucket.bg, border: `1px solid ${bucket.border}`, borderRadius: 12, padding: "1rem 1.1rem", marginBottom: ".85rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: ".25rem" }}>
                          <div style={{ fontSize: ".85rem", fontWeight: 700, color: bucket.color }}>{bucket.title}</div>
                          <div style={{ fontSize: ".7rem", color: "var(--text3)", fontFamily: "var(--mono)" }}>{bucketSelected}/{items.length}</div>
                        </div>
                        <div style={{ fontSize: ".72rem", color: "var(--text2)", marginBottom: ".85rem", lineHeight: 1.5 }}>
                          {bucket.desc}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem" }}>
                          {items.map(kw => {
                            const sel = isKwSelected(kw);
                            return (
                              <button key={kw} type="button" onClick={() => toggleKw(kw)}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: ".4rem",
                                  background: sel ? "var(--gdim)" : "var(--bg)",
                                  color: sel ? "var(--green)" : "var(--text3)",
                                  border: sel ? "1px solid rgba(15,219,138,.35)" : "1px solid var(--border)",
                                  borderRadius: 16,
                                  padding: ".35rem .75rem",
                                  fontSize: ".78rem",
                                  fontWeight: 500,
                                  cursor: "pointer",
                                  fontFamily: "inherit",
                                  transition: "all .12s",
                                  textAlign: "left",
                                }}>
                                <span style={{ fontSize: ".8rem", lineHeight: 1, opacity: sel ? 1 : .5 }}>{sel ? "✓" : "○"}</span>
                                {kw}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* Navigation buttons */}
                  <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                    <button onClick={() => goToStep(1)}
                      style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" }}>
                      ← Back
                    </button>
                    <button onClick={() => goToStep(3)} disabled={selected < 1}
                      style={{
                        flex: "1 1 200px",
                        background: selected < 1 ? "var(--s2)" : "var(--green)",
                        color: selected < 1 ? "var(--text3)" : "#000",
                        border: "none",
                        borderRadius: 8,
                        padding: ".75rem 1.1rem",
                        fontSize: ".85rem",
                        fontWeight: 700,
                        cursor: selected < 1 ? "not-allowed" : "pointer",
                        fontFamily: "inherit",
                      }}>
                      Continue with {selected} keyword{selected === 1 ? "" : "s"} →
                    </button>
                  </div>
                  {selected < 1 && (
                    <div style={{ marginTop: ".75rem", fontSize: ".75rem", color: "var(--text3)", textAlign: "center" }}>
                      Select at least one keyword to continue.
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}

        {/* ── Step 3: Real Keyword Data (DataForSEO) ─────────────── */}
        {state.currentStep === 3 && (() => {
          const seedSelected = selectedSeedKeywords();
          const tooMany = seedSelected.length > 50;

          // Empty state — no DFS data yet
          if (!state.enrichedKeywords) {
            // Free/Starter — show locked card
            if (!isPro) {
              return (
                <>
                  <div style={{ background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.75rem 1.5rem", textAlign: "center" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: ".75rem" }}>🔒</div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text)", marginBottom: ".5rem" }}>
                      Real keyword data is a Pro feature
                    </div>
                    <div style={{ fontSize: ".85rem", color: "var(--text2)", maxWidth: 480, margin: "0 auto 1.25rem", lineHeight: 1.6 }}>
                      Upgrade to a paid plan to pull real monthly search volume and difficulty scores from DataForSEO. You'll see exactly which of your seed keywords are worth targeting — and which to skip.
                    </div>
                    <button onClick={() => setShowUpgrade(true)}
                      style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: 8, padding: ".75rem 1.5rem", fontSize: ".88rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      ✨ Upgrade
                    </button>
                  </div>
                  <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                    <button onClick={() => goToStep(2)}
                      style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" }}>
                      ← Back
                    </button>
                    <button onClick={() => setScreen("dashboard")}
                      style={{ flex: "1 1 200px", background: "var(--s2)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      Save & return to dashboard
                    </button>
                  </div>
                </>
              );
            }

            // Pro+ — show pre-fetch card with quota warning
            return (
              <>
                <div style={{ background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.75rem 1.5rem" }}>
                  <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: ".75rem" }}>📊</div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text)", marginBottom: ".5rem" }}>
                      Get real keyword data
                    </div>
                    <div style={{ fontSize: ".85rem", color: "var(--text2)", maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>
                      We'll look up monthly search volume and difficulty from DataForSEO for the <strong style={{ color: "var(--text)" }}>{seedSelected.length}</strong> keyword{seedSelected.length === 1 ? "" : "s"} you've selected.
                    </div>
                  </div>

                  {/* Quota warning */}
                  <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "1rem", marginBottom: "1rem", fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.55 }}>
                    <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: ".3rem" }}>
                      ⚠ This will use 1 DataForSEO session
                    </div>
                    Your plan includes monthly DataForSEO sessions for keyword research. Each batch up to 50 keywords counts as 1 session. Cached keywords don't count.
                  </div>

                  {tooMany && (
                    <div style={{ background: "var(--adim)", border: "1px solid rgba(245,166,35,.3)", borderRadius: 8, padding: ".75rem 1rem", color: "var(--amber)", fontSize: ".82rem", marginBottom: "1rem", lineHeight: 1.5 }}>
                      You've selected {seedSelected.length} keywords. The maximum is 50 per session — go back to Step 2 and deselect some before continuing.
                    </div>
                  )}

                  {enrichErrorPh3 && (
                    <div style={{ background: "var(--rdim)", border: "1px solid rgba(240,62,95,.3)", borderRadius: 8, padding: ".75rem 1rem", color: "var(--red)", fontSize: ".82rem", marginBottom: "1rem", lineHeight: 1.5 }}>
                      {enrichErrorPh3}
                    </div>
                  )}

                  <button onClick={fetchKeywordData} disabled={enrichingPh3 || tooMany || seedSelected.length === 0}
                    style={{
                      width: "100%",
                      background: enrichingPh3 || tooMany || seedSelected.length === 0 ? "var(--s2)" : "var(--green)",
                      color: enrichingPh3 || tooMany || seedSelected.length === 0 ? "var(--text3)" : "#000",
                      border: "none",
                      borderRadius: 8,
                      padding: ".9rem 1.25rem",
                      fontSize: ".9rem",
                      fontWeight: 700,
                      cursor: enrichingPh3 ? "wait" : tooMany || seedSelected.length === 0 ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}>
                    {enrichingPh3 ? "📊 Fetching keyword data… (5-15s)" : `📊 Get keyword data for ${seedSelected.length} keyword${seedSelected.length === 1 ? "" : "s"}`}
                  </button>
                </div>

                <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                  <button onClick={() => goToStep(2)} disabled={enrichingPh3}
                    style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: enrichingPh3 ? "wait" : "pointer", fontFamily: "inherit", flex: "0 0 auto" }}>
                    ← Back
                  </button>
                </div>
              </>
            );
          }

          // Result state — DFS data loaded
          const list = state.enrichedKeywords.list || [];
          // Sort: keywords with data first (by volume desc), no-data last
          const sorted = [...list].sort((a, b) => {
            const av = a.volume == null ? -1 : a.volume;
            const bv = b.volume == null ? -1 : b.volume;
            return bv - av;
          });
          const withData = sorted.filter(k => k.volume != null || k.competitionIndex != null);
          const withoutData = sorted.filter(k => k.volume == null && k.competitionIndex == null);

          const handleRefresh = () => {
            if (window.confirm("Refresh will use another DataForSEO session and reset your selections here. Continue?")) {
              setState(s => ({ ...s, enrichedKeywords: null }));
              // Schedule the fetch after state update flushes
              setTimeout(() => fetchKeywordData(), 0);
            }
          };

          const BUCKET_COLORS = {
            informational: { color: "var(--blue)",  label: "Info" },
            commercial:    { color: "var(--amber)", label: "Comm" },
            navigational:  { color: "var(--green)", label: "Trans" },
          };

          const renderRow = (item) => {
            const sel = isPh3Selected(item.keyword);
            const vol = item.volume;
            const comp = item.competitionIndex;
            const compLabel = comp == null ? "—" : comp < 33 ? "Easy" : comp < 66 ? "Medium" : "Hard";
            const compColor = comp == null ? "var(--text3)" : comp < 33 ? "var(--green)" : comp < 66 ? "var(--amber)" : "var(--red)";
            const bucket = bucketOf(item.keyword);
            const bMeta = bucket ? BUCKET_COLORS[bucket] : null;

            return (
              <div key={item.keyword}
                onClick={() => togglePh3Kw(item.keyword)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ".75rem",
                  padding: ".7rem .9rem",
                  background: sel ? "var(--gdim)" : "var(--bg)",
                  border: sel ? "1px solid rgba(15,219,138,.3)" : "1px solid var(--border)",
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "background .12s, border-color .12s",
                  marginBottom: ".4rem",
                }}>
                <span style={{ fontSize: ".95rem", lineHeight: 1, opacity: sel ? 1 : .4, color: sel ? "var(--green)" : "var(--text3)", flexShrink: 0, width: 14, textAlign: "center" }}>
                  {sel ? "✓" : "○"}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: ".84rem", color: sel ? "var(--text)" : "var(--text2)", fontWeight: 500, wordBreak: "break-word" }}>
                    {item.keyword}
                  </span>
                  {bMeta && (
                    <span style={{ fontSize: ".62rem", padding: ".1rem .4rem", borderRadius: 4, background: "transparent", border: `1px solid ${bMeta.color}`, color: bMeta.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", flexShrink: 0 }}>
                      {bMeta.label}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: ".75rem", fontFamily: "var(--mono)", color: vol == null ? "var(--text3)" : "var(--text)", flexShrink: 0, minWidth: 70, textAlign: "right" }}>
                  {vol == null ? "—" : `${vol.toLocaleString()}/mo`}
                </div>
                <div style={{ fontSize: ".72rem", fontWeight: 600, color: compColor, flexShrink: 0, minWidth: 52, textAlign: "right" }}>
                  {compLabel}
                </div>
              </div>
            );
          };

          const totalSelected = ph3SelectedCount();

          return (
            <>
              {/* Summary header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: ".75rem", padding: ".75rem 1rem", background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 10 }}>
                <div>
                  <div style={{ fontSize: ".88rem", fontWeight: 700, color: "var(--text)" }}>
                    Real keyword data
                  </div>
                  <div style={{ fontSize: ".74rem", color: "var(--text2)", marginTop: ".15rem" }}>
                    <strong style={{ color: "var(--green)" }}>{totalSelected}</strong> of {list.length} selected
                    {state.enrichedKeywords.quotaLimit != null && (
                      <> · Quota: {state.enrichedKeywords.quotaUsed}/{state.enrichedKeywords.quotaLimit} this month</>
                    )}
                  </div>
                </div>
                <button onClick={handleRefresh} disabled={enrichingPh3}
                  style={{ background: "var(--s2)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 7, padding: ".45rem .85rem", fontSize: ".75rem", fontWeight: 600, cursor: enrichingPh3 ? "wait" : "pointer", fontFamily: "inherit" }}>
                  {enrichingPh3 ? "Refreshing…" : "↻ Refresh data"}
                </button>
              </div>

              {enrichErrorPh3 && (
                <div style={{ background: "var(--adim)", border: "1px solid rgba(245,166,35,.3)", borderRadius: 8, padding: ".75rem 1rem", color: "var(--amber)", fontSize: ".82rem", marginBottom: "1rem", lineHeight: 1.5 }}>
                  {enrichErrorPh3}
                </div>
              )}

              {/* Column header strip */}
              <div style={{ display: "flex", alignItems: "center", gap: ".75rem", padding: "0 .9rem .35rem", fontSize: ".68rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }}>
                <span style={{ width: 14, flexShrink: 0 }}> </span>
                <span style={{ flex: 1 }}>Keyword</span>
                <span style={{ minWidth: 70, textAlign: "right" }}>Volume</span>
                <span style={{ minWidth: 52, textAlign: "right" }}>Difficulty</span>
              </div>

              {/* Rows with data */}
              <div style={{ marginBottom: withoutData.length > 0 ? "1rem" : 0 }}>
                {withData.map(renderRow)}
              </div>

              {/* No-data section, collapsed visually */}
              {withoutData.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: ".72rem", color: "var(--text3)", padding: "0 .9rem .4rem", fontWeight: 600 }}>
                    No data available ({withoutData.length})
                  </div>
                  {withoutData.map(renderRow)}
                </div>
              )}

              {/* Insight footer — interpretation help */}
              <div style={{ background: "rgba(77,123,255,.06)", border: "1px solid rgba(77,123,255,.2)", borderRadius: 10, padding: "1rem 1.1rem", marginBottom: "1rem" }}>
                <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--blue)", marginBottom: ".4rem" }}>
                  💡 How to read this
                </div>
                <div style={{ fontSize: ".77rem", color: "var(--text2)", lineHeight: 1.6 }}>
                  Sub-100 volumes are common for niche B2B searches and are still worth targeting if intent is high. "Easy" reflects Google Ads competition, not organic SEO difficulty — treat it as directional. Keep keywords with no data only if you have strong reason to think they convert.
                </div>
              </div>

              {/* Navigation */}
              <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                <button onClick={() => goToStep(2)}
                  style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" }}>
                  ← Back
                </button>
                <button onClick={() => goToStep(4)} disabled={totalSelected < 1}
                  style={{
                    flex: "1 1 200px",
                    background: totalSelected < 1 ? "var(--s2)" : "var(--green)",
                    color: totalSelected < 1 ? "var(--text3)" : "#000",
                    border: "none",
                    borderRadius: 8,
                    padding: ".75rem 1.1rem",
                    fontSize: ".85rem",
                    fontWeight: 700,
                    cursor: totalSelected < 1 ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}>
                  Continue with {totalSelected} keyword{totalSelected === 1 ? "" : "s"} →
                </button>
              </div>
              {totalSelected < 1 && (
                <div style={{ marginTop: ".75rem", fontSize: ".75rem", color: "var(--text3)", textAlign: "center" }}>
                  Select at least one keyword to continue.
                </div>
              )}
            </>
          );
        })()}

        {/* ── Step 4: Competitor Keyword Discovery ───────────────── */}
        {state.currentStep === 4 && (() => {
          // Empty state — no competitor data yet
          if (!state.competitors) {
            // Free/Starter — locked
            if (!isPro) {
              return (
                <>
                  <div style={{ background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.75rem 1.5rem", textAlign: "center" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: ".75rem" }}>🔒</div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text)", marginBottom: ".5rem" }}>
                      Competitor analysis is a Pro feature
                    </div>
                    <div style={{ fontSize: ".85rem", color: "var(--text2)", maxWidth: 480, margin: "0 auto 1.25rem", lineHeight: 1.6 }}>
                      Upgrade to a paid plan to discover what your competitors are ranking for. We'll pull their top keywords from DataForSEO Labs and surface gaps you should be targeting.
                    </div>
                    <button onClick={() => setShowUpgrade(true)}
                      style={{ background: "var(--green)", color: "#000", border: "none", borderRadius: 8, padding: ".75rem 1.5rem", fontSize: ".88rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      ✨ Upgrade
                    </button>
                  </div>
                  <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                    <button onClick={() => goToStep(3)}
                      style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" }}>
                      ← Back
                    </button>
                    <button onClick={() => setScreen("dashboard")}
                      style={{ flex: "1 1 200px", background: "var(--s2)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      Save & return to dashboard
                    </button>
                  </div>
                </>
              );
            }

            // Pro+ — domain input
            return (
              <>
                <div style={{ background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.75rem 1.5rem" }}>
                  <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: ".75rem" }}>🔍</div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text)", marginBottom: ".5rem" }}>
                      Find what your competitors rank for
                    </div>
                    <div style={{ fontSize: ".85rem", color: "var(--text2)", maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>
                      Add up to 5 competitor websites. We'll pull their top organic keywords from DataForSEO and show you opportunities you might have missed.
                    </div>
                  </div>

                  {/* AI competitor suggestions — review/select, never auto-pulls DFS */}
                  <div style={{ marginBottom: "1.25rem" }}>
                    {suggestions === null ? (
                      <button type="button" onClick={suggestCompetitors} disabled={suggesting}
                        style={{
                          width: "100%",
                          background: suggesting ? "var(--s2)" : "var(--bdim)",
                          color: suggesting ? "var(--text3)" : "var(--blue)",
                          border: "1px solid rgba(77,123,255,.3)",
                          borderRadius: 8,
                          padding: ".75rem 1rem",
                          fontSize: ".85rem",
                          fontWeight: 700,
                          cursor: suggesting ? "wait" : "pointer",
                          fontFamily: "inherit",
                        }}>
                        {suggesting ? "✨ Thinking of competitors…" : "✨ Suggest competitors from my business profile"}
                      </button>
                    ) : (
                      <>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: ".5rem", gap: ".5rem", flexWrap: "wrap" }}>
                          <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text)" }}>
                            AI suggestions <span style={{ color: "var(--text3)", fontWeight: 400 }}>— tick the ones to review</span>
                          </div>
                          <button type="button" onClick={suggestCompetitors} disabled={suggesting}
                            style={{ background: "transparent", border: "none", color: "var(--blue)", fontSize: ".76rem", fontWeight: 600, cursor: suggesting ? "wait" : "pointer", fontFamily: "inherit", padding: 0 }}>
                            {suggesting ? "…" : "↻ Regenerate"}
                          </button>
                        </div>

                        <div style={{ background: "var(--bg)", border: "1px solid rgba(77,123,255,.2)", borderRadius: 8, padding: ".55rem .7rem", marginBottom: ".6rem", fontSize: ".72rem", color: "var(--text3)", lineHeight: 1.5 }}>
                          {suggestScale === "local"
                            ? <>Matched to <strong style={{ color: "var(--text2)" }}>local</strong> competitors{state.profile?.location ? <> around {state.profile.location}</> : null}. </>
                            : suggestScale === "regional"
                            ? <>Matched to <strong style={{ color: "var(--text2)" }}>regional</strong> competitors{state.profile?.location ? <> across the {state.profile.location} area</> : null}. </>
                            : <>Matched to <strong style={{ color: "var(--text2)" }}>national</strong> competitors. </>}
                          These are AI guesses and may be wrong or miss obvious rivals — review and tick the ones you recognise. Wrong scale? <button type="button" onClick={() => goToStep(1)} style={{ background: "transparent", border: "none", color: "var(--blue)", fontSize: "inherit", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}>edit step 1</button>. Nothing is analysed until you add competitors below and run the analysis.
                        </div>

                        {suggestions.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: ".4rem", marginBottom: ".7rem" }}>
                            {suggestions.map(s => {
                              const already = pendingDomains.includes(s.domain);
                              const checked = selectedSuggestions.has(s.domain);
                              return (
                                <label key={s.domain}
                                  style={{
                                    display: "flex", alignItems: "flex-start", gap: ".6rem",
                                    background: checked ? "var(--bdim)" : "var(--s1)",
                                    border: `1px solid ${checked ? "rgba(77,123,255,.35)" : "var(--border)"}`,
                                    borderRadius: 8, padding: ".6rem .75rem",
                                    cursor: already ? "default" : "pointer",
                                    opacity: already ? .55 : 1,
                                  }}>
                                  <input type="checkbox"
                                    checked={checked || already}
                                    disabled={already}
                                    onChange={() => toggleSuggestion(s.domain)}
                                    style={{ marginTop: ".15rem", accentColor: "var(--blue)", cursor: already ? "default" : "pointer" }} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: ".82rem", fontWeight: 600, color: "var(--text)", fontFamily: "var(--mono)", wordBreak: "break-all" }}>
                                      {s.domain}{already && <span style={{ fontFamily: "var(--font)", fontWeight: 500, color: "var(--text3)", marginLeft: ".4rem" }}>· added</span>}
                                    </div>
                                    {s.reason && <div style={{ fontSize: ".74rem", color: "var(--text2)", marginTop: ".15rem", lineHeight: 1.45 }}>{s.reason}</div>}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}

                        {suggestError && (
                          <div style={{ fontSize: ".76rem", color: "var(--text2)", marginBottom: ".6rem", lineHeight: 1.5 }}>{suggestError}</div>
                        )}

                        {suggestions.length > 0 && (
                          <button type="button" onClick={addSelectedSuggestions}
                            disabled={addableSelectedCount() === 0}
                            style={{
                              width: "100%",
                              background: addableSelectedCount() > 0 ? "var(--green)" : "var(--s2)",
                              color: addableSelectedCount() > 0 ? "#000" : "var(--text3)",
                              border: "none", borderRadius: 8, padding: ".6rem 1rem",
                              fontSize: ".82rem", fontWeight: 700,
                              cursor: addableSelectedCount() > 0 ? "pointer" : "not-allowed",
                              fontFamily: "inherit",
                            }}>
                            {pendingDomains.length >= 5
                              ? "Domain list full (5/5)"
                              : addableSelectedCount() === 0
                                ? "Tick suggestions to add"
                                : `Add ${addableSelectedCount()} selected →`}
                          </button>
                        )}
                      </>
                    )}

                    {suggestions === null && suggestError && (
                      <div style={{ fontSize: ".76rem", color: "var(--text2)", marginTop: ".5rem", lineHeight: 1.5 }}>{suggestError}</div>
                    )}
                  </div>

                  {/* Domain input */}
                  <div style={{ marginBottom: "1rem" }}>
                    <label style={{ display: "block", fontSize: ".78rem", fontWeight: 600, color: "var(--text)", marginBottom: ".4rem" }}>
                      Competitor websites <span style={{ color: "var(--text3)", fontWeight: 400 }}>({pendingDomains.length}/5)</span>
                    </label>
                    <div style={{ display: "flex", gap: ".4rem", marginBottom: pendingDomains.length > 0 ? ".6rem" : 0 }}>
                      <input type="text" value={domainInput}
                        onChange={e => setDomainInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") { e.preventDefault(); addDomain(); }
                          else if (e.key === "Backspace" && domainInput === "" && pendingDomains.length > 0) {
                            removeDomain(pendingDomains[pendingDomains.length - 1]);
                          }
                        }}
                        placeholder={pendingDomains.length === 0 ? "e.g. competitor.com (press Enter to add)" : "Add another…"}
                        disabled={pendingDomains.length >= 5}
                        maxLength={100}
                        style={{ flex: 1, background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 8, padding: ".7rem .9rem", color: "var(--text)", fontFamily: "inherit", fontSize: ".88rem", outline: "none", transition: "border-color .15s" }}
                        onFocus={e => e.target.style.borderColor = "var(--green)"}
                        onBlur={e => e.target.style.borderColor = "var(--border)"} />
                      <button type="button" onClick={addDomain}
                        disabled={!domainInput.trim() || pendingDomains.length >= 5 || !isValidDomain(normaliseDomain(domainInput))}
                        style={{
                          background: domainInput.trim() && pendingDomains.length < 5 && isValidDomain(normaliseDomain(domainInput)) ? "var(--green)" : "var(--s2)",
                          color: domainInput.trim() && pendingDomains.length < 5 && isValidDomain(normaliseDomain(domainInput)) ? "#000" : "var(--text3)",
                          border: "none",
                          borderRadius: 8,
                          padding: ".7rem 1rem",
                          fontSize: ".82rem",
                          fontWeight: 700,
                          cursor: domainInput.trim() && pendingDomains.length < 5 && isValidDomain(normaliseDomain(domainInput)) ? "pointer" : "not-allowed",
                          fontFamily: "inherit",
                          flexShrink: 0,
                        }}>
                        Add
                      </button>
                    </div>
                    {pendingDomains.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem" }}>
                        {pendingDomains.map(d => (
                          <span key={d} style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: ".4rem",
                            background: "var(--bdim)",
                            color: "var(--blue)",
                            border: "1px solid rgba(77,123,255,.25)",
                            borderRadius: 16,
                            padding: ".3rem .65rem .3rem .8rem",
                            fontSize: ".78rem",
                            fontWeight: 500,
                            fontFamily: "var(--mono)",
                          }}>
                            {d}
                            <button type="button" onClick={() => removeDomain(d)}
                              aria-label={`Remove ${d}`}
                              style={{ background: "transparent", border: "none", color: "var(--blue)", cursor: "pointer", fontSize: ".95rem", lineHeight: 1, padding: 0, opacity: .65, fontFamily: "inherit" }}
                              onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                              onMouseLeave={e => e.currentTarget.style.opacity = ".65"}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: ".72rem", color: "var(--text3)", marginTop: ".4rem", lineHeight: 1.5 }}>
                      Just the domain — we'll strip http/www/paths automatically.
                    </div>
                  </div>

                  {/* Quota warning */}
                  <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "1rem", marginBottom: "1rem", fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.55 }}>
                    <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: ".3rem" }}>
                      ⚠ This will use 1 DataForSEO session
                    </div>
                    Cached competitor data is reused for free across users. You'll only burn a credit if at least one of these domains is new to our system.
                  </div>

                  {enrichErrorPh4 && (
                    <div style={{ background: "var(--rdim)", border: "1px solid rgba(240,62,95,.3)", borderRadius: 8, padding: ".75rem 1rem", color: "var(--red)", fontSize: ".82rem", marginBottom: "1rem", lineHeight: 1.5 }}>
                      {enrichErrorPh4}
                    </div>
                  )}

                  <button onClick={fetchCompetitorKeywords}
                    disabled={enrichingPh4 || pendingDomains.length === 0}
                    style={{
                      width: "100%",
                      background: enrichingPh4 || pendingDomains.length === 0 ? "var(--s2)" : "var(--green)",
                      color: enrichingPh4 || pendingDomains.length === 0 ? "var(--text3)" : "#000",
                      border: "none",
                      borderRadius: 8,
                      padding: ".9rem 1.25rem",
                      fontSize: ".9rem",
                      fontWeight: 700,
                      cursor: enrichingPh4 ? "wait" : pendingDomains.length === 0 ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}>
                    {enrichingPh4
                      ? "🔍 Analysing competitors… (10-30s)"
                      : pendingDomains.length === 0
                        ? "Add at least one competitor"
                        : `🔍 Analyse ${pendingDomains.length} competitor${pendingDomains.length === 1 ? "" : "s"}`}
                  </button>
                </div>

                <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                  <button onClick={() => goToStep(3)} disabled={enrichingPh4}
                    style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: enrichingPh4 ? "wait" : "pointer", fontFamily: "inherit", flex: "0 0 auto" }}>
                    ← Back
                  </button>
                  <button onClick={() => goToStep(5)}
                    style={{ flex: "1 1 200px", background: "var(--s2)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                    Skip competitor analysis →
                  </button>
                </div>
              </>
            );
          }

          // Result state — competitor data loaded
          const list = state.competitors.list || [];
          const summary = state.competitors.competitorSummary || [];
          const existingKws = ph3SelectedSet();
          const newCount = list.filter(k => !existingKws.has(normaliseKw(k.keyword))).length;
          const dupeCount = list.length - newCount;

          // Build a per-domain colour map for the overlap bars
          const domainColors = ["var(--blue)", "var(--green)", "var(--amber)", "var(--red)", "#9b6bff"];
          const domainColorOf = (domain) => {
            const idx = state.competitors.domains.indexOf(domain);
            return idx >= 0 ? domainColors[idx % domainColors.length] : "var(--text3)";
          };

          const handleReanalyse = () => {
            if (window.confirm("This will reset your selections and use another DataForSEO session. Continue?")) {
              setState(s => ({ ...s, competitors: null }));
            }
          };

          const renderRow = (item) => {
            const sel = isCompetitorKwSelected(item.keyword);
            const vol = item.volume;
            const comp = item.competitionIndex;
            const compLabel = comp == null ? "—" : comp < 33 ? "Easy" : comp < 66 ? "Medium" : "Hard";
            const compColor = comp == null ? "var(--text3)" : comp < 33 ? "var(--green)" : comp < 66 ? "var(--amber)" : "var(--red)";
            const isDupe = existingKws.has(normaliseKw(item.keyword));
            const overlap = item.competitors?.length || 0;
            const totalCompetitors = state.competitors.domains.length;
            const competitorList = (item.competitors || []).map(c => `${c.domain}${c.position ? ` (#${c.position})` : ""}`).join(" · ");

            return (
              <div key={item.keyword}
                onClick={() => !isDupe && toggleCompetitorKw(item.keyword)}
                title={competitorList}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ".75rem",
                  padding: ".7rem .9rem",
                  background: isDupe ? "transparent" : sel ? "var(--gdim)" : "var(--bg)",
                  border: isDupe ? "1px solid var(--border)" : sel ? "1px solid rgba(15,219,138,.3)" : "1px solid var(--border)",
                  borderRadius: 8,
                  cursor: isDupe ? "default" : "pointer",
                  transition: "background .12s, border-color .12s",
                  marginBottom: ".4rem",
                  opacity: isDupe ? 0.55 : 1,
                }}>
                <span style={{ fontSize: ".95rem", lineHeight: 1, opacity: isDupe ? .3 : sel ? 1 : .4, color: isDupe ? "var(--text3)" : sel ? "var(--green)" : "var(--text3)", flexShrink: 0, width: 14, textAlign: "center" }}>
                  {isDupe ? "—" : sel ? "✓" : "○"}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: ".84rem", color: isDupe ? "var(--text3)" : sel ? "var(--text)" : "var(--text2)", fontWeight: 500, wordBreak: "break-word", textDecoration: isDupe ? "line-through" : "none" }}>
                    {item.keyword}
                  </span>
                  {isDupe && (
                    <span style={{ fontSize: ".62rem", padding: ".1rem .4rem", borderRadius: 4, background: "var(--s2)", color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", flexShrink: 0 }}>
                      In your list
                    </span>
                  )}
                  {item.intent && !isDupe && (
                    <span style={{ fontSize: ".62rem", padding: ".1rem .4rem", borderRadius: 4, background: "transparent", border: "1px solid var(--text3)", color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", flexShrink: 0 }}>
                      {item.intent}
                    </span>
                  )}
                </div>
                {/* Overlap dots — one per competitor that ranks for this kw */}
                <div style={{ display: "flex", gap: "2px", flexShrink: 0 }} title={`${overlap} of ${totalCompetitors} competitors rank for this`}>
                  {state.competitors.domains.map(d => {
                    const ranks = (item.competitors || []).some(c => c.domain === d);
                    return (
                      <span key={d} style={{
                        width: 8, height: 8, borderRadius: 2,
                        background: ranks ? domainColorOf(d) : "var(--border)",
                      }} />
                    );
                  })}
                </div>
                <div style={{ fontSize: ".75rem", fontFamily: "var(--mono)", color: vol == null ? "var(--text3)" : isDupe ? "var(--text3)" : "var(--text)", flexShrink: 0, minWidth: 70, textAlign: "right" }}>
                  {vol == null ? "—" : `${vol.toLocaleString()}/mo`}
                </div>
                <div style={{ fontSize: ".72rem", fontWeight: 600, color: isDupe ? "var(--text3)" : compColor, flexShrink: 0, minWidth: 52, textAlign: "right" }}>
                  {compLabel}
                </div>
              </div>
            );
          };

          const newKeywords = list.filter(k => !existingKws.has(normaliseKw(k.keyword)));
          const dupeKeywords = list.filter(k =>  existingKws.has(normaliseKw(k.keyword)));
          const selectedCount = competitorSelectedCount();

          return (
            <>
              {/* Summary header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: ".75rem", padding: ".75rem 1rem", background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 10 }}>
                <div>
                  <div style={{ fontSize: ".88rem", fontWeight: 700, color: "var(--text)" }}>
                    Competitor keywords
                  </div>
                  <div style={{ fontSize: ".74rem", color: "var(--text2)", marginTop: ".15rem" }}>
                    <strong style={{ color: "var(--green)" }}>{selectedCount}</strong> new selected · {newCount} new · {dupeCount} already in your list
                    {state.competitors.quotaLimit != null && (
                      <> · Quota: {state.competitors.quotaUsed}/{state.competitors.quotaLimit}</>
                    )}
                  </div>
                </div>
                <button onClick={handleReanalyse} disabled={enrichingPh4}
                  style={{ background: "var(--s2)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 7, padding: ".45rem .85rem", fontSize: ".75rem", fontWeight: 600, cursor: enrichingPh4 ? "wait" : "pointer", fontFamily: "inherit" }}>
                  ↻ Change competitors
                </button>
              </div>

              {/* Competitor breakdown chips */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem", marginBottom: "1rem" }}>
                {summary.map(c => (
                  <div key={c.domain} style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: ".5rem",
                    padding: ".4rem .75rem",
                    background: "var(--s1)",
                    border: `1px solid ${c.error ? "rgba(240,62,95,.3)" : "var(--border)"}`,
                    borderRadius: 16,
                    fontSize: ".74rem",
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: domainColorOf(c.domain), flexShrink: 0 }} />
                    <span style={{ fontFamily: "var(--mono)", color: "var(--text)" }}>{c.domain}</span>
                    <span style={{ color: c.error ? "var(--red)" : "var(--text3)", fontFamily: "var(--mono)" }}>
                      {c.error ? "error" : `${c.keywordCount} kw`}{c.cached ? " · cached" : ""}
                    </span>
                  </div>
                ))}
              </div>

              {/* Column header strip */}
              <div style={{ display: "flex", alignItems: "center", gap: ".75rem", padding: "0 .9rem .35rem", fontSize: ".68rem", color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }}>
                <span style={{ width: 14, flexShrink: 0 }}> </span>
                <span style={{ flex: 1 }}>Keyword</span>
                <span style={{ flexShrink: 0 }}>Overlap</span>
                <span style={{ minWidth: 70, textAlign: "right" }}>Volume</span>
                <span style={{ minWidth: 52, textAlign: "right" }}>Difficulty</span>
              </div>

              {/* New keywords (the actionable ones) */}
              {newKeywords.length > 0 && (
                <div style={{ marginBottom: dupeKeywords.length > 0 ? "1rem" : 0 }}>
                  {newKeywords.map(renderRow)}
                </div>
              )}

              {/* Already-in-list keywords (deprioritised, collapsed) */}
              {dupeKeywords.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: ".72rem", color: "var(--text3)", padding: "0 .9rem .4rem", fontWeight: 600 }}>
                    Already in your list ({dupeKeywords.length}) — confirms you're on the right track
                  </div>
                  {dupeKeywords.map(renderRow)}
                </div>
              )}

              {newKeywords.length === 0 && (
                <div style={{ background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 10, padding: "1.25rem", textAlign: "center", marginBottom: "1rem" }}>
                  <div style={{ fontSize: ".88rem", color: "var(--text)", fontWeight: 600, marginBottom: ".4rem" }}>
                    No new keywords found
                  </div>
                  <div style={{ fontSize: ".78rem", color: "var(--text2)", lineHeight: 1.55 }}>
                    Your competitors aren't ranking for anything you don't already have on your list. Either you've covered the space well, or these competitors are in a different lane than expected. Try different competitors if you want broader coverage.
                  </div>
                </div>
              )}

              {/* Insight footer */}
              <div style={{ background: "rgba(77,123,255,.06)", border: "1px solid rgba(77,123,255,.2)", borderRadius: 10, padding: "1rem 1.1rem", marginBottom: "1rem" }}>
                <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--blue)", marginBottom: ".4rem" }}>
                  💡 How to read overlap
                </div>
                <div style={{ fontSize: ".77rem", color: "var(--text2)", lineHeight: 1.6 }}>
                  Each row shows coloured dots — one per competitor domain. A filled dot means that competitor ranks in the top 50 for that keyword. More dots = stronger signal that the keyword matters in your space. Hover over a row to see exact positions.
                </div>
              </div>

              {/* Navigation */}
              <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                <button onClick={() => goToStep(3)}
                  style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" }}>
                  ← Back
                </button>
                <button onClick={() => goToStep(5)}
                  style={{
                    flex: "1 1 200px",
                    background: "var(--green)",
                    color: "#000",
                    border: "none",
                    borderRadius: 8,
                    padding: ".75rem 1.1rem",
                    fontSize: ".85rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}>
                  {selectedCount === 0
                    ? "Continue without adding any →"
                    : `Continue with ${selectedCount} new keyword${selectedCount === 1 ? "" : "s"} →`}
                </button>
              </div>
            </>
          );
        })()}

        {/* ── Step 5: Recommended Targets (AI Synthesis) ─────────── */}
        {state.currentStep === 5 && (() => {
          const candidates = candidateKeywords();

          // Empty state — no AI-generated targets yet
          if (!state.targets) {
            // Edge case: no candidates from earlier phases
            if (candidates.length === 0) {
              return (
                <>
                  <div style={{ background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 12, padding: "2rem 1.5rem", textAlign: "center" }}>
                    <div style={{ fontSize: "2rem", marginBottom: ".75rem" }}>⚠️</div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text)", marginBottom: ".5rem" }}>
                      No candidate keywords yet
                    </div>
                    <div style={{ fontSize: ".85rem", color: "var(--text2)", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
                      Go back and make sure you've selected at least one keyword in Step 2. We need keywords to recommend a target list.
                    </div>
                  </div>
                  <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                    <button onClick={() => goToStep(4)}
                      style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      ← Back
                    </button>
                  </div>
                </>
              );
            }

            // Pre-fetch state — show candidate breakdown + generate button
            const seedCount = candidates.filter(c => c.source === "seed").length;
            const compCount = candidates.filter(c => c.source === "competitor").length;
            const withVolume = candidates.filter(c => c.volume != null).length;

            return (
              <>
                <div style={{ background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.75rem 1.5rem" }}>
                  <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: ".75rem" }}>🎯</div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text)", marginBottom: ".5rem" }}>
                      Get your prioritised target list
                    </div>
                    <div style={{ fontSize: ".85rem", color: "var(--text2)", maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>
                      AI will review your <strong style={{ color: "var(--text)" }}>{candidates.length}</strong> candidate keyword{candidates.length === 1 ? "" : "s"} and recommend 10-15 to focus on first, organised by priority with reasoning for each.
                    </div>
                  </div>

                  {/* Candidate breakdown */}
                  <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "1rem", marginBottom: "1.25rem", fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: ".4rem", fontSize: ".82rem" }}>
                      What the AI is reviewing
                    </div>
                    <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", fontSize: ".78rem" }}>
                      <div>
                        <span style={{ color: "var(--text3)" }}>From your seeds:</span>{" "}
                        <strong style={{ color: "var(--text)" }}>{seedCount}</strong>
                      </div>
                      {compCount > 0 && (
                        <div>
                          <span style={{ color: "var(--text3)" }}>From competitors:</span>{" "}
                          <strong style={{ color: "var(--text)" }}>{compCount}</strong>
                        </div>
                      )}
                      <div>
                        <span style={{ color: "var(--text3)" }}>With real data:</span>{" "}
                        <strong style={{ color: "var(--text)" }}>{withVolume}</strong>
                      </div>
                    </div>
                  </div>

                  {generateErrorPh5 && (
                    <div style={{ background: "var(--rdim)", border: "1px solid rgba(240,62,95,.3)", borderRadius: 8, padding: ".75rem 1rem", color: "var(--red)", fontSize: ".82rem", marginBottom: "1rem", lineHeight: 1.5 }}>
                      {generateErrorPh5}
                    </div>
                  )}

                  <button onClick={generateRecommendedTargets} disabled={generatingPh5}
                    style={{
                      width: "100%",
                      background: generatingPh5 ? "var(--s2)" : "var(--green)",
                      color: generatingPh5 ? "var(--text3)" : "#000",
                      border: "none",
                      borderRadius: 8,
                      padding: ".9rem 1.25rem",
                      fontSize: ".9rem",
                      fontWeight: 700,
                      cursor: generatingPh5 ? "wait" : "pointer",
                      fontFamily: "inherit",
                    }}>
                    {generatingPh5 ? "🤖 Reviewing your keywords… (15-30s)" : "✨ Generate target list"}
                  </button>

                  <div style={{ marginTop: ".75rem", fontSize: ".72rem", color: "var(--text3)", textAlign: "center", lineHeight: 1.5 }}>
                    Doesn't use DataForSEO quota — pure AI synthesis.
                  </div>
                </div>

                <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                  <button onClick={() => goToStep(4)} disabled={generatingPh5}
                    style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: generatingPh5 ? "wait" : "pointer", fontFamily: "inherit" }}>
                    ← Back
                  </button>
                </div>
              </>
            );
          }

          // Result state — AI targets loaded
          const targets = state.targets.list || [];
          const handleRegenerate = () => {
            if (window.confirm("Regenerate will replace these recommendations. Your selections will be lost. Continue?")) {
              setState(s => ({ ...s, targets: null }));
              setTimeout(() => generateRecommendedTargets(), 0);
            }
          };

          const TIERS = [
            {
              key: "must",
              title: "Must-target",
              icon: "🎯",
              desc: "Focus on these immediately — strongest signals across the board",
              color: "var(--green)",
              bg: "rgba(15,219,138,.06)",
              border: "rgba(15,219,138,.25)",
            },
            {
              key: "opportunity",
              title: "Opportunity",
              icon: "🚀",
              desc: "Solid secondary targets — pursue once must-targets show traction",
              color: "var(--blue)",
              bg: "rgba(77,123,255,.06)",
              border: "rgba(77,123,255,.2)",
            },
            {
              key: "long-shot",
              title: "Long-shot",
              icon: "🌱",
              desc: "Aspirational — keep on the radar, build content for these later",
              color: "var(--amber)",
              bg: "rgba(245,166,35,.06)",
              border: "rgba(245,166,35,.2)",
            },
          ];

          // Build a candidate lookup so we can show signals next to AI's reasoning
          const candidateLookup = new Map(candidates.map(c => [c.keyword, c]));

          const renderTargetRow = (target) => {
            const sel = isTargetSelected(target.keyword);
            const cand = candidateLookup.get(normaliseKw(target.keyword));
            const vol = cand?.volume;
            const comp = cand?.competitionIndex;
            const compLabel = comp == null ? null : comp < 33 ? "Easy" : comp < 66 ? "Medium" : "Hard";
            const compColor = comp == null ? "var(--text3)" : comp < 33 ? "var(--green)" : comp < 66 ? "var(--amber)" : "var(--red)";

            return (
              <div key={target.keyword}
                onClick={() => toggleTarget(target.keyword)}
                style={{
                  padding: ".85rem 1rem",
                  background: sel ? "var(--gdim)" : "var(--bg)",
                  border: sel ? "1px solid rgba(15,219,138,.3)" : "1px solid var(--border)",
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "background .12s, border-color .12s",
                  marginBottom: ".5rem",
                }}>
                <div style={{ display: "flex", alignItems: "center", gap: ".75rem", marginBottom: target.reasoning ? ".4rem" : 0 }}>
                  <span style={{ fontSize: ".95rem", lineHeight: 1, opacity: sel ? 1 : .4, color: sel ? "var(--green)" : "var(--text3)", flexShrink: 0, width: 14, textAlign: "center" }}>
                    {sel ? "✓" : "○"}
                  </span>
                  <span style={{ flex: 1, fontSize: ".9rem", fontWeight: 600, color: sel ? "var(--text)" : "var(--text2)", wordBreak: "break-word" }}>
                    {target.keyword}
                  </span>
                  {/* Signal pills */}
                  <div style={{ display: "flex", gap: ".4rem", flexShrink: 0, alignItems: "center" }}>
                    {vol != null && (
                      <span style={{ fontSize: ".68rem", fontFamily: "var(--mono)", color: "var(--text3)" }}>
                        {vol.toLocaleString()}/mo
                      </span>
                    )}
                    {compLabel && (
                      <span style={{ fontSize: ".68rem", fontWeight: 600, color: compColor }}>
                        {compLabel}
                      </span>
                    )}
                    {cand?.source === "competitor" && cand?.competitors > 0 && (
                      <span style={{ fontSize: ".62rem", padding: ".1rem .4rem", borderRadius: 4, background: "var(--bdim)", color: "var(--blue)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>
                        {cand.competitors} rivals
                      </span>
                    )}
                  </div>
                </div>
                {target.reasoning && (
                  <div style={{ fontSize: ".77rem", color: sel ? "var(--text2)" : "var(--text3)", lineHeight: 1.5, paddingLeft: "calc(14px + .75rem)" }}>
                    {target.reasoning}
                  </div>
                )}
              </div>
            );
          };

          const totalSelected = targetSelectedCount();
          const groupedTargets = TIERS.map(tier => ({
            ...tier,
            items: targets.filter(t => t.tier === tier.key),
          }));

          return (
            <>
              {/* Strategic summary */}
              {state.targets.summary && (
                <div style={{ background: "linear-gradient(135deg, rgba(15,219,138,.08), rgba(77,123,255,.06))", border: "1px solid rgba(15,219,138,.2)", borderRadius: 12, padding: "1.1rem 1.25rem", marginBottom: "1.25rem" }}>
                  <div style={{ fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".12em", color: "var(--green)", fontWeight: 700, marginBottom: ".4rem" }}>
                    📋 Strategic Overview
                  </div>
                  <div style={{ fontSize: ".88rem", color: "var(--text)", lineHeight: 1.55, fontWeight: 500 }}>
                    {state.targets.summary}
                  </div>
                </div>
              )}

              {/* Summary header with regenerate */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: ".75rem", padding: ".75rem 1rem", background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 10 }}>
                <div>
                  <div style={{ fontSize: ".88rem", fontWeight: 700, color: "var(--text)" }}>
                    Your target list
                  </div>
                  <div style={{ fontSize: ".74rem", color: "var(--text2)", marginTop: ".15rem" }}>
                    <strong style={{ color: "var(--green)" }}>{totalSelected}</strong> of {targets.length} selected
                    {state.targets.provider && <> · via {state.targets.provider}</>}
                  </div>
                </div>
                <button onClick={handleRegenerate} disabled={generatingPh5}
                  style={{ background: "var(--s2)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 7, padding: ".45rem .85rem", fontSize: ".75rem", fontWeight: 600, cursor: generatingPh5 ? "wait" : "pointer", fontFamily: "inherit" }}>
                  {generatingPh5 ? "Regenerating…" : "↻ Regenerate"}
                </button>
              </div>

              {/* Tier sections */}
              {groupedTargets.map(tier => {
                if (tier.items.length === 0) return null;
                const tierSelected = tier.items.filter(t => isTargetSelected(t.keyword)).length;
                return (
                  <div key={tier.key} style={{ background: tier.bg, border: `1px solid ${tier.border}`, borderRadius: 12, padding: "1.1rem 1.1rem", marginBottom: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: ".25rem", gap: ".5rem", flexWrap: "wrap" }}>
                      <div style={{ fontSize: ".95rem", fontWeight: 700, color: tier.color, display: "flex", alignItems: "center", gap: ".4rem" }}>
                        <span style={{ fontSize: "1.1rem" }}>{tier.icon}</span>
                        {tier.title}
                      </div>
                      <div style={{ fontSize: ".7rem", color: "var(--text3)", fontFamily: "var(--mono)" }}>
                        {tierSelected}/{tier.items.length}
                      </div>
                    </div>
                    <div style={{ fontSize: ".74rem", color: "var(--text2)", marginBottom: ".85rem", lineHeight: 1.5 }}>
                      {tier.desc}
                    </div>
                    {tier.items.map(renderTargetRow)}
                  </div>
                );
              })}

              {/* Insight footer */}
              <div style={{ background: "rgba(77,123,255,.06)", border: "1px solid rgba(77,123,255,.2)", borderRadius: 10, padding: "1rem 1.1rem", marginBottom: "1rem" }}>
                <div style={{ fontSize: ".78rem", fontWeight: 700, color: "var(--blue)", marginBottom: ".4rem" }}>
                  💡 What happens next
                </div>
                <div style={{ fontSize: ".77rem", color: "var(--text2)", lineHeight: 1.6 }}>
                  Step 6 turns your selected targets into a content roadmap — for each keyword, deciding whether you need a new page, an existing one to optimise, or a guide to write. You can always come back here to refine.
                </div>
              </div>

              {/* Navigation */}
              <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                <button onClick={() => goToStep(4)}
                  style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" }}>
                  ← Back
                </button>
                <button onClick={() => goToStep(6)} disabled={totalSelected < 1}
                  style={{
                    flex: "1 1 200px",
                    background: totalSelected < 1 ? "var(--s2)" : "var(--green)",
                    color: totalSelected < 1 ? "var(--text3)" : "#000",
                    border: "none",
                    borderRadius: 8,
                    padding: ".75rem 1.1rem",
                    fontSize: ".85rem",
                    fontWeight: 700,
                    cursor: totalSelected < 1 ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}>
                  Continue with {totalSelected} target{totalSelected === 1 ? "" : "s"} →
                </button>
              </div>
              {totalSelected < 1 && (
                <div style={{ marginTop: ".75rem", fontSize: ".75rem", color: "var(--text3)", textAlign: "center" }}>
                  Select at least one target to continue.
                </div>
              )}
            </>
          );
        })()}

        {/* ── Step 6: Content Roadmap (Final Step) ────────────────── */}
        {state.currentStep === 6 && (() => {
          const targets = selectedTargets();

          // Empty state — no roadmap generated yet
          if (!state.roadmap) {
            // Edge case — no targets to roadmap
            if (targets.length === 0) {
              return (
                <>
                  <div style={{ background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 12, padding: "2rem 1.5rem", textAlign: "center" }}>
                    <div style={{ fontSize: "2rem", marginBottom: ".75rem" }}>⚠️</div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text)", marginBottom: ".5rem" }}>
                      No targets selected
                    </div>
                    <div style={{ fontSize: ".85rem", color: "var(--text2)", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
                      Go back to Step 5 and select at least one target keyword. We need targets to build a content roadmap.
                    </div>
                  </div>
                  <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                    <button onClick={() => goToStep(5)}
                      style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      ← Back
                    </button>
                  </div>
                </>
              );
            }

            // Pre-fetch state — generate button
            const tierCounts = {
              must: targets.filter(t => t.tier === "must").length,
              opportunity: targets.filter(t => t.tier === "opportunity").length,
              "long-shot": targets.filter(t => t.tier === "long-shot").length,
            };

            return (
              <>
                <div style={{ background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 12, padding: "1.75rem 1.5rem" }}>
                  <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: ".75rem" }}>🗺️</div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text)", marginBottom: ".5rem" }}>
                      Build your content roadmap
                    </div>
                    <div style={{ fontSize: ".85rem", color: "var(--text2)", maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>
                      For each of your <strong style={{ color: "var(--text)" }}>{targets.length}</strong> target{targets.length === 1 ? "" : "s"}, AI will recommend a content type, page title, angle, and when to build it. This is your "what to publish" plan.
                    </div>
                  </div>

                  {/* Tier breakdown */}
                  <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "1rem", marginBottom: "1.25rem", fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: ".4rem", fontSize: ".82rem" }}>
                      What we're building a roadmap for
                    </div>
                    <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", fontSize: ".78rem" }}>
                      {tierCounts.must > 0 && (
                        <div>
                          <span style={{ color: "var(--green)" }}>🎯</span>{" "}
                          <strong style={{ color: "var(--text)" }}>{tierCounts.must}</strong>{" "}
                          <span style={{ color: "var(--text3)" }}>must-target</span>
                        </div>
                      )}
                      {tierCounts.opportunity > 0 && (
                        <div>
                          <span style={{ color: "var(--blue)" }}>🚀</span>{" "}
                          <strong style={{ color: "var(--text)" }}>{tierCounts.opportunity}</strong>{" "}
                          <span style={{ color: "var(--text3)" }}>opportunity</span>
                        </div>
                      )}
                      {tierCounts["long-shot"] > 0 && (
                        <div>
                          <span style={{ color: "var(--amber)" }}>🌱</span>{" "}
                          <strong style={{ color: "var(--text)" }}>{tierCounts["long-shot"]}</strong>{" "}
                          <span style={{ color: "var(--text3)" }}>long-shot</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {generateErrorPh6 && (
                    <div style={{ background: "var(--rdim)", border: "1px solid rgba(240,62,95,.3)", borderRadius: 8, padding: ".75rem 1rem", color: "var(--red)", fontSize: ".82rem", marginBottom: "1rem", lineHeight: 1.5 }}>
                      {generateErrorPh6}
                    </div>
                  )}

                  <button onClick={generateContentRoadmap} disabled={generatingPh6}
                    style={{
                      width: "100%",
                      background: generatingPh6 ? "var(--s2)" : "var(--green)",
                      color: generatingPh6 ? "var(--text3)" : "#000",
                      border: "none",
                      borderRadius: 8,
                      padding: ".9rem 1.25rem",
                      fontSize: ".9rem",
                      fontWeight: 700,
                      cursor: generatingPh6 ? "wait" : "pointer",
                      fontFamily: "inherit",
                    }}>
                    {generatingPh6 ? "🤖 Building your roadmap… (15-30s)" : "✨ Generate content roadmap"}
                  </button>

                  <div style={{ marginTop: ".75rem", fontSize: ".72rem", color: "var(--text3)", textAlign: "center", lineHeight: 1.5 }}>
                    Doesn't use DataForSEO quota — pure AI synthesis.
                  </div>
                </div>

                <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                  <button onClick={() => goToStep(5)} disabled={generatingPh6}
                    style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: generatingPh6 ? "wait" : "pointer", fontFamily: "inherit" }}>
                    ← Back
                  </button>
                </div>
              </>
            );
          }

          // Result state — roadmap loaded
          const items = state.roadmap.items || [];
          const handleRegenerate = () => {
            if (window.confirm("Regenerate will replace this roadmap with fresh recommendations. Continue?")) {
              setState(s => ({ ...s, roadmap: null }));
              setTimeout(() => generateContentRoadmap(), 0);
            }
          };

          const PHASES = [
            {
              key: "now",
              title: "Build first",
              subtitle: "Weeks 1-2",
              icon: "🟢",
              desc: "Foundation content — start here",
              color: "var(--green)",
              bg: "rgba(15,219,138,.06)",
              border: "rgba(15,219,138,.25)",
            },
            {
              key: "soon",
              title: "Build next",
              subtitle: "Months 2-3",
              icon: "🔵",
              desc: "Second wave — once foundation is in place",
              color: "var(--blue)",
              bg: "rgba(77,123,255,.06)",
              border: "rgba(77,123,255,.2)",
            },
            {
              key: "later",
              title: "Build later",
              subtitle: "Month 4+",
              icon: "🟡",
              desc: "Deeper coverage — fill in once you have traction",
              color: "var(--amber)",
              bg: "rgba(245,166,35,.06)",
              border: "rgba(245,166,35,.2)",
            },
          ];

          // Content type → icon + label mapping for compact display
          const CONTENT_TYPE_META = {
            "service-page": { icon: "🛠️", label: "Service page" },
            "landing-page": { icon: "🎯", label: "Landing page" },
            "blog":         { icon: "📝", label: "Blog post" },
            "guide":        { icon: "📚", label: "Guide" },
            "comparison":   { icon: "⚖️", label: "Comparison" },
            "listicle":     { icon: "📋", label: "Listicle" },
            "how-to":       { icon: "🧭", label: "How-to" },
          };

          const TIER_META = {
            "must":        { icon: "🎯", label: "Must" },
            "opportunity": { icon: "🚀", label: "Opp" },
            "long-shot":   { icon: "🌱", label: "Long" },
          };

          const renderRoadmapItem = (item, idx) => {
            const ctMeta = CONTENT_TYPE_META[item.contentType] || CONTENT_TYPE_META.blog;
            const tMeta  = TIER_META[item.tier] || TIER_META.opportunity;

            return (
              <div key={item.keyword + idx} style={{
                padding: "1rem 1.1rem",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                marginBottom: ".6rem",
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: ".75rem", marginBottom: ".5rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "1.1rem", flexShrink: 0, lineHeight: 1.2 }}>{ctMeta.icon}</span>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div style={{ fontSize: ".95rem", fontWeight: 700, color: "var(--text)", lineHeight: 1.35, marginBottom: ".2rem", wordBreak: "break-word" }}>
                      {item.title || item.keyword}
                    </div>
                    <div style={{ fontSize: ".74rem", color: "var(--text3)", fontFamily: "var(--mono)", wordBreak: "break-word" }}>
                      → targets: "{item.keyword}"
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: ".4rem", flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: ".62rem", padding: ".15rem .45rem", borderRadius: 4, background: "var(--s2)", color: "var(--text2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>
                      {ctMeta.label}
                    </span>
                    <span style={{ fontSize: ".62rem", padding: ".15rem .45rem", borderRadius: 4, background: "transparent", border: "1px solid var(--border2)", color: "var(--text3)", fontWeight: 600, fontFamily: "var(--mono)" }}>
                      ~{item.wordCount.toLocaleString()} words
                    </span>
                    <span style={{ fontSize: ".62rem", padding: ".15rem .45rem", borderRadius: 4, background: "var(--s2)", color: "var(--text3)", fontWeight: 600 }}>
                      {tMeta.icon} {tMeta.label}
                    </span>
                  </div>
                </div>
                {item.angle && (
                  <div style={{ fontSize: ".82rem", color: "var(--text2)", lineHeight: 1.55 }}>
                    {item.angle}
                  </div>
                )}
              </div>
            );
          };

          const groupedByPhase = PHASES.map(phase => ({
            ...phase,
            items: items.filter(i => i.phase === phase.key),
          }));

          return (
            <>
              {/* Strategic summary */}
              {state.roadmap.summary && (
                <div style={{ background: "linear-gradient(135deg, rgba(15,219,138,.08), rgba(77,123,255,.06))", border: "1px solid rgba(15,219,138,.2)", borderRadius: 12, padding: "1.1rem 1.25rem", marginBottom: "1.25rem" }}>
                  <div style={{ fontSize: ".68rem", textTransform: "uppercase", letterSpacing: ".12em", color: "var(--green)", fontWeight: 700, marginBottom: ".4rem" }}>
                    🗺️ Your Content Strategy
                  </div>
                  <div style={{ fontSize: ".88rem", color: "var(--text)", lineHeight: 1.55, fontWeight: 500 }}>
                    {state.roadmap.summary}
                  </div>
                </div>
              )}

              {/* Summary header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: ".75rem", padding: ".75rem 1rem", background: "var(--s1)", border: "1px solid var(--border)", borderRadius: 10 }}>
                <div>
                  <div style={{ fontSize: ".88rem", fontWeight: 700, color: "var(--text)" }}>
                    Content roadmap
                  </div>
                  <div style={{ fontSize: ".74rem", color: "var(--text2)", marginTop: ".15rem" }}>
                    <strong style={{ color: "var(--text)" }}>{items.length}</strong> {items.length === 1 ? "page" : "pages"} planned
                    {state.roadmap.provider && <> · via {state.roadmap.provider}</>}
                  </div>
                </div>
                <button onClick={handleRegenerate} disabled={generatingPh6}
                  style={{ background: "var(--s2)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 7, padding: ".45rem .85rem", fontSize: ".75rem", fontWeight: 600, cursor: generatingPh6 ? "wait" : "pointer", fontFamily: "inherit" }}>
                  {generatingPh6 ? "Regenerating…" : "↻ Regenerate"}
                </button>
              </div>

              {/* Phase sections */}
              {groupedByPhase.map(phase => {
                if (phase.items.length === 0) return null;
                return (
                  <div key={phase.key} style={{ background: phase.bg, border: `1px solid ${phase.border}`, borderRadius: 12, padding: "1.1rem 1.1rem", marginBottom: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: ".4rem", gap: ".5rem", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: ".5rem", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "1rem" }}>{phase.icon}</span>
                        <span style={{ fontSize: ".95rem", fontWeight: 700, color: phase.color }}>{phase.title}</span>
                        <span style={{ fontSize: ".7rem", color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>{phase.subtitle}</span>
                      </div>
                      <span style={{ fontSize: ".7rem", color: "var(--text3)", fontFamily: "var(--mono)" }}>
                        {phase.items.length} {phase.items.length === 1 ? "page" : "pages"}
                      </span>
                    </div>
                    <div style={{ fontSize: ".74rem", color: "var(--text2)", marginBottom: ".85rem", lineHeight: 1.5 }}>
                      {phase.desc}
                    </div>
                    {phase.items.map(renderRoadmapItem)}
                  </div>
                );
              })}

              {/* What's next footer */}
              <div style={{ background: "rgba(15,219,138,.06)", border: "1px solid rgba(15,219,138,.2)", borderRadius: 10, padding: "1.1rem 1.25rem", marginBottom: "1.25rem" }}>
                <div style={{ fontSize: ".82rem", fontWeight: 700, color: "var(--green)", marginBottom: ".5rem" }}>
                  🎉 You've built your SEO foundation
                </div>
                <div style={{ fontSize: ".8rem", color: "var(--text2)", lineHeight: 1.6 }}>
                  Your roadmap is ready. Hit "Save to Strategy Planner" to load it as your active content plan — you'll be able to track status, update URLs once published, and click through to write each piece in the Content Generator. The wizard stays available so you can come back any time to refine.
                </div>
              </div>

              {/* Final actions */}
              <div style={{ marginTop: "1.25rem", display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
                <button onClick={() => goToStep(5)}
                  style={{ background: "var(--s2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: ".75rem 1.1rem", fontSize: ".85rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" }}>
                  ← Back
                </button>
                <button onClick={completeWizard}
                  style={{
                    flex: "1 1 200px",
                    background: "var(--green)",
                    color: "#000",
                    border: "none",
                    borderRadius: 8,
                    padding: ".75rem 1.1rem",
                    fontSize: ".88rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}>
                  ✓ Save to Strategy Planner →
                </button>
              </div>
            </>
          );
        })()}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // ROOT
  // ─────────────────────────────────────────────────────────────
  return (
    <><style>{CSS}</style>
    <div className="gos" onClick={()=>siteOpen&&setSiteOpen(false)}>
      <div className="layout">
        <Sidebar/>
        <div className="main-area">
          <TopBar/>
          {/* Test wizard entry point — ADMIN ONLY. This is an internal shortcut for
              reaching the wizard while testing; the flask emoji and the word "Test"
              read as debug tooling. It was previously ungated, so any customer whose
              site returned fewer than 3 keywords saw it pinned to their screen —
              i.e. exactly the new users forming a first impression of the product.
              Customers reach the wizard through the dashboard CTA instead. */}
          {isAdmin && currentView !== "portfolio" && (siteData?.keywords?.length || 0) < 3 && (
            <button onClick={()=>setScreen("startingOut")}
              style={{position:"fixed",bottom:20,right:20,zIndex:9999,background:"#0fdb8a",color:"#000",border:"none",borderRadius:8,padding:".6rem 1rem",fontSize:".8rem",fontWeight:700,cursor:"pointer",boxShadow:"0 4px 12px rgba(0,0,0,.4)",fontFamily:"inherit"}}>
              🧪 Test wizard
            </button>
          )}
          {/* Portfolio view (Agency + Enterprise) replaces the per-site screens entirely.
              A meta-level "where am I in the app" toggle. */}
          {currentView === "portfolio" ? <Portfolio/> : <>
            {/* Back-to-portfolio breadcrumb — shown when the user drilled into a site
                from the portfolio, gives them a one-click way back to the overview. */}
            {arrivedFromPortfolio && (
              <div style={{padding:".6rem 1.5rem .25rem",fontSize:".82rem"}}>
                <button onClick={()=>{ setCurrentView("portfolio"); setArrivedFromPortfolio(false); }}
                  style={{background:"none",border:"none",color:"var(--text2)",cursor:"pointer",fontFamily:"inherit",fontSize:".82rem",padding:0,display:"inline-flex",alignItems:"center",gap:".35rem"}}>
                  ← Back to Portfolio
                </button>
              </div>
            )}
            {screen==="dashboard"  && <DashboardContent/>}
            {screen==="dashboard"  && <SproutPanel/>}
            {screen==="siteDetail" && <SiteDetailContent/>}
            {screen==="content"    && <ContentGenerator/>}
            {screen==="strategy"   && <StrategyPlanner/>}
            {screen==="links"      && <LinkBuildingScreen/>}
            {screen==="tracker"    && <RankTracker/>}
            {screen==="audit"      && <PageAudit/>}
            {screen==="startingOut" && <StartingOutWizard/>}
            {screen==="settings"   && <SettingsScreen/>}
            {screen==="reports"    && <ReportsTab/>}
            {screen==="admin"      && isAdmin && <AdminPanel/>}
            {screen==="admin"      && !isAdmin && <div className="content" style={{textAlign:"center",paddingTop:"4rem",color:"var(--text3)"}}>Access denied.</div>}
          </>}
          
          {/* Disclaimer footer */}
          <div style={{padding:"1rem 2rem",borderTop:"1px solid var(--border)",fontSize:".68rem",color:"var(--text3)",lineHeight:1.6,textAlign:"center"}}>
            RankActions provides AI-generated suggestions and recommendations only. Always back up your website before making changes. Review all content and fixes before implementing. RankActions and E2E Integration accept no responsibility for changes made to your website, loss of data, or service disruption resulting from actions taken based on our suggestions. See our <a href="https://rankactions.com/terms.html" target="_blank" rel="noopener" style={{color:"var(--text3)",textDecoration:"underline"}}>Terms of Service</a> for full details.
          </div>
        </div>
      </div>
      {modal            && FixModal()}
      {croModal         && <CroModal/>}
      {showUpgrade      && <UpgradeModal/>}
      {showSupport      && <SupportModal/>}
      {gscSitePicker    && <GscSitePicker/>}
      {showTour         && <OnboardingTour/>}
    </div></>
  );
}
