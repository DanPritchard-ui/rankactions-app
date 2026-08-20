import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import RankActions from './App'

// ---------------------------------------------------------------------------
// Failure diagnostics
// ---------------------------------------------------------------------------
// Every white screen this project has hit looked identical from the outside:
// a blank page, no message, and the real cause only visible if you happened to
// have DevTools open at the right moment. That cost hours of guessing.
//
// Two different failure modes need catching, and they need different tools:
//
//   1. RENDER errors — a component throws while rendering. React error
//      boundaries catch these, but ONLY these. They do not catch async
//      failures, event handlers, or anything outside the render lifecycle.
//
//   2. BOOT failures — the app never mounts at all. Clerk rejecting an origin
//      is the example that bit us: it fails asynchronously, React never gets
//      far enough to throw, and the boundary never fires. Caught here with
//      window error listeners, guarded so they only act when the root is
//      genuinely empty (i.e. nothing ever rendered).
//
// Both paths render the same panel: what broke, where, and a copy button — so
// the error can be pasted somewhere useful instead of described from memory.
// ---------------------------------------------------------------------------

const PANEL_STYLE = {
  minHeight: '100vh',
  margin: 0,
  padding: '2rem',
  background: '#0d0d0d',
  color: '#f5f1e8',
  fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const CARD_STYLE = {
  maxWidth: '760px',
  width: '100%',
  background: '#15161a',
  border: '1px solid #2a2d3a',
  borderRadius: '12px',
  padding: '2rem',
}

function FailurePanel({ title, message, detail, onReload }) {
  const [copied, setCopied] = React.useState(false)
  const full = `${title}\n\n${message}\n\n${detail || ''}`.trim()

  const copy = () => {
    try {
      navigator.clipboard.writeText(full)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable — the text is on screen anyway */ }
  }

  return (
    <div style={PANEL_STYLE}>
      <div style={CARD_STYLE}>
        <div style={{ fontSize: '1.35rem', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '.6rem' }}>
          <span style={{ color: '#ffffff' }}>Rank</span><span style={{ color: '#1ea863' }}>Actions</span>
        </div>
        <h1 style={{ fontSize: '1.05rem', fontWeight: 600, margin: '0 0 .75rem' }}>{title}</h1>
        <p style={{ fontSize: '.9rem', lineHeight: 1.6, color: '#c9c6bd', margin: '0 0 1.25rem' }}>
          {message}
        </p>

        {detail && (
          <pre style={{
            background: '#0b0c0f',
            border: '1px solid #2a2d3a',
            borderRadius: '8px',
            padding: '.9rem',
            fontSize: '.75rem',
            lineHeight: 1.5,
            color: '#e06c75',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '260px',
            margin: '0 0 1.25rem',
          }}>{detail}</pre>
        )}

        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <button
            onClick={onReload}
            style={{
              background: '#0a7c4e', color: '#fff', border: 'none', borderRadius: '8px',
              padding: '.65rem 1.25rem', fontSize: '.85rem', fontWeight: 600, cursor: 'pointer',
            }}
          >Reload the page</button>
          <button
            onClick={copy}
            style={{
              background: 'transparent', color: '#c9c6bd', border: '1px solid #2a2d3a',
              borderRadius: '8px', padding: '.65rem 1.25rem', fontSize: '.85rem', cursor: 'pointer',
            }}
          >{copied ? '✓ Copied' : 'Copy error details'}</button>
        </div>

        <p style={{ fontSize: '.75rem', color: '#8a877e', margin: '1.25rem 0 0', lineHeight: 1.6 }}>
          If this keeps happening, copy the details above and send them to support —
          they identify the exact cause.
        </p>
      </div>
    </div>
  )
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Keep the console output — it is still the fastest route to a stack trace
    // when DevTools happens to be open.
    console.error('[boundary] render error:', error, info)
    this.setState({ info })
  }

  render() {
    if (!this.state.error) return this.props.children

    const detail = [
      this.state.error?.stack || String(this.state.error),
      this.state.info?.componentStack ? `\nComponent stack:${this.state.info.componentStack}` : '',
    ].join('')

    return (
      <FailurePanel
        title="Something went wrong"
        message="The app hit an unexpected error and stopped rendering. Reloading usually fixes it. Your data is safe — nothing is stored in this page."
        detail={detail}
        onReload={() => window.location.reload()}
      />
    )
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const rootEl = document.getElementById('root')
const root = ReactDOM.createRoot(rootEl)

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  // Previously this threw at module scope, which meant nothing rendered at all —
  // a white screen whose only clue was a console line. Render the reason instead.
  root.render(
    <FailurePanel
      title="Configuration error"
      message="VITE_CLERK_PUBLISHABLE_KEY is not set, so authentication cannot start."
      detail={'Add it to .env.local for local development, or to the environment variables\nfor this deployment in Cloudflare Pages (Settings → Environment variables).'}
      onReload={() => window.location.reload()}
    />
  )
} else {
  root.render(
    <React.StrictMode>
      {/* Outside ClerkProvider so a throw during Clerk's own render is caught. */}
      <ErrorBoundary>
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
          <RankActions />
        </ClerkProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )

  // ---- Boot-failure watchdog ----------------------------------------------
  // Catches the case the error boundary structurally cannot: the app never
  // mounts. Clerk rejecting the origin is the known example — it fails async,
  // so React never throws and the boundary never fires.
  //
  // Guarded twice so it can never hijack a healthy app: it only reports if the
  // root is still empty, and only within the first few seconds after load.
  const BOOT_GRACE_MS = 8000
  const bootedAt = Date.now()
  let reported = false

  const reportBootFailure = (label, err) => {
    if (reported) return
    if (Date.now() - bootedAt > BOOT_GRACE_MS) return       // app had time to mount
    if (rootEl && rootEl.childElementCount > 0) return       // something rendered — not a boot failure
    reported = true
    const detail = err?.stack || err?.message || String(err || 'no detail available')
    root.render(
      <FailurePanel
        title="The app couldn't start"
        message="RankActions failed to load before it could render anything. This is usually a configuration or connection problem rather than a fault with your account."
        detail={`${label}\n\n${detail}`}
        onReload={() => window.location.reload()}
      />
    )
  }

  window.addEventListener('error', (e) => reportBootFailure('Uncaught error during startup:', e.error || e.message))
  window.addEventListener('unhandledrejection', (e) => reportBootFailure('Unhandled promise rejection during startup:', e.reason))
}
