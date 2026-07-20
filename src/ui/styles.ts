/**
 * The component stylesheet, as a string.
 *
 * It ships as a string rather than a `.css` file so that both renderers can
 * use it with no bundler configuration and no CSS-in-JS runtime: React inlines
 * it in a `<style>` element (which server-renders, so there is no flash of
 * unstyled content), and the web component adopts it into its shadow root.
 *
 * Every class is prefixed `hc-` and every colour reads from a custom property
 * on `.hc-root`, so a consumer can restyle the whole component by setting a
 * handful of variables, and nothing here can leak into or be broken by the
 * host page's styles.
 */
export const hoodConnectCss = `
.hc-root {
  --hc-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --hc-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --hc-radius: 14px;
  --hc-radius-sm: 9px;
  --hc-gap: 14px;

  --hc-bg: #ffffff;
  --hc-bg-inset: #f6f7f9;
  --hc-border: #e3e5ea;
  --hc-border-strong: #cbd0d8;
  --hc-text: #14161a;
  --hc-text-dim: #5c626e;
  --hc-text-faint: #8a909c;
  --hc-accent: #00c805;
  --hc-accent-text: #04310a;
  --hc-accent-soft: rgba(0, 200, 5, 0.12);
  --hc-danger: #d7263d;
  --hc-danger-soft: rgba(215, 38, 61, 0.1);
  --hc-focus: #1f6feb;
  --hc-shadow: 0 1px 2px rgba(16, 18, 22, 0.05), 0 8px 24px rgba(16, 18, 22, 0.06);

  box-sizing: border-box;
  font-family: var(--hc-font);
  color: var(--hc-text);
  background: var(--hc-bg);
  border: 1px solid var(--hc-border);
  border-radius: var(--hc-radius);
  box-shadow: var(--hc-shadow);
  padding: 20px;
  width: 100%;
  max-width: 420px;
  display: block;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.hc-root *, .hc-root *::before, .hc-root *::after { box-sizing: border-box; }

.hc-root[data-theme='dark'] {
  --hc-bg: #101114;
  --hc-bg-inset: #17191d;
  --hc-border: #26282e;
  --hc-border-strong: #3a3d45;
  --hc-text: #f2f3f5;
  --hc-text-dim: #a2a7b2;
  --hc-text-faint: #6d7280;
  --hc-accent: #00c805;
  --hc-accent-text: #04310a;
  --hc-accent-soft: rgba(0, 200, 5, 0.16);
  --hc-danger: #ff6b7d;
  --hc-danger-soft: rgba(255, 107, 125, 0.12);
  --hc-focus: #58a6ff;
  --hc-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 28px rgba(0, 0, 0, 0.36);
}

@media (prefers-color-scheme: dark) {
  .hc-root[data-theme='auto'] {
    --hc-bg: #101114;
    --hc-bg-inset: #17191d;
    --hc-border: #26282e;
    --hc-border-strong: #3a3d45;
    --hc-text: #f2f3f5;
    --hc-text-dim: #a2a7b2;
    --hc-text-faint: #6d7280;
    --hc-accent: #00c805;
    --hc-accent-text: #04310a;
    --hc-accent-soft: rgba(0, 200, 5, 0.16);
    --hc-danger: #ff6b7d;
    --hc-danger-soft: rgba(255, 107, 125, 0.12);
    --hc-focus: #58a6ff;
    --hc-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 28px rgba(0, 0, 0, 0.36);
  }
}

/* progress rail */
.hc-rail { display: flex; gap: 6px; margin-bottom: 18px; }
.hc-rail-item { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.hc-rail-bar {
  height: 3px;
  border-radius: 999px;
  background: var(--hc-border);
  transition: background 220ms ease;
}
.hc-rail-item[data-state='done'] .hc-rail-bar { background: var(--hc-accent); }
.hc-rail-item[data-state='active'] .hc-rail-bar {
  background: linear-gradient(90deg, var(--hc-accent) 0%, var(--hc-accent) 55%, var(--hc-border) 55%);
}
.hc-rail-label {
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--hc-text-faint);
  transition: color 220ms ease;
}
.hc-rail-item[data-state='active'] .hc-rail-label,
.hc-rail-item[data-state='done'] .hc-rail-label { color: var(--hc-text-dim); }

/* header */
.hc-eyebrow {
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--hc-text-faint);
  margin: 0 0 6px;
}
.hc-title { margin: 0 0 6px; font-size: 17px; font-weight: 650; letter-spacing: -0.01em; }
.hc-detail { margin: 0; color: var(--hc-text-dim); }
.hc-root[data-tone='error'] .hc-title { color: var(--hc-danger); }

/* spinner */
.hc-spinner {
  width: 14px; height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  display: inline-block;
  vertical-align: -2px;
  animation: hc-spin 700ms linear infinite;
}
.hc-title .hc-spinner { margin-right: 8px; color: var(--hc-accent); }
@keyframes hc-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .hc-spinner { animation-duration: 2.4s; }
  .hc-rail-bar, .hc-btn, .hc-route { transition: none; }
}

/* actions */
.hc-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: var(--hc-gap); }
.hc-btn {
  appearance: none;
  font: inherit;
  font-weight: 560;
  border-radius: var(--hc-radius-sm);
  border: 1px solid var(--hc-border-strong);
  background: var(--hc-bg-inset);
  color: var(--hc-text);
  padding: 9px 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-decoration: none;
  transition: background 140ms ease, border-color 140ms ease, transform 60ms ease, opacity 140ms ease;
}
.hc-btn:hover:not(:disabled) { border-color: var(--hc-text-faint); background: var(--hc-bg); }
.hc-btn:active:not(:disabled) { transform: translateY(1px); }
.hc-btn:focus-visible { outline: 2px solid var(--hc-focus); outline-offset: 2px; }
.hc-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.hc-btn[data-kind='primary'] {
  background: var(--hc-accent);
  border-color: var(--hc-accent);
  color: var(--hc-accent-text);
  flex: 1 1 auto;
}
.hc-btn[data-kind='primary']:hover:not(:disabled) { filter: brightness(1.06); background: var(--hc-accent); }
.hc-btn[data-kind='ghost'] { background: transparent; border-color: transparent; color: var(--hc-text-dim); }
.hc-btn[data-kind='ghost']:hover:not(:disabled) { background: var(--hc-bg-inset); border-color: var(--hc-border); }

/* wallet choices */
.hc-wallets { display: flex; flex-direction: column; gap: 8px; margin-top: var(--hc-gap); }
.hc-wallet {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  justify-content: flex-start;
  padding: 10px 12px;
}
.hc-wallet-icon {
  width: 22px; height: 22px; border-radius: 6px; flex: none;
  background: var(--hc-border); object-fit: contain;
}
.hc-wallet-name { flex: 1; text-align: left; }

/* details */
.hc-details {
  margin: var(--hc-gap) 0 0;
  border: 1px solid var(--hc-border);
  border-radius: var(--hc-radius-sm);
  background: var(--hc-bg-inset);
  padding: 4px 12px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 12px;
}
.hc-details dt { color: var(--hc-text-faint); font-size: 12px; padding: 7px 0; }
.hc-details dd { margin: 0; padding: 7px 0; text-align: right; font-size: 12px; }
.hc-details dd.hc-mono { font-family: var(--hc-mono); }
.hc-details a { color: inherit; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: var(--hc-border-strong); }
.hc-details a:hover { text-decoration-color: var(--hc-accent); }
.hc-details a:focus-visible { outline: 2px solid var(--hc-focus); outline-offset: 2px; border-radius: 3px; }

/* funding routes */
.hc-routes { display: flex; flex-direction: column; gap: 8px; margin-top: var(--hc-gap); }
.hc-route {
  display: block;
  border: 1px solid var(--hc-border);
  border-radius: var(--hc-radius-sm);
  padding: 11px 13px;
  text-decoration: none;
  color: inherit;
  background: var(--hc-bg);
  transition: border-color 140ms ease, background 140ms ease;
}
.hc-route:hover { border-color: var(--hc-accent); background: var(--hc-accent-soft); }
.hc-route:focus-visible { outline: 2px solid var(--hc-focus); outline-offset: 2px; }
.hc-route-label { font-weight: 560; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.hc-route-desc { color: var(--hc-text-dim); font-size: 12px; margin-top: 2px; }
.hc-route-arrow { color: var(--hc-text-faint); flex: none; }

/* receive panel */
.hc-receive {
  margin-top: var(--hc-gap);
  border: 1px solid var(--hc-border);
  border-radius: var(--hc-radius-sm);
  background: var(--hc-bg-inset);
  padding: 13px;
}
.hc-receive-head { font-weight: 560; margin-bottom: 4px; }
.hc-receive-desc { color: var(--hc-text-dim); font-size: 12px; margin-bottom: 10px; }
.hc-receive-body { display: flex; gap: 12px; align-items: center; }
.hc-qr { flex: none; background: #ffffff; padding: 6px; border-radius: 8px; line-height: 0; }
.hc-qr svg { display: block; width: 92px; height: 92px; }
.hc-receive-fields { flex: 1; min-width: 0; }
.hc-address {
  font-family: var(--hc-mono);
  font-size: 11px;
  word-break: break-all;
  background: var(--hc-bg);
  border: 1px solid var(--hc-border);
  border-radius: 7px;
  padding: 7px 9px;
  color: var(--hc-text-dim);
}
.hc-copy { margin-top: 8px; width: 100%; padding: 7px 12px; font-size: 13px; }
.hc-copy[data-copied='true'] { color: var(--hc-accent); border-color: var(--hc-accent); }

/* error banner */
.hc-alert {
  margin-top: var(--hc-gap);
  border: 1px solid var(--hc-danger);
  background: var(--hc-danger-soft);
  color: var(--hc-text);
  border-radius: var(--hc-radius-sm);
  padding: 10px 12px;
  font-size: 12.5px;
}
.hc-alert-code { font-family: var(--hc-mono); color: var(--hc-danger); }

.hc-sr {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (max-width: 380px) {
  .hc-root { padding: 16px; }
  .hc-receive-body { flex-direction: column; align-items: stretch; }
  .hc-qr { align-self: center; }
  .hc-actions .hc-btn { flex: 1 1 100%; }
}
`
