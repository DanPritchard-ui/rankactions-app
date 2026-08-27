// ============================================================
// utils/exportReportPdf.js — Weekly report as a real PDF
// ============================================================
// The Reports tab used to build an HTML string, open a blank tab and
// document.write() it. Two things were wrong with that:
//
//   1. The HTML was passed through sanitizeAiHtml(), which strips <style>
//      by design. The report arrived completely unstyled — no header, no
//      KPI cards, no table borders. The sanitiser was correct; applying it
//      to our own template was not.
//   2. The button said "Export as PDF" but produced an HTML page with a
//      "Save as PDF" button that ran window.print(). The customer had to
//      do the export themselves.
//
// This module draws the report directly with jsPDF and calls doc.save(),
// so the button does what it says. No document.write, so no sanitiser
// involvement and nothing to strip.
//
// Deliberately self-contained rather than sharing helpers with
// exportAuditPdf.js: those live inside that module's exported function as
// closures, and refactoring a working PDF export to share ~60 lines of
// drawing primitives is not a trade worth making. The colours and brand
// defaults below are copied so the two documents look identical — if you
// change one, change the other.
// ============================================================

import { jsPDF } from 'jspdf';

const C = {
  text:     '#0d0d0d',
  textMute: '#525252',
  textSoft: '#737373',
  border:   '#e5e5e5',
  panelBg:  '#fafafa',
  green:    '#0e7a3c',
  greenLt:  '#1ea863',
  red:      '#dc2626',
  amber:    '#d97706',
};

const DEFAULT_BRAND = {
  name:           'RankActions',
  wordmarkPrefix: 'Rank',
  wordmarkSuffix: 'Actions',
  siteUrl:        'rankactions.com',
  accent:         '#0e7a3c',
  accentLt:       '#1ea863',
  dark:           '#0d0d0d',
};

