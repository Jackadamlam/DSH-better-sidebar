/**
 * Per-domain memory for embed-refusal handling: when the sidebar browser
 * encounters a site that refuses embedding (X-Frame-Options / frame-ancestors),
 * the user's choice (open in browser / try loading directly) is persisted
 * per hostname so the next visit auto-applies instead of showing the card
 * again. Kept dependency-free so it is unit-testable.
 */

export type EmbedPref = 'external' | 'anyway'

const STORAGE_KEY_PREFIX = 'dsh-better-sidebar:embed-pref:'

/**
 * Read the remembered choice for one hostname. Returns null when absent
 * or the stored value is not a recognized token (defensive against future
 * schema changes).
 */
export function getEmbedPref(hostname: string): EmbedPref | null {
  if (hostname === '') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + hostname)
    if (raw === 'external' || raw === 'anyway') return raw
    return null
  } catch {
    // Storage unavailable (private mode / quota exceeded / disabled): treat
    // as no memory. The caller falls back to showing the card.
    return null
  }
}

/**
 * Persist one choice for one hostname. Overwrites any prior value.
 */
export function setEmbedPref(hostname: string, value: EmbedPref): void {
  if (hostname === '') return
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + hostname, value)
  } catch {
    // Storage write failure: silently ignore. The user will see the card
    // again next time, which is the safe fallback.
  }
}

/**
 * Clear the remembered choice for one hostname. Idempotent.
 */
export function clearEmbedPref(hostname: string): void {
  if (hostname === '') return
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + hostname)
  } catch {
    // Best effort.
  }
}

/**
 * Extract the hostname from one URL. Returns '' when the URL is malformed
 * so callers can short-circuit on the empty string.
 */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
