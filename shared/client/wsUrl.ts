/**
 * URL normalization shared by mobile + fps + overlay.
 *
 * Auto-upgrade to https/wss when the page itself is served over https:
 * a browser served HTTPS will block any plain http/ws sub-resource
 * (Mixed Content). Without this auto-upgrade, an `http://` engine URL
 * pasted into a Vercel-hosted client silently dies. This is the #1
 * cross-origin deployment failure mode for this stack.
 *
 * The mobile build was the first to land this fix (commit 8b069e4
 * "fix: batch B — mixed content"); the fps build had a strict-prefix
 * version that did not auto-upgrade. Consolidating here also closes
 * that latent bug in fps.
 */

function isSecurePage(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:';
}

export function normalizeHttpUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const secure = isSecurePage();
  if (trimmed.startsWith('https://')) {
    return trimmed.replace(/\/$/, '');
  }
  if (trimmed.startsWith('http://')) {
    if (secure) {
      return 'https://' + trimmed.slice('http://'.length).replace(/\/$/, '');
    }
    return trimmed.replace(/\/$/, '');
  }
  if (trimmed.startsWith('ws://')) {
    const host = trimmed.slice('ws://'.length).replace(/\/$/, '');
    return (secure ? 'https://' : 'http://') + host;
  }
  if (trimmed.startsWith('wss://')) {
    return 'https://' + trimmed.slice('wss://'.length).replace(/\/$/, '');
  }
  return (secure ? 'https://' : 'http://') + trimmed.replace(/\/$/, '');
}

export function normalizeWsUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const secure = isSecurePage();
  if (trimmed.startsWith('wss://')) {
    return trimmed.replace(/\/$/, '');
  }
  if (trimmed.startsWith('ws://')) {
    if (secure) {
      return 'wss://' + trimmed.slice('ws://'.length).replace(/\/$/, '');
    }
    return trimmed.replace(/\/$/, '');
  }
  if (trimmed.startsWith('http://')) {
    const host = trimmed.slice('http://'.length).replace(/\/$/, '');
    return (secure ? 'wss://' : 'ws://') + host;
  }
  if (trimmed.startsWith('https://')) {
    return 'wss://' + trimmed.slice('https://'.length).replace(/\/$/, '');
  }
  // Bare host:port
  return (secure ? 'wss://' : 'ws://') + trimmed.replace(/\/$/, '');
}
