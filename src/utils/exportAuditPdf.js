// utils/exportAuditPdf.js
// ----------------------------------------------------------------------------
// PDF export for the RankActions Page SEO Audit.
//
// Usage:
//   import { exportAuditPdf } from './utils/exportAuditPdf';
//   exportAuditPdf({ audit: auditData, perf: perfData });
//
// `audit` is the worker response (auditData state). Expected shape:
//   { url, score, grade, summary:{critical,warnings,passed,total},
//     issues:[{type,category,issue,fix,current,impact}],
//     aiReadiness:{score,grade,checks:[{status,check,detail,fix}]},
//     wordCount, loadTime, audited:true }
//
// `perf` is the PSI-derived object (perfData state). May be null. Expected:
//   { score, cwv:{lcp,cls,fcp,si,tbt}, opportunities:[{title,description,savings}], diagnostics:[...] }
//   LCP/FCP/SI/TBT are in milliseconds (raw Lighthouse values); CLS is a ratio.
// ----------------------------------------------------------------------------

import { jsPDF } from 'jspdf';

const C = {
  text:     '#0d0d0d',
  textMute: '#525252',
  border:   '#e5e5e5',
  panelBg:  '#fafafa',
  green:    '#0e7a3c',
  red:      '#dc2626',
  amber:    '#d97706',
  blue:     '#2563eb',
};

const rgb = (hex) => {
  const m = hex.replace('#', '').match(/.{2}/g);
  return m ? m.map((h) => parseInt(h, 16)) : [0, 0, 0];
};

const gradeColor = (n) => (n >= 75 ? C.green : n >= 50 ? C.amber : C.red);

const severityColor = (type) =>
  type === 'critical' ? C.red
  : type === 'warning' ? C.amber
  : type === 'info'    ? C.blue
  :                      C.green;

