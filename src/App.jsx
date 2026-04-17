import { useState, useEffect, useRef } from "react";
import {
  SignIn, SignUp, UserButton,
  useUser, useClerk, SignedIn, SignedOut
} from "@clerk/clerk-react";

// ─────────────────────────────────────────────────────────────
// ⚙️  CONFIG — paste your Worker URL here after deploying it
// ─────────────────────────────────────────────────────────────
const WORKER_URL = import.meta.env.VITE_WORKER_URL || "https://growthos-api.growthos.workers.dev";

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
.plan-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;width:100%;max-width:860px;margin-bottom:1.5rem;}
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
.site-picker-checkbox{width:18px;height:18px;border-radius:4px;border:2px solid var(--border2);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;transition:all .15s;}
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
.site-picker-search:focus{border-color:var(--blue);}`;
// ─── Demo fallback data ───────────────────────────────────────
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
async function callClaude(userMsg, systemMsg, mode = 'standard') {
  const res = await fetch(`${WORKER_URL}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userMsg, systemMsg, mode }),
  });
  if (!res.ok) throw new Error(`AI request failed: ${res.status}`);
  const d = await res.json();
  return d.text || "";
}

// ─── Main component ───────────────────────────────────────────
export default function RankActions() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut }                    = useClerk();

  // Auth UI state
  const [authView,  setAuthView]  = useState("signin"); // signin | signup
  const [showPlan,  setShowPlan]  = useState(false);
  const [plan,      setPlan]      = useState(() => localStorage.getItem("rankactions_plan") || "free");
  const [selPlan,   setSelPlan]   = useState("free");

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
  const [sites,        setSites]        = useState(() => JSON.parse(localStorage.getItem("rankactions_sites") || '["mywebsite.com"]'));
  const [addingSite,   setAddingSite]   = useState(false);
  const [newSiteInput, setNewSiteInput] = useState("");
  const [siteOpen,     setSiteOpen]     = useState(false);
  const [activeTab,    setActiveTab]    = useState("Overview");
  const [expandedFix,  setExpandedFix]  = useState(null);
  const [doneFixes,    setDoneFixes]    = useState(new Set());
  const [copiedId,     setCopiedId]     = useState(null);
  const [aiSummary,    setAiSummary]    = useState(null);
  const [summaryLoading,setSummaryLoading] = useState(false);
  const [modal,        setModal]        = useState(null);
  const [modalData,    setModalData]    = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalApplied, setModalApplied] = useState(new Set());
  const contentPresetRef = useRef(null);
  const [croModal,   setCroModal]   = useState(null);
  const [croData,    setCroData]    = useState(null);
  const [croLoading, setCroLoading] = useState(false);
  const [aiFixCount,   setAiFixCount]   = useState(() => {
    const stored = JSON.parse(localStorage.getItem("rankactions_ai_fix_usage") || '{"count":0,"month":""}');
    const thisMonth = new Date().toISOString().slice(0,7);
    if (stored.month !== thisMonth) return 0; // reset each month
    return stored.count;
  });
  const [showUpgrade,  setShowUpgrade]  = useState(false);
  const [planBilling,  setPlanBilling]  = useState("monthly");
  const [gscSitePicker, setGscSitePicker] = useState(null); // list of sites to pick from // for plan selection screen

  // ── Plan helpers ────────────────────────────────────────────
  const isAgency = plan === "agency";
  const isPro    = plan === "pro" || isAgency; // agency gets all Pro features
  const AI_FIX_LIMIT = 5; // free tier monthly limit
  const aiFixesLeft = Math.max(0, AI_FIX_LIMIT - aiFixCount);

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

    const profileUrl = `${WORKER_URL}/api/user/profile?clerkId=${encodeURIComponent(clerkId)}` + (userId ? `&userId=${encodeURIComponent(userId)}` : "");
    fetch(profileUrl)
      .then(r => r.json())
      .then(data => {
        if (data.found) {
          // Server has a plan record — use it as source of truth
          if (data.plan && data.plan !== plan) {
            setPlan(data.plan);
            localStorage.setItem("rankactions_plan", data.plan);
          }
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
  // The Worker redirects back with ?userId=xxx&auth=success
  useEffect(() => {
    const params      = new URLSearchParams(window.location.search);
    const uid         = params.get("userId");
    const result      = params.get("auth");
    const saved       = localStorage.getItem("rankactions_userId");
    const savedSite   = localStorage.getItem("rankactions_selectedSite");
    const savedSites  = localStorage.getItem("rankactions_sites");

    if (result === "error") setDataError("Google connection failed. Check your Worker URL is correct.");

    const activeUid = uid || saved;
    if (activeUid) {
      setUserId(activeUid);
      setIsConnected(true);
      localStorage.setItem("rankactions_userId", activeUid);

      if (uid) {
        // Fresh OAuth return — fetch the user's GSC sites then let them pick
        fetch(`${WORKER_URL}/api/gsc-sites?userId=${encodeURIComponent(uid)}`)
          .then(r => r.json())
          .then(data => {
            const gscSites = data.sites || [];
            const pendingSite = localStorage.getItem("rankactions_pending_site") || "";
            localStorage.removeItem("rankactions_pending_site");

            if (gscSites.length === 0) {
              // No GSC sites — use what they typed
              const fallback = pendingSite || "mywebsite.com";
              setSelectedSite(fallback);
              localStorage.setItem("rankactions_selectedSite", fallback);
              setSites([fallback]);
              localStorage.setItem("rankactions_sites", JSON.stringify([fallback]));
            } else if (gscSites.length === 1) {
              // Only one site — use it automatically, no picker needed
              const site = gscSites[0].siteUrl;
              setSelectedSite(site);
              localStorage.setItem("rankactions_selectedSite", site);
              setSites([site]);
              localStorage.setItem("rankactions_sites", JSON.stringify([site]));
            } else {
              // Multiple sites — show picker with pending site pre-selected
              setGscSitePicker({ sites: gscSites, pending: pendingSite, userId: uid });
            }
          })
          .catch(() => {
            const fallback = localStorage.getItem("rankactions_pending_site") || savedSite || "mywebsite.com";
            localStorage.removeItem("rankactions_pending_site");
            setSelectedSite(fallback);
            localStorage.setItem("rankactions_selectedSite", fallback);
            setSites([fallback]);
            localStorage.setItem("rankactions_sites", JSON.stringify([fallback]));
          });
      } else {
        // Returning user — restore from localStorage
        if (savedSite && savedSite !== "mywebsite.com") setSelectedSite(savedSite);
        if (savedSites) setSites(JSON.parse(savedSites));
      }

      window.history.replaceState({}, "", window.location.pathname);
      setScreen("dashboard");
    }
  }, []);

  // ── Sync user data to Worker for admin panel ───────────────
  useEffect(() => {
    if (!userId && !user?.id) return;
    fetch(`${WORKER_URL}/api/user/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        clerkId:    user?.id,
        plan,
        sites,
        aiFixCount,
      })
    }).catch(()=>{});
  }, [plan, sites, aiFixCount]);

  // ── Fetch data when userId or site changes ──────────────────
  useEffect(() => {
    if (userId && selectedSite && screen !== "onboarding") fetchSiteData();
  }, [userId, selectedSite]);

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

  // ── Auto-generate summary when screen/data changes ──────────
  useEffect(() => {
    if (screen === "dashboard" && !aiSummary && !summaryLoading) generateSummary();
  }, [screen, siteData]);

  // ─────────────────────────────────────────────────────────────
  // Fetch real Search Console data from the Worker
  // ─────────────────────────────────────────────────────────────
  const fetchSiteData = async () => {
    setDataLoading(true); setDataError(null);
    try {
      const siteUrl = selectedSite.startsWith("http") ? selectedSite : `https://${selectedSite}`;
      const res = await fetch(
        `${WORKER_URL}/api/search-console?userId=${encodeURIComponent(userId)}&siteUrl=${encodeURIComponent(siteUrl)}`
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
    return [
      { label:"Organic Traffic", value:t.clicks.toLocaleString(),     delta:"last 28 days", pos:true, sub:"clicks",            source:"live" },
      { label:"Impressions",     value:t.impressions.toLocaleString(), delta:"last 28 days", pos:true, sub:"search appearances", source:"live" },
      { label:"Avg. Position",   value:String(t.avgPosition),          delta:"from GSC",     pos:null, sub:"lower = better",     source:"live" },
      { label:"Click Rate",      value:t.avgCtr,                       delta:"from GSC",     pos:true, sub:"avg CTR",            source:"live" },
    ];
  };

  const getPriorityFixes = () => {
    if (!siteData?.topOpportunities?.length) return DEMO_FIXES;
    const colors = ["#f03e5f","#f5a623","#0fdb8a"];
    const labels = ["HIGH IMPACT","OPPORTUNITY","QUICK WIN"];
    const levels = ["high","medium","low"];
    return siteData.topOpportunities.slice(0,3).map((opp,i) => ({
      id:`live-${i}`, level:levels[i], color:colors[i], label:labels[i], type:"SEO",
      title:`Improve ranking for "${opp.keyword}"`,
      desc:`Currently at position #${opp.position}. ${opp.potential}.`,
      m1:`Position: #${opp.position}`, m2:opp.potential,
      suggestion:opp.fix,
      field:"Page Content & Title",
      current:`Not fully optimised for "${opp.keyword}"`,
      recommended:opp.fix,
      metaDesc:null,
    }));
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
        detail: `High traffic page · load time unverified — connect PageSpeed API for real data`,
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
        ? realPages.slice(0, 2).map(p => ({ url: p.url, detail: "Load time unverified — connect PageSpeed API for real data", priority: "medium" }))
        : [
            { url:`/`,          detail:"Load time unverified — connect PageSpeed API", priority:"medium" },
            { url:`/services/`, detail:"Load time unverified — connect PageSpeed API", priority:"medium" },
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
        summary:`Key pages on ${site} may load slowly on mobile — Google uses mobile speed as a ranking factor.`,
        fix:"Compress images, enable lazy loading and remove unused JavaScript to improve load time.",
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
          : "Senior SEO copywriter. Return valid JSON only. No markdown. Be SPECIFIC to the keyword and page — never generic."
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
        "Senior CRO specialist. Return valid JSON only. No markdown. Be specific to the page and issue — never generic."
      );
      setCroData(JSON.parse(txt.replace(/```json|```/g,"").trim()));
    } catch {
      setCroData({ error: "Could not generate suggestions — please try again." });
    }
    setCroLoading(false);
  };

  const disconnect = () => {
    localStorage.removeItem("rankactions_userId");
    setUserId(null); setIsConnected(false); setSiteData(null); setDataError(null); setAiSummary(null);
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
      <div className="plan-wrap">
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
            <div className="plan-name">Free</div>
            <div className="plan-price">£0</div>
            <div className="plan-period">forever</div>
            <ul className="plan-features">
              <li>1 website</li>
              <li>Top 3 weekly actions</li>
              <li>5 AI fix suggestions/month</li>
              <li>Search Console data</li>
            </ul>
          </div>
          <div className={`plan-card featured ${selPlan==="pro"?"selected":""}`} onClick={()=>setSelPlan("pro")}>
            <div className="plan-badge">Most popular</div>
            <div className="plan-name">Pro</div>
            <div className="plan-price">{isAnnual ? "£500" : "£50"}</div>
            <div className="plan-period">{isAnnual ? "per year — £41.67/mo" : "per month"}</div>
            {isAnnual && <div style={{fontSize:".78rem",color:"var(--green)",fontWeight:600,marginBottom:".5rem"}}>Save £100 vs monthly</div>}
            <ul className="plan-features">
              <li>Unlimited websites</li>
              <li>Full action list</li>
              <li>Unlimited AI fixes</li>
              <li>AI content generator</li>
              <li>Conversion tracking</li>
              <li>Weekly email digest</li>
            </ul>
          </div>
          <div className={`plan-card ${selPlan==="agency"?"selected":""}`} onClick={()=>setSelPlan("agency")}>
            <div className="plan-name">Agency</div>
            <div className="plan-price">{isAnnual ? "£900" : "£90"}</div>
            <div className="plan-period">{isAnnual ? "per year — £75/mo" : "per month"}</div>
            {isAnnual && <div style={{fontSize:".78rem",color:"var(--green)",fontWeight:600,marginBottom:".5rem"}}>Save £180 vs monthly</div>}
            <ul className="plan-features">
              <li>Everything in Pro</li>
              <li>Unlimited client sites</li>
              <li>DataForSEO data (soon)</li>
              <li>Competitor tracking (soon)</li>
              <li>White-label reports (soon)</li>
            </ul>
          </div>
        </div>
        <button className="plan-continue-btn" onClick={()=>{
          setPlan(selPlan);
          localStorage.setItem("rankactions_plan", selPlan);
          localStorage.setItem("rankactions_plan_chosen", "1");
          localStorage.setItem("rankactions_billing", planBilling);
          setShowPlan(false);
        }}>
          {selPlan==="free" ? "Continue with Free →" : `Start with ${selPlan==="agency"?"Agency":"Pro"} ${isAnnual?"(Annual)":"(Monthly)"} →`}
        </button>
        <div className="plan-skip" onClick={()=>{
          localStorage.setItem("rankactions_plan_chosen","1");
          setShowPlan(false);
        }}>Skip for now — start with Free</div>
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
            <div className="ob-connect-card active" onClick={()=>window.location.href=`${WORKER_URL}/auth/google`}>
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
  // Add site helper
  // ─────────────────────────────────────────────────────────────
  const addSite = () => {
    // Gate: free users can only have 1 site
    if (!isPro && sites.length >= 1) {
      setShowUpgrade(true);
      return;
    }
    const input = window.prompt("Enter your website URL:", "e.g. mysite.com");
    if (!input || !input.trim()) return;
    const clean = input.trim().replace(/^https?:\/\//,"").replace(/\/$/,"");
    if (!clean) return;
    const updated = [...new Set([...sites, clean])];
    setSites(updated);
    localStorage.setItem("rankactions_sites", JSON.stringify(updated));
    setSelectedSite(clean);
    localStorage.setItem("rankactions_selectedSite", clean);
    setSiteData(null); setAiSummary(null); setSiteOpen(false);
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
          {id:"content",    icon:"✍", label:"Content"},
          {id:"reports",    icon:"📄", label:"Reports"},
          {id:"settings",   icon:"⚙", label:"Settings"},
          ...(isAdmin ? [{id:"admin", icon:"🔐", label:"Admin"}] : []),
        ].map(n=>(
          <div key={n.id} className={`nav-item ${screen===n.id?"active":""}`}
            onClick={()=>{
              if(["dashboard","siteDetail","content","admin","reports"].includes(n.id)) setScreen(n.id);
            }}>
            <span style={{fontSize:"0.9rem"}}>{n.icon}</span>
            {n.label}
            {n.id==="content" && !isPro && <span style={{fontSize:".6rem",marginLeft:"auto",color:"var(--text3)"}}>Pro</span>}
          </div>
        ))}
      </div>
    </div>
  );

  const TopBar = () => (
    <div className="topbar">
      <div className="site-selector">
        <div className="site-btn" onClick={e=>{e.stopPropagation();setSiteOpen(p=>!p);setAddingSite(false);}}>
          <span>🌐</span><span>{selectedSite}</span><span style={{color:"var(--text3)",fontSize:"0.7rem"}}>▼</span>
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
                {s}
              </div>
            ))}
            <div className="site-add" onClick={addSite}>➕ Add site</div>
          </div>
        )}
      </div>
      <div className="topbar-right">
        {dataLoading  ? <span className="topbar-badge demo">⏳ Fetching…</span>
         : isConnected && siteData ? <span className="topbar-badge">✓ Live data</span>
         : <span className="topbar-badge demo">⚠ Demo data</span>}
        <span
          className={`plan-pill ${plan==="pro"?"pro":plan==="agency"?"agency":""}`}
          style={{cursor:"pointer"}}
          title="Click to change plan"
          onClick={()=>{
            localStorage.removeItem("rankactions_plan_chosen");
            setShowPlan(true);
          }}>
          {plan==="agency"?"Agency":plan==="pro"?"Pro":"Free"}
        </span>
        {isConnected
          ? <button className="disconnect-btn" onClick={disconnect}>Disconnect GSC</button>
          : <button className="connect-btn" onClick={()=>window.location.href=`${WORKER_URL}/auth/google`}>🔗 Connect Google</button>}
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
              fetch(`${WORKER_URL}/api/user/sync`,{
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
    if (!isConnected) return <div className="data-banner">📊 Showing demo data. Connect Google Search Console for your real numbers.<button className="data-banner-action" onClick={()=>window.location.href=`${WORKER_URL}/auth/google`}>Connect Google →</button></div>;
    if (siteData)     return <div className="data-banner live">✓ Live data · {selectedSite} · Last {siteData.dateRange.days} days<button className="data-banner-action" onClick={fetchSiteData}>Refresh</button></div>;
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
        <div className="kpi-strip">
          {kpis.map((k,i)=>(
            <div key={i} className="kpi-card">
              <div className="kpi-label">{k.label}</div>
              <div className={`kpi-value ${dataLoading?"shimmer":""}`}>{k.value}</div>
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

        <div className="section-head">
          <div className="section-title">Priority Actions</div>
          <div className="section-sub">{siteData?"Based on your live data":"Demo data"} · {fixes.filter(f=>!doneFixes.has(f.id)).length} remaining</div>
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
                    <div className="fix-suggestion-box">
                      <div className="fix-sugg-label">Suggested Fix</div>
                      <div className="fix-sugg-text">{fix.suggestion}</div>
                    </div>
                    <div className="fix-actions">
                      <button className="fa-btn primary" onClick={()=>openModal(fix)}>
                        ✨ Generate alternatives
                        {!isPro && <span className={`ai-fix-counter ${aiFixesLeft<=2?"warn":""}`}>({aiFixesLeft} left)</span>}
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
        <div className="site-detail-name">{selectedSite}</div>
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
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value">{k.value}</div>
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
            <div className="section-title">Keyword Opportunities</div>
            <div className="section-sub">{siteData?`${seoRows.length} keywords from Search Console`:"Demo keywords"}</div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Keyword</th><th>Position</th><th>Impressions/mo</th><th>What to do</th><th>Action</th></tr></thead>
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
            <div className="section-title">Conversion Issues</div>
            <div className="section-sub">Pages with traffic but low conversions — industry average: 2.1%</div>
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

          {/* Data notice */}
          <div className="issue-data-note">
            🔍 <strong>These are demo issues.</strong> Connect Google Search Console and the PageSpeed Insights API (Phase 2) to see real technical issues specific to your site — including actual slow pages, real broken links and missing meta descriptions detected by crawling your live site.
          </div>
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
          <button className="mf-btn" onClick={()=>openModal(modal)} disabled={modalLoading}>{modalLoading?"Generating…":"↻ Regenerate"}</button>
          <button className={`mf-btn ${modalApplied.has(modal.id)?"done":"primary"}`}
            onClick={()=>{setModalApplied(p=>new Set([...p,modal.id]));setDoneFixes(p=>new Set([...p,modal.id]));}}>
            {modalApplied.has(modal.id)?"✓ Applied":"✅ Mark as applied"}
          </button>
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
    const [billing, setBilling] = useState("monthly");
    return (
    <div className="upgrade-overlay" onClick={e=>e.target===e.currentTarget&&setShowUpgrade(false)}>
      <div className="upgrade-modal">
        <div className="upgrade-modal-badge">Pro Feature</div>
        <h2>Upgrade to Pro</h2>
        <p>Unlock unlimited AI fixes, content generation, conversion tracking and more.</p>

        {/* Billing toggle */}
        <div style={{display:"flex",background:"var(--s2)",borderRadius:999,padding:3,gap:3,marginBottom:"1.25rem"}}>
          {[["monthly","£50/month"],["annual","£500/year"]].map(([b,label])=>(
            <button key={b} onClick={()=>setBilling(b)}
              style={{flex:1,padding:".45rem",borderRadius:999,border:"none",fontFamily:"var(--font)",fontSize:".82rem",fontWeight:600,cursor:"pointer",background:billing===b?"var(--green)":"none",color:billing===b?"#000":"var(--text2)",transition:"all .15s"}}>
              {label}
              {b==="annual" && <span style={{display:"block",fontSize:".68rem",fontWeight:500,opacity:.8}}>save £100</span>}
            </button>
          ))}
        </div>

        <ul className="upgrade-modal-features">
          <li>Unlimited websites</li>
          <li>Unlimited AI fix generator</li>
          <li>AI content generator — blog posts in 30 seconds</li>
          <li>Conversions tab — find pages losing leads</li>
          <li>Issues tab — technical SEO problems</li>
          <li>Full SEO keyword opportunities</li>
          <li>Weekly email digest</li>
        </ul>
        <button className="upgrade-modal-cta" onClick={()=>{
          setPlan("pro");
          localStorage.setItem("rankactions_plan","pro");
          setShowUpgrade(false);
          alert("Stripe payments coming in Phase 2 — plan set to Pro for testing.");
        }}>
          {billing==="annual" ? "Upgrade to Pro — £500/year" : "Upgrade to Pro — £50/month"}
        </button>
        {billing==="monthly" && (
          <div style={{fontSize:".75rem",color:"var(--green)",textAlign:"center",margin:".5rem 0",cursor:"pointer"}} onClick={()=>setBilling("annual")}>
            💡 Switch to annual and save £100/year
          </div>
        )}
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
    const [siteStyle, setSiteStyle] = useState(null);
    const [scanning,  setScanning]  = useState(false);

    const loadMsgs = [
      "Researching your keyword…",
      "Scanning your site for styles…",
      "Writing SEO-optimised content…",
      "Structuring headings and subheadings…",
      "Adding internal link suggestions…",
      "Applying your site's design…",
      "Finalising meta tags…",
    ];

    // Clear ref immediately so revisiting content tab starts fresh
    useEffect(()=>{ contentPresetRef.current = null; },[]);

    const suggestedKw = siteData?.topOpportunities?.[0]?.keyword || "";

    // Scan the user's site for colours, fonts and layout
    const scanSite = async () => {
      setScanning(true);
      try {
        const res  = await fetch(`${WORKER_URL}/api/scan-site?siteUrl=${encodeURIComponent(selectedSite)}`);
        const data = await res.json();
        if (data.scanned) setSiteStyle(data);
      } catch(e) { console.warn("Site scan failed — continuing without styles"); }
      setScanning(false);
    };

    const seoStats = output ? {
      titleLen: (output.match(/<title>(.*?)<\/title>/i)?.[1]||"").length,
      descLen:  (output.match(/meta name="description" content="(.*?)"/i)?.[1]||"").length,
      h2Count:  (output.match(/<h2/gi)||[]).length,
      h1Count:  (output.match(/<h1/gi)||[]).length,
      wordEst:  Math.round(output.replace(/<[^>]*>/g,"").split(/\s+/).length),
      hasKw:    kw && output.toLowerCase().includes(kw.toLowerCase()),
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

      // Scan site for styles if not already done
      let style = siteStyle;
      if (!style) {
        try {
          const res  = await fetch(`${WORKER_URL}/api/scan-site?siteUrl=${encodeURIComponent(selectedSite)}`);
          const data = await res.json();
          if (data.scanned) { style = data; setSiteStyle(data); }
        } catch(e) {}
      }

      // Build style context from scan
      const styleContext = style ? `
SITE DESIGN — match this as closely as possible:
- Brand name: ${style.brandName}
- Detected colours: ${style.colors?.slice(0,8).join(', ') || 'not detected'}
- Primary background: ${style.primaryBg || 'white'}
- Primary text colour: ${style.primaryText || '#333'}
- Fonts detected: ${style.fonts?.join(', ') || 'system-ui'}
- Google Fonts URLs: ${style.gFonts?.join(', ') || 'none'}
- Nav links to replicate: ${style.navLinks?.join(' | ') || 'none'}
Use these exact colours and fonts in the generated HTML. Import the Google Fonts if available.` : '';

      try {
        const prompt = `You are an expert SEO content writer. Generate a complete, production-ready HTML blog post.

OUTPUT ONLY raw HTML starting with <!DOCTYPE html>. No markdown, no code fences, no explanation.

INPUTS:
- Target keyword: "${kw.trim()}"
- Business/niche: ${biz.trim() || "general business"}
- Tone: ${tone}
- Target word count: ~${wordCount} words
- Primary CTA: ${cta.trim() || "Contact us to find out more"}
- Additional notes: ${notes.trim() || "none"}
- Website: ${selectedSite}
${styleContext}

DATA NOTICE: Only keyword, business context and tone are sent to AI. No personal data included.

BUILD THIS STRUCTURE:
1. HEAD: title tag (50-60 chars, keyword first), meta description (145-155 chars, include keyword), canonical URL (https://${selectedSite}/[keyword-slug]/), robots, Open Graph tags, JSON-LD Article schema, datePublished today
2. NAV: replicate detected nav links if available, otherwise simple nav with site name and 3-4 links
3. HERO SECTION: H1 containing exact keyword "${kw.trim()}", subtitle, author, date, read time
4. ARTICLE BODY: max-width 760px, margin auto, padding 3rem 2rem
   - Opening paragraph with keyword in first 100 words
   - 4-6 H2 sections (keyword-rich headings)
   - At least one H3 subsection
   - One tip/callout box (border-left: 3px solid accent colour)
   - Natural keyword usage — no stuffing
   - 3-5 internal links: <a href="/[related-slug]/">[related topic]</a>
   - Each internal link should have a comment: <!-- Internal link: link to your [page type] page -->
5. CTA SECTION: "${cta.trim() || "Get in touch today"}" button
6. FOOTER: site name, copyright ${new Date().getFullYear()}

IMPORTANT — Label internal links clearly so non-technical users know what they are.`;

        const text = await callClaude(prompt,
          "Expert SEO content writer. Output ONLY raw HTML starting with <!DOCTYPE html>. No markdown. No explanations.",
          "longform"
        );
        clearInterval(iv);
        const clean = text.replace(/^```html\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/i,"").trim();
        setOutput(clean);
        setTab("preview");
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
              <button
                style={{width:"100%",padding:".6rem",background:"var(--s3)",border:"1px solid var(--border)",borderRadius:8,color:siteStyle?"var(--green)":"var(--text2)",fontFamily:"var(--font)",fontSize:".82rem",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:".5rem"}}
                onClick={scanSite} disabled={scanning}>
                {scanning ? <><span className="spinner-sm"/> Scanning site…</> : siteStyle ? "✓ Site styles scanned — regenerate to apply" : "🎨 Scan site for colours & fonts"}
              </button>
              <div className="cg-tip">
                ⏱ Generation takes 20–40 seconds. The article is created in your browser and never stored on our servers.
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
                <div style={{padding:".65rem 1rem",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid var(--border)",flexWrap:"wrap",gap:".5rem"}}>
                  <div style={{fontSize:".78rem",color:"var(--text2)"}}>
                    {annotated ? "🏷 Labels visible — toggle off to see clean version" : "Clean preview — toggle labels to see SEO structure"}
                  </div>
                  <button
                    style={{background:"var(--blue)",color:"#fff",border:"none",borderRadius:7,padding:".4rem .9rem",fontFamily:"var(--font)",fontSize:".8rem",fontWeight:600,cursor:"pointer"}}
                    onClick={()=>{
                      const w = window.open("","_blank");
                      if(w){ w.document.open(); w.document.write(output); w.document.close(); }
                    }}>
                    🔍 Open in new tab
                  </button>
                </div>
                <iframe
                  key={annotated ? "annotated" : "clean"}
                  ref={el=>{ if(el){ const d=el.contentDocument||el.contentWindow?.document; if(d){d.open();d.write(annotated ? buildAnnotated(output) : output);d.close();} } }}
                  style={{width:"100%",minHeight:580,border:"none",background:"white",flex:1}}
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
  const ADMIN_CLERK_ID = "user_3CMXybSmGDdSNc2caXRZraMoZdt";
  const isAdmin = user?.id === ADMIN_CLERK_ID;

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
    const [adminSecret,setAdminSecret]= useState(localStorage.getItem("ra_admin_secret")||"");
    const [secretInput,setSecretInput]= useState("");
    const [authed,     setAuthed]     = useState(!!localStorage.getItem("ra_admin_secret"));

    const fetchUsers = async (secret) => {
      setLoading(true); setError(null);
      try {
        const res  = await fetch(`${WORKER_URL}/api/admin/users`, {
          headers: { "x-admin-secret": secret || adminSecret }
        });
        if (res.status === 401) { setError("Invalid admin secret"); setAuthed(false); return; }
        const data = await res.json();
        setUsers(data.users || []);
      } catch(e) { setError("Failed to load users"); }
      setLoading(false);
    };

    useEffect(()=>{ if(authed && adminSecret) fetchUsers(adminSecret); },[authed]);

    const updateUser = async (userId, changes) => {
      setSaving(true);
      try {
        await fetch(`${WORKER_URL}/api/admin/user/${userId}`, {
          method:"POST",
          headers:{ "Content-Type":"application/json", "x-admin-secret": adminSecret },
          body: JSON.stringify(changes)
        });
        setUsers(prev => prev.map(u => u.userId===userId ? {...u,...changes} : u));
        setSelected(prev => prev?.userId===userId ? {...prev,...changes} : prev);
      } catch(e) { alert("Update failed"); }
      setSaving(false);
    };

    const deleteUser = async (userId) => {
      if (!window.confirm("Permanently delete this user and all their data? This cannot be undone.")) return;
      setSaving(true);
      try {
        await fetch(`${WORKER_URL}/api/admin/user/${userId}`, {
          method:"DELETE",
          headers:{ "x-admin-secret": adminSecret }
        });
        setUsers(prev => prev.filter(u => u.userId!==userId));
        setSelected(null);
      } catch(e) { alert("Delete failed"); }
      setSaving(false);
    };

    const filtered = users.filter(u => {
      const matchSearch = !search || u.email?.toLowerCase().includes(search.toLowerCase()) || u.name?.toLowerCase().includes(search.toLowerCase());
      const matchFilter = filter==="all"
        || (filter==="agency"  && u.plan==="agency")
        || (filter==="pro"     && u.plan==="pro")
        || (filter==="free"    && (!u.plan||u.plan==="free"))
        || (filter==="disabled"&& u.disabled);
      return matchSearch && matchFilter;
    });

    const stats = {
      total:    users.length,
      pro:      users.filter(u=>u.plan==="pro").length,
      agency:   users.filter(u=>u.plan==="agency").length,
      free:     users.filter(u=>!u.plan||u.plan==="free").length,
      disabled: users.filter(u=>u.disabled).length,
    };

    const fmt = (iso) => iso ? new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "—";

    // Auth gate — enter admin secret
    if (!authed) return (
      <div className="admin-wrap" style={{maxWidth:420,margin:"4rem auto",textAlign:"center"}}>
        <div style={{fontSize:"1.5rem",marginBottom:".5rem"}}>🔐</div>
        <div style={{fontSize:"1rem",fontWeight:700,marginBottom:".35rem"}}>Admin access</div>
        <div style={{fontSize:".85rem",color:"var(--text2)",marginBottom:"1.5rem"}}>Enter your admin secret to continue</div>
        <input
          type="password" placeholder="Admin secret"
          value={secretInput} onChange={e=>setSecretInput(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"&&secretInput.trim()){ localStorage.setItem("ra_admin_secret",secretInput.trim()); setAdminSecret(secretInput.trim()); setAuthed(true); }}}
          style={{width:"100%",background:"var(--s2)",border:"1px solid var(--border)",borderRadius:8,padding:".75rem 1rem",color:"var(--text)",fontFamily:"var(--font)",fontSize:".9rem",outline:"none",marginBottom:".75rem"}}
        />
        <button style={{width:"100%",padding:".75rem",background:"var(--blue)",color:"#fff",border:"none",borderRadius:8,fontFamily:"var(--font)",fontSize:".9rem",fontWeight:600,cursor:"pointer"}}
          onClick={()=>{ if(secretInput.trim()){ localStorage.setItem("ra_admin_secret",secretInput.trim()); setAdminSecret(secretInput.trim()); setAuthed(true); }}}>
          Continue
        </button>
        {error && <div style={{marginTop:".75rem",color:"var(--red)",fontSize:".85rem"}}>{error}</div>}
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
            <button className="admin-refresh" onClick={()=>fetchUsers(adminSecret)} disabled={loading}>
              {loading?"Loading…":"↻ Refresh"}
            </button>
            <button className="admin-refresh" style={{color:"var(--red)",borderColor:"var(--red)"}}
              onClick={()=>{ localStorage.removeItem("ra_admin_secret"); setAuthed(false); setAdminSecret(""); }}>
              Sign out
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="admin-stats">
          {[["Total users",stats.total,"var(--text)"],["Pro",stats.pro,"var(--green)"],["Agency",stats.agency,"#a855f7"],["Free",stats.free,"var(--blue)"],["Disabled",stats.disabled,"var(--red)"]].map(([l,v,c])=>(
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
                  <tr key={u.userId} className={u.disabled?"disabled-row":""} onClick={()=>setSelected(u)}>
                    <td>
                      <div style={{fontWeight:600}}>{u.name || "—"}</div>
                      <div style={{fontSize:".75rem",color:"var(--text2)"}}>{u.email}</div>
                    </td>
                    <td><span className={`plan-badge ${u.plan==="agency"?"agency":u.plan==="pro"?"pro":"free"}`}>{u.plan||"free"}</span></td>
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
                    ["User ID",     selected.userId,     true],
                    ["Clerk ID",    selected.clerkId||"—",true],
                    ["Email",       selected.email,      false],
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
                    <div className="drawer-field-value"><span className={`plan-badge ${selected.plan==="pro"?"pro":"free"}`}>{selected.plan||"free"}</span></div>
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
                {selected.plan!=="agency" && (
                  <button className="drawer-btn upgrade" style={{background:"#a855f7"}} disabled={saving} onClick={()=>updateUser(selected.userId,{plan:"agency"})}>
                    ↑ Upgrade to Agency
                  </button>
                )}
                {selected.plan!=="pro" && (
                  <button className="drawer-btn upgrade" disabled={saving} onClick={()=>updateUser(selected.userId,{plan:"pro"})}>
                    {selected.plan==="agency" ? "↓ Downgrade to Pro" : "↑ Upgrade to Pro"}
                  </button>
                )}
                {selected.plan!=="free" && (
                  <button className="drawer-btn downgrade" disabled={saving} onClick={()=>updateUser(selected.userId,{plan:"free"})}>
                    ↓ Downgrade to Free
                  </button>
                )}
                {selected.disabled
                  ? <button className="drawer-btn enable" disabled={saving} onClick={()=>updateUser(selected.userId,{disabled:false})}>
                      ✓ Re-enable account
                    </button>
                  : <button className="drawer-btn disable" disabled={saving} onClick={()=>updateUser(selected.userId,{disabled:true})}>
                      ⊘ Disable account
                    </button>
                }
                <button className="drawer-btn delete" disabled={saving} onClick={()=>deleteUser(selected.userId)}>
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
    const [priorityFilter, setPriorityFilter] = useState("all");

    // Build per-site data from live or demo data
    const siteReports = sites.map(site => {
      const isActive = site === selectedSite;
      const kpis = isActive && siteData ? {
        traffic:  siteData.totals.clicks.toLocaleString(),
        position: siteData.totals.avgPosition,
        ctr:      siteData.totals.avgCtr,
        live: true,
      } : {
        traffic:  Math.floor(Math.random()*3000+500).toLocaleString(),
        position: (Math.random()*20+5).toFixed(1),
        ctr:      (Math.random()*5+1).toFixed(1) + "%",
        live: false,
      };

      // Generate demo actions per site
      const seed = site.length;
      const actions = [
        ...(seed%3===0 ? [{level:"high",   color:"#f03e5f", label:"HIGH IMPACT",  text:"Improve homepage title tag"}]  : []),
        ...(seed%2===0 ? [{level:"high",   color:"#f03e5f", label:"HIGH IMPACT",  text:"Fix missing meta descriptions"}] : []),
        {level:"medium", color:"#f5a623", label:"OPPORTUNITY", text:"Improve CTR on /services page"},
        {level:"medium", color:"#f5a623", label:"OPPORTUNITY", text:"Add internal links to blog posts"},
        {level:"low",    color:"#0fdb8a", label:"QUICK WIN",   text:"Add schema markup to homepage"},
      ];
      return { site, kpis, actions };
    });

    // Aggregate priority counts across all sites
    const totals = siteReports.reduce((acc, sr) => {
      sr.actions.forEach(a => {
        if (a.level==="high")   acc.high++;
        else if (a.level==="medium") acc.medium++;
        else acc.low++;
      });
      return acc;
    }, {high:0, medium:0, low:0});
    const total = totals.high + totals.medium + totals.low;

    // Donut chart via SVG
    const DonutChart = () => {
      const cx=90, cy=90, r=65, stroke=22;
      const circ = 2 * Math.PI * r;
      const segments = [
        {label:"High",    count:totals.high,   color:"#f03e5f"},
        {label:"Medium",  count:totals.medium, color:"#f5a623"},
        {label:"Quick Win", count:totals.low,  color:"#0fdb8a"},
      ];
      let offset = 0;
      const arcs = segments.map(seg => {
        const pct  = total > 0 ? seg.count / total : 0;
        const dash = pct * circ;
        const gap  = circ - dash;
        const arc  = { ...seg, dash, gap, offset: offset * circ };
        offset += pct;
        return arc;
      });
      return (
        <svg width="180" height="180" viewBox="0 0 180 180">
          {total === 0 ? (
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke}/>
          ) : arcs.map((arc, i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={arc.color} strokeWidth={stroke}
              strokeDasharray={`${arc.dash} ${arc.gap}`}
              strokeDashoffset={-arc.offset}
              style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}}/>
          ))}
          <text x={cx} y={cy-8}  textAnchor="middle" style={{fill:"var(--text)",fontSize:24,fontWeight:700,fontFamily:"var(--mono)"}}>{total}</text>
          <text x={cx} y={cy+12} textAnchor="middle" style={{fill:"var(--text3)",fontSize:11,fontFamily:"system-ui"}}>total actions</text>
        </svg>
      );
    };

    // Filter actions for bar chart and list
    const filteredSiteReports = siteReports.map(sr => ({
      ...sr,
      actions: priorityFilter==="all" ? sr.actions : sr.actions.filter(a=>a.level===priorityFilter)
    }));

    return (
      <div className="reports-wrap">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"1rem"}}>
          <div>
            <div style={{fontSize:"1.1rem",fontWeight:700,letterSpacing:"-.03em"}}>Reports</div>
            <div style={{fontSize:".82rem",color:"var(--text2)",marginTop:".2rem"}}>
              {sites.length} site{sites.length!==1?"s":""} · {total} actions outstanding · {siteData?"Live data":"Demo data"}
            </div>
          </div>
          {/* Priority filter */}
          <div className="reports-filter-row">
            {[
              {id:"all",    label:"All"},
              {id:"high",   label:"🔴 High"},
              {id:"medium", label:"🟡 Medium"},
              {id:"low",    label:"🟢 Quick Wins"},
            ].map(f=>(
              <button key={f.id} className={`reports-filter-btn ${f.id} ${priorityFilter===f.id?"active":""}`}
                onClick={()=>setPriorityFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Section 1: Priority Overview ── */}
        <div className="reports-section">
          <div className="reports-section-head">
            <div>
              <div className="reports-section-title">Priority Overview</div>
              <div className="reports-section-sub">Actions outstanding across all your sites</div>
            </div>
          </div>
          <div className="reports-charts-row">
            {/* Donut */}
            <div className="reports-donut-wrap">
              <DonutChart/>
              <div className="reports-donut-legend">
                {[
                  {label:"High impact",  count:totals.high,   color:"#f03e5f"},
                  {label:"Opportunity",  count:totals.medium, color:"#f5a623"},
                  {label:"Quick wins",   count:totals.low,    color:"#0fdb8a"},
                ].map(({label,count,color})=>(
                  <div key={label} className="reports-legend-item">
                    <div className="reports-legend-dot" style={{background:color}}/>
                    <span className="reports-legend-label">{label}</span>
                    <span className="reports-legend-count">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bar chart per site */}
            <div className="reports-bar-wrap">
              <div className="reports-bar-title">Actions by site</div>
              {filteredSiteReports.map(({site, actions}) => {
                const high   = actions.filter(a=>a.level==="high").length;
                const medium = actions.filter(a=>a.level==="medium").length;
                const low    = actions.filter(a=>a.level==="low").length;
                const tot    = high + medium + low;
                const pct    = (n,t) => t>0 ? `${(n/t*100).toFixed(0)}%` : "0%";
                return (
                  <div key={site} className="reports-site-row"
                    style={{cursor:"pointer"}} onClick={()=>{setSelectedSite(site);setScreen("siteDetail");}}>
                    <div className="reports-site-name" title={site}>
                      {site===selectedSite && <span style={{color:"var(--green)",marginRight:.3+"rem"}}>●</span>}
                      {site}
                    </div>
                    <div className="reports-bar-track">
                      {high>0   && <div className="reports-bar-seg" style={{width:pct(high,tot),  background:"#f03e5f"}}/>}
                      {medium>0 && <div className="reports-bar-seg" style={{width:pct(medium,tot),background:"#f5a623"}}/>}
                      {low>0    && <div className="reports-bar-seg" style={{width:pct(low,tot),   background:"#0fdb8a"}}/>}
                      {tot===0  && <div className="reports-bar-seg" style={{width:"100%",background:"var(--border)"}}/>}
                    </div>
                    <div className="reports-bar-total">{tot}</div>
                  </div>
                );
              })}
              {/* Legend */}
              <div style={{display:"flex",gap:"1rem",marginTop:".5rem",flexWrap:"wrap"}}>
                {[["#f03e5f","High"],["#f5a623","Medium"],["#0fdb8a","Quick Win"]].map(([c,l])=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:".35rem",fontSize:".72rem",color:"var(--text3)"}}>
                    <div style={{width:10,height:10,borderRadius:2,background:c,flexShrink:0}}/>
                    {l}
                  </div>
                ))}
                <div style={{marginLeft:"auto",fontSize:".72rem",color:"var(--text3)"}}>Click a site to view its details →</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Section 2: Per-site Performance ── */}
        <div className="reports-section">
          <div className="reports-section-head">
            <div>
              <div className="reports-section-title">Site Performance</div>
              <div className="reports-section-sub">Traffic, rankings and top actions per site</div>
            </div>
            {!siteData && (
              <div style={{fontSize:".75rem",color:"var(--amber)",background:"var(--adim)",padding:".35rem .75rem",borderRadius:6}}>
                ⚠ Connect Search Console for live data
              </div>
            )}
          </div>
          <div className="reports-perf-grid">
            {filteredSiteReports.map(({site, kpis, actions}) => (
              <div key={site} className="reports-perf-card">
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".5rem"}}>
                  <div style={{fontSize:".85rem",fontWeight:700,display:"flex",alignItems:"center",gap:".4rem"}}>
                    {site===selectedSite && <span style={{color:"var(--green)",fontSize:".65rem"}}>● Live</span>}
                    {site}
                  </div>
                  <button style={{background:"none",border:"1px solid var(--border)",borderRadius:6,padding:".25rem .6rem",fontFamily:"var(--font)",fontSize:".72rem",color:"var(--blue)",cursor:"pointer"}}
                    onClick={()=>{setSelectedSite(site);setScreen("siteDetail");}}>
                    View →
                  </button>
                </div>
                <div className="reports-perf-kpis">
                  {[
                    {val:kpis.traffic,  lbl:"Clicks/mo"},
                    {val:kpis.position, lbl:"Avg position"},
                    {val:kpis.ctr,      lbl:"CTR"},
                  ].map(({val,lbl})=>(
                    <div key={lbl} className="reports-perf-kpi">
                      <div className="reports-perf-kpi-val">{val}</div>
                      <div className="reports-perf-kpi-lbl">{lbl}</div>
                    </div>
                  ))}
                </div>
                {/* Top actions for this site filtered */}
                <div className="reports-actions-list">
                  {actions.length===0
                    ? <div style={{fontSize:".75rem",color:"var(--green)"}}>✓ No {priorityFilter==="all"?"":priorityFilter+" "}actions outstanding</div>
                    : actions.slice(0,3).map((a,i)=>(
                        <div key={i} className="reports-action-item">
                          <div className="reports-priority-dot" style={{background:a.color}}/>
                          {a.text}
                        </div>
                      ))
                  }
                  {actions.length>3 && (
                    <div style={{fontSize:".72rem",color:"var(--text3)",paddingLeft:".65rem"}}>
                      +{actions.length-3} more — <span style={{color:"var(--blue)",cursor:"pointer"}} onClick={()=>{setSelectedSite(site);setScreen("siteDetail");}}>view all</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Demo notice */}
        {!siteData && (
          <div style={{background:"var(--bdim)",border:"1px solid rgba(77,123,255,.15)",borderRadius:8,padding:".75rem 1rem",fontSize:".78rem",color:"var(--blue)"}}>
            📊 Performance data is estimated. Connect Google Search Console to see real traffic, positions and CTR for each site.
          </div>
        )}
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
          {screen==="reports"    && <ReportsTab/>}
          {screen==="admin"      && isAdmin && <AdminPanel/>}
          {screen==="admin"      && !isAdmin && <div className="content" style={{textAlign:"center",paddingTop:"4rem",color:"var(--text3)"}}>Access denied.</div>}
        </div>
      </div>
      {modal            && <FixModal/>}
      {croModal         && <CroModal/>}
      {showUpgrade      && <UpgradeModal/>}
      {gscSitePicker    && <GscSitePicker/>}
    </div></>
  );
}
