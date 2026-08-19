/**
 * Unit tests for the per-domain embed-refusal preference helpers.
 * Imports browser-globals first (the repo's standard shim) and overlays a
 * real in-memory localStorage so the helpers can round-trip values.
 */
import './browser-globals.ts'
import { describe, it, expect, beforeEach } from 'vitest'
import { getEmbedPref, setEmbedPref, clearEmbedPref, hostnameOf } from '../src/client/embed-pref.ts'

/** In-memory localStorage replacement (the browser-globals shim is read-only). */
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null { return this.store.get(key) ?? null }
  setItem(key: string, value: string): void { this.store.set(key, value) }
  removeItem(key: string): void { this.store.delete(key) }
  clear(): void { this.store.clear() }
  get length(): number { return this.store.size }
  key(_index: number): string | null { return null }
}

const memoryStorage = new MemoryStorage()
// Replace the shim's no-op localStorage with a working one for these tests.
;(globalThis as Record<string, unknown>).localStorage = memoryStorage

describe('embed-pref', () => {
  beforeEach(() => {
    memoryStorage.clear()
  })

  it('hostnameOf extracts the hostname from a valid URL', () => {
    expect(hostnameOf('https://arxiv.org/abs/2401.10001')).toBe('arxiv.org')
    expect(hostnameOf('http://localhost:3000/path')).toBe('localhost')
    expect(hostnameOf('https://platform.qianwenai.com/home/bill')).toBe('platform.qianwenai.com')
  })

  it('hostnameOf returns "" for a malformed URL', () => {
    expect(hostnameOf('not-a-url')).toBe('')
    expect(hostnameOf('')).toBe('')
  })

  it('getEmbedPref returns null when no memory exists', () => {
    expect(getEmbedPref('arxiv.org')).toBeNull()
  })

  it('setEmbedPref + getEmbedPref round-trips a valid token', () => {
    setEmbedPref('arxiv.org', 'external')
    expect(getEmbedPref('arxiv.org')).toBe('external')
    setEmbedPref('arxiv.org', 'anyway')
    expect(getEmbedPref('arxiv.org')).toBe('anyway')
  })

  it('setEmbedPref ignores an empty hostname', () => {
    setEmbedPref('', 'external')
    expect(getEmbedPref('')).toBeNull()
  })

  it('getEmbedPref returns null for an unrecognized stored value', () => {
    localStorage.setItem('dsh-better-sidebar:embed-pref:arxiv.org', 'bogus')
    expect(getEmbedPref('arxiv.org')).toBeNull()
  })

  it('clearEmbedPref removes the stored value', () => {
    setEmbedPref('arxiv.org', 'external')
    clearEmbedPref('arxiv.org')
    expect(getEmbedPref('arxiv.org')).toBeNull()
  })

  it('clearEmbedPref is idempotent', () => {
    clearEmbedPref('arxiv.org')
    clearEmbedPref('arxiv.org')
    expect(getEmbedPref('arxiv.org')).toBeNull()
  })

  it('clearEmbedPref ignores an empty hostname', () => {
    // Should not throw.
    clearEmbedPref('')
  })

  it('different hostnames have independent memories', () => {
    setEmbedPref('arxiv.org', 'external')
    setEmbedPref('platform.qianwenai.com', 'anyway')
    expect(getEmbedPref('arxiv.org')).toBe('external')
    expect(getEmbedPref('platform.qianwenai.com')).toBe('anyway')
    clearEmbedPref('arxiv.org')
    expect(getEmbedPref('arxiv.org')).toBeNull()
    expect(getEmbedPref('platform.qianwenai.com')).toBe('anyway')
  })
})
