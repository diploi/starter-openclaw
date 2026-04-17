import { useCallback, useEffect, useMemo, useState } from 'react'
import logoutIcon from './assets/logout.svg'
import openclawIcon from './assets/openclaw.svg'
import TerminalEmbed from './Terminal.jsx'
import './App.css'

const FAST_POLL_MS = 500
const SLOW_POLL_MS = 2500

const formatAgo = (fromIso, nowIso) => {
  if (!fromIso || !nowIso) return ''
  const from = new Date(fromIso).getTime()
  const now = new Date(nowIso).getTime()
  const s = Math.max(0, Math.floor((now - from) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts = []
  if (h) parts.push(`${h}h`)
  if (m || h) parts.push(`${m}m`)
  parts.push(`${sec}s`)
  return parts.join(' ')
}

const capitalize = (value) => {
  if (!value) return ''
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

const Section = ({ title, children }) => (
  <div className="section">
    <h2 className="sectionTitle">{title}</h2>
    {children}
  </div>
)

function App() {
  const [status, setStatus] = useState({ state: 'unknown' })
  const [pendingAction, setPendingAction] = useState(null)
  const [nowIso, setNowIso] = useState(new Date().toISOString())
  const [error, setError] = useState('')
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [terminalExpanded, setTerminalExpanded] = useState(
    () => window.location.pathname === '/terminal' || window.location.pathname.startsWith('/terminal/')
  )

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/gateway/status', { cache: 'no-store' })
      const j = await r.json()
      const nextGateway = j.gateway || {}
      setNowIso(j.now || new Date().toISOString())
      setStatus((prev) => {
        const nextState = nextGateway.state

        // Keep optimistic transition while start/stop request is still in flight.
        if (pendingAction === 'starting' && nextState === 'stopped') return prev
        if (pendingAction === 'stopping' && (nextState === 'running' || nextState === 'booting' || nextState === 'starting')) return prev

        return nextGateway
      })
      setError('')
    } catch (err) {
      setError(String(err))
    }
  }, [pendingAction])

  const isRunning = status.state === 'running'
  const isBooting = status.state === 'booting'
  const isStarting = status.state === 'starting'
  const isStopping = status.state === 'stopping'

  const pollMs = useMemo(() => {
    if (status.state === 'booting' || status.state === 'starting' || status.state === 'stopping') return FAST_POLL_MS
    return SLOW_POLL_MS
  }, [status.state])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, pollMs)
    return () => clearInterval(t)
  }, [refresh, pollMs])

  const uptimeText = useMemo(() => {
    const basis = status.readyAt || status.startedAt
    if (status.state === 'running' && basis) return `Up for ${formatAgo(basis, nowIso)}`
    if (status.state === 'starting' && status.startedAt) return `Starting… ${formatAgo(status.startedAt, nowIso)}`
    if (status.state === 'stopping' && basis) return `Stopping… up ${formatAgo(basis, nowIso)}`
    return ''
  }, [status, nowIso])


  const callAction = async (path, optimisticState) => {
    setError('')
    setPendingAction(optimisticState || null)
    if (optimisticState) {
      const optimisticNow = new Date().toISOString()
      setNowIso(optimisticNow)
      setStatus((prev) => ({
        ...prev,
        state: optimisticState,
        startedAt: optimisticState === 'starting' ? optimisticNow : prev.startedAt,
        readyAt: optimisticState === 'starting' ? null : prev.readyAt,
      }))
    }
    try {
      const r = await fetch(path, { method: 'POST' })
      const j = await r.json()
      setNowIso(j.now || new Date().toISOString())
      setStatus(j.gateway || {})
    } catch (err) {
      setError(String(err))
    } finally {
      setPendingAction(null)
    }
  }

  const onToggle = () => {
    if (isRunning) {
      setShowStopConfirm(true)
    } else {
      callAction('/api/gateway/start', 'starting')
    }
  }

  const confirmStop = () => {
    setShowStopConfirm(false)
    callAction('/api/gateway/stop', 'stopping')
  }

  const cancelStop = () => {
    setShowStopConfirm(false)
  }

  const onResetClick = () => {
    setShowResetConfirm(true)
  }

  const confirmReset = async () => {
    setShowResetConfirm(false)
    setIsResetting(true)
    setError('')
    try {
      const r = await fetch('/api/full-reset', { method: 'POST' })
      const j = await r.json()
      setNowIso(j.now || new Date().toISOString())
      setStatus(j.gateway || {})
      if (!j.ok) setError(j?.error || 'Reset failed')
    } catch (err) {
      setError(String(err))
    } finally {
      setIsResetting(false)
    }
  }

  const cancelReset = () => {
    setShowResetConfirm(false)
  }

  const onOpenDashboard = async () => {
    setError('')
    try {
      const r = await fetch('/api/dashboard-token', { cache: 'no-store' })
      const j = await r.json()
      if (!j || !j.ok || !j.token) {
        setError(j?.error || 'Dashboard token not available yet.')
        return
      }
      const token = j.token;
      const key = "openclaw.control.settings.v1";
      let settings = {};
      try {
        const current = localStorage.getItem(key);
        settings = current ? JSON.parse(current) : {};
      } catch {
        settings = {};
      }
      settings.token = token;
      localStorage.setItem(key, JSON.stringify(settings));
      sessionStorage.setItem(`openclaw.control.token.v1:${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/dashboard`, token);
      window.open('/dashboard', '_blank');

    } catch (err) {
      setError(String(err))
    }
  }

  const onLogout = () => {
    fetch('/api/logout', { method: 'POST' })
      .catch(() => {
        // Ignore network errors; still try redirecting.
      })
      .finally(() => {
        window.location.href = '/'
      })
  }

  return (
    <div className="wrap">
      {showStopConfirm ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-labelledby="stop-gateway-title">
          <div className="modalCard">
            <h3 id="stop-gateway-title">Stop the gateway?</h3>
            <p>
              This will stop the OpenClaw gateway process. Existing sessions may disconnect until you start it again.
            </p>
            <div className="modalActions">
              <button className="btn" type="button" onClick={cancelStop}>
                Cancel
              </button>
              <button className="btn danger" type="button" onClick={confirmStop}>
                Stop gateway
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showResetConfirm ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <div className="modalCard">
            <h3 id="reset-title">Reset OpenClaw?</h3>
            <p>
              This will permanently delete all data (agents, credentials, workspace, etc.) and restart OpenClaw with an empty
              configuration. This action cannot be undone.
            </p>
            <div className="modalActions">
              <button className="btn" type="button" onClick={cancelReset}>
                Cancel
              </button>
              <button className="btn danger" type="button" onClick={confirmReset}>
                Reset OpenClaw
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Navigation Bar */}
      <nav className="navbar">
        <div className="navContent">
          <div className="navBrand">
            <div className="logo" aria-hidden="true">
              <img src={openclawIcon} alt="" width={26} height={26} />
            </div>
            <div className="brandText">
              <span className="brandTitle">OpenClaw</span>
              <span className="brandSubtitle">Setup Page</span>
            </div>
          </div>
          <button className="btn navLogout" type="button" onClick={onLogout} aria-label="Logout">
            <img src={logoutIcon} alt="" width="20" height="20" />
            <span>Logout</span>
          </button>
        </div>
      </nav>

      {/* Welcome Section */}
      <div className="welcomeSection">
        <div className="welcomeContent">
          <h1 className="welcomeTitle">Welcome to OpenClaw running on Diploi</h1>
          <button className="btn primary" type="button" onClick={onOpenDashboard}>
            Open OpenClaw Dashboard
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="mainContent">
        <div className="contentWrapper">
          {/* Left Column */}
          <div className="column columnLeft">
            <Section title="Gateway Status">
              <div className="statusRow">
                <span className="pill">
                  <span className={`dot ${status.state === 'running' ? 'good' : status.state === 'stopped' ? 'bad' : status.state === 'booting' ? 'booting' : 'unknown'}`} />
                  <span>{capitalize(status.state || 'unknown')}</span>
                </span>
                <span className="muted">{uptimeText}</span>
              </div>

              {error ? <div className="error">{error}</div> : null}
            </Section>

            <div className="controlButtons">
              {
                !isResetting && (
                  <button
                    className={`btn ${isRunning ? 'danger' : 'primary'} ${isStopping || isStarting || isBooting ? 'loading' : ''}`}
                    type="button"
                    onClick={onToggle}
                    disabled={isStopping || isStarting || isBooting}
                  >
                    {isStopping ? 'Stopping…' : isRunning ? 'Stop Gateway' : isStarting ? 'Starting…' : isBooting ? 'Booting…' : 'Start Gateway'}
                  </button>
                )
              }

              <button
                className={`btn danger ${isResetting ? 'loading' : ''}`}
                type="button"
                onClick={onResetClick}
                disabled={isResetting || isStarting || isStopping || isBooting}
              >
                {isResetting ? "Resetting…" : "Reset OpenClaw"}
              </button>
            </div>
          </div>

          {/* Right Column */}
          <div className="column columnRight">
            <Section title="Instructions">
              <div className="instructionsText">
                <p className="muted lead">
                  Manage your OpenClaw gateway from this page. Use the controls on the left to start, stop, or reset.
                </p>

                <ol className="steps">
                  <li className="stepItem">
                    <span className="stepNum">1</span>
                    <div>
                      <strong>Wait for the gateway to boot</strong>
                      <span className="muted"> — status changes from <em>booting</em> to <em>running</em>. This may take up to a minute.</span>
                    </div>
                  </li>
                  <li className="stepItem">
                    <span className="stepNum">2</span>
                    <div>
                      <strong>Open the admin dashboard</strong>
                      <span className="muted"> — once running, click <em>"Open OpenClaw Dashboard"</em> to manage your instance.</span>
                    </div>
                  </li>
                  <li className="stepItem">
                    <span className="stepNum">3</span>
                    <div>
                      <strong>Configure OpenClaw</strong>
                      <span className="muted">
                        {" "}
                        — via the{" "}
                        <a href="/dashboard" target="_blank" rel="noopener noreferrer">
                          dashboard
                        </a>
                        , by editing <code>openclaw.json</code> in the Cloud IDE, or by using the
                        terminal below. To connect locally, click <em>"Connect"</em> on the Node.js
                        container in the Diploi deployment page and paste the SSH command into your
                        terminal.
                      </span>
                    </div>
                  </li>
                </ol>

                <p className="tip">
                  <strong>Need help?</strong> See the <a href="https://docs.openclaw.ai/start/getting-started" target="_blank" rel="noopener noreferrer">OpenClaw documentation</a> or contact Diploi support.
                </p>
              </div>
            </Section>
          </div>
        </div>
      </div>

      <div className="terminal-section">
        <button
          type="button"
          className="terminal-toggle"
          onClick={() => setTerminalExpanded((v) => !v)}
          aria-expanded={terminalExpanded}
        >
          <span className="terminal-toggle-icon">{terminalExpanded ? '▼' : '▶'}</span>
          <span>Terminal</span>
        </button>
        <div className="terminal-desc">
          Use a browser terminal to access the <strong>openclaw</strong> command directly, or modify files or{' '}
          <strong>openclaw.json</strong>.
        </div>
        {terminalExpanded && (
          <div className="terminal-wrap">
            <TerminalEmbed visible={true} />
          </div>
        )}
      </div>

    </div>
  )
}

export default App
