import { useEffect, useMemo, useState } from 'react'
import logoutIcon from './assets/logout.svg'
import openclawIcon from './assets/openclaw.svg'
import TerminalEmbed from './Terminal.jsx'
import './App.css'

const POLL_MS = 2500

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

const formatTimestamp = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
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
  const [nowIso, setNowIso] = useState(new Date().toISOString())
  const [error, setError] = useState('')
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [terminalExpanded, setTerminalExpanded] = useState(
    () => window.location.pathname === '/terminal' || window.location.pathname.startsWith('/terminal/')
  )

  const refresh = async () => {
    try {
      const r = await fetch('/api/gateway/status', { cache: 'no-store' })
      const j = await r.json()
      setNowIso(j.now || new Date().toISOString())
      setStatus(j.gateway || {})
      setError('')
    } catch (err) {
      setError(String(err))
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [])

  const isRunning = status.state === 'running'
  const isStarting = status.state === 'starting'
  const isStopping = status.state === 'stopping'

  const uptimeText = useMemo(() => {
    const basis = status.readyAt || status.startedAt
    if (status.state === 'running' && basis) return `Up for ${formatAgo(basis, nowIso)}`
    if (status.state === 'starting' && status.startedAt) return `Starting… ${formatAgo(status.startedAt, nowIso)}`
    if (status.state === 'stopping' && basis) return `Stopping… up ${formatAgo(basis, nowIso)}`
    return ''
  }, [status, nowIso])


  const callAction = async (path, optimisticState) => {
    setError('')
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
                  <span className={`dot ${status.state === 'running' ? 'good' : status.state === 'stopped' ? 'bad' : ''}`} />
                  <span>{capitalize(status.state || 'unknown')}</span>
                </span>
                <span className="muted">{uptimeText}</span>
              </div>

              {error ? <div className="error">{error}</div> : null}
            </Section>

            <div className="controlButtons">
              <button
                className={`btn ${isRunning ? 'danger' : 'primary'} ${isStopping || isStarting ? 'loading' : ''}`}
                type="button"
                onClick={onToggle}
                disabled={isStopping || isStarting}
              >
                {isStopping ? 'Stopping…' : isRunning ? 'Stop Gateway' : isStarting ? 'Starting…' : 'Start Gateway'}
              </button>
              <button
                className={`btn danger ${isResetting ? 'loading' : ''}`}
                type="button"
                onClick={onResetClick}
                disabled={isResetting || isStarting || isStopping}
              >
                {isResetting ? "Resetting…" : "Reset OpenClaw"}
              </button>
            </div>
          </div>

          {/* Right Column */}
          <div className="column columnRight">
            <Section title="Instructions">
              <div className="muted instructionsText">
                <p>
                  This is Diploi Setup Page for OpenClaw, allowing gateway process's management through UI interface.
                </p>
                <p>
                  You can restart the gateway or reset all OpenClaw data using the buttons on the left. The gateway status shows whether the gateway process is running, starting, stopping, or stopped, along with uptime information.
                </p>
                <p>
                  Configuring OpenClaw can be done either through the <a href="/dashboard" target="_blank" rel="noopener noreferrer">OpenClaw Dashboard</a> or by using the OpenClaw CLI.
                  You can also edit openclaw.json directly in the Cloud IDE by clicking the "Code in the Browser" button on the OpenClaw Deployment page.</p>
                <p className="tip">
                  <strong>Documentation:</strong> For more detailed instructions and troubleshooting, please refer to the <a href="https://docs.openclaw.ai/start/getting-started" target="_blank" rel="noopener noreferrer">OpenClaw Documentation</a> or
                  contact Diploi support if you need any assistance with your OpenClaw deployment.
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
