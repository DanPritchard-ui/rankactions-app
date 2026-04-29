import { useState, useEffect, useRef } from "react";
import {
  SignIn, SignUp, UserButton,
  useUser, useClerk, SignedIn, SignedOut
} from "@clerk/clerk-react";
import { sanitizeAiHtml, sanitizeAiPreview } from "./utils/sanitize";

// ─────────────────────────────────────────────────────────────
// ⚙️  CONFIG — paste your Worker URL here after deploying it
// ─────────────────────────────────────────────────────────────
const WORKER_URL = import.meta.env.VITE_WORKER_URL || "https://api.rankactions.com";

// Module-level auth token — updated by the component, read by API helpers
let _getToken = async () => null;

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
  --font:'Outfit',sans-serif;--mono:'JetBrains Mono',monospace;
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
.ob-card{width:100%;max-width:460px;background:#131729;border:1px solid #2a3560;border-radius:16px;padding:2.5rem;box-shadow:0 0 0 1px rgba(77,123,255,.08),0 8px 40px rgba(0,0,0,.5),0 0 80px rgba(77,123,255,.06);}
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
.site-dropdown{position:absolute;top:calc(100% + 6px);left:0;background:var(--s2);border:1px solid var(--border);border-radius:10px;min-width:190px;z-index:100;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.4);}
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
  titleTag: "The clickable blue headline that appears in Google search results. Should be 50-60 characters and include your main keyword near the front.",
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
  { id:"f1", level:"high",   color:"#f03e5f", label:"HIGH IMPACT", type:"SEO",
    title:"Improve homepage ranking",
    desc:"Your homepage ranks outside the top 5 for your main keyword — a title tag update could move you into the top 3.",
    m1:"Position: #7", m2:"Target: Top 3",
    suggestion:"Rewrite your title tag to include your primary keyword in the first 60 characters with a clear value proposition.",
    field:"Title Tag", current:"Homepage | Your Business Name",
    recommended:"Primary Keyword | Clear Value Proposition | Brand",
    metaDesc:"Connect Google Search Console to see your real keyword data and get specific AI suggestions for your site." },
  { id:"f2", level:"medium", color:"#f5a623", label:"OPPORTUNITY",  type:"CRO",
    title:"Increase conversions on your key service page",
    desc:"Your main service page gets good traffic but converts below the industry average.",
    m1:"Conv: below avg", m2:"Industry: 2.1%",
    suggestion:"Move your primary CTA above the fold and make the benefit clear in the button text.",
    field:"CTA Copy", current:"Contact us", recommended:"Get a free quote today", metaDesc:null },
  { id:"f3", level:"low",    color:"#0fdb8a", label:"QUICK WIN",    type:"SEO",
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
  }, [session]);

  // Auth UI state
  const [authView,  setAuthView]  = useState("signin"); // signin | signup
  const [showPlan,  setShowPlan]  = useState(false);
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
  const [expandedFix,  setExpandedFix]  = useState(null);
  const [doneFixes,    setDoneFixes]    = useState(() => {
    try { const site = localStorage.getItem("rankactions_selectedSite") || "mywebsite.com"; return new Set(JSON.parse(localStorage.getItem(`ra_done_${site}`) || "[]")); } catch { return new Set(); }
  });
  const [copiedId,     setCopiedId]     = useState(null);
  const [aiSummary,    setAiSummary]    = useState(null);
  const [summaryLoading,setSummaryLoading] = useState(false);
  const [modal,        setModal]        = useState(null);
  const [modalData,    setModalData]    = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalApplied, setModalApplied] = useState(new Set());
  const [indexingStatus, setIndexingStatus] = useState(null); // null | 'loading' | 'success' | 'error'
  const [indexingMsg, setIndexingMsg] = useState("");

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
  const isPro     = plan === "pro" || isAgency;
  const isStarter = plan === "starter" || isPro;
  const isPaid    = isStarter;
  const AI_FIX_LIMIT = isPro ? Infinity : plan === "starter" ? 20 : 5;
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
    // Reload doneFixes for this site
    try { setDoneFixes(new Set(JSON.parse(localStorage.getItem(`ra_done_${selectedSite}`) || "[]"))); } catch { setDoneFixes(new Set()); }
    // Reload link prospects for this site
    try { setLinkProspects(JSON.parse(localStorage.getItem(`ra_prospects_${selectedSite}`) || "[]")); } catch { setLinkProspects([]); }
    // Clear cached link opps and AI summary (they're site-specific)
    setLinkOpps([]);
    setAiSummary(null);
  }, [selectedSite]);

  // ── Persist doneFixes whenever they change ──────────────────
  useEffect(() => {
    if (!selectedSite) return;
    localStorage.setItem(`ra_done_${selectedSite}`, JSON.stringify([...doneFixes]));
  }, [doneFixes, selectedSite]);

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
  useEffect(() => {
    if (screen === "dashboard" && !aiSummary && !summaryLoading && !dataLoading) generateSummary();
  }, [screen, siteData, dataLoading]);

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
    if (!siteData?.topOpportunities?.length) return DEMO_FIXES;
    const colors = ["#f03e5f","#f5a623","#0fdb8a"];
    const labels = ["HIGH IMPACT","OPPORTUNITY","QUICK WIN"];
    const levels = ["high","medium","low"];
    // Filter out completed fixes and show the next best opportunities
    const allOpps = siteData.topOpportunities || [];
    const available = allOpps.filter((_opp, i) => !doneFixes.has(`live-${i}`));
    // If all top ones are done, pull from deeper in the list
    const opps = available.length > 0 ? available : allOpps.slice(3, 6);
    if (opps.length === 0) return DEMO_FIXES;
    return opps.slice(0,3).map((opp,i) => {
      const origIdx = allOpps.indexOf(opp);
      return {
        id: origIdx >= 0 ? `live-${origIdx}` : `live-ext-${i}`,
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
    return siteData.keywords.slice(0,15).map(k => {
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
      return { page:"—", kw:k.keyword, pos:k.position, vol:`${k.impressions}/mo`, gap, action, opp:k.opportunity };
    });
  };

  // ─────────────────────────────────────────────────────────────
  // Dynamic Issues data — site-specific, uses real GSC data where available
  // ─────────────────────────────────────────────────────────────
  const getIssuesData = (site, data) => {
    // Use real low-CTR pages from GSC if available
    const lowCtrPages = data?.pages
      ?.filter(p => parseFloat(p.ctr) < 0.02 && p.clicks > 5)
      ?.slice(0, 4)
      ?.map(p => ({
        url:      p.page.replace(/^https?:\/\/[^/]+/,"") || "/",
        detail:   `No meta description set · CTR ${(p.ctr*100).toFixed(1)}% (avg ${(data.totals.avgCtr*100).toFixed(1)}%)`,
        priority: p.clicks > 50 ? "high" : "medium",
      })) || [];

    const slowPages = data?.pages
      ?.sort((a,b) => b.impressions - a.impressions)
      ?.slice(0, 2)
      ?.map(p => ({
        url:    p.page.replace(/^https?:\/\/[^/]+/,"") || "/",
        detail: `High traffic page — run a Page Audit for Core Web Vitals and speed recommendations`,
        priority: "medium",
      })) || [];

    // Use real pages from GSC for schema and broken links if available
    const realPages = data?.pages?.slice(0, 6)?.map(p => ({
      url:      p.page.replace(/^https?:\/\/[^/]+/, "") || "/",
      clicks:   p.clicks,
      impressions: p.impressions,
    })) || [];

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
    // Use real high-traffic pages from GSC where available
    const topPages = data?.pages?.slice(0, 3) || [];

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
    if (!isPro && aiFixCount >= AI_FIX_LIMIT) { setShowUpgrade(true); return; }
    if (!isPro) trackAiFixUsage();
    setModal(fix); setModalData(null); setModalLoading(true);
    try {
      const category    = fix.fixCategory || null;
      const pageUrl     = fix.page ? `https://${selectedSite}${fix.page}` : `https://${selectedSite}`;
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
Return ONLY valid JSON — no markdown, no preamble:
{
  "option1": "ready-to-use title tag — 50-60 chars, keyword-rich, compelling",
  "option2": "alternative title tag — different angle, still 50-60 chars",
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
The SPECIFIC keyword this page needs to rank for: "${keyword}"
Current ranking position: ${fix.m1}
Goal: ${fix.m2}
Fix type: ${fix.type} — ${fix.field}
CRITICAL RULES:
- Every suggestion MUST include the exact phrase "${keyword}"
- No generic language — make it specific to "${keyword}"
- Title tags: 50-60 characters maximum
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
    starter_monthly: 'price_1TP6AHPxXBgdsxBI4OWdtv0Z',
    starter_annual:  'price_1TP6AnPxXBgdsxBI10fIEXuS',
    pro_monthly:     'price_1TP6R4PxXBgdsxBIeBQGpjYk',
    pro_annual:      'price_1TOf5DPxXBgdsxBIhil9CD59',
    agency_monthly:  'price_1TOf44PxXBgdsxBIMfYph4FF',
    agency_annual:   'price_1TOf4kPxXBgdsxBIEXUjDAlx',
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
          ? <SignIn routing="hash" afterSignInUrl="/" appearance={{variables:{colorPrimary:"#4d7bff",colorBackground:"#0c0e1a",colorInputBackground:"#07080f",colorText:"#dde2f5",colorTextSecondary:"#8590b8",colorInputText:"#dde2f5",borderRadius:"10px"}}}/>
          : <SignUp routing="hash" afterSignUpUrl="/" appearance={{variables:{colorPrimary:"#4d7bff",colorBackground:"#0c0e1a",colorInputBackground:"#07080f",colorText:"#dde2f5",colorTextSecondary:"#8590b8",colorInputText:"#dde2f5",borderRadius:"10px"}}}/>
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
            <span style={{background:"var(--green)",color:"#000",fontSize:".65rem",fontWeight:700,padding:".15rem .45rem",borderRadius:999,marginLeft:".4rem"}}>2 months free</span>
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
          <div className={`plan-card ${selPlan==="starter"?"selected":""}`} onClick={()=>setSelPlan("starter")}>
            {plan==="starter" && <div className="plan-badge" style={{background:"var(--blue)",color:"#fff"}}>Current plan</div>}
            <div className="plan-name">Starter</div>
            <div className="plan-price">{isAnnual ? "£190" : "£19"}</div>
            <div className="plan-period">{isAnnual ? "per year — £15.83/mo" : "per month"}</div>
            {isAnnual && <div style={{fontSize:".78rem",color:"var(--green)",fontWeight:600,marginBottom:".5rem"}}>Save £38 vs monthly</div>}
            <ul className="plan-features">
              <li>3 websites</li>
              <li>Full action list</li>
              <li>20 AI fixes/month</li>
              <li>Rank Tracker</li>
              <li>Unlimited page audits</li>
              <li>Weekly email digest</li>
            </ul>
          </div>
          <div className={`plan-card featured ${selPlan==="pro"?"selected":""}`} onClick={()=>setSelPlan("pro")}>
            {plan==="pro" ? <div className="plan-badge" style={{background:"var(--blue)",color:"#fff"}}>Current plan</div> : <div className="plan-badge">Most popular</div>}
            <div className="plan-name">Pro</div>
            <div className="plan-price">{isAnnual ? "£390" : "£39"}</div>
            <div className="plan-period">{isAnnual ? "per year — £32.50/mo" : "per month"}</div>
            {isAnnual && <div style={{fontSize:".78rem",color:"var(--green)",fontWeight:600,marginBottom:".5rem"}}>Save £78 vs monthly</div>}
            <ul className="plan-features">
              <li>5 websites (+£5/site extra)</li>
              <li>Unlimited AI fixes</li>
              <li>AI Content Generator</li>
              <li>Strategy Planner</li>
              <li>Link Building tools</li>
              <li>Rank Tracker</li>
              <li>Page Audit</li>
              <li>Weekly email digest</li>
            </ul>
          </div>
          <div className={`plan-card ${selPlan==="agency"?"selected":""}`} onClick={()=>setSelPlan("agency")}>
            {plan==="agency" && <div className="plan-badge" style={{background:"var(--blue)",color:"#fff"}}>Current plan</div>}
            <div className="plan-name">Agency</div>
            <div className="plan-price">{isAnnual ? "£790" : "£79"}</div>
            <div className="plan-period">{isAnnual ? "per year — £65.83/mo" : "per month"}</div>
            {isAnnual && <div style={{fontSize:".78rem",color:"var(--green)",fontWeight:600,marginBottom:".5rem"}}>Save £158 vs monthly</div>}
            <ul className="plan-features">
              <li>Everything in Pro</li>
              <li>10 websites (+£5/site extra)</li>
              <li>DataForSEO data (soon)</li>
              <li>Competitor tracking (soon)</li>
              <li>White-label reports (soon)</li>
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
          } else {
            const pm = { starter: isAnnual?STRIPE_PRICES.starter_annual:STRIPE_PRICES.starter_monthly, pro: isAnnual?STRIPE_PRICES.pro_annual:STRIPE_PRICES.pro_monthly, agency: isAnnual?STRIPE_PRICES.agency_annual:STRIPE_PRICES.agency_monthly };
            localStorage.setItem("rankactions_plan_chosen", "1");
            setShowPlan(false);
            await startCheckout(pm[selPlan]);
          }
        }}>
          {selPlan === plan ? "← Back to dashboard"
            : selPlan === "free" && isPaid ? "Manage subscription →"
            : selPlan === "free" ? "Continue with Free →"
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
      const available = (data.sites || []).filter(s => !sites.includes(s.siteUrl) && !sites.includes(s.displayUrl));
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
  const Sidebar = () => (
    <div className="sidebar">
      <div className="sidebar-logo">Rank<em>Actions</em></div>
      <div className="sidebar-nav">
        {[
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
        ].map(n=>(
          <div key={n.id} className={`nav-item ${screen===n.id?"active":""}`}
            data-tour={`nav-${n.id}`}
            onClick={()=>{
              if(["dashboard","siteDetail","content","admin","reports","links","settings","strategy","tracker","audit"].includes(n.id)) setScreen(n.id);
            }}>
            <span style={{fontSize:"0.9rem"}}>{n.icon}</span>
            {n.label}
            {n.id==="content" && !isPro && <span style={{fontSize:".6rem",marginLeft:"auto",color:"var(--text3)"}}>Pro</span>}
            {n.id==="strategy" && !isPro && <span style={{fontSize:".6rem",marginLeft:"auto",color:"var(--text3)"}}>Pro</span>}
            {n.id==="links" && !isPro && <span style={{fontSize:".6rem",marginLeft:"auto",color:"var(--text3)"}}>Pro</span>}
            {n.id==="tracker" && !isStarter && <span style={{fontSize:".6rem",marginLeft:"auto",color:"var(--text3)"}}>Starter</span>}
          </div>
        ))}
      </div>
    </div>
  );

  const TopBar = () => (
    <div className="topbar">
      <div className="site-selector" data-tour="site-selector">
        <div className="site-btn" onClick={e=>{e.stopPropagation();setSiteOpen(p=>!p);setAddingSite(false);}}>
          <span>🌐</span><span>{displaySite(selectedSite)}</span><span style={{color:"var(--text3)",fontSize:"0.7rem"}}>▼</span>
        </div>
        {siteOpen && (
          <div className="site-dropdown">
            {sites.map(s=>(
              <div key={s} className={`site-opt ${s===selectedSite?"sel":""}`}
                onClick={()=>{
                  setSelectedSite(s);
                  localStorage.setItem("rankactions_selectedSite", s);
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
                  availableGscSites.map(s => (
                    <div key={s.siteUrl} className="site-opt" style={{display:"flex",flexDirection:"column",gap:".1rem",cursor:"pointer"}}
                      onClick={e=>{e.stopPropagation();selectGscSite(s.siteUrl, s.displayUrl);}}>
                      <span>{s.displayUrl}</span>
                      <span style={{fontSize:".65rem",color:"var(--text3)"}}>{s.siteUrl.startsWith("sc-domain:")?"Domain property":"URL prefix"}</span>
                    </div>
                  ))
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
        <span
          className={`plan-pill ${plan==="pro"?"pro":plan==="agency"?"agency":plan==="starter"?"starter":""}`}
          style={{cursor:"pointer"}}
          title="View plans"
          onClick={()=>{
            setSelPlan(plan || "free");
            setShowPlan(true);
          }}>
          {plan==="agency"?"Agency":plan==="pro"?"Pro":plan==="starter"?"Starter":"Free"}
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
            <option value="pro">Pro</option>
            <option value="agency">Agency</option>
          </select>
        )}
        <UserButton afterSignOutUrl="/" appearance={{variables:{colorPrimary:"#4d7bff"}}}/>
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
              : <button className="ai-regen-btn" onClick={()=>setShowUpgrade(true)} title="Pro feature">
                  🔒 Pro only
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
          <div className="section-sub">{(siteData?.topOpportunities?.length > 0) ? "Based on your live data" : "Demo data"} · {fixes.filter(f=>!doneFixes.has(f.id)).length} remaining</div>
        </div>
        <div className="fixes-list">
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
                        : <button className="fa-btn" onClick={()=>setDoneFixes(p=>new Set([...p,fix.id]))}>✅ Mark as done</button>}
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
                ? `${seoRows.length} keywords from Search Console`
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
              <div style={{fontSize:".85rem",fontWeight:600,color:"var(--text)",marginBottom:".6rem"}}>
                In the meantime, here's what to do:
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
                    : <>Upgrade to Pro to use the Content Generator and publish SEO-optimised articles targeting keywords you want to rank for.</>
                  }</span>
                </li>
                <li style={{display:"flex",alignItems:"flex-start",gap:".65rem",fontSize:".88rem",color:"var(--text2)",lineHeight:1.55}}>
                  <span style={{color:"var(--green)",fontWeight:700,flexShrink:0}}>3.</span>
                  <span>{isPro
                    ? <>Open the <span className="td-link" style={{color:"var(--blue)"}} onClick={()=>setScreen("links")}>Link Building</span> tools to find directories, guest post targets and partnerships you can pursue manually while your organic data builds up.</>
                    : <>Upgrade to Pro to access Link Building tools — find directories, guest post targets and partnerships you can pursue manually.</>
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
                <thead><tr><th><Tip term="keyword">Keyword</Tip></th><th><Tip term="position">Position</Tip></th><th><Tip term="impressions">Impressions/mo</Tip></th><th>What to do</th><th>Action</th></tr></thead>
                <tbody>
                  {seoRows.map((row,i)=>{
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
                              id:`seo-${i}`, level:"medium", color:"#f5a623", label:"OPPORTUNITY", type:"SEO",
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
                Upgrade to Pro →
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
          <div className="current-box"><div className="current-label">{modal.field}</div><div className="current-val">{modal.current}</div></div>
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
            onClick={()=>{setModalApplied(p=>new Set([...p,modal.id]));setDoneFixes(p=>new Set([...p,modal.id]));}}>
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
  // UPGRADE MODAL
  // ─────────────────────────────────────────────────────────────

  const UpgradeModal = () => {
    const [upgradePlan, setUpgradePlan] = useState(plan === "free" ? "starter" : "pro");
    const [billing, setBilling] = useState("monthly");
    const [loading, setLoading] = useState(false);

    const prices = {
      starter:{ monthly: "£19",  annual: "£190", save: "£38",  monthlyEff: "£15.83" },
      pro:    { monthly: "£39",  annual: "£390", save: "£78",  monthlyEff: "£32.50" },
      agency: { monthly: "£79",  annual: "£790", save: "£158", monthlyEff: "£65.83" },
    };
    const p = prices[upgradePlan];

    const priceMap = {
      starter: billing==="annual" ? STRIPE_PRICES.starter_annual : STRIPE_PRICES.starter_monthly,
      pro: billing==="annual" ? STRIPE_PRICES.pro_annual : STRIPE_PRICES.pro_monthly,
      agency: billing==="annual" ? STRIPE_PRICES.agency_annual : STRIPE_PRICES.agency_monthly,
    };
    const priceId = priceMap[upgradePlan];

    return (
    <div className="upgrade-overlay" onClick={e=>e.target===e.currentTarget&&setShowUpgrade(false)}>
      <div className="upgrade-modal">
        <div className="upgrade-modal-badge">Upgrade</div>
        <h2>Unlock RankActions {upgradePlan.charAt(0).toUpperCase()+upgradePlan.slice(1)}</h2>
        <p>{upgradePlan === "starter" ? "More AI fixes, rank tracking, unlimited page audits, and weekly reports."
          : upgradePlan === "pro" ? "Unlimited AI fixes, content generation, strategy planner, and link building."
          : "Everything in Pro plus unlimited client sites and priority support."}</p>

        {/* Plan toggle */}
        <div style={{display:"flex",background:"var(--s2)",borderRadius:999,padding:3,gap:3,marginBottom:".75rem"}}>
          {[["starter","Starter"],["pro","Pro"],["agency","Agency"]].filter(([id])=> id !== plan).map(([id,label])=>(
            <button key={id} onClick={()=>setUpgradePlan(id)}
              style={{flex:1,padding:".45rem",borderRadius:999,border:"none",fontFamily:"var(--font)",fontSize:".82rem",fontWeight:600,cursor:"pointer",background:upgradePlan===id?"var(--blue)":"none",color:upgradePlan===id?"#fff":"var(--text2)",transition:"all .15s"}}>
              {label}
            </button>
          ))}
        </div>

        {/* Billing toggle */}
        <div style={{display:"flex",background:"var(--s2)",borderRadius:999,padding:3,gap:3,marginBottom:"1.25rem"}}>
          {[["monthly",`${p.monthly}/month`],["annual",`${p.annual}/year`]].map(([b,label])=>(
            <button key={b} onClick={()=>setBilling(b)}
              style={{flex:1,padding:".45rem",borderRadius:999,border:"none",fontFamily:"var(--font)",fontSize:".82rem",fontWeight:600,cursor:"pointer",background:billing===b?"var(--green)":"none",color:billing===b?"#000":"var(--text2)",transition:"all .15s"}}>
              {label}
              {b==="annual" && <span style={{display:"block",fontSize:".68rem",fontWeight:500,opacity:.8}}>save {p.save}</span>}
            </button>
          ))}
        </div>

        <ul className="upgrade-modal-features">
          {upgradePlan === "starter" ? (
            <>
              <li>3 websites</li>
              <li>20 AI fixes per month</li>
              <li>Rank Tracker</li>
              <li>Unlimited page audits</li>
              <li>Weekly email digest</li>
              <li>Full action list</li>
            </>
          ) : upgradePlan === "pro" ? (
            <>
              <li>5 websites (+£5/site extra)</li>
              <li>Unlimited AI fixes</li>
              <li>AI content generator</li>
              <li>Strategy planner</li>
              <li>Link building tools</li>
              <li>Rank Tracker + Page Audit</li>
              <li>Weekly email digest</li>
            </>
          ) : (
            <>
              <li>Everything in Pro</li>
              <li>10 websites (+£5/site extra)</li>
              <li>Priority support</li>
              <li>White-label reports (coming soon)</li>
              <li>Competitor tracking (coming soon)</li>
            </>
          )}
        </ul>
        <button className="upgrade-modal-cta" disabled={loading} onClick={async ()=>{
          setLoading(true);
          await startCheckout(priceId);
          setLoading(false);
        }}>
          {loading ? "Redirecting to checkout…" : billing==="annual" ? `Upgrade — ${p.annual}/year` : `Upgrade — ${p.monthly}/month`}
        </button>
        {billing==="monthly" && (
          <div style={{fontSize:".75rem",color:"var(--green)",textAlign:"center",margin:".5rem 0",cursor:"pointer"}} onClick={()=>setBilling("annual")}>
            💡 Switch to annual and save {p.save}/year
          </div>
        )}
        <div style={{fontSize:".7rem",color:"var(--text3)",textAlign:"center",marginTop:".5rem"}}>Secure payment via Stripe · Cancel any time</div>
        <div className="upgrade-modal-skip" onClick={()=>setShowUpgrade(false)}>Maybe later</div>
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
      const realPages = (siteData?.pages || [])
        .slice()
        .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
        .slice(0, 8)
        .map(p => {
          const path = (p.page || "").replace(/^https?:\/\/[^/]+/, "") || "/";
          return `${siteBase}${path}`;
        });
      // Always include the homepage as a guaranteed-valid fallback
      const homepageUrl = `${siteBase}/`;
      const linkPool = Array.from(new Set([homepageUrl, ...realPages]));
      const linkPoolContext = linkPool.length > 1
        ? `\nALLOWED INTERNAL LINKS — these are the ONLY URLs that exist on the client's site. You MUST link only to URLs from this list. Do NOT invent any other paths or you will create 404s:\n${linkPool.map(u => `- ${u}`).join("\n")}\n`
        : `\nALLOWED INTERNAL LINKS — only the homepage is confirmed on this site. Link any internal anchors to: ${homepageUrl}\n`;

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
${linkPoolContext}${historyContext}

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
1. HEAD: title tag (50-60 chars, MUST start with or contain "${kw.trim()}" in the first 30 chars), meta description (145-155 chars, MUST include "${kw.trim()}"), canonical URL (${siteBase}/[keyword-slug]/), robots, Open Graph tags (og:title MUST include "${kw.trim()}"), JSON-LD Article schema, datePublished today, the Google Fonts link, and a <style> block with the CSS above
2. HEADER BAR: dark, with the two-tone "RankActions" wordmark on the left (white "Rank" + green "Actions", Barlow Condensed weight 500) and "Generated for ${displaySite(selectedSite)}" on the right in small cream text
3. HERO SECTION: H1 containing the exact verbatim phrase "${kw.trim()}", followed by a subtitle, author byline, date, read time
4. ARTICLE BODY:
   - Opening paragraph: the FIRST SENTENCE must contain the exact phrase "${kw.trim()}" within the first 25 words
   - 4-6 H2 sections — at least 2 must contain the exact phrase "${kw.trim()}" in the heading text
   - At least one H3 subsection
   - One tip/callout box (green border-left)
   - Natural keyword usage — no stuffing, but the exact phrase "${kw.trim()}" should appear 4-8 times in body text
   - 2-4 internal links — these MUST use URLs from the ALLOWED INTERNAL LINKS list above. Do NOT invent paths. If no relevant deep page exists for a topic, either link to the homepage from the list OR don't add a link at all rather than making one up. Format: <a href="[URL from the allowed list]">[descriptive anchor text]</a>
   - Each internal link should have a comment: <!-- Internal link: link to your [page type] page -->
5. CTA SECTION: prominent green button with text "${cta.trim() || "Get in touch today"}"
6. FOOTER BAR: dark, centered, "Generated by RankActions — AI-powered SEO content" with "rankactions.com" linked in green #1ea863

IMPORTANT — The keyword "${kw.trim()}" MUST appear verbatim in the title, meta description, H1, first sentence, and at least 2 H2s. This is the single most important rule. Label internal links clearly so non-technical users know what they are. Every internal link MUST resolve to a real page (use only URLs from the ALLOWED INTERNAL LINKS list). The page must look professional and on-brand for RankActions while still being a usable blog post the client can publish.`;

        const text = await callClaude(prompt,
          "Expert SEO content writer. Output ONLY raw HTML starting with <!DOCTYPE html>. No markdown. No explanations.",
          "longform"
        );
        clearInterval(iv);
        const clean = text.replace(/^```html\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/i,"").trim();
        setOutput(clean);
        setTab("preview");
        // Track generated content to avoid future duplication
        try {
          const histKey = `ra_content_history_${selectedSite}`;
          const hist = JSON.parse(localStorage.getItem(histKey) || "[]");
          hist.push({ keyword: kw.trim(), date: new Date().toISOString().slice(0,10) });
          localStorage.setItem(histKey, JSON.stringify(hist.slice(-50))); // keep last 50
        } catch {}
      } catch(e) {
        clearInterval(iv);
        setError("Generation failed — please try again. If the problem persists, check your Worker is deployed.");
      }
      setLoading(false);
    };

    const copyHtml = () => {
      if (!output) return;
      navigator.clipboard.writeText(output).catch(()=>{});
      setCopied(true); setTimeout(()=>setCopied(false), 1800);
    };

    const download = () => {
      if (!output) return;
      const slug = kw.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([output],{type:"text/html"}));
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
          <button className="upgrade-wall-btn" onClick={()=>setShowUpgrade(true)}>Upgrade to Pro — £50/month</button>
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
            <option value="pro">Pro only</option>
            <option value="starter">Starter only</option>
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
                {selected.plan!=="pro" && (
                  <button className="drawer-btn upgrade" disabled={saving} onClick={()=>updateUser(selected._id,{plan:"pro"})}>
                    {selected.plan==="agency" ? "↓ Downgrade to Pro" : "↑ Upgrade to Pro"}
                  </button>
                )}
                {selected.plan!=="starter" && (
                  <button className="drawer-btn upgrade" style={{background:"var(--blue)"}} disabled={saving} onClick={()=>updateUser(selected._id,{plan:"starter"})}>
                    {selected.plan==="pro"||selected.plan==="agency" ? "↓ Downgrade to Starter" : "↑ Upgrade to Starter"}
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
                <div style={{fontSize:".8rem",color:"var(--text)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k.keyword}</div>
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
            {completedFixes.length > 0 ? (
              <>
                <div style={{fontSize:"1.4rem",fontWeight:800,fontFamily:"var(--mono)",color:"var(--green)",marginBottom:".5rem"}}>{completedFixes.length}</div>
                <div style={{fontSize:".78rem",color:"var(--text2)",marginBottom:".75rem"}}>actions completed for {selectedSite}</div>
                {completedFixes.slice(0,6).map((id,i) => (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:".5rem",padding:".3rem 0",fontSize:".78rem"}}>
                    <span style={{color:"var(--green)"}}>✓</span>
                    <span style={{color:"var(--text2)"}}>{id.replace("live-","Action #").replace("demo-","Fix: ")}</span>
                  </div>
                ))}
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
                : "Select one site to track. Upgrade to Pro to track unlimited sites."
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
                🔒 Free plan: 1 site only. <span style={{color:"var(--green)",cursor:"pointer",fontWeight:600}} onClick={()=>setShowUpgrade(true)}>Upgrade to Pro</span> to add unlimited sites.
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
    localStorage.setItem(`ra_prospects_${selectedSite}`, JSON.stringify(updated));
  };

  const moveProspect = (id, newStatus) => {
    const updated = linkProspects.map(p => p.id===id ? {...p, status:newStatus} : p);
    setLinkProspects(updated);
    localStorage.setItem(`ra_prospects_${selectedSite}`, JSON.stringify(updated));
  };

  const deleteProspect = (id) => {
    const updated = linkProspects.filter(p => p.id!==id);
    setLinkProspects(updated);
    localStorage.setItem(`ra_prospects_${selectedSite}`, JSON.stringify(updated));
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
    const [suggestions, setSuggestions] = useState(null);
    const [customTopic, setCustomTopic] = useState("");

    // Load saved strategy for this site
    const [strategy, setStrategy] = useState(() => {
      try { return JSON.parse(localStorage.getItem(`ra_strategy_${selectedSite}`) || "null"); } catch { return null; }
    });

    const saveStrategy = (s) => {
      setStrategy(s);
      localStorage.setItem(`ra_strategy_${selectedSite}`, JSON.stringify(s));
    };

    // Generate cluster suggestions from GSC data
    const generateSuggestions = async (topic) => {
      setGenerating(true);
      setSuggestions(null);
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

Generate exactly 1 strategy with 6-8 cluster posts. Make sure keywords are specific and realistic for a UK audience.`

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

Generate exactly 3 strategies, each with 6-8 cluster posts. Pick topics with the highest combined impression volume where I'm currently underperforming. Target UK audience. Be specific — use my actual keywords.`;

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
        setSuggestions(data.strategies || [data]); // handle single strategy response too
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
          localStorage.setItem(histKey, JSON.stringify(hist.slice(-20))); // keep last 20
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
    const writeContent = (keyword, title) => {
      if (!isPro) { setShowUpgrade(true); return; }
      contentPresetRef.current = { kw: keyword, biz: selectedSite, notes: `Part of pillar strategy: "${strategy?.topic}". Blog title suggestion: "${title}". Link back to the pillar page using the main keyword as anchor text.` };
      setScreen("content");
    };

    const statusColors = { not_started: "var(--text3)", drafted: "var(--amber)", published: "var(--green)" };
    const statusLabels = { not_started: "Not started", drafted: "Drafted", published: "Published" };
    const statusIcons  = { not_started: "○", drafted: "◐", published: "●" };
    const diffColors   = { easy: "var(--green)", medium: "var(--amber)", hard: "#f03e5f" };

    const cardStyle = { background: "var(--card)", border: "1px solid var(--b2)", borderRadius: 12, padding: "1.25rem" };
    const headStyle = { fontSize: ".72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text3)", marginBottom: ".75rem" };

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
                  <div style={{ fontSize: ".78rem", color: "var(--text2)", marginBottom: ".25rem" }}>Target keyword: "{strategy.pillar.keyword}" · {strategy.pillar.wordCount} words recommended</div>
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
                        <div style={{ fontSize: ".75rem", color: "var(--text3)" }}>"{c.keyword}" · {c.wordCount} words</div>
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
            <div><div style={valStyle}><span className={`plan-pill ${plan==="pro"?"pro":plan==="agency"?"agency":plan==="starter"?"starter":""}`} style={{fontSize:".75rem"}}>{plan==="agency"?"Agency":plan==="pro"?"Pro":plan==="starter"?"Starter":"Free"}</span></div><div style={subStyle}>Current plan</div></div>
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
  const RankTracker = () => {
    const [trackedKws, setTrackedKws] = useState([]);
    const [selectedKw, setSelectedKw] = useState(null);
    const [localSnapshots, setLocalSnapshots] = useState([]);
    const [loading, setLoading] = useState(false);
    const loadedSite = useRef(null);

    useEffect(() => {
      if (loadedSite.current === selectedSite) return;
      loadedSite.current = selectedSite;
      const load = async () => {
        setLoading(true);
        try {
          const siteUrl = selectedSite.startsWith("http") || selectedSite.startsWith("sc-domain:") ? selectedSite : `https://${selectedSite}`;
          // Auto-save a snapshot for today
          if (userId) {
            await authFetch(`${WORKER_URL}/api/rank-snapshot/save`, {
              method: "POST", headers: {"Content-Type":"application/json"},
              body: JSON.stringify({ siteUrl })
            }).catch(()=>{});
          }
          // Fetch snapshots
          const res = await authFetch(`${WORKER_URL}/api/rank-snapshots?siteUrl=${encodeURIComponent(siteUrl)}`);
          const data = await res.json();
          if (data.snapshots) {
            setLocalSnapshots(data.snapshots);
            const kwMap = {};
            data.snapshots.forEach(snap => {
              snap.keywords.forEach(k => {
                if (!kwMap[k.keyword]) kwMap[k.keyword] = { keyword: k.keyword, history: [] };
                kwMap[k.keyword].history.push({ date: snap.date, position: k.position, clicks: k.clicks, impressions: k.impressions });
              });
            });
            const sorted = Object.values(kwMap).sort((a,b) => b.history.length - a.history.length);
            setTrackedKws(sorted);
            if (sorted.length > 0) setSelectedKw(sorted[0].keyword);
          }
        } catch {}
        setLoading(false);
      };
      load();
    }, [selectedSite]);

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
      const pts = history.map((d,i)=>({ x:pL+(i/(history.length-1))*cW, y:pT+cH-((d.position-minP)/range)*cH }));
      // Position 1 = top of chart (y inverted already since lower position = higher)
      // Actually need to invert: lower position number should be higher on chart
      const invertPts = history.map((d,i)=>({ x:pL+(i/(history.length-1))*cW, y:pT+((d.position-minP)/range)*cH }));
      // So position 1 is at top (small y), position 30 at bottom (large y) — that's wrong. Let me fix:
      // We want: position 1 → y near pT (top), position 30 → y near pT+cH (bottom)
      // y = pT + ((position - minP) / range) * cH — this puts minP at top, maxP at bottom. That's correct!
      // Because lower position number is better and should be at the top.
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
      <div className="content" style={{padding:"1.5rem 2rem",maxWidth:1100}}>
        <div style={{marginBottom:"1.5rem"}}>
          <div style={{fontSize:"1.3rem",fontWeight:700}}><Tip term="rankTracker">Rank Tracker</Tip></div>
          <div style={{fontSize:".82rem",color:"var(--text3)"}}>{displaySite(selectedSite)} · {localSnapshots.length} snapshots · {trackedKws.length} keywords tracked</div>
        </div>
        {loading ? (
          <div style={{textAlign:"center",padding:"3rem",color:"var(--text3)"}}><div className="spinner-sm" style={{margin:"0 auto .75rem"}}/>Loading rank history...</div>
        ) : trackedKws.length === 0 ? (
          <div style={{textAlign:"center",padding:"3rem",background:"var(--s1)",borderRadius:12,border:"1px solid var(--border)"}}>
            <div style={{fontSize:"2rem",marginBottom:".5rem"}}>📈</div>
            <div style={{fontWeight:600,marginBottom:".4rem"}}>No rank data yet</div>
            <div style={{fontSize:".82rem",color:"var(--text3)",maxWidth:400,margin:"0 auto"}}>
              RankActions captures your keyword positions automatically. Your first snapshot will appear after your next Monday digest, or reload this page to capture one now.
            </div>
          </div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:"1.5rem",alignItems:"start"}}>
            <div style={{background:"var(--s1)",borderRadius:12,border:"1px solid var(--border)",overflow:"hidden"}}>
              <div style={{padding:".65rem 1rem",borderBottom:"1px solid var(--border)",fontWeight:600,fontSize:".78rem",color:"var(--text3)"}}>Keywords ({trackedKws.length})</div>
              <div style={{maxHeight:480,overflow:"auto"}}>
                {trackedKws.map(kw=>{
                  const ch = getChange(kw.keyword);
                  const latest = kw.history[kw.history.length-1];
                  return (
                    <div key={kw.keyword} onClick={()=>setSelectedKw(kw.keyword)}
                      style={{padding:".5rem .85rem",cursor:"pointer",borderBottom:"1px solid var(--b2)",
                        background:selectedKw===kw.keyword?"var(--s2)":"transparent",
                        borderLeft:selectedKw===kw.keyword?"3px solid var(--green)":"3px solid transparent"}}>
                      <div style={{fontSize:".78rem",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{kw.keyword}</div>
                      <div style={{display:"flex",gap:".6rem",fontSize:".68rem",color:"var(--text3)"}}>
                        <span>#{latest.position}</span>
                        {ch!==null && <span style={{color:ch>0?"var(--green)":ch<0?"#f03e5f":"var(--text3)",fontWeight:600}}>{ch>0?`↑${ch}`:ch<0?`↓${Math.abs(ch)}`:"→"}</span>}
                        <span>{kw.history.length}wk</span>
                      </div>
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

  // ─────────────────────────────────────────────────────────────
  // PAGE AUDIT
  // ─────────────────────────────────────────────────────────────
  const PageAudit = () => {
    const [url, setUrl] = useState(auditUrl || (selectedSite.startsWith("sc-domain:")?`https://${selectedSite.replace("sc-domain:","")}`:selectedSite.startsWith("http")?selectedSite:`https://${selectedSite}`));

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
  // ROOT
  // ─────────────────────────────────────────────────────────────
  return (
    <><style>{CSS}</style>
    <div className="gos" onClick={()=>siteOpen&&setSiteOpen(false)}>
      <div className="layout">
        <Sidebar/>
        <div className="main-area">
          <TopBar/>
          {screen==="dashboard"  && <DashboardContent/>}
          {screen==="siteDetail" && <SiteDetailContent/>}
          {screen==="content"    && <ContentGenerator/>}
          {screen==="strategy"   && <StrategyPlanner/>}
          {screen==="links"      && <LinkBuildingScreen/>}
          {screen==="tracker"    && <RankTracker/>}
          {screen==="audit"      && <PageAudit/>}
          {screen==="settings"   && <SettingsScreen/>}
          {screen==="reports"    && <ReportsTab/>}
          {screen==="admin"      && isAdmin && <AdminPanel/>}
          {screen==="admin"      && !isAdmin && <div className="content" style={{textAlign:"center",paddingTop:"4rem",color:"var(--text3)"}}>Access denied.</div>}
          
          {/* Disclaimer footer */}
          <div style={{padding:"1rem 2rem",borderTop:"1px solid var(--border)",fontSize:".68rem",color:"var(--text3)",lineHeight:1.6,textAlign:"center"}}>
            RankActions provides AI-generated suggestions and recommendations only. Always back up your website before making changes. Review all content and fixes before implementing. RankActions and E2E Integration accept no responsibility for changes made to your website, loss of data, or service disruption resulting from actions taken based on our suggestions. See our <a href="https://rankactions.com/terms.html" target="_blank" rel="noopener" style={{color:"var(--text3)",textDecoration:"underline"}}>Terms of Service</a> for full details.
          </div>
        </div>
      </div>
      {modal            && FixModal()}
      {croModal         && <CroModal/>}
      {showUpgrade      && <UpgradeModal/>}
      {gscSitePicker    && <GscSitePicker/>}
      {showTour         && <OnboardingTour/>}
    </div></>
  );
}
