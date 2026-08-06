// The one screen createGameShell can't show: it's never built when startup
// itself fails before any of that wiring runs (R2/CLAUDE.md -- design for
// failure on every external call).
export function renderStartupError(container, message) {
  container.textContent = '';
  const el = document.createElement('div');
  el.style.cssText =
    'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:12px;color:#fff;font-family:system-ui,sans-serif;text-align:center;background:#000;';
  const heading = document.createElement('h1');
  heading.style.cssText = 'margin:0;font-size:1.8rem;';
  heading.textContent = "Couldn't start";
  const body = document.createElement('p');
  body.style.opacity = '0.8';
  body.textContent = message;
  el.append(heading, body);
  container.appendChild(el);
}
