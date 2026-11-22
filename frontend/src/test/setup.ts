import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// No test may reach a real network. The default backend is "offline"; tests that need it up stub fetch themselves.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network is disabled in tests'))))
})

afterEach(() => {
  cleanup()
})

// jsdom lacks these browser APIs, which the hero's canvas field and layout measuring rely on.
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

// Following an in-page anchor makes jsdom call scrollTo, which it only implements as a stub that logs.
window.scrollTo = (() => {}) as typeof window.scrollTo

vi.stubGlobal('ResizeObserver', ObserverStub)
vi.stubGlobal('IntersectionObserver', ObserverStub)

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
})

// No canvas implementation in jsdom: the heat field then skips drawing, which is what these tests want.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