const rgb = (hex) => {
  const m = String(hex).replace('#', '').match(/.{2}/g);
  return m ? m.map((h) => parseInt(h, 16)) : [0, 0, 0];
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Position colour: page 1 green, striking distance amber, beyond that muted.
const posColor = (p) => {
  const n = num(p);
  if (n == null) return C.textMute;
  return n <= 10 ? C.green : n <= 20 ? C.amber : C.textMute;
};

/**
 * Build and download the weekly report as a PDF.
 *
 * Every argument is optional — a site with no Search Console data, no
 * strategy and no link prospects still produces a valid report that says so,
 * rather than throwing or rendering empty sections.
 *
 * @param {object}   opts
 * @param {string}   opts.site        Display name of the site
 * @param {object}   opts.totals      { clicks, impressions, avgPosition, avgCtr }
 * @param {Array}    opts.keywords    [{ keyword, position, clicks, impressions }]
 * @param {Array}    opts.fixes       [{ label, text }] priority actions
 * @param {string}   opts.summary     Plain-text AI summary (already stripped of HTML)
 * @param {object}   opts.strategy    { topic, pillar, clusters } or null
 * @param {Array}    opts.content     [{ keyword, date }] generated content history
 * @param {object}   opts.links       { identified, contacted, replied, secured }
 * @param {string}   opts.tier        Plan tier
 * @param {object}   opts.branding    Agency white-label overrides
 */
export function exportReportPdf({
  site = '',
  totals = null,
  keywords = [],
  fixes = [],
  summary = '',
  strategy = null,
  content = [],
  links = null,
  tier = null,
  branding = null,
} = {}) {
  // White-label is an Agency-tier feature. Any other tier gets RankActions
  // defaults regardless of what was passed.
  const isAgency = typeof tier === 'string' && tier.toLowerCase() === 'agency';
  const brand = { ...DEFAULT_BRAND, ...(isAgency && branding ? branding : {}) };

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  let y = margin;

  const setText = (hex) => doc.setTextColor(...rgb(hex));
  const setFill = (hex) => doc.setFillColor(...rgb(hex));
  const setDraw = (hex) => doc.setDrawColor(...rgb(hex));

  const addFooter = () => {
    const pn = doc.getCurrentPageInfo().pageNumber;
    setText(C.textMute);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`${brand.name}  ·  ${brand.siteUrl}`, margin, pageH - 8);
    doc.text(`Page ${pn}`, pageW - margin, pageH - 8, { align: 'right' });
  };

  const ensureSpace = (need) => {
    if (y + need > pageH - margin - 12) {
      addFooter();
      doc.addPage();
      y = margin;
    }
  };

  // Section heading. `keepWithNext` reserves room for the first content block
  // so a heading never strands itself at the foot of a page.
  const sectionHeading = (txt, keepWithNext = 0) => {
    ensureSpace(16 + keepWithNext);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    setText(brand.dark);
    doc.text(txt, margin, y);
    setDraw(brand.accent);
    doc.setLineWidth(0.6);
    doc.line(margin, y + 1.5, margin + 22, y + 1.5);
    y += 12;
  };

  const drawWrapped = (text, x, startY, maxW, style = 'normal', size = 9, color = C.text, lineH = 4) => {
    if (!text) return 0;
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    setText(color);
    const lines = doc.splitTextToSize(String(text), maxW);
    doc.text(lines, x, startY);
    return lines.length * lineH;
  };

  const emptyNote = (txt) => {
    y += drawWrapped(txt, margin, y, contentW, 'italic', 9, C.textSoft);
    y += 6;
  };

  // ── Header ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  setText(brand.dark);
  doc.text(brand.wordmarkPrefix, margin, y + 4);
  const wmW = doc.getTextWidth(brand.wordmarkPrefix);
  setText(brand.accent);
  doc.text(brand.wordmarkSuffix, margin + wmW, y + 4);

  setText(C.textMute);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  doc.text('Weekly Report', pageW - margin, y, { align: 'right' });
  doc.text(`${site}  ·  ${dateStr}`, pageW - margin, y + 5, { align: 'right' });

  y += 10;
  setDraw(brand.accent);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageW - margin, y);
  y += 12;

  // ── KPI strip ───────────────────────────────────────────────
  if (totals) {
    const kpis = [
      ['Clicks (28d)',  totals.clicks != null ? Number(totals.clicks).toLocaleString() : '—', C.text],
      ['Impressions',   totals.impressions != null ? Number(totals.impressions).toLocaleString() : '—', C.text],
      ['Avg position',  totals.avgPosition ?? '—', (num(totals.avgPosition) ?? 99) <= 10 ? C.green : C.amber],
      ['Click rate',    totals.avgCtr ?? '—',      (num(totals.avgCtr) ?? 0) >= 4 ? C.green : C.amber],
    ];
    const boxW = (contentW - 6 * 3) / 4;
    ensureSpace(26);
    kpis.forEach(([label, val, col], i) => {
      const x = margin + i * (boxW + 6);
      setFill(C.panelBg);
      setDraw(C.border);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, y, boxW, 20, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      setText(col);
      doc.text(String(val), x + boxW / 2, y + 9, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      setText(C.textSoft);
      doc.text(label, x + boxW / 2, y + 15.5, { align: 'center' });
    });
    y += 28;
  } else {
    emptyNote('No Search Console data yet — connect Google Search Console to see traffic figures.');
  }

  // ── Summary ─────────────────────────────────────────────────
  if (summary && String(summary).trim()) {
    sectionHeading('Summary', 14);
    const h = drawWrapped(String(summary).trim(), margin + 4, y, contentW - 8, 'normal', 9.5, C.text, 4.4);
    setFill(C.panelBg);
    setDraw(brand.accentLt);
    doc.setLineWidth(0.8);
    // Panel drawn behind the text: redraw the text over it.
    doc.rect(margin, y - 5, contentW, h + 8, 'F');
    doc.line(margin, y - 5, margin, y + h + 3);
    drawWrapped(String(summary).trim(), margin + 4, y, contentW - 8, 'normal', 9.5, C.text, 4.4);
    y += h + 12;
  }

  // ── Keyword rankings ────────────────────────────────────────
  sectionHeading('Keyword rankings', 30);
  if (keywords.length === 0) {
    emptyNote('No keywords yet. Connect Google Search Console to see which searches you appear for.');
  } else {
    const p1 = keywords.filter(k => (num(k.position) ?? 99) <= 10).length;
    const striking = keywords.filter(k => (num(k.position) ?? 0) > 10 && (num(k.position) ?? 0) <= 20).length;
    const p3 = keywords.length - p1 - striking;
    y += drawWrapped(`On page 1: ${p1}   ·   Close to page 1: ${striking}   ·   Further back: ${p3}`,
      margin, y, contentW, 'normal', 8.5, C.textMute);
    y += 4;

    const cols = [contentW * 0.52, contentW * 0.16, contentW * 0.16, contentW * 0.16];
    const headerRow = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      setText(C.textSoft);
      doc.text('Search term', margin, y);
      doc.text('Position',    margin + cols[0], y, { align: 'right' });
      doc.text('Clicks',      margin + cols[0] + cols[1], y, { align: 'right' });
      doc.text('Views',       margin + cols[0] + cols[1] + cols[2], y, { align: 'right' });
      y += 2;
      setDraw(C.border);
      doc.setLineWidth(0.2);
      doc.line(margin, y, pageW - margin, y);
      y += 4.5;
    };
    headerRow();

    keywords.slice(0, 20).forEach((k) => {
      ensureSpace(8);
      if (y === margin) headerRow();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      setText(C.text);
      const kw = doc.splitTextToSize(String(k.keyword ?? ''), cols[0] - 4)[0] || '';
      doc.text(kw, margin, y);
      doc.setFont('helvetica', 'bold');
      setText(posColor(k.position));
      doc.text(`#${k.position ?? '—'}`, margin + cols[0], y, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      setText(C.textMute);
      doc.text(String(k.clicks ?? 0), margin + cols[0] + cols[1], y, { align: 'right' });
      doc.text(String(k.impressions ?? 0), margin + cols[0] + cols[1] + cols[2], y, { align: 'right' });
      y += 5.5;
    });
    y += 6;
  }

  // ── Priority actions ────────────────────────────────────────
  sectionHeading('What to do next', 24);
  if (!fixes || fixes.length === 0) {
    emptyNote('Nothing needs attention this week — no qualifying opportunities were found for this site.');
  } else {
    fixes.forEach((f, i) => {
      const txt = typeof f === 'string' ? f : (f.text || f.title || f.label || '');
      if (!txt) return;
      const h = doc.splitTextToSize(String(txt), contentW - 12).length * 4.4;
      ensureSpace(h + 6);
      setFill(brand.accent);
      doc.circle(margin + 2.5, y - 1.2, 2.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      setText('#ffffff');
      doc.text(String(i + 1), margin + 2.5, y, { align: 'center' });
      drawWrapped(txt, margin + 9, y, contentW - 12, 'normal', 9.5, C.text, 4.4);
      y += h + 4;
    });
    y += 4;
  }

  // ── Link building ───────────────────────────────────────────
  if (links) {
    sectionHeading('Link building', 8);
    y += drawWrapped(
      `Identified: ${links.identified ?? 0}   ·   Contacted: ${links.contacted ?? 0}   ·   ` +
      `Replied: ${links.replied ?? 0}   ·   Secured: ${links.secured ?? 0}`,
      margin, y, contentW, 'normal', 9, C.text);
    y += 8;
  }

  // ── Strategy ────────────────────────────────────────────────
  if (strategy && strategy.pillar) {
    sectionHeading('Content plan', 16);
    const clusters = Array.isArray(strategy.clusters) ? strategy.clusters : [];
    const published = clusters.filter(c => c.status === 'published').length
      + (strategy.pillar.status === 'published' ? 1 : 0);
    const total = clusters.length + 1;
    const pct = total > 0 ? Math.round((published / total) * 100) : 0;
    y += drawWrapped(String(strategy.topic ?? ''), margin, y, contentW, 'bold', 10, C.text, 4.6);
    y += 2;
    y += drawWrapped(`Main guide: ${strategy.pillar.title ?? '—'}`, margin, y, contentW, 'normal', 9, C.textMute);
    y += 2;
    y += drawWrapped(`${published} of ${total} published (${pct}%)`, margin, y, contentW, 'normal', 9, C.textMute);
    y += 8;
  }

  // ── Content produced ────────────────────────────────────────
  if (Array.isArray(content) && content.length > 0) {
    sectionHeading('Content produced', 12);
    y += drawWrapped(`${content.length} article${content.length === 1 ? '' : 's'} written`,
      margin, y, contentW, 'normal', 9, C.textMute);
    y += 3;
    content.slice(0, 12).forEach((c) => {
      ensureSpace(7);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      setText(C.text);
      const kw = doc.splitTextToSize(String(c.keyword ?? c.kw ?? ''), contentW - 32)[0] || '';
      doc.text(kw, margin, y);
      setText(C.textMute);
      doc.text(String(c.date ?? ''), pageW - margin, y, { align: 'right' });
      y += 5.2;
    });
    y += 4;
  }

  addFooter();

  const slug = String(site || 'site').replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '').toLowerCase() || 'site';
  const dateSlug = new Date().toISOString().slice(0, 10);
  doc.save(`rankactions-report-${slug}-${dateSlug}.pdf`);
}
