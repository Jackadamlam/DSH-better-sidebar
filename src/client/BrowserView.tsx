/**
 * The built-in browser tab: an address bar plus a sandboxed iframe.
 *
 * Security model (see browser.ts + the sandbox tokens below): the iframe is
 * ALWAYS sandboxed without `allow-same-origin` (opaque origin — the visited
 * page can never sit on the GUI's origin, read its storage, or reach
 * /sidebar/api) and without `allow-top-navigation` (a page must not hijack
 * the GUI). The address bar only accepts http(s) and refuses loopback /
 * the GUI's own origin. The side card setting "关闭浏览器沙箱" drops the
 * sandbox attribute entirely for fully trusted sites — the visited page then
 * runs with the GUI's own origin and full session access, so a persistent
 * warning bar renders while it is off.
 *
 * The URL is persisted onto the tab (path/title via the patchTab reducer)
 * so a reload restores the visited page; the back/forward stack only tracks
 * address-bar navigations (in-frame link clicks are cross-origin and
 * invisible — a documented limitation).
 *
 * Embed-refusal handling (X-Frame-Options / frame-ancestors): the host
 * probe detects blocked sites before the iframe loads, and the client shows
 * a card with two honest actions — "open in browser" (the reliable path)
 * or "try loading directly" (usually still blocked by the browser). The
 * user's choice is remembered per domain (localStorage) so subsequent
 * visits auto-apply: remembered "external" shows a compact bar with a
 * one-click "open now"; remembered "anyway" loads the iframe directly with
 * a thin "change choice" bar.
 */
