// utils/exportAuditPdf.js
// ----------------------------------------------------------------------------
// PDF export for the RankActions Page SEO Audit.
//
// Mirrors the entire audit screen and expands the in-page dropdowns
// ("What do these scores mean?" and "Why does AI search readiness matter?")
// inline so the PDF is a complete, self-contained read-along report.
//
// White-label branding is an Agency-tier feature. The function silently
// ignores `branding` overrides for any other tier — see the `tier` parameter.
//
// Usage:
//   import { exportAuditPdf } from './utils/exportAuditPdf';
//
//   // Standard export (any tier)
//   await exportAuditPdf({ audit: auditData, perf: perfData });
//
//   // White-label export (Agency tier only — branding is ignored otherwise)
//   await exportAuditPdf({
//     audit: auditData,
//     perf:  perfData,
//     tier:  'agency',
//     branding: {
//       name:           'Acme SEO',
//       wordmarkPrefix: 'Acme',
//       wordmarkSuffix: 'SEO',
//       siteUrl:        'acmeseo.co.uk',
//       accent:         '#1f4e79',
//       accentLt:       '#3a7cb6',
//       dark:           '#0a1929',
//     },
//   });
// ----------------------------------------------------------------------------

import { jsPDF } from 'jspdf';

// ── Brand colours ──
// `C.green` etc. are FUNCTIONAL/SEMANTIC (traffic-light grades, severity badges,
// AI = purple convention). They stay the same regardless of brand. The
// brand-specific colours (accent, dark, etc.) live on the `brand` object below
// and are merged from the `branding` parameter at runtime — but only on the
// Agency tier.
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
  blue:     '#2563eb',
  purple:   '#a855f7',
};

// ── Default brand profile (RankActions) ──
// All brand-customisable values live here. Agency-tier callers can pass a
// `branding` object to override any subset of these. Other tiers always get
// these defaults regardless of what they pass.
const DEFAULT_BRAND = {
  name:            'RankActions',
  // Wordmark renders as two coloured halves: prefix in dark, suffix in accent.
  wordmarkPrefix:  'Rank',
  wordmarkSuffix:  'Actions',
  tagline:         'SEO that tells you what to do next.',
  intro:           'A complete SEO platform that turns Google Search Console data, page audits, and AI analysis into a prioritised list of actions you can complete in minutes — not months.',
  builtForLine:    'Small businesses · Marketing teams · Agencies managing multiple client sites',
  siteUrl:         'rankactions.com',
  // Brand colours — accent is the headline accent (section underlines, badges,
  // etc.), accentLt is a brighter variant for dark backgrounds, dark is the
  // hero box and verdict box background.
  accent:          '#0e7a3c',
  accentLt:        '#1ea863',
  dark:            '#0d0d0d',
  // Page 1 is the product-overview "sales pitch" page. Defaults to true for
  // RankActions; white-label agencies get false so the audit delivers as a
  // clean report without trying to sell RankActions on page 1.
  showProductPage: true,

  // Cover page section content. White-label callers (Agency tier) can override
  // any of these to replace the RankActions sales copy with neutral
  // audit-focused content. Defaults below are RankActions-specific marketing.
  howWorksTitle:   'How RankActions works',
  stages: [
    {
      stage: 'FIND',
      title: "Find what's broken",
      desc:  'Page audits, technical SEO checks, broken links, structured data validation and AI search readiness — all in plain English.',
      bullets: ['Page-level audits', 'Site-wide crawls', 'AI Search readiness checks'],
    },
    {
      stage: 'FIX',
      title: 'Fix it fast',
      desc:  'AI ranks every issue by impact and effort, then drafts the fix for you — meta descriptions, schema markup, full content rewrites.',
      bullets: ['Prioritised weekly action list', 'AI Content Generator', 'Strategy Planner'],
    },
    {
      stage: 'TRACK',
      title: 'Track results',
      desc:  'Daily rank tracking, Google Search Console integration, link building tools and white-label reports for clients.',
      bullets: ['Daily Rank Tracker', 'Real Google Search Console data', 'Weekly digest + PDF reports'],
    },
  ],
  whyTitle:        'Why teams choose RankActions',
  proofPoints: [
    ['No SEO expertise required',     'Plain-English explanations and copy-paste fixes for every issue. If you can use a CMS, you can use RankActions.'],
    ['Built on real Google data',     'Live data from Google Search Console — not estimates or third-party scrapers.'],
    ['AI Search Ready',               "Built-in checks for ChatGPT, Perplexity and Google AI Overviews citation signals — most SEO tools haven't caught up yet."],
  ],
  ctaTitle:        'See it on your own site',
  ctaBody:         null, // Computed at runtime when null — defaults to "Free trial at {siteUrl} ..."

  // Tiny attribution line. White-label callers don't override this — it always
  // reads "Powered by RankActions" so we get a discreet credit without being
  // intrusive. Set to false to suppress entirely (not recommended).
  poweredByLine:   true,
};


// ── Plain-English explanations duplicated from App.jsx SEO_TIPS ──
// (Kept here so the PDF is self-contained — if you update SEO_TIPS in App.jsx,
//  update the matching keys here too.)
const CATEGORY_EXPLANATIONS = {
  'Title Tag':           'The clickable blue headline that appears in Google search results. Should be 50–60 characters and include your main keyword near the front.',
  'Meta Description':    'A short summary (about 155 characters) that appears below your page title in Google results. A good meta description encourages people to click.',
  'H1 Heading':          'The main heading on a page — like the title of a newspaper article. Every page should have exactly one H1 that includes your target keyword.',
  'Content Structure':   'Subheadings (H2/H3) break your content into sections. They help readers scan the page and help Google understand your content structure.',
  'Canonical Tag':       'A tag that tells Google which version of a page is the "official" one. Prevents duplicate content issues if you have similar pages.',
  'Mobile Friendliness': 'A meta tag that tells mobile browsers how to display your page. Without it, your site may look tiny on phones. Essential for mobile-friendly pages.',
  'Image Alt Text':      'Text descriptions added to images that tell Google (and screen readers) what the image shows. Include relevant keywords where natural.',
  'Structured Data':     'JSON-LD markup that helps Google understand what your page is about. Can trigger rich results like star ratings, FAQs, and event details.',
  'Social Meta Tags':    'Open Graph tags that control how your page looks when shared on social media. Includes the title, description, and image shown.',
  'Internal Links':      'Links from one page on your site to another. They help visitors navigate and help Google discover and rank all your pages.',
  'HTTPS':               'HTTPS encrypts the connection between your site and visitors. Google uses it as a ranking factor and browsers show "Not Secure" warnings without it.',
  'Page Speed':          'How fast your page loads. Slow pages frustrate visitors and rank lower in Google. Under 3 seconds is good, under 1 second is excellent.',
  'Content Length':      'The number of words on a page. Pages with fewer than 300 words often struggle to rank because Google sees them as "thin content". Aim for 800+ for blog posts.',
};