export function exportAuditPdf({ audit, perf } = {}) {
  if (!audit || !audit.url) {
    console.warn('exportAuditPdf: no audit data');
    return;
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  let y = margin;

  const setText = (hex) => doc.setTextColor(...rgb(hex));
  const setFill = (hex) => doc.setFillColor(...rgb(hex));
  const setDraw = (hex) => doc.setDrawColor(...rgb(hex));

  const addFooter = () => {
    const pn = doc.getCurrentPageInfo().pageNumber;
    setText(C.textMute);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('RankActions  •  rankactions.com', margin, pageH - 8);
    doc.text(`Page ${pn}`, pageW - margin, pageH - 8, { align: 'right' });
  };

  const ensureSpace = (need) => {
    if (y + need > pageH - margin - 12) {
      addFooter();
      doc.addPage();
      y = margin;
    }
  };

  // ── HEADER ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  setText(C.text);
  doc.text('Rank', margin, y + 6);
  const rankW = doc.getTextWidth('Rank');
  setText(C.green);
  doc.text('Actions', margin + rankW, y + 6);

  setText(C.textMute);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    pageW - margin, y + 6,
    { align: 'right' }
  );

  y += 12;
  setDraw(C.border);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 9;

  // ── TITLE / URL ───────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  setText(C.text);
  doc.text('Page SEO Audit', margin, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setText(C.textMute);
  const urlText = audit.url.length > 85 ? audit.url.slice(0, 82) + '…' : audit.url;
  doc.text(urlText, margin, y);
  y += 11;

  // ── SCORE CARDS ───────────────────────────────────────────────────────────
  const cardW = (pageW - margin * 2 - 8) / 3;
  const cardH = 32;

  const drawScoreCard = (x, label, score, sub) => {
    setDraw(C.border);
    setFill(C.panelBg);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');

    setText(gradeColor(score));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.text(String(score), x + cardW / 2, y + 14, { align: 'center' });

    setText(C.text);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(label, x + cardW / 2, y + 21, { align: 'center' });

    if (sub) {
      setText(C.textMute);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(sub, x + cardW / 2, y + 27, { align: 'center' });
    }
  };

  const drawEmptyCard = (x, label) => {
    setDraw(C.border);
    setFill(C.panelBg);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');
    setText(C.textMute);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(label, x + cardW / 2, y + cardH / 2 + 1, { align: 'center' });
  };

  drawScoreCard(margin, 'On-page SEO', audit.score ?? 0, audit.grade ? `Grade ${audit.grade}` : '');

  if (perf && typeof perf.score === 'number') {
    drawScoreCard(margin + cardW + 4, 'Page speed', perf.score, '');
  } else {
    drawEmptyCard(margin + cardW + 4, 'Page speed not available');
  }

  if (audit.aiReadiness) {
    drawScoreCard(margin + cardW * 2 + 8, 'AI Search Ready', audit.aiReadiness.score ?? 0, audit.aiReadiness.grade || '');
  } else {
    drawEmptyCard(margin + cardW * 2 + 8, 'AI readiness n/a');
  }

  y += cardH + 8;

  // ── SUMMARY STATS ─────────────────────────────────────────────────────────
  if (audit.summary) {
    const statW = (pageW - margin * 2 - 8) / 3;
    const statH = 16;

    const drawStat = (x, n, label, color) => {
      setDraw(color);
      setFill('#ffffff');
      doc.setLineWidth(0.5);
      doc.roundedRect(x, y, statW, statH, 1.5, 1.5, 'FD');
      setText(color);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text(String(n), x + 6, y + 10);
      setText(C.text);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(label, x + 16, y + 10);
    };

    drawStat(margin,                   audit.summary.critical || 0, 'Critical', C.red);
    drawStat(margin + statW + 4,       audit.summary.warnings || 0, 'Warnings', C.amber);
    drawStat(margin + statW * 2 + 8,   audit.summary.passed   || 0, 'Passed',   C.green);
    y += statH + 8;
  }

  // ── CORE METRICS (Core Web Vitals + page meta) ────────────────────────────
  const metrics = [];
  const cwv = perf?.cwv || {};
  if (cwv.lcp != null) metrics.push({ label: 'LCP',  value: `${(cwv.lcp / 1000).toFixed(1)}s` });
  if (cwv.cls != null) metrics.push({ label: 'CLS',  value: cwv.cls.toFixed(3) });
  if (cwv.fcp != null) metrics.push({ label: 'FCP',  value: `${(cwv.fcp / 1000).toFixed(1)}s` });
  if (audit.loadTime)  metrics.push({ label: 'Server', value: `${audit.loadTime}ms` });
  if (audit.wordCount) metrics.push({ label: 'Words',  value: `~${audit.wordCount}` });

  if (metrics.length) {
    ensureSpace(20);
    const mW = (pageW - margin * 2 - (metrics.length - 1) * 3) / metrics.length;
    const mH = 14;
    metrics.forEach((m, i) => {
      const x = margin + i * (mW + 3);
      setDraw(C.border);
      setFill(C.panelBg);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y, mW, mH, 1.5, 1.5, 'FD');
      setText(C.textMute);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(m.label, x + mW / 2, y + 5, { align: 'center' });
      setText(C.text);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(String(m.value), x + mW / 2, y + 11, { align: 'center' });
    });
    y += mH + 10;
  }

  // ── ISSUES TO FIX ─────────────────────────────────────────────────────────
  if (Array.isArray(audit.issues) && audit.issues.length) {
    const order = { critical: 0, warning: 1, info: 2, pass: 3 };
    const actionable = [...audit.issues]
      .filter((i) => i.type !== 'pass')
      .sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));

    if (actionable.length) {
      ensureSpace(15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      setText(C.text);
      doc.text('SEO issues to fix', margin, y);
      y += 7;

      actionable.forEach((issue) => {
        const innerW = pageW - margin * 2 - 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        const titleLines = doc.splitTextToSize(issue.issue || '', innerW);

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        const currentLines = issue.current ? doc.splitTextToSize(`Current: ${String(issue.current).slice(0, 300)}`, innerW) : [];

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const fixLines = issue.fix ? doc.splitTextToSize(issue.fix, innerW) : [];

        const blockH = 6 + titleLines.length * 4 + currentLines.length * 3.5 + fixLines.length * 4 + 8;
        ensureSpace(blockH);

        const color = severityColor(issue.type);

        setFill(color);
        doc.rect(margin, y, 1.4, blockH - 4, 'F');

        const label = (issue.type || '').toUpperCase();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        const labelW = doc.getTextWidth(label) + 4;
        setFill(color);
        doc.roundedRect(margin + 4, y, labelW, 5, 1, 1, 'F');
        setText('#ffffff');
        doc.text(label, margin + 4 + labelW / 2, y + 3.5, { align: 'center' });

        setText(C.textMute);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(issue.category || '', margin + 4 + labelW + 3, y + 3.5);

        let yy = y + 10;
        setText(C.text);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(titleLines, margin + 4, yy);
        yy += titleLines.length * 4 + 1;

        if (currentLines.length) {
          setText(C.textMute);
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8);
          doc.text(currentLines, margin + 4, yy + 2);
          yy += currentLines.length * 3.5 + 1;
        }

        if (fixLines.length) {
          setText(C.text);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.text(fixLines, margin + 4, yy + 3);
          yy += fixLines.length * 4 + 1;
        }

        y = yy + 5;
      });
    }
  }

  // ── PAGE SPEED OPPORTUNITIES (from PSI) ───────────────────────────────────
  if (perf && Array.isArray(perf.opportunities) && perf.opportunities.length) {
    ensureSpace(15);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    setText(C.text);
    doc.text('Page speed opportunities', margin, y);
    y += 7;

    perf.opportunities.slice(0, 8).forEach((op) => {
      const innerW = pageW - margin * 2 - 6;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      const titleLines = doc.splitTextToSize(op.title || '', innerW);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      // Strip markdown-style links from PSI descriptions
      const cleanDesc = op.description ? op.description.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1').trim() : '';
      const descLines = cleanDesc ? doc.splitTextToSize(cleanDesc, innerW) : [];

      const blockH = 6 + titleLines.length * 4 + descLines.length * 4 + 8;
      ensureSpace(blockH);

      setFill(C.amber);
      doc.rect(margin, y, 1.4, blockH - 4, 'F');

      if (op.savings) {
        const savings = `Save ${op.savings}`;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        const sW = doc.getTextWidth(savings) + 4;
        setFill(C.amber);
        doc.roundedRect(margin + 4, y, sW, 5, 1, 1, 'F');
        setText('#ffffff');
        doc.text(savings, margin + 4 + sW / 2, y + 3.5, { align: 'center' });
      }

      let yy = y + 10;
      setText(C.text);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(titleLines, margin + 4, yy);
      yy += titleLines.length * 4 + 1;

      if (descLines.length) {
        setText(C.textMute);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(descLines, margin + 4, yy + 2);
        yy += descLines.length * 4;
      }

      y = yy + 5;
    });
  }

  // ── AI READINESS DETAIL ───────────────────────────────────────────────────
  if (audit.aiReadiness && Array.isArray(audit.aiReadiness.checks)) {
    const aiActionable = audit.aiReadiness.checks.filter((c) => c.status === 'fail' || c.status === 'partial');
    if (aiActionable.length) {
      ensureSpace(15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      setText(C.text);
      doc.text('AI Search readiness', margin, y);
      y += 7;

      aiActionable.forEach((c) => {
        const innerW = pageW - margin * 2 - 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const detailLines = c.detail ? doc.splitTextToSize(c.detail, innerW) : [];
        const fixLines    = c.fix    ? doc.splitTextToSize(c.fix,    innerW) : [];

        const blockH = 6 + 4 + detailLines.length * 4 + fixLines.length * 4 + 6;
        ensureSpace(blockH);

        const color = c.status === 'fail' ? C.red : C.amber;
        setFill(color);
        doc.rect(margin, y, 1.4, blockH - 4, 'F');

        setText(C.text);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(c.check || '', margin + 4, y + 5);

        let yy = y + 10;
        if (detailLines.length) {
          setText(C.textMute);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.text(detailLines, margin + 4, yy);
          yy += detailLines.length * 4;
        }
        if (fixLines.length) {
          setText(C.text);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.text(fixLines, margin + 4, yy + 2);
          yy += fixLines.length * 4;
        }

        y = yy + 5;
      });
    }
  }

  // ── CTA ───────────────────────────────────────────────────────────────────
  ensureSpace(28);
  setFill(C.text);
  doc.roundedRect(margin, y, pageW - margin * 2, 22, 2, 2, 'F');
  setText('#ffffff');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Want these issues fixed?', margin + 6, y + 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Get a tailored proposal at rankactions.com — most issues fixed within a week.', margin + 6, y + 16);
  y += 26;

  addFooter();

  const slug = audit.url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  doc.save(`rankactions-audit-${slug}-${date}.pdf`);
}