import { useEffect, useState } from 'react'
import {
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconLinkOutline14,
  IconRefreshOutline14,
  IconRightUpOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { VscLinkExternal } from 'react-icons/vsc'
import { api } from './api.ts'
import { embeddabilityOf, normalizeBrowserUrl } from './browser.ts'
import { patchTab } from './state.ts'
import { SandboxStatusBar } from './SandboxStatusBar.tsx'
import { t } from './locales.ts'
import { getEmbedPref, setEmbedPref, clearEmbedPref, hostnameOf, type EmbedPref } from './embed-pref.ts'
import type { TabComponentProps } from './service.ts'
import css from './sidebar.module.css'

/**
 * The browser iframe sandbox tokens. NO allow-same-origin (opaque origin —
 * no GUI storage/API access), NO allow-top-navigation (a browsed page must
 * not hijack the GUI). allow-forms/allow-popups/allow-downloads/allow-modals
 * keep login flows working; allow-popups-to-escape-sandbox lets OAuth
 * popups open as normal tabs (they are cross-origin to the GUI either way).
 */
export const BROWSER_IFRAME_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-downloads allow-modals allow-popups-to-escape-sandbox'

export function BrowserView(props: TabComponentProps) {
  const { store, tab } = props
  // The current address (initialized from the persisted tab.path so a
  // reload restores the visited page).
  const [url, setUrl] = useState<string | undefined>(tab.path)
  const [input, setInput] = useState<string>(tab.path ?? '')
  /** Blocked/invalid hint shown under the address bar (null = none). */
  const [message, setMessage] = useState<string | null>(null)
  /** Address-bar navigation history (in-frame clicks are not tracked). */
  const [history, setHistory] = useState<string[]>(tab.path !== undefined ? [tab.path] : [])
  const [cursor, setCursor] = useState<number>(tab.path !== undefined ? 0 : -1)
  /** Bumped on reload to remount the iframe (also remounts on sandbox flip). */
  const [reloadKey, setReloadKey] = useState(0)
  /** TEMPORARY sandbox unlock for THIS surface only (never writes the global
   *  side card setting; lasts until the tab unmounts or the user restores). */
  const [localUnlock, setLocalUnlock] = useState(false)
  const noSandbox = store.getPrefs().browserNoSandbox === true || localUnlock
  /** A site that refuses to be embedded (X-Frame-Options / frame-ancestors):
   *  the probe verdict shown instead of the blank iframe. */
  const [blocked, setBlocked] = useState<string | null>(null)
  /** The user asked to load the refused site anyway (keeps the plain iframe). */
  const [forceEmbed, setForceEmbed] = useState(false)
  /** The remembered per-domain choice (from localStorage). */
  const [remembered, setRemembered] = useState<EmbedPref | null>(null)
  /** The user clicked "change" on a remembered bar, dismissing it for this
   *  navigation (shows the full card again). */
  const [dismissed, setDismissed] = useState(false)

  // Probe every navigation (address bar, history, restored path): when the
  // target forbids embedding, apply the remembered choice or show the card.
  // A failed probe (unreachable) keeps the plain iframe.
  useEffect(() => {
    if (url === undefined) return
    let cancelled = false
    setBlocked(null)
    setForceEmbed(false)
    setDismissed(false)
    const host = hostnameOf(url)
    const pref = host !== '' ? getEmbedPref(host) : null
    setRemembered(pref)
    void api.browserProbe(url).then((probe) => {
      if (!cancelled && embeddabilityOf(probe) === 'blocked') {
        setBlocked(url)
        // Auto-apply remembered choice.
        if (pref === 'anyway') setForceEmbed(true)
      }
    }).catch(() => { /* unreachable: keep the plain iframe */ })
    return () => { cancelled = true }
  }, [url])

  const persist = (nextUrl: string): void => {
    let host = nextUrl
    try { host = new URL(nextUrl).hostname } catch { /* keep the URL as title */ }
    store.reduce(state => patchTab(state, tab.id, { path: nextUrl, title: host }))
  }

  const navigateTo = (raw: string): void => {
    const result = normalizeBrowserUrl(raw, window.location.origin)
    if (result.kind === 'ok') {
      const next = result.url
      setUrl(next)
      setInput(next)
      setMessage(null)
      // Push onto the stack, dropping any stale forward entries.
      setHistory(previous => [...previous.slice(0, cursor + 1), next])
      setCursor(previous => previous + 1)
      setReloadKey(key => key + 1)
      persist(next)
      return
    }
    setMessage(result.kind === 'invalid'
      ? t('browserInvalid')
      : result.reason === 'scheme' ? t('browserBlockedScheme')
      : t('browserBlockedLoopback'))
  }

  const goBack = (): void => {
    if (cursor <= 0) return
    const next = history[cursor - 1]!
    setCursor(cursor - 1)
    setUrl(next)
    setInput(next)
    setReloadKey(key => key + 1)
  }

  const goForward = (): void => {
    if (cursor >= history.length - 1) return
    const next = history[cursor + 1]!
    setCursor(cursor + 1)
    setUrl(next)
    setInput(next)
    setReloadKey(key => key + 1)
  }

  const openExternal = (remember: boolean): void => {
    if (url !== undefined) window.open(url, '_blank', 'noopener')
    if (remember && url !== undefined) {
      const host = hostnameOf(url)
      if (host !== '') {
        setEmbedPref(host, 'external')
        setRemembered('external')
      }
    }
  }

  const loadAnyway = (remember: boolean): void => {
    if (remember && url !== undefined) {
      const host = hostnameOf(url)
      if (host !== '') {
        setEmbedPref(host, 'anyway')
        setRemembered('anyway')
      }
    }
    setForceEmbed(true)
  }

  const changeChoice = (): void => {
    if (url !== undefined) {
      const host = hostnameOf(url)
      if (host !== '') clearEmbedPref(host)
    }
    setRemembered(null)
    setForceEmbed(false)
    setDismissed(true)
  }

  // Render mode selection.
  const mode = url === undefined ? 'start'
    : blocked !== null && !dismissed
      ? (remembered === 'external' ? 'external-bar'
         : remembered === 'anyway' || forceEmbed ? 'frame-forced'
         : 'card')
      : 'frame'

  return (
    <div className={css.browser}>
      <div className={css.browserBar}>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('browserBack')}
          title={t('browserBack')}
          disabled={cursor <= 0}
          onClick={goBack}
        >
          <IconChevronLeftOutline14 />
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('browserForward')}
          title={t('browserForward')}
          disabled={cursor >= history.length - 1}
          onClick={goForward}
        >
          <IconChevronRightOutline14 />
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('refresh')}
          title={t('refresh')}
          onClick={() => { setReloadKey(key => key + 1) }}
        >
          <IconRefreshOutline14 />
        </button>
        <input
          className={css.browserInput}
          value={input}
          placeholder={t('browserPlaceholder')}
          spellCheck={false}
          onChange={event => { setInput(event.target.value) }}
          onKeyDown={event => {
            if (event.key === 'Enter') navigateTo(input)
          }}
        />
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('browserGo')}
          title={t('browserGo')}
          onClick={() => { navigateTo(input) }}
        >
          <IconLinkOutline14 />
        </button>
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('browserOpenExternal')}
          title={t('browserOpenExternal')}
          disabled={url === undefined}
          onClick={() => {
            if (url !== undefined) window.open(url, '_blank', 'noopener')
          }}
        >
          <VscLinkExternal size={15} />
        </button>
      </div>
      {message !== null && <div className={css.browserMessage}>{message}</div>}
      <SandboxStatusBar
        sandboxed={!noSandbox}
        local={localUnlock}
        dangerCopy={t('browserNoSandboxWarning')}
        onUnlock={() => { setLocalUnlock(true) }}
        onRestore={() => { setLocalUnlock(false) }}
      />
      {mode === 'start' ? (
        <div className={css.browserStart}>{t('browserStart')}</div>
      ) : mode === 'external-bar' ? (
        <BrowserRememberedExternal
          url={url!}
          onOpenNow={() => { window.open(url!, '_blank', 'noopener') }}
          onChange={changeChoice}
        />
      ) : mode === 'card' ? (
        <BrowserEmbedBlocked
          url={blocked!}
          onOpenInBrowser={() => { openExternal(false) }}
          onOpenInBrowserAndRemember={() => { openExternal(true) }}
          onLoadAnyway={() => { loadAnyway(false) }}
          onLoadAnywayAndRemember={() => { loadAnyway(true) }}
        />
      ) : (
        <>
          {blocked !== null && (
            <div className={css.browserForcedBar}>
              <span>{t('browserForcedBanner')}</span>
              <button type="button" className={css.browserForcedButton} onClick={changeChoice}>
                {t('browserChangeChoice')}
              </button>
            </div>
          )}
          <iframe
            key={`${reloadKey}:${noSandbox ? 'ns' : 'sb'}`}
            className={css.browserFrame}
            src={url}
            sandbox={noSandbox ? undefined : BROWSER_IFRAME_SANDBOX}
            referrerPolicy="no-referrer"
            allow=""
            title={url}
          />
        </>
      )}
    </div>
  )
}

