import { useState, useEffect } from "react";
import {
  SignIn, SignUp, UserButton,
  useUser, useClerk, SignedIn, SignedOut
} from "@clerk/clerk-react";

// ─────────────────────────────────────────────────────────────
// ⚙️  CONFIG — paste your Worker URL here after deploying it
// ─────────────────────────────────────────────────────────────
const WORKER_URL = "https://growthos-api.growthos.workers.dev";

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
.issue-row{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:1rem 1.25rem;display:flex;align-items:center;gap:1rem;}
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
.plan-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;width:100%;max-width:560px;margin-bottom:1.5rem;}
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
`;

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
  { t:"error",   icon:"⚠",  label:"Missing meta descriptions",pages:"4 pages",fix:"Add unique meta descriptions to boost CTR" },
  { t:"warning", icon:"⏱",  label:"Slow page speed",          pages:"2 pages",fix:"Compress images and enable browser caching" },
  { t:"warning", icon:"🔗",  label:"Broken internal links",    pages:"1 page", fix:"Update or remove 3 broken anchor links" },
  { t:"info",    icon:"📋",  label:"Missing schema markup",    pages:"6 pages",fix:"Add LocalBusiness schema for better listings" },
];

const CONV_DATA = [
  { page:"/services",rate:"0.4%",traffic:"840/mo",  issue:"CTA buried below the fold",   action:"Move CTA & rewrite copy" },
  { page:"/pricing", rate:"0.8%",traffic:"290/mo",  issue:"No social proof near the CTA", action:"Add testimonials above CTA" },
  { page:"/contact", rate:"1.2%",traffic:"1.2k/mo", issue:"Contact form has 7 fields",    action:"Reduce form to 3 fields" },
];

// ─── AI helper — routes through Worker to avoid CORS ─────────
async function callClaude(userMsg, systemMsg) {
  const res = await fetch(`${WORKER_URL}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userMsg, systemMsg }),
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

  // ── Show plan selection on first sign-in ───────────────────
  useEffect(() => {
    if (isSignedIn && !localStorage.getItem("rankactions_plan_chosen")) {
      setShowPlan(true);
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
      if (savedSite)  setSelectedSite(savedSite);
      if (savedSites) setSites(JSON.parse(savedSites));
      window.history.replaceState({}, "", window.location.pathname);
      setScreen("dashboard");
    }
  }, []);

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
    return siteData.keywords.slice(0,15).map(k => ({
      page:"—", kw:k.keyword, pos:k.position, vol:`${k.impressions}/mo`,
      gap: k.position<=10 ? "Add keyword to title tag and H1"
         : k.position<=20 ? "Create dedicated page for this keyword"
         : "Target in a new blog post",
      opp: k.opportunity,
    }));
  };

  // ─────────────────────────────────────────────────────────────
  // AI summary — uses real numbers when available
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
    setModal(fix); setModalData(null); setModalLoading(true);
    try {
      // Build rich context — top keywords, impressions, site name
      const topKws = siteData?.keywords?.slice(0,8).map(k=>`"${k.keyword}" (pos #${k.position}, ${k.impressions} impressions/mo)`).join(", ") || "unknown";
      const keyword = fix.title.match(/"([^"]+)"/)?.[1] || fix.current?.replace(/Not fully optimised for |"/g,"") || "";
      const siteContext = siteData
        ? `Site: ${selectedSite}. Top keywords from Search Console: ${topKws}. Avg position: ${siteData.totals?.avgPosition}, CTR: ${siteData.totals?.avgCtr}.`
        : `Site: ${selectedSite}.`;

      const txt = await callClaude(
        `You are a senior SEO copywriter improving a real website's rankings.

${siteContext}
Target keyword to optimise for: "${keyword}"
Current position: ${fix.m1}
Goal: ${fix.m2}

Generate 2 specific, ready-to-use alternatives. Each must:
- Include the exact keyword "${keyword}" naturally
- Be under 60 characters for title tags, under 160 for meta descriptions
- Sound professional and compelling to a real visitor
- Be completely specific — no placeholders, no generics

Return ONLY valid JSON:
{
  "option1": "exact ready-to-use title tag or heading here",
  "option2": "second specific alternative here",
  "metaDesc": "compelling meta description including ${keyword} under 155 chars",
  "tip": "one specific actionable next step for this keyword, max 12 words"
}`,
        "Senior SEO copywriter. Return valid JSON only. No markdown. Every suggestion must be specific, ready-to-publish copy — never a template or placeholder."
      );
      setModalData(JSON.parse(txt.replace(/```json|```/g,"").trim()));
    } catch {
      setModalData({
        option1: `${keyword} | Professional Services | ${selectedSite}`,
        option2: `Expert ${keyword} Support — Get Help Today`,
        metaDesc: `Professional ${keyword} services. Expert guidance and support for businesses. Contact us today.`,
        tip: `Add "${keyword}" to your H1 and first paragraph`
      });
    }
    setModalLoading(false);
  };

  const copyText = (text, id) => {
    navigator.clipboard.writeText(text).catch(()=>{});
    setCopiedId(id); setTimeout(()=>setCopiedId(null), 1600);
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
  if (showPlan) return (
    <><style>{CSS}</style>
    <div className="gos">
      <div className="plan-wrap">
        <div className="plan-logo">Rank<em>Actions</em></div>
        <div className="plan-sub">Choose your plan — upgrade or downgrade any time</div>
        <div className="plan-grid">
          <div className={`plan-card ${selPlan==="free"?"selected":""}`} onClick={()=>setSelPlan("free")}>
            <div className="plan-name">Free</div>
            <div className="plan-price">£0</div>
            <div className="plan-period">forever</div>
            <ul className="plan-features">
              <li>1 website</li>
              <li>Top 3 weekly actions</li>
              <li>AI-written suggestions</li>
              <li>Search Console data</li>
            </ul>
          </div>
          <div className={`plan-card featured ${selPlan==="pro"?"selected":""}`} onClick={()=>setSelPlan("pro")}>
            <div className="plan-badge">Most popular</div>
            <div className="plan-name">Pro</div>
            <div className="plan-price">£29</div>
            <div className="plan-period">per month</div>
            <ul className="plan-features">
              <li>Unlimited websites</li>
              <li>Full action list</li>
              <li>Unlimited AI fixes</li>
              <li>Conversion tracking</li>
              <li>Weekly email digest</li>
            </ul>
          </div>
        </div>
        <button className="plan-continue-btn" onClick={()=>{
          setPlan(selPlan);
          localStorage.setItem("rankactions_plan", selPlan);
          localStorage.setItem("rankactions_plan_chosen", "1");
          setShowPlan(false);
        }}>
          {selPlan==="pro" ? "Start 14-day free trial →" : "Continue with Free →"}
        </button>
        <div className="plan-skip" onClick={()=>{
          localStorage.setItem("rankactions_plan_chosen","1");
          setShowPlan(false);
        }}>Skip for now</div>
      </div>
    </div></>
  );

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
          <div className="ob-sub">We'll analyse your site and show you exactly what to fix this week.</div>
          <input className="ob-input" placeholder="e.g. mywebsite.com" value={urlInput}
            onChange={e=>setUrlInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&urlInput.trim()&&setStep(2)}/>
          <button className="ob-btn" disabled={!urlInput.trim()} onClick={()=>{
            const clean = urlInput.trim().replace(/^https?:\/\//,"");
            setSelectedSite(clean);
            localStorage.setItem("rankactions_selectedSite", clean);
            const updated = [...new Set([clean])];
            setSites(updated);
            localStorage.setItem("rankactions_sites", JSON.stringify(updated));
            setStep(2);
          }}>Continue →</button>
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
        {[{id:"dashboard",icon:"⬡",label:"Dashboard"},{id:"siteDetail",icon:"◎",label:"Site Detail"},{id:"reports",icon:"📄",label:"Reports"},{id:"settings",icon:"⚙",label:"Settings"}]
          .map(n=>(
          <div key={n.id} className={`nav-item ${screen===n.id?"active":""}`}
            onClick={()=>{if(n.id==="dashboard"||n.id==="siteDetail")setScreen(n.id);}}>
            <span style={{fontSize:"0.9rem"}}>{n.icon}</span>{n.label}
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
        <span className={`plan-pill ${plan==="pro"?"pro":""}`}>{plan==="pro"?"Pro":"Free"}</span>
        {isConnected
          ? <button className="disconnect-btn" onClick={disconnect}>Disconnect GSC</button>
          : <button className="connect-btn" onClick={()=>window.location.href=`${WORKER_URL}/auth/google`}>🔗 Connect Google</button>}
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
            <button className="ai-regen-btn" onClick={generateSummary} disabled={summaryLoading}>
              {summaryLoading?<span className="spinner-sm"/>:"↻"}
              {summaryLoading?" Generating…":" Regenerate"}
            </button>
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
                      <button className="fa-btn primary" onClick={()=>openModal(fix)}>✨ Generate alternatives</button>
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
          {["Overview","SEO Opportunities","Conversions","Issues"].map(t=>(
            <button key={t} className={`tab-btn ${activeTab===t?"active":""}`} onClick={()=>setActiveTab(t)}>{t}</button>
          ))}
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
              <thead><tr><th>Page</th><th>Keyword</th><th>Position</th><th>Impressions/mo</th><th>Fix</th><th></th></tr></thead>
              <tbody>
                {seoRows.map((row,i)=>(
                  <tr key={i}>
                    <td className="td-mono" style={{color:"var(--text2)"}}>{row.page}</td>
                    <td style={{fontWeight:500}}>{row.kw}{row.opp&&<span className="td-opp">opp</span>}</td>
                    <td className="td-mono" style={{color:row.pos<=10?"var(--amber)":"var(--text)"}}>#{row.pos}</td>
                    <td className="td-mono" style={{color:"var(--text2)"}}>{row.vol}</td>
                    <td style={{color:"var(--text2)",fontSize:"0.8rem"}}>{row.gap}</td>
                    <td><span className="td-link" onClick={()=>openModal({
                      id:`seo-${i}`, level:"medium", color:"#f5a623", label:"OPPORTUNITY", type:"SEO",
                      title:`Improve ranking for "${row.kw}"`,
                      desc:`Currently at position #${row.pos} with ${row.vol} impressions. ${row.gap}.`,
                      m1:`Position: #${row.pos}`, m2:row.vol,
                      field:"Title Tag & Page Content",
                      current:`Not fully optimised for "${row.kw}"`,
                      recommended:row.gap, metaDesc:null,
                    })}>Fix →</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}

        {activeTab==="Conversions" && <>
          <div className="section-head" style={{marginBottom:"1.25rem"}}>
            <div className="section-title">Conversion Issues</div>
            <div className="section-sub">Pages with traffic but low leads</div>
          </div>
          <div className="conv-list">
            {CONV_DATA.map((row,i)=>(
              <div key={i} className="conv-card">
                <div className="conv-page-url">{row.page}</div>
                <div className="conv-stats">
                  <div className="conv-stat"><div className="cv">{row.traffic}</div><div className="cl">Traffic</div></div>
                  <div className="conv-stat"><div className="cv" style={{color:parseFloat(row.rate)<1?"var(--red)":"var(--amber)"}}>{row.rate}</div><div className="cl">Conv. Rate</div></div>
                </div>
                <div className="conv-issue-text">⚠ {row.issue}</div>
                <button className="conv-fix-btn" onClick={()=>openModal(fixes[1])}>✨ Fix: {row.action}</button>
              </div>
            ))}
          </div>
        </>}

        {activeTab==="Issues" && <>
          <div className="section-head" style={{marginBottom:"1.25rem"}}>
            <div className="section-title">Technical Issues</div>
            <div className="section-sub">{ISSUES_DATA.length} issues detected</div>
          </div>
          <div className="issues-list">
            {ISSUES_DATA.map((issue,i)=>(
              <div key={i} className="issue-row">
                <div className={`issue-icon-wrap ${issue.t}`}>{issue.icon}</div>
                <div className="issue-info"><div className="issue-name">{issue.label}</div><div className="issue-fix-hint">{issue.fix}</div></div>
                <div className="issue-pages-badge">{issue.pages}</div>
              </div>
            ))}
          </div>
        </>}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // FIX MODAL
  // ─────────────────────────────────────────────────────────────
  const FixModal = () => (
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
      <div className="modal">
        <div className="modal-head">
          <div><div className="modal-h">{modal.title}</div><div className="modal-sub">{modal.field} — AI-generated alternatives</div></div>
          <button className="modal-close" onClick={()=>setModal(null)}>✕</button>
        </div>
        <div className="modal-content">
          <div className="modal-section-label">Current</div>
          <div className="current-box"><div className="current-label">{modal.field}</div><div className="current-val">{modal.current}</div></div>
          <div className="modal-section-label">AI Suggestions</div>
          {modalLoading
            ? <div className="loading-center"><div className="spinner"/><span>Generating alternatives…</span></div>
            : modalData && <>
                {[{key:"option1",label:"Option 1",text:modalData.option1},{key:"option2",label:"Option 2",text:modalData.option2},...(modalData.metaDesc?[{key:"meta",label:"Meta Description",text:modalData.metaDesc}]:[])].map(({key,label,text})=>(
                  <div key={key} className="option-card">
                    <div className="option-num">{label}</div>
                    <div className="option-text">{text}</div>
                    <div className="option-actions">
                      <button className={`opt-btn ${copiedId===key?"copied":""}`} onClick={()=>copyText(text,key)}>
                        {copiedId===key?"✓ Copied":"📋 Copy"}
                      </button>
                    </div>
                  </div>
                ))}
                {modalData.tip && <div className="tip-box">💡 {modalData.tip}</div>}
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
        </div>
      </div>
      {modal && <FixModal/>}
    </div></>
  );
}