// ── Helpers ──
const rgb = (hex) => {
  const m = hex.replace('#', '').match(/.{2}/g);
  return m ? m.map((h) => parseInt(h, 16)) : [0, 0, 0];
};
const gradeColor    = (n) => (n >= 75 ? C.green  : n >= 50 ? C.amber : C.red);
const aiScoreColor  = (n) => (n >= 80 ? C.purple : n >= 50 ? C.amber : C.red);
const severityColor = (t) => t === 'critical' ? C.red : t === 'warning' ? C.amber : t === 'info' ? C.blue : C.green;
const cwvColor = (metric, val) => {
  if (val == null) return C.textMute;
  if (metric === 'lcp') return val <= 2500 ? C.green : val <= 4000 ? C.amber : C.red;
  if (metric === 'cls') return val <= 0.1  ? C.green : val <= 0.25 ? C.amber : C.red;
  if (metric === 'fcp') return val <= 1800 ? C.green : val <= 3000 ? C.amber : C.red;
  return C.textMute;
};
const cwvLabel = (metric, val) => {
  if (val == null) return '';
  if (metric === 'lcp') return val <= 2500 ? 'Good' : val <= 4000 ? 'Needs work' : 'Poor';
  if (metric === 'cls') return val <= 0.1  ? 'Good' : val <= 0.25 ? 'Needs work' : 'Poor';
  if (metric === 'fcp') return val <= 1800 ? 'Good' : val <= 3000 ? 'Needs work' : 'Poor';
  return '';
};

// ── Impact heuristics (rough industry-standard framings, kept as ranges) ──
const speedImpact = (savingsSec) => {
  if (!savingsSec) return null;
  // Bounce rate rises ~7% for every 1s of load delay (industry studies)
  const bounceLift = Math.round(savingsSec * 7);
  return `Roughly ${bounceLift}% of mobile visitors give up before slow pages finish loading.`;
};
const altTextImpact = (issue) => {
  const m = (issue.issue || '').match(/(\d+)\s*of\s*(\d+)/i);
  if (m) {
    const ratio = Math.round((parseInt(m[1], 10) / parseInt(m[2], 10)) * 100);
    return `${ratio}% of your images can't be understood by Google or screen readers — losing image search traffic and accessibility compliance.`;
  }
  return 'Images without alt text can\'t rank in Google Image Search and fail accessibility checks.';
};
const titleImpact = () => 'Your search listing is being cut off mid-sentence in Google results, hurting click-through.';
const aiSchemaImpact = () => 'AI search engines (ChatGPT, Perplexity, Google AI Overviews) skip pages without structured data when choosing which sources to cite.';
const metaImpact = () => 'Without a meta description, Google auto-generates one — usually picking text that doesn\'t encourage clicks.';
const httpsImpact = () => 'Browsers show "Not Secure" warnings, and Google ranks HTTP pages lower.';
const wordCountImpact = () => 'Thin pages struggle to rank against more comprehensive competitors covering the same topic.';

// Returns a one-line "what this is costing you" framing for an issue.
// Conservative — only returns text where the framing is well-supported.
const businessImpact = (issue) => {
  const cat = issue.category || '';
  if (cat === 'Image Alt Text')   return altTextImpact(issue);
  if (cat === 'Title Tag')        return titleImpact();
  if (cat === 'Meta Description') return metaImpact();
  if (cat === 'HTTPS')            return httpsImpact();
  if (cat === 'Content Length')   return wordCountImpact();
  return null;
};

// Score an SEO issue 0–100 by likely revenue impact (used for Top 3 ranking).
const issueImpactScore = (issue) => {
  let score = 0;
  if (issue.type === 'critical') score += 60;
  else if (issue.type === 'warning') score += 30;
  else score += 10;

  // Boost for issues with quantifiable scope ("36 of 41 images...")
  const m = (issue.issue || '').match(/(\d+)\s*of\s*(\d+)/i);
  if (m) {
    const ratio = parseInt(m[1], 10) / parseInt(m[2], 10);
    score += Math.round(ratio * 25); // up to +25 for fully-affected counts
  }

  // High-impact categories get a boost regardless
  const highImpactCats = ['HTTPS', 'Mobile Friendliness', 'Structured Data', 'H1 Heading', 'Image Alt Text'];
  if (highImpactCats.includes(issue.category)) score += 10;

  return score;
};