/**
 * The compact bar shown when the user has remembered "open in browser" for
 * this domain. One-click "open now" plus a "change" link to revert to the
 * full card.
 */
export function BrowserRememberedExternal(props: {
  url: string
  onOpenNow: () => void
  onChange: () => void
}) {
  const { url, onOpenNow, onChange } = props
  let host = url
  try { host = new URL(url).hostname } catch { /* keep the raw URL */ }
  return (
    <div className={css.browserRememberBar}>
      <IconRightUpOutline16 size={14} />
      <span>{t('browserRememberedExternal', { host })}</span>
      <button type="button" className={css.browserRememberButton} onClick={onOpenNow}>
        {t('browserOpenNow')}
      </button>
      <button type="button" className={css.browserRememberChange} onClick={onChange}>
        {t('browserChangeChoice')}
      </button>
    </div>
  )
}

/**
 * The embed-refusal panel: shown when the probed site forbids being
 * displayed inside other pages (X-Frame-Options / frame-ancestors) — the
 * iframe would only show the browser's "refused to connect" blank. Explains
 * the reason and offers the real-browser open plus an honest "try loading
 * directly" escape (usually still blocked). The user's choice is remembered
 * per domain when the checkbox is checked.
 * Exported so the copy and the actions are testable without a DOM.
 */
export function BrowserEmbedBlocked(props: {
  url: string
  onOpenInBrowser: () => void
  onOpenInBrowserAndRemember: () => void
  onLoadAnyway: () => void
  onLoadAnywayAndRemember: () => void
}) {
  const { url, onOpenInBrowser, onOpenInBrowserAndRemember, onLoadAnyway, onLoadAnywayAndRemember } = props
  const [remember, setRemember] = useState(false)
  let host = url
  try { host = new URL(url).hostname } catch { /* keep the raw URL */ }
  return (
    <div className={css.browserBlocked}>
      <IconWarningOutline16 size={16} />
      <div className={css.browserBlockedTitle}>{t('browserEmbedBlocked', { host })}</div>
      <div className={css.browserBlockedDesc}>{t('browserEmbedBlockedDesc')}</div>
      <div className={css.browserBlockedActions}>
        <button
          type="button"
          className={css.browserBlockedButtonPrimary}
          onClick={remember ? onOpenInBrowserAndRemember : onOpenInBrowser}
        >
          {t('browserOpenExternal')}
        </button>
        <button
          type="button"
          className={css.browserBlockedButton}
          onClick={remember ? onLoadAnywayAndRemember : onLoadAnyway}
        >
          {t('browserEmbedAnyway')}
        </button>
      </div>
      <label className={css.browserRememberCheckbox}>
        <input
          type="checkbox"
          checked={remember}
          onChange={event => { setRemember(event.target.checked) }}
        />
        <span>{t('browserRememberChoice')}</span>
      </label>
    </div>
  )
}
