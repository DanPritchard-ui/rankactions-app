// ============================================================
// utils/sanitize.js — Sanitize AI-generated HTML (C7)
// ============================================================
// The Content Generator and PDF report builders write AI output
// into a same-origin iframe / window via document.write. Even
// though the prompt asks for "clean HTML", LLM output cannot be
// trusted as a security boundary — prompt injection or accidental
// inclusion of <script> / event handlers will execute in our
// origin and steal Clerk session tokens.
//
// This module wraps DOMPurify with a strict config and is applied
// to AI HTML before any document.write or innerHTML assignment.
//
// Install:  npm install dompurify@3
// ============================================================

import DOMPurify from 'dompurify';

// ─── Strict config: structural HTML only ──────────────────────
const SAFE_TAGS = [
  'a', 'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'mark',
  'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
  'div', 'span', 'section', 'article', 'header', 'footer',
  'figure', 'figcaption',
  'dl', 'dt', 'dd',
];

const SAFE_ATTRS = [
  'href', 'title', 'alt',
  'class', 'id',
  'colspan', 'rowspan',
  'aria-label', 'aria-hidden', 'role',
];

// Hard-disallow any URI scheme except http(s) and mailto
const SAFE_URI_REGEX = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const STRICT_CONFIG = Object.freeze({
  ALLOWED_TAGS: SAFE_TAGS,
  ALLOWED_ATTR: SAFE_ATTRS,
  ALLOWED_URI_REGEXP: SAFE_URI_REGEX,
  // Forbid all event handlers and known sinks even if they slipped
  // through ALLOWED_ATTR somehow.
  FORBID_ATTR: ['style', 'srcdoc', 'on*', 'formaction', 'action', 'background'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input',
                'textarea', 'select', 'button', 'link', 'style', 'meta',
                'base', 'frame', 'frameset', 'applet', 'audio', 'video',
                'canvas', 'svg', 'math'],
  // No SVG / MathML — both can execute script in some contexts.
  USE_PROFILES: { html: true },
  // Strip <html><body> wrappers DOMPurify sometimes adds.
  WHOLE_DOCUMENT: false,
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  RETURN_TRUSTED_TYPE: false,
  // Do not allow data: URLs (rules out data:text/html,xss)
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  SANITIZE_DOM: true,
  SANITIZE_NAMED_PROPS: true,  // prevent DOM clobbering of e.g. window.foo via name=foo
});

// One-time hook to enforce target=_blank rel=noopener on all links.
let _hookInstalled = false;
function ensureLinkHook() {
  if (_hookInstalled) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      // Force target=_blank + rel=noopener for any href that survived.
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  _hookInstalled = true;
}

/**
 * Sanitize untrusted HTML for embedding in a same-origin context.
 * Intended for AI-generated content displayed in the Content
 * Generator preview iframe and in PDF report `document.write`s.
 *
 * @param {string} dirty – Raw HTML from an AI model
 * @returns {string} Sanitized HTML safe to assign to innerHTML
 *                    or pass to document.write.
 */
export function sanitizeAiHtml(dirty) {
  if (typeof dirty !== 'string') return '';
  if (dirty.length > 1_000_000) {
    // 1MB ceiling — beyond this, refuse rather than burn CPU.
    console.warn('sanitizeAiHtml: input exceeds 1MB, refusing');
    return '';
  }
  ensureLinkHook();
  return DOMPurify.sanitize(dirty, STRICT_CONFIG);
}

/**
 * Stricter variant for plain-text-only contexts: strips ALL HTML,
 * returning text content only. Use where you need a string and
 * have no rendering layer.
 */
export function stripAllHtml(dirty) {
  if (typeof dirty !== 'string') return '';
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  });
}

/**
 * For a defensive fallback when DOMPurify is unavailable
 * (e.g. SSR, test envs): strips obvious dangerous tags via regex.
 * NOT a substitute for DOMPurify — only a last-ditch defence.
 */
export function emergencyHtmlFilter(dirty) {
  if (typeof dirty !== 'string') return '';
  return dirty
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/data:(?!image\/)/gi, '');
}
