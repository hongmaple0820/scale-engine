/**
 * SCALE Engine Dashboard 2.0 — SPA Core
 * Client-side routing, theme management, SSE, i18n, shared utilities
 */
;(() => {
  'use strict'

  // ── Utilities ──────────────────────────────────────────────────────

  const $ = (sel, ctx = document) => ctx.querySelector(sel)
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)]

  function formatNumber(n) {
    if (n == null) return '0'
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
    return String(n)
  }

  function formatTime(ts) {
    if (!ts) return '-'
    const d = new Date(ts)
    return d.toLocaleString()
  }

  function relativeTime(ts) {
    return window.I18n?.relativeTime(ts) || fallbackRelativeTime(ts)
  }

  function fallbackRelativeTime(ts) {
    if (!ts) return '-'
    const diff = Date.now() - ts
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'
    return Math.floor(diff / 86400000) + 'd ago'
  }

  async function fetchJSON(url) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return await res.json()
    } catch (e) {
      console.warn(`Fetch failed: ${url}`, e)
      return null
    }
  }

  // ── i18n ───────────────────────────────────────────────────────────

  function t(key) {
    return window.I18n?.t(key) || key
  }

  function translateDocument() {
    $$('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n)
    })
    $$('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder)
    })
  }

  function updateLangToggle() {
    const btn = $('#lang-toggle')
    if (btn) btn.textContent = window.I18n?.getLang() === 'zh' ? '中文' : 'EN'
  }

  // ── Theme ──────────────────────────────────────────────────────────

  const html = document.documentElement
  const themeBtn = $('#theme-toggle')

  function getTheme() {
    return localStorage.getItem('scale-theme') || 'dark'
  }

  function setTheme(theme) {
    html.setAttribute('data-theme', theme)
    localStorage.setItem('scale-theme', theme)
    themeBtn.innerHTML = theme === 'dark' ? '&#9790;' : '&#9728;'
    window.dispatchEvent(new CustomEvent('themechange', { detail: theme }))
  }

  setTheme(getTheme())

  themeBtn.addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark')
  })

  // ── Language Toggle ────────────────────────────────────────────────

  const langBtn = $('#lang-toggle')
  updateLangToggle()

  langBtn.addEventListener('click', () => {
    const next = window.I18n?.getLang() === 'zh' ? 'en' : 'zh'
    window.I18n?.setLang(next)
  })

  window.addEventListener('langchange', () => {
    updateLangToggle()
    translateDocument()
    navigate(currentPage)
  })

  // ── Router ─────────────────────────────────────────────────────────

  const pageKeys = {
    overview: 'overview.title',
    workflow: 'workflow.title',
    topology: 'topology.title',
    monitoring: 'monitoring.title',
    costs: 'costs.title',
    documents: 'documents.title',
  }

  const pages = {
    overview: { render: () => window.DashboardPages?.overview?.() },
    workflow: { render: () => window.DashboardPages?.workflow?.() },
    topology: { render: () => window.DashboardPages?.topology?.() },
    monitoring: { render: () => window.DashboardPages?.monitoring?.() },
    costs: { render: () => window.DashboardPages?.costs?.() },
    documents: { render: () => window.DashboardPages?.documents?.() },
  }

  let currentPage = 'overview'
  let chartInstances = []

  function disposeCharts() {
    chartInstances.forEach(c => { try { c.dispose() } catch {} })
    chartInstances = []
  }

  function registerChart(instance) {
    chartInstances.push(instance)
  }

  function navigate(page) {
    if (!pages[page]) page = 'overview'
    if (currentPage === page && $('#app').children.length > 0) return

    disposeCharts()
    currentPage = page

    // Update nav
    $$('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page)
    })

    // Update title
    const titleEl = $('#page-title')
    if (titleEl) titleEl.textContent = t(pageKeys[page] || page)

    // Update URL
    history.replaceState(null, '', `#${page}`)

    // Render page
    const app = $('#app')
    app.innerHTML = `<div class="loading-placeholder">${t('common.loading')}</div>`
    try {
      const result = pages[page].render?.()
      if (result?.catch) result.catch(e => {
        app.innerHTML = `<div class="empty-state"><div class="icon">&#9888;</div><p>${e.message}</p></div>`
      })
    } catch (e) {
      app.innerHTML = `<div class="empty-state"><div class="icon">&#9888;</div><p>${e.message}</p></div>`
    }
  }

  // Nav click handler
  $$('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page))
  })

  // Hash routing
  function handleHash() {
    const hash = location.hash.slice(1) || 'overview'
    navigate(hash)
  }
  window.addEventListener('hashchange', handleHash)

  // ── SSE Connection ─────────────────────────────────────────────────

  let eventSource = null
  const sseDot = $('#sse-dot')
  const sseLabel = $('#sse-label')

  function connectSSE() {
    if (eventSource) { try { eventSource.close() } catch {} }

    eventSource = new EventSource('/api/stream')

    eventSource.addEventListener('init', (e) => {
      sseDot?.classList.add('connected')
      if (sseLabel) sseLabel.textContent = t('sse.live')
    })

    eventSource.addEventListener('event', (e) => {
      try {
        const data = JSON.parse(e.data)
        window.dispatchEvent(new CustomEvent('scale-event', { detail: data.event }))
      } catch {}
    })

    eventSource.addEventListener('heartbeat', () => {
      sseDot?.classList.add('connected')
      if (sseLabel) sseLabel.textContent = t('sse.live')
    })

    eventSource.onerror = () => {
      sseDot?.classList.remove('connected')
      if (sseLabel) sseLabel.textContent = t('sse.reconnecting')
      setTimeout(connectSSE, 5000)
    }
  }

  connectSSE()

  // ── Search ─────────────────────────────────────────────────────────

  const searchBox = $('#global-search')
  searchBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = searchBox.value.trim()
      if (q) window.dispatchEvent(new CustomEvent('search', { detail: q }))
    }
  })

  // ── Shared State ───────────────────────────────────────────────────

  window.Dashboard = {
    fetchJSON,
    formatNumber,
    formatTime,
    relativeTime,
    registerChart,
    getTheme,
    navigate,
    t,
    $,
    $$,
  }

  // ── Initial Render ─────────────────────────────────────────────────
  // Deferred to after page scripts load (see index.html)
})()