export function exportAuditPdf({ audit, perf, tier, branding } = {}) {
  if (!audit || !audit.url) {
    console.warn('exportAuditPdf: no audit data');
    return;
  }

  // White-label branding is an Agency-tier feature. Any other tier — including
  // missing/undefined — gets RankActions defaults regardless of what was passed.
  // Compare case-insensitively so 'Agency', 'agency', 'AGENCY' all work.
  const isAgency = typeof tier === 'string' && tier.toLowerCase() === 'agency';
  const effectiveBranding = isAgency ? branding : null;

  // Merge effective branding with RankActions defaults. When agency branding
  // is supplied, default `showProductPage` to false (the page-1 overview is
  // RankActions-specific sales copy and shouldn't appear on a white-label).
  const brand = {
    ...DEFAULT_BRAND,
    ...(effectiveBranding || {}),
    showProductPage: effectiveBranding?.showProductPage
      ?? (effectiveBranding ? false : DEFAULT_BRAND.showProductPage),
  };

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  let y = margin;

  // ── Drawing primitives ──
  const setText = (hex) => doc.setTextColor(...rgb(hex));
  const setFill = (hex) => doc.setFillColor(...rgb(hex));
  const setDraw = (hex) => doc.setDrawColor(...rgb(hex));

  const addFooter = () => {
    const pn = doc.getCurrentPageInfo().pageNumber;
    setText(C.textMute);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`${brand.name}  •  ${brand.siteUrl}`, margin, pageH - 8);
    doc.text(`Page ${pn}`, pageW - margin, pageH - 8, { align: 'right' });
  };

  const ensureSpace = (need) => {
    if (y + need > pageH - margin - 12) {
      addFooter();
      doc.addPage();
      y = margin;
    }
  };

  // Section heading with "keep with next" support.
  //
  // The optional `keepWithNext` parameter (mm) tells the heading how much
  // vertical space it needs to reserve for at least the first content block
  // that follows. Without this, the heading can render at the bottom of a
  // page while the first content card pushes itself onto the next page,
  // leaving an awkward orphan heading and a big blank gap.
  //
  // Callers should pass an estimate of the smallest reasonable first block
  // (a single-line card is ~30mm; a multi-line card with all fields is
  // ~60mm — pass something around 40mm for typical card lists).
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

  // Wraps text and returns total height drawn (in mm).
  const drawWrapped = (text, x, startY, maxW, fontStyle = 'normal', size = 9, color = C.text, lineH = 4) => {
    if (!text) return 0;
    doc.setFont('helvetica', fontStyle);
    doc.setFontSize(size);
    setText(color);
    const lines = doc.splitTextToSize(String(text), maxW);
    doc.text(lines, x, startY);
    return lines.length * lineH;
  };

  // Predicts wrapped-text height without drawing.
  const measureWrapped = (text, maxW, size = 9, lineH = 4) => {
    if (!text) return 0;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    return doc.splitTextToSize(String(text), maxW).length * lineH;
  };

  // Compact wordmark used in the small page headers.
  const drawWordmark = (atY) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    setText(brand.dark);
    doc.text(brand.wordmarkPrefix, margin, atY);
    const w = doc.getTextWidth(brand.wordmarkPrefix);
    setText(brand.accent);
    doc.text(brand.wordmarkSuffix, margin + w, atY);
  };

  // ===========================================================================
  // PAGE 1 — PRODUCT OVERVIEW (skipped for white-label unless explicitly enabled)
  // ===========================================================================
  if (brand.showProductPage) {
  // Full-bleed dark hero (compact)
  setFill(brand.dark);
  doc.rect(0, 0, pageW, 60, 'F');

  // Wordmark (white prefix + accent suffix) on dark
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  setText('#ffffff');
  doc.text(brand.wordmarkPrefix, margin, 24);
  const heroRankW = doc.getTextWidth(brand.wordmarkPrefix);
  setText(brand.accentLt);
  doc.text(brand.wordmarkSuffix, margin + heroRankW, 24);

  // Tagline
  setText('#ffffff');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(brand.tagline, margin, 38);

  setText('#cccccc');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const heroSubLines = doc.splitTextToSize(brand.intro, contentW);
  doc.text(heroSubLines, margin, 47);

  y = 70;

  // ── "Built for" strip ──
  setText(C.textMute);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('BUILT FOR', margin, y);
  setText(brand.dark);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(brand.builtForLine, margin + 22, y);
  y += 9;

  // ── Find / Fix / Track three-act layout ──
  setText(brand.dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(brand.howWorksTitle, margin, y);
  setDraw(brand.accent);
  doc.setLineWidth(0.6);
  doc.line(margin, y + 1.5, margin + 18, y + 1.5);
  y += 7;

  const stages = brand.stages;

  // Calculate uniform stage card height
  const stageW = (contentW - 8) / 3;
  let stageH = 0;
  stages.forEach((s) => {
    const h = 18 + measureWrapped(s.desc, stageW - 8, 9, 4) + s.bullets.length * 4 + 8;
    if (h > stageH) stageH = h;
  });

  stages.forEach((s, i) => {
    const x = margin + i * (stageW + 4);

    // Card
    setFill(C.panelBg);
    setDraw(C.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, stageW, stageH, 2, 2, 'FD');

    // Stage label tag
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    const lw = doc.getTextWidth(s.stage) + 5;
    setFill(brand.accent);
    doc.roundedRect(x + 4, y + 4, lw, 5, 1, 1, 'F');
    setText('#ffffff');
    doc.text(s.stage, x + 4 + lw / 2, y + 7.5, { align: 'center' });

    // Title
    setText(brand.dark);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(s.title, x + 4, y + 15);

    // Description
    setText(C.textMute);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const descLines = doc.splitTextToSize(s.desc, stageW - 8);
    doc.text(descLines, x + 4, y + 21);
    let bY = y + 21 + descLines.length * 4 + 3;

    // Bullet list
    s.bullets.forEach((b) => {
      setFill(brand.accent);
      doc.circle(x + 5.5, bY - 1.2, 0.8, 'F');
      setText(brand.dark);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(b, x + 8, bY);
      bY += 4;
    });
  });
  y += stageH + 6;

  // ── Why teams choose [brand] ──
  setText(brand.dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(brand.whyTitle, margin, y);
  setDraw(brand.accent);
  doc.setLineWidth(0.6);
  doc.line(margin, y + 1.5, margin + 18, y + 1.5);
  y += 7;

  const proofPoints = brand.proofPoints;

  proofPoints.forEach(([title, desc]) => {
    setFill(brand.accent);
    doc.circle(margin + 3, y + 2.5, 1.5, 'F');
    setText('#ffffff');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('✓', margin + 3, y + 3.5, { align: 'center' });

    setText(brand.dark);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(title, margin + 9, y + 3);

    setText(C.textMute);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const dl = doc.splitTextToSize(desc, contentW - 12);
    doc.text(dl, margin + 9, y + 7.5);
    y += 7 + dl.length * 4 + 2;
  });

  y += 2;

  // ── Bottom CTA strip ──
  setFill(brand.dark);
  doc.roundedRect(margin, y, contentW, 20, 2, 2, 'F');
  setText('#ffffff');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(brand.ctaTitle, margin + 6, y + 8);
  setText('#cccccc');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  // Allow brand.ctaBody to be explicitly set; fall back to the RankActions
  // free-trial line for the default brand.
  const ctaBodyText = brand.ctaBody || `Free trial at ${brand.siteUrl}  ·  Or book a 20-minute walkthrough — no slides, just your site.`;
  doc.text(ctaBodyText, margin + 6, y + 15);
  y += 24;

  // Tiny attribution — only shown for white-label exports (agency tier with
  // custom branding). Default RankActions exports already say "RankActions"
  // throughout and don't need this line.
  if (isAgency && brand.poweredByLine) {
    setText(C.textSoft);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('Powered by RankActions', pageW / 2, y + 2, { align: 'center' });
    y += 4;
  }

  addFooter();
  doc.addPage();
  y = margin;
  } // end if (brand.showProductPage)

  // ===========================================================================
  // PAGE 2 — EXECUTIVE SUMMARY
  // ===========================================================================
  drawWordmark(y + 6);
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

  // ── Title ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  setText(brand.dark);
  doc.text('Audit summary', margin, y);
  y += 6;
  setText(C.textMute);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const exUrl = audit.url.length > 90 ? audit.url.slice(0, 87) + '…' : audit.url;
  doc.text(exUrl, margin, y);
  y += 10;

  // ── Verdict box (the headline) ──
  const seoScore = audit.score ?? 0;
  const perfScore = perf?.score ?? null;
  const aiScore = audit.aiReadiness?.score ?? null;

  // Count actionable items across all three categories — this is the "issues" total.
  const seoActionable     = Array.isArray(audit.issues) ? audit.issues.filter((i) => i.type !== 'pass').length : 0;
  const speedOpps         = Array.isArray(perf?.opportunities) ? perf.opportunities.length : 0;
  const aiActionable      = Array.isArray(audit.aiReadiness?.checks) ? audit.aiReadiness.checks.filter((c) => c.status === 'fail' || c.status === 'partial').length : 0;
  const totalActionable   = seoActionable + speedOpps + aiActionable;

  // Build a contextual verdict from the data
  const verdictParts = [];
  if (seoScore >= 80) verdictParts.push('strong on-page SEO fundamentals');
  else if (seoScore >= 60) verdictParts.push('reasonable on-page SEO with room to improve');
  else verdictParts.push('significant on-page SEO gaps');

  if (perfScore != null) {
    if (perfScore < 50) verdictParts.push('slow mobile load times costing visitors');
    else if (perfScore < 75) verdictParts.push('below-average page speed');
    else verdictParts.push('solid page speed');
  }

  if (aiScore != null && aiScore < 70) {
    verdictParts.push('limited readiness for AI search');
  } else if (aiScore != null) {
    verdictParts.push('good AI search readiness');
  }

  // Closing line varies by overall severity — avoids the "always 4–6 weeks" template feel
  const minScore = Math.min(seoScore, aiScore ?? 100, perfScore ?? 100);
  let closing;
  if (minScore < 50) {
    closing = `These ${totalActionable} issues are likely already costing you customers — most can be fixed within 4–6 weeks for meaningful uplift.`;
  } else if (minScore < 75) {
    closing = `We've identified ${totalActionable} opportunit${totalActionable === 1 ? 'y' : 'ies'} to improve search visibility and conversion within 4–6 weeks.`;
  } else {
    closing = `${totalActionable} fine-tuning opportunit${totalActionable === 1 ? 'y' : 'ies'} identified — small optimisations to defend rankings against newer competitors.`;
  }

  const verdict = `This page has ${verdictParts.join(', ')}. ${closing}`;

  const verdictH = measureWrapped(verdict, contentW - 12, 11, 5) + 12;
  ensureSpace(verdictH + 4);
  setFill(brand.dark);
  doc.roundedRect(margin, y, contentW, verdictH, 2, 2, 'F');
  setText(brand.accentLt);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('VERDICT', margin + 6, y + 7);
  setText('#ffffff');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const vLines = doc.splitTextToSize(verdict, contentW - 12);
  doc.text(vLines, margin + 6, y + 14);
  y += verdictH + 6;

  // ── At-a-glance score row (compact) ──
  const ag = [
    { label: 'On-page SEO',     val: seoScore,                     color: gradeColor(seoScore),                grade: audit.grade || '' },
    { label: 'Page speed',      val: perfScore != null ? perfScore : '—', color: perfScore != null ? gradeColor(perfScore) : C.textMute, grade: perfScore != null ? (perfScore >= 90 ? 'Fast' : perfScore >= 50 ? 'Needs work' : 'Slow') : 'Not run' },
    { label: 'AI Search Ready', val: aiScore != null ? aiScore : '—',     color: aiScore != null ? aiScoreColor(aiScore) : C.textMute, grade: audit.aiReadiness?.grade || 'n/a' },
  ];
  const agW = (contentW - 8) / 3;
  ensureSpace(28);
  ag.forEach((s, i) => {
    const x = margin + i * (agW + 4);
    setFill(C.panelBg);
    setDraw(C.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, agW, 24, 2, 2, 'FD');
    setText(C.textMute);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(s.label.toUpperCase(), x + 5, y + 6);
    setText(s.color);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(String(s.val), x + 5, y + 18);
    setText(C.textMute);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(s.grade, x + agW - 5, y + 18, { align: 'right' });
  });
  y += 25;

  // ── Industry context (softer, uncited but honest) ──
  setFill('#f0f7ff');
  setDraw(C.blue);
  doc.setLineWidth(0.3);
  const ctxText = 'In our experience, healthy small business websites tend to score 70+ on on-page SEO and 50+ on mobile page speed. Sites that consistently rank in the top 3 typically score 85+ across all three.';
  const ctxH = measureWrapped(ctxText, contentW - 10, 9) + 8;
  ensureSpace(ctxH + 4);
  doc.roundedRect(margin, y, contentW, ctxH, 2, 2, 'FD');
  setText(C.blue);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('FOR CONTEXT', margin + 5, y + 5);
  drawWrapped(ctxText, margin + 5, y + 11, contentW - 10, 'normal', 9, C.text);
  y += ctxH + 6;

  // ── Top 3 priorities — IMPACT-SCORED across SEO / Speed / AI ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  setText(brand.dark);
  doc.text('Top 3 priorities', margin, y);
  setDraw(brand.accent);
  doc.setLineWidth(0.6);
  doc.line(margin, y + 1.5, margin + 18, y + 1.5);
  y += 8;

  // Build a unified candidate pool, score each, then pick the best 3.
  const candidates = [];

  // SEO issues — scored by issueImpactScore()
  if (Array.isArray(audit.issues)) {
    audit.issues
      .filter((i) => i.type !== 'pass')
      .forEach((i) => {
        candidates.push({
          kind: 'SEO',
          score: issueImpactScore(i),
          title: i.issue,
          why: businessImpact(i),
          action: i.fix || 'See full audit detail.',
        });
      });
  }

  // Speed opportunities — scored by parsed savings (seconds), then bytes
  if (Array.isArray(perf?.opportunities)) {
    perf.opportunities.forEach((op) => {
      let savScore = 0;
      const m = String(op.savings || '').match(/([\d.]+)\s*s/);
      if (m) {
        const sec = parseFloat(m[1]);
        savScore = Math.round(sec * 30); // 1.0s ≈ +30, 2.0s ≈ +60
      }
      candidates.push({
        kind: 'SPEED',
        score: 30 + savScore, // baseline + scaled by savings
        title: op.title || 'Page speed opportunity',
        why: speedImpact(parseFloat(m?.[1] || '0')),
        action: (op.description || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 220).trim(),
      });
    });
  }

  // AI readiness fails / partials — scored by status, with check-specific impact lines
  const aiImpactLine = (check) => {
    const t = (check?.check || '').toLowerCase();
    if (t.includes('faq'))      return 'FAQ schema is one of the strongest signals for Google AI Overviews and ChatGPT citations.';
    if (t.includes('howto'))    return 'HowTo schema lets AI engines extract step-by-step content directly into AI-generated answers.';
    if (t.includes('question')) return 'Question-based headings match how people query AI assistants — a direct path to AI citations.';
    if (t.includes('author'))   return 'AI engines prioritise content with clear authorship signals when choosing which sources to cite.';
    if (t.includes('date'))     return 'AI engines weight recency heavily — undated content is rarely cited.';
    if (t.includes('answer') || t.includes('concise'))
                                return 'AI assistants extract direct answers — preamble before the answer reduces citation odds.';
    if (/schema|structured/.test(t))
                                return aiSchemaImpact();
    return 'Increases the likelihood of being cited in AI-generated search results.';
  };

  if (Array.isArray(audit.aiReadiness?.checks)) {
    audit.aiReadiness.checks
      .filter((c) => c.status === 'fail' || c.status === 'partial')
      .forEach((c) => {
        const isSchema = /schema/i.test(c.check || '');
        candidates.push({
          kind: 'AI',
          score: (c.status === 'fail' ? 50 : 25) + (isSchema ? 15 : 0),
          title: c.check,
          why: aiImpactLine(c),
          action: c.fix || 'See AI Search readiness section.',
        });
      });
  }

  // Sort by score descending, then pick top 3 with KIND VARIETY:
  //   1. Take the highest-scoring item from each kind that has any items
  //   2. Fill remaining slots from the highest-scoring leftovers
  // This ensures we don't surface 3 near-identical items (e.g. 3 AI schema fixes)
  // when distinct categories of work would be more useful for the prospect.
  candidates.sort((a, b) => b.score - a.score);
  const top3 = [];
  const usedKinds = new Set();
  // Pass 1: best-of-each-kind
  for (const c of candidates) {
    if (top3.length >= 3) break;
    if (usedKinds.has(c.kind)) continue;
    top3.push(c);
    usedKinds.add(c.kind);
  }
  // Pass 2: fill any remaining slots from highest-scoring leftovers (max 2 per kind)
  const kindCounts = {};
  top3.forEach((c) => { kindCounts[c.kind] = (kindCounts[c.kind] || 0) + 1; });
  for (const c of candidates) {
    if (top3.length >= 3) break;
    if (top3.includes(c)) continue;
    if ((kindCounts[c.kind] || 0) >= 2) continue;
    top3.push(c);
    kindCounts[c.kind] = (kindCounts[c.kind] || 0) + 1;
  }

  if (top3.length === 0) {
    setText(C.textMute);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text('No actionable issues identified — strong all-round performance.', margin, y);
    y += 8;
  } else {
    top3.forEach((p, i) => {
      const innerW = contentW - 16;
      const titleH  = measureWrapped(p.title, innerW, 10);
      const impactH = p.why ? measureWrapped(`Impact: ${p.why}`, innerW, 9, 4) : 0;
      const actH    = measureWrapped(`Fix: ${p.action}`, innerW, 9, 4);
      const blockH  = 7 + titleH + (impactH ? impactH + 1 : 0) + actH + 8;
      ensureSpace(blockH + 2);

      setFill(C.panelBg);
      setDraw(C.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, contentW, blockH, 2, 2, 'FD');

      // Number circle
      setFill(brand.accent);
      doc.circle(margin + 6, y + 6, 4, 'F');
      setText('#ffffff');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(String(i + 1), margin + 6, y + 7.5, { align: 'center' });

      // Kind tag (right-padded for visual consistency)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      const kindTxt = p.kind;
      const kw = Math.max(doc.getTextWidth(kindTxt) + 4, 14);
      setFill(p.kind === 'SEO' ? C.blue : p.kind === 'SPEED' ? C.amber : C.purple);
      doc.roundedRect(margin + 13, y + 3, kw, 5, 1, 1, 'F');
      setText('#ffffff');
      doc.text(kindTxt, margin + 13 + kw / 2, y + 6.5, { align: 'center' });

      // Title
      let yy = y + 12;
      yy += drawWrapped(p.title, margin + 13, yy, innerW, 'bold', 10, C.text);

      // Impact (only if we had a confident framing)
      if (p.why) {
        yy += 1;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        setText(C.red);
        doc.text('Impact: ', margin + 13, yy + 3);
        const wW = doc.getTextWidth('Impact: ');
        drawWrapped(p.why, margin + 13 + wW, yy + 3, innerW - wW, 'normal', 9, C.text);
        yy += impactH;
      }

      // Fix
      yy += 1;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      setText(brand.accent);
      doc.text('Fix: ', margin + 13, yy + 3);
      const aW = doc.getTextWidth('Fix: ');
      drawWrapped(p.action, margin + 13 + aW, yy + 3, innerW - aW, 'normal', 9, C.text);

      y += blockH + 3;
    });
  }

  y += 2;

  addFooter();
  doc.addPage();
  y = margin;

  // ===========================================================================
  // ===========================================================================
  // PAGE 3+ — EXISTING DETAILED AUDIT (unchanged)
  // ===========================================================================
  // ===========================================================================

  // ───────────────────────────────────────────────────────────────────────────
  // HEADER
  // ───────────────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  setText(brand.dark);
  doc.text(brand.wordmarkPrefix, margin, y + 6);
  const rankW = doc.getTextWidth(brand.wordmarkPrefix);
  setText(brand.accent);
  doc.text(brand.wordmarkSuffix, margin + rankW, y + 6);

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

  // ───────────────────────────────────────────────────────────────────────────
  // TITLE / URL
  // ───────────────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  setText(brand.dark);
  doc.text('Page SEO Audit', margin, y);
  y += 7;

  setText(C.textMute);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const urlText = audit.url.length > 90 ? audit.url.slice(0, 87) + '…' : audit.url;
  doc.text(urlText, margin, y);
  y += 11;

  // ───────────────────────────────────────────────────────────────────────────
  // SCORE CARDS
  // ───────────────────────────────────────────────────────────────────────────
  const cardW = (contentW - 8) / 3;
  const cardH = 32;

  const drawScoreCard = (x, label, score, sub, color) => {
    setDraw(C.border);
    setFill(C.panelBg);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');
    setText(color);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.text(String(score), x + cardW / 2, y + 14, { align: 'center' });
    setText(brand.dark);
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

  drawScoreCard(margin, 'On-page SEO', audit.score ?? 0, audit.grade ? `Grade ${audit.grade}` : '', gradeColor(audit.score ?? 0));

  if (perf && typeof perf.score === 'number') {
    drawScoreCard(margin + cardW + 4, 'Page speed', perf.score, 'Mobile (Google)', gradeColor(perf.score));
  } else {
    drawEmptyCard(margin + cardW + 4, 'Page speed not available');
  }

  if (audit.aiReadiness) {
    drawScoreCard(
      margin + cardW * 2 + 8,
      'AI Search Ready',
      audit.aiReadiness.score ?? 0,
      audit.aiReadiness.grade || '',
      aiScoreColor(audit.aiReadiness.score ?? 0)
    );
  } else {
    drawEmptyCard(margin + cardW * 2 + 8, 'AI readiness n/a');
  }

  y += cardH + 8;

  // ───────────────────────────────────────────────────────────────────────────
  // SUMMARY STATS
  // ───────────────────────────────────────────────────────────────────────────
  if (audit.summary) {
    const statW = (contentW - 8) / 3;
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
      setText(brand.dark);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(label, x + 16, y + 10);
    };
    drawStat(margin,                   audit.summary.critical || 0, 'Critical', C.red);
    drawStat(margin + statW + 4,       audit.summary.warnings || 0, 'Warnings', C.amber);
    drawStat(margin + statW * 2 + 8,   audit.summary.passed   || 0, 'Passed',   C.green);
    y += statH + 8;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CORE WEB VITALS / METRICS STRIP (with status labels)
  // ───────────────────────────────────────────────────────────────────────────
  const metrics = [];
  const cwv = perf?.cwv || {};
  if (cwv.lcp != null) metrics.push({ label: 'LCP',  value: `${(cwv.lcp / 1000).toFixed(1)}s`, color: cwvColor('lcp', cwv.lcp), status: cwvLabel('lcp', cwv.lcp) });
  if (cwv.cls != null) metrics.push({ label: 'CLS',  value: cwv.cls.toFixed(3),                 color: cwvColor('cls', cwv.cls), status: cwvLabel('cls', cwv.cls) });
  if (cwv.fcp != null) metrics.push({ label: 'FCP',  value: `${(cwv.fcp / 1000).toFixed(1)}s`,  color: cwvColor('fcp', cwv.fcp), status: cwvLabel('fcp', cwv.fcp) });
  if (audit.loadTime != null) {
    const lt = audit.loadTime;
    metrics.push({
      label: 'Load time', value: `${lt}ms`,
      color: lt < 2000 ? C.green : lt < 4000 ? C.amber : C.red,
      status: lt < 2000 ? 'Good' : lt < 4000 ? 'Needs work' : 'Poor',
    });
  }
  if (audit.wordCount != null) {
    const wc = audit.wordCount;
    metrics.push({
      label: 'Word count', value: `~${wc}`,
      color: wc >= 300 ? C.green : wc >= 150 ? C.amber : C.red,
      status: wc >= 300 ? 'Good' : wc >= 150 ? 'Needs work' : 'Poor',
    });
  }

  if (metrics.length) {
    ensureSpace(20);
    const mW = (contentW - (metrics.length - 1) * 3) / metrics.length;
    const mH = 18;
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
      setText(m.color);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(String(m.value), x + mW / 2, y + 11, { align: 'center' });
      if (m.status) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.text(m.status.toUpperCase(), x + mW / 2, y + 15.5, { align: 'center' });
      }
    });
    y += mH + 8;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // WHAT DO THESE SCORES MEAN? (the in-page dropdown, expanded)
  // ───────────────────────────────────────────────────────────────────────────
  ensureSpace(60);
  setFill('#f0f7ff');
  setDraw(C.blue);
  doc.setLineWidth(0.3);
  // measure first
  const colW = (contentW - 14) / 2;
  const left1 = 'How well your page is set up for search engines. Checks things like your page title, description, headings, images, and links. Aim for 80+.';
  const left2 = 'How fast your page loads on a mobile phone (from Google). Under 50 is slow, 50–89 needs improvement, 90+ is fast.';
  const right = [
    'LCP — How long until the main content appears. Under 2.5 seconds is good.',
    'CLS — How much the page jumps around while loading. Under 0.1 means things stay put.',
    'FCP — How long until anything appears on screen. Under 1.8 seconds is good.',
    'Green = good, amber = needs work, red = poor. Google uses these to rank your site.',
  ];
  const leftH = 6 + measureWrapped(left1, colW) + 5 + 6 + measureWrapped(left2, colW);
  const rightH = 6 + right.reduce((a, t) => a + measureWrapped(t, colW) + 1, 0);
  const boxH = Math.max(leftH, rightH) + 14;
  ensureSpace(boxH + 4);
  doc.roundedRect(margin, y, contentW, boxH, 2, 2, 'FD');

  // Heading
  setText(C.blue);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('What do these scores mean?', margin + 5, y + 6);

  let lY = y + 12, rY = y + 12;
  // Left column
  setText(brand.dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('SEO Score (0–100)', margin + 5, lY);
  lY += 4;
  lY += drawWrapped(left1, margin + 5, lY, colW, 'normal', 9, C.textMute);
  lY += 4;
  doc.setFont('helvetica', 'bold');
  setText(brand.dark);
  doc.setFontSize(9);
  doc.text('Performance Score (0–100)', margin + 5, lY);
  lY += 4;
  lY += drawWrapped(left2, margin + 5, lY, colW, 'normal', 9, C.textMute);

  // Right column
  doc.setFont('helvetica', 'bold');
  setText(brand.dark);
  doc.setFontSize(9);
  doc.text('Core Web Vitals', margin + 5 + colW + 4, rY);
  rY += 4;
  right.forEach((t) => {
    rY += drawWrapped(t, margin + 5 + colW + 4, rY, colW, 'normal', 9, C.textMute) + 1;
  });

  y += boxH + 10;

  // ───────────────────────────────────────────────────────────────────────────
  // SEO ISSUES (with category explanations inline — replicates the Tip dropdown)
  // ───────────────────────────────────────────────────────────────────────────
  if (Array.isArray(audit.issues) && audit.issues.length) {
    const order = { critical: 0, warning: 1, info: 2, pass: 3 };
    const actionable = [...audit.issues]
      .filter((i) => i.type !== 'pass')
      .sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));

    if (actionable.length) {
      sectionHeading('SEO issues to fix', 40);

      actionable.forEach((issue) => {
        const innerW = contentW - 12;
        const tipText = CATEGORY_EXPLANATIONS[issue.category] || '';

        const titleH   = measureWrapped(issue.issue, innerW, 10);
        const tipH     = tipText ? measureWrapped(`What this is: ${tipText}`, innerW, 8, 3.5) : 0;
        const fixH     = issue.fix ? measureWrapped(issue.fix, innerW, 9) : 0;
        const currentH = issue.current ? measureWrapped(`Current: ${String(issue.current).slice(0, 400)}`, innerW, 8, 3.5) : 0;

        const blockH = 9 + titleH + (tipH ? tipH + 2 : 0) + (fixH ? fixH + 3 : 0) + (currentH ? currentH + 2 : 0) + 7;
        ensureSpace(blockH + 3);

        const color = severityColor(issue.type);

        // Background panel
        setFill(C.panelBg);
        setDraw(C.border);
        doc.setLineWidth(0.3);
        doc.roundedRect(margin, y, contentW, blockH, 2, 2, 'FD');
        // Severity bar (left edge)
        setFill(color);
        doc.rect(margin, y, 1.4, blockH, 'F');

        // Header row: severity badge + category
        const label = (issue.type || '').toUpperCase();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        const labelW = doc.getTextWidth(label) + 4;
        setFill(color);
        doc.roundedRect(margin + 6, y + 3.5, labelW, 5, 1, 1, 'F');
        setText('#ffffff');
        doc.text(label, margin + 6 + labelW / 2, y + 7, { align: 'center' });

        setText(C.textMute);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(issue.category || '', margin + 6 + labelW + 3, y + 7);

        let yy = y + 12;
        // Title
        yy += drawWrapped(issue.issue || '', margin + 6, yy, innerW, 'bold', 10, C.text);
        // Inline tip explanation (Tip dropdown content)
        if (tipText) {
          yy += 1;
          yy += drawWrapped(`What this is: ${tipText}`, margin + 6, yy + 1, innerW, 'italic', 8, C.textSoft, 3.5);
        }
        // Fix recommendation
        if (issue.fix) {
          yy += 2;
          yy += drawWrapped(issue.fix, margin + 6, yy + 1, innerW, 'normal', 9, C.text);
        }
        // Current value
        if (issue.current) {
          yy += 1;
          yy += drawWrapped(`Current: ${String(issue.current).slice(0, 400)}`, margin + 6, yy + 1, innerW, 'italic', 8, C.textMute, 3.5);
        }

        y += blockH + 5;
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PAGE SPEED OPPORTUNITIES (PSI)
  // ───────────────────────────────────────────────────────────────────────────
  if (perf && Array.isArray(perf.opportunities) && perf.opportunities.length) {
    sectionHeading('Page speed opportunities', 40);

    perf.opportunities.forEach((op) => {
      const innerW = contentW - 12;
      const cleanDesc = op.description ? op.description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim() : '';
      const titleH = measureWrapped(op.title || '', innerW, 10);
      const descH  = cleanDesc ? measureWrapped(cleanDesc, innerW, 9) : 0;
      const blockH = 11 + titleH + (descH ? descH + 2 : 0) + 6;
      ensureSpace(blockH + 3);

      const accent = (op.score != null && op.score <= 0.5) ? C.red : C.amber;
      setFill(C.panelBg);
      setDraw(C.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, contentW, blockH, 2, 2, 'FD');
      setFill(accent);
      doc.rect(margin, y, 1.4, blockH, 'F');

      // Savings badges
      let badgeX = margin + 6;
      if (op.savings) {
        const txt = `Save ${op.savings}`;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        const w = doc.getTextWidth(txt) + 4;
        setFill(brand.accent);
        doc.roundedRect(badgeX, y + 3.5, w, 5, 1, 1, 'F');
        setText('#ffffff');
        doc.text(txt, badgeX + w / 2, y + 7, { align: 'center' });
        badgeX += w + 2;
      }
      if (op.savingsBytes) {
        const txt = op.savingsBytes;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        const w = doc.getTextWidth(txt) + 4;
        setFill(C.blue);
        doc.roundedRect(badgeX, y + 3.5, w, 5, 1, 1, 'F');
        setText('#ffffff');
        doc.text(txt, badgeX + w / 2, y + 7, { align: 'center' });
      }

      let yy = y + 13;
      yy += drawWrapped(op.title || '', margin + 6, yy, innerW, 'bold', 10, C.text);
      if (cleanDesc) {
        yy += 2;
        drawWrapped(cleanDesc, margin + 6, yy + 1, innerW, 'normal', 9, C.textMute);
      }

      y += blockH + 5;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PAGE SPEED DIAGNOSTICS
  // ───────────────────────────────────────────────────────────────────────────
  if (perf && Array.isArray(perf.diagnostics) && perf.diagnostics.length) {
    sectionHeading('Page speed diagnostics', 12);
    perf.diagnostics.forEach((d) => {
      const lines = doc.splitTextToSize(d.title || '', contentW - 8);
      ensureSpace(lines.length * 4.5 + 4);
      const dot = (d.score != null && d.score <= 0.5) ? C.red : C.amber;
      setFill(dot);
      doc.circle(margin + 2, y - 1.2, 0.9, 'F');
      setText(brand.dark);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(lines, margin + 6, y);
      y += lines.length * 4.5 + 2;
    });
    y += 6;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // AI SEARCH READINESS — every check, with examples + fix
  // ───────────────────────────────────────────────────────────────────────────
  if (audit.aiReadiness) {
    sectionHeading('AI Search readiness', 30);

    // Subheading
    if (typeof audit.aiReadiness.passed === 'number' && typeof audit.aiReadiness.total === 'number') {
      setText(aiScoreColor(audit.aiReadiness.score ?? 0));
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(
        `${audit.aiReadiness.passed}/${audit.aiReadiness.total} checks passed · ${audit.aiReadiness.grade || ''}`,
        margin, y
      );
      y += 5;
    }

    const intro = 'How well this page is structured for AI search engines like Google AI Overviews, ChatGPT, and Perplexity. Pages that score higher here are more likely to be cited in AI-generated answers.';
    y += drawWrapped(intro, margin, y, contentW, 'normal', 9, C.textMute) + 4;

    if (Array.isArray(audit.aiReadiness.checks)) {
      audit.aiReadiness.checks.forEach((c) => {
        const innerW = contentW - 8;
        const detailH  = c.detail ? measureWrapped(c.detail, innerW, 9) : 0;
        const fixH     = c.fix    ? measureWrapped(`Fix: ${c.fix}`, innerW, 9) : 0;
        const examplesText = (Array.isArray(c.examples) && c.examples.length)
          ? `Examples: ${c.examples.map((e) => `"${e}"`).join('  ·  ')}`
          : '';
        const examplesH = examplesText ? measureWrapped(examplesText, innerW, 8, 3.5) : 0;

        const blockH = 8 + detailH + (fixH ? fixH + 2 : 0) + (examplesH ? examplesH + 2 : 0) + 6;
        ensureSpace(blockH + 2);

        const color =
          c.status === 'pass'    ? C.purple :
          c.status === 'partial' ? C.amber  :
          c.status === 'neutral' ? C.textMute :
                                   C.red;

        setFill(C.panelBg);
        setDraw(C.border);
        doc.setLineWidth(0.3);
        doc.roundedRect(margin, y, contentW, blockH, 2, 2, 'FD');
        setFill(color);
        doc.rect(margin, y, 1.4, blockH, 'F');

        // Status badge
        const statusLabel = (c.status || '').toUpperCase();
        if (statusLabel) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7);
          const w = doc.getTextWidth(statusLabel) + 4;
          setFill(color);
          doc.roundedRect(margin + 4, y + 2, w, 5, 1, 1, 'F');
          setText('#ffffff');
          doc.text(statusLabel, margin + 4 + w / 2, y + 5.5, { align: 'center' });

          // Check name on same row
          setText(brand.dark);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.text(c.check || '', margin + 4 + w + 3, y + 5.5);
        } else {
          setText(brand.dark);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.text(c.check || '', margin + 4, y + 5.5);
        }

        let yy = y + 10;
        if (c.detail) {
          yy += drawWrapped(c.detail, margin + 4, yy, innerW, 'normal', 9, C.textMute);
        }
        if (c.fix) {
          yy += 2;
          yy += drawWrapped(`Fix: ${c.fix}`, margin + 4, yy + 1, innerW, 'italic', 9, C.text);
        }
        if (examplesText) {
          yy += 2;
          drawWrapped(examplesText, margin + 4, yy + 1, innerW, 'normal', 8, C.purple, 3.5);
        }

        y += blockH + 3;
      });
    }

    // ── Why does AI search readiness matter? (dropdown expanded) ──
    ensureSpace(70);
    const aiBlocks = [
      ['FAQ and HowTo schema',     'Structured data that AI can extract directly without interpreting prose.'],
      ['Question-based headings',  'H2s phrased as questions that match how people ask AI assistants.'],
      ['Concise direct answers',   'The first sentence after a heading should directly answer the question.'],
      ['Author and date signals',  'AI engines prioritise recent, authoritative content.'],
      ['Structured content',       'Lists, tables, and short paragraphs that AI can parse reliably.'],
    ];
    const aiIntro = 'Google AI Overviews, ChatGPT, and Perplexity are increasingly answering questions directly instead of showing traditional search results. When they do, they cite sources — and the sources they choose tend to have:';
    const aiOutro = 'Traditional SEO still matters — you need to rank in the top 3–5 results for AI to consider citing you. AI readiness is the next layer on top of good SEO fundamentals.';

    let aiBoxH = 12 + measureWrapped(aiIntro, contentW - 10) + 4;
    aiBlocks.forEach(([k, v]) => {
      aiBoxH += measureWrapped(`${k} — ${v}`, contentW - 10) + 2;
    });
    aiBoxH += 4 + measureWrapped(aiOutro, contentW - 10) + 6;

    ensureSpace(aiBoxH + 2);
    setFill('#faf5ff');
    setDraw(C.purple);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, contentW, aiBoxH, 2, 2, 'FD');

    setText(C.purple);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Why does AI search readiness matter?', margin + 5, y + 6);

    let aY = y + 11;
    aY += drawWrapped(aiIntro, margin + 5, aY, contentW - 10, 'normal', 9, C.text) + 3;

    aiBlocks.forEach(([k, v]) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      setText(brand.dark);
      const w = doc.getTextWidth(`${k} — `);
      doc.text(`${k} — `, margin + 5, aY);
      const valLines = doc.splitTextToSize(v, contentW - 10 - w);
      doc.setFont('helvetica', 'normal');
      setText(C.textMute);
      doc.text(valLines, margin + 5 + w, aY);
      aY += Math.max(4, valLines.length * 4) + 2;
    });

    aY += 2;
    drawWrapped(aiOutro, margin + 5, aY, contentW - 10, 'italic', 9, C.textSoft);

    y += aiBoxH + 8;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // METHODOLOGY DISCLAIMER (closing block — sales conversation happens live)
  // ───────────────────────────────────────────────────────────────────────────
  const disclaimer = 'SEO checks are based on HTML analysis. Performance data is from Google PageSpeed Insights (mobile). Always back up your site before making changes.';
  const discInnerW = contentW - 6;
  const discH = measureWrapped(disclaimer, discInnerW, 7.5, 3.4) + 4;
  ensureSpace(discH + 2);
  setFill(C.panelBg);
  setDraw(C.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentW, discH, 1.5, 1.5, 'FD');
  drawWrapped(disclaimer, margin + 3, y + 3.5, discInnerW, 'italic', 7.5, C.textMute, 3.4);
  y += discH + 4;

  addFooter();

  // ── Save ──
  const slug = audit.url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  doc.save(`rankactions-audit-${slug}-${date}.pdf`);
}
