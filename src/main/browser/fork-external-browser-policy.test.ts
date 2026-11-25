import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserError } from './browser-error'
import {
  assertInternalBrowserAllowedForAgent,
  shouldBlockAgentInternalBrowser
} from './fork-external-browser-policy'

describe('fork-external-browser-policy', () => {
  const savedAllow = process.env.ORCA_ALLOW_INTERNAL_BROWSER
  const savedBlock = process.env.ORCA_BLOCK_INTERNAL_BROWSER
  const savedVitest = process.env.VITEST

  beforeEach(() => {
    delete process.env.ORCA_ALLOW_INTERNAL_BROWSER
    process.env.ORCA_BLOCK_INTERNAL_BROWSER = '1'
  })

  afterEach(() => {
    if (savedAllow === undefined) {
      delete process.env.ORCA_ALLOW_INTERNAL_BROWSER
    } else {
      process.env.ORCA_ALLOW_INTERNAL_BROWSER = savedAllow
    }
    if (savedBlock === undefined) {
      delete process.env.ORCA_BLOCK_INTERNAL_BROWSER
    } else {
      process.env.ORCA_BLOCK_INTERNAL_BROWSER = savedBlock
    }
    if (savedVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = savedVitest
    }
  })

  it('blocks default agent and runtime calls with guidance pointing to dusk and browser-use', () => {
    expect(shouldBlockAgentInternalBrowser()).toBe(true)
    expect(shouldBlockAgentInternalBrowser({ clientKind: 'runtime' })).toBe(true)

    let caught: unknown
    try {
      assertInternalBrowserAllowedForAgent({ clientKind: 'runtime' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(BrowserError)
    const message = caught instanceof Error ? caught.message : ''
    expect(message).toContain('dusk')
    expect(message).toContain('browser-use')
    expect(message).toContain('ORCA_ALLOW_INTERNAL_BROWSER=1')
  })

  it('allows internal browser when ORCA_ALLOW_INTERNAL_BROWSER=1 or ORCA_BLOCK_INTERNAL_BROWSER=0', () => {
    process.env.ORCA_ALLOW_INTERNAL_BROWSER = '1'
    expect(shouldBlockAgentInternalBrowser()).toBe(false)
    expect(() => assertInternalBrowserAllowedForAgent()).not.toThrow()

    delete process.env.ORCA_ALLOW_INTERNAL_BROWSER
    process.env.ORCA_BLOCK_INTERNAL_BROWSER = '0'
    expect(shouldBlockAgentInternalBrowser()).toBe(false)
    expect(() => assertInternalBrowserAllowedForAgent()).not.toThrow()
  })

  it('allows mobile screencast and offscreen page-link callers', () => {
    expect(shouldBlockAgentInternalBrowser({ clientKind: 'mobile' })).toBe(false)
    expect(shouldBlockAgentInternalBrowser({ opensPageLink: true })).toBe(false)
    expect(() => assertInternalBrowserAllowedForAgent({ clientKind: 'mobile' })).not.toThrow()
    expect(() => assertInternalBrowserAllowedForAgent({ opensPageLink: true })).not.toThrow()
  })

  it('stays unblocked under Vitest unless ORCA_BLOCK_INTERNAL_BROWSER=1 is set', () => {
    delete process.env.ORCA_BLOCK_INTERNAL_BROWSER
    process.env.VITEST = 'true'
    expect(shouldBlockAgentInternalBrowser()).toBe(false)
    expect(() => assertInternalBrowserAllowedForAgent()).not.toThrow()
  })
})
