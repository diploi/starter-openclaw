export const DASHBOARD_LOADING_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>Opening OpenClaw</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0b1020;
        color: rgba(255, 255, 255, 0.92);
      }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        overflow: hidden;
        background:
          radial-gradient(900px 600px at 15% 0%, rgba(138, 92, 255, 0.24), transparent 58%),
          radial-gradient(800px 600px at 100% 15%, rgba(255, 92, 122, 0.20), transparent 58%),
          #0b1020;
      }
      .card {
        position: relative;
        width: min(440px, 100%);
        padding: 32px;
        overflow: hidden;
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.035));
        box-shadow: 0 24px 70px rgba(3, 8, 19, 0.55);
        backdrop-filter: blur(12px);
      }
      .brand {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-bottom: 28px;
      }
      .logo {
        width: 48px;
        height: 48px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        background: linear-gradient(135deg, rgba(255, 92, 122, 0.25), rgba(138, 92, 255, 0.25));
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
        font-size: 27px;
      }
      .brand-copy { text-align: left; }
      .brand-title { font-size: 15px; font-weight: 800; letter-spacing: 0.2px; }
      .brand-subtitle { margin-top: 2px; color: rgba(255, 255, 255, 0.62); font-size: 12px; }
      .loader {
        position: relative;
        width: 58px;
        height: 58px;
        margin: 0 auto 24px;
        border: 3px solid rgba(255, 255, 255, 0.09);
        border-top-color: #ff5c7a;
        border-right-color: #8a5cff;
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
      }
      .loader::after {
        content: "";
        position: absolute;
        inset: 8px;
        border-radius: inherit;
        background: rgba(255, 255, 255, 0.04);
      }
      h1 { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -0.35px; }
      p { margin: 10px 0 0; color: rgba(255, 255, 255, 0.64); font-size: 14px; line-height: 1.55; }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-top: 22px;
        padding: 8px 12px;
        color: rgba(255, 255, 255, 0.76);
        border: 1px solid rgba(255, 255, 255, 0.10);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.04);
        font-size: 12px;
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #22c55e;
        box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.13);
        animation: pulse 1.4s ease-in-out infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes pulse { 50% { opacity: 0.45; } }
      @media (prefers-reduced-motion: reduce) {
        .loader, .dot { animation: none; }
      }
    </style>
  </head>
  <body>
    <main class="card" aria-labelledby="loading-title">
      <div class="brand">
        <div class="logo" aria-hidden="true">🦞</div>
        <div class="brand-copy">
          <div class="brand-title">OpenClaw</div>
          <div class="brand-subtitle">Starter Kit for Diploi</div>
        </div>
      </div>
      <div class="loader" role="status" aria-label="Loading"></div>
      <h1 id="loading-title">Opening your dashboard</h1>
      <p>Creating a secure connection and preparing your OpenClaw workspace.</p>
      <div class="status"><span class="dot" aria-hidden="true"></span>Secure handoff in progress</div>
    </main>
  </body>
</html>`;