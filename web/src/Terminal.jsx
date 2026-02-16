import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import './Terminal.css'

function TerminalEmbed({ visible = true, className = '' }) {
  const containerRef = useRef(null)
  const fitRef = useRef(null)
  const wsRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || !visible) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 11,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    fitRef.current = fitAddon

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/terminal-ws`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => { }

    ws.onmessage = (ev) => {
      term.write(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data))
    }

    ws.onclose = () => {
      // Ignore - avoids spurious "Connection closed unexpectedly" during initial connect
    }

    ws.onerror = () => {
      // Ignore - not helpful during initial connection
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    const handleResize = () => {
      fitAddon.fit()
      const dims = fitAddon.proposeDimensions()
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ resize: { cols: dims.cols, rows: dims.rows } }))
      }
    }

    window.addEventListener('resize', handleResize)

    wsRef.current = ws

    return () => {
      window.removeEventListener('resize', handleResize)
      ws.close()
      term.dispose()
    }
  }, [visible])

  if (!visible) return null

  return (
    <div className={`terminal-embed ${className}`}>
      <div ref={containerRef} className="terminal-container" />
    </div>
  )
}

export default TerminalEmbed
