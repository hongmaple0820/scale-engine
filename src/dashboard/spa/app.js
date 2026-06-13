/**
 * SCALE Engine Dashboard 2.0 — SPA Core
 * Client-side routing, theme management, SSE, i18n, shared utilities
 */
;(() => {
  'use strict'

  // ── Utilities ──────────────────────────────────────────────────────

  const $ = (sel, ctx = document) => ctx.querySelector(sel)
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)]

  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag)
    if (options.id) node.id = options.id
    if (options.className) node.className = options.className
    if (options.text != null) node.textContent = String(options.text)
    if (options.type != null) node.type = String(options.type)
    if (options.value != null) node.value = String(options.value)
    if (options.placeholder != null) node.placeholder = String(options.placeholder)
    if (options.title != null) node.title = String(options.title)
    if (options.disabled != null) node.disabled = Boolean(options.disabled)
    if (options.checked != null) node.checked = Boolean(options.checked)
    if (options.dataset) {
      for (const [key, value] of Object.entries(options.dataset)) node.dataset[key] = String(value)
    }
    if (options.attrs) {
      for (const [key, value] of Object.entries(options.attrs)) {
        if (value == null || value === false) continue
        node.setAttribute(key, value === true ? '' : String(value))
      }
    }
    if (options.style) Object.assign(node.style, options.style)
    for (const child of children) {
      if (child == null) continue
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
    }
    return node
  }

  function safeClassToken(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '-')
  }

  function textBlock(message, className = 'text-muted text-sm') {
    return el('div', { className, text: message })
  }

  function renderText(container, message, className = 'text-muted text-sm') {
    container.replaceChildren(textBlock(message, className))
  }

  async function copyText(text, button, options = {}) {
    await navigator.clipboard.writeText(String(text ?? ''))
    if (!button) return
    const original = button.textContent
    button.textContent = options.copiedLabel ?? t('common.copied')
    setTimeout(() => { button.textContent = original }, options.resetMs ?? 1500)
  }

  function downloadText(name, text, type = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([String(text ?? '')], { type }))
    const link = el('a', { attrs: { href: url, download: name } })
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function dataNote(items) {
    return el('div', { className: 'data-note' }, items.map(item => {
      if (typeof item === 'string') return el('span', { text: item })
      return el(item.strong ? 'strong' : 'span', { text: item.text })
    }))
  }

  let pageCleanup = null

  function setPageCleanup(cleanup) {
    if (pageCleanup) {
      try {
        pageCleanup()
      } catch (error) {
        observeRecoverableError(error)
      }
    }
    pageCleanup = typeof cleanup === 'function' ? cleanup : null
  }

  function autoRefreshControl(onRefresh, options = {}) {
    const intervalMs = options.intervalMs ?? 30000
    const status = el('span', { className: 'text-muted text-sm', text: t('common.autoRefreshOff') })
    const checkbox = el('input', { type: 'checkbox', title: t('common.autoRefresh') })
    const label = el('label', { className: 'field-label auto-refresh-control', title: t('common.autoRefreshHint') }, [
      checkbox,
      el('span', { text: t('common.autoRefresh') }),
      status,
    ])
    let timer = null
    let inFlight = false

    async function tick() {
      if (inFlight) return
      inFlight = true
      status.textContent = t('common.refreshing')
      try {
        await onRefresh({ auto: true })
        status.textContent = `${t('common.lastAutoRefresh')}: ${formatTime(Date.now())}`
      } catch (error) {
        observeRecoverableError(error)
        status.textContent = t('common.failed')
      } finally {
        inFlight = false
      }
    }

    function stop() {
      if (timer) clearInterval(timer)
      timer = null
      checkbox.checked = false
      status.textContent = t('common.autoRefreshOff')
    }

    checkbox.addEventListener('change', () => {
      if (!checkbox.checked) {
        stop()
        return
      }
      status.textContent = t('common.autoRefreshOn')
      timer = setInterval(tick, intervalMs)
    })

    setPageCleanup(stop)
    return label
  }

  function emptyState(message, icon) {
    const children = []
    if (icon) children.push(el('div', { className: 'icon', text: icon }))
    children.push(el('p', { text: message }))
    return el('div', { className: 'empty-state' }, children)
  }

  function metricCard(label, value, cls = '') {
    const valueClass = ['metric-value', cls].filter(Boolean).join(' ')
    return el('div', { className: 'metric-card' }, [
      el('div', { className: 'metric-label', text: label }),
      el('div', { className: valueClass, text: value }),
    ])
  }

  function chartContainer(title, chartId) {
    return el('div', { className: 'chart-container' }, [
      el('div', { className: 'chart-header' }, [
        el('span', { className: 'chart-title', text: title }),
      ]),
      el('div', { className: 'chart-area', id: chartId }),
    ])
  }

  function panel(title, bodyId, options = {}) {
    const titleChildren = [document.createTextNode(title)]
    if (options.titleSuffix) titleChildren.push(document.createTextNode(' '), options.titleSuffix)
    return el('div', { className: ['panel', options.className].filter(Boolean).join(' ') }, [
      el('div', { className: 'panel-title' }, titleChildren),
      el('div', { id: bodyId, className: options.bodyClassName ?? '' }),
    ])
  }

  function dataTable(headers, rows) {
    return el('table', { className: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, headers.map(header => el('th', { text: header }))),
      ]),
      el('tbody', {}, rows),
    ])
  }

  function observeRecoverableError(error) {
    void error
  }

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
      observeRecoverableError(e)
      return null
    }
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || 'Unknown error')
  }

  function renderLoading(container, message = t('common.loading')) {
    container.replaceChildren(el('div', { className: 'loading-placeholder', text: message }))
  }

  function renderEmptyState(container, message, options = {}) {
    container.replaceChildren(emptyState(message, options.icon))
  }

  // ── i18n ───────────────────────────────────────────────────────────

  function t(key, params) {
    return window.I18n?.t(key, params) || key
  }

  function runtimeLabel(scope, value) {
    if (value == null || value === '') return '-'
    const normalized = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!normalized) return '-'
    const key = `runtime.${scope}.${normalized}`
    const translated = t(key)
    return translated === key ? humanizeRuntimeValue(value) : translated
  }

  function humanizeRuntimeValue(value) {
    return String(value ?? '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase())
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
    if (themeBtn) themeBtn.textContent = theme === 'dark' ? '\u263e' : '\u2600'
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
    navigate(currentPage, { force: true })
  })

  // ── Router ─────────────────────────────────────────────────────────

  const pageKeys = {
    overview: 'overview.title',
    workflow: 'workflow.title',
    topology: 'topology.title',
    monitoring: 'monitoring.title',
    costs: 'costs.title',
    documents: 'documents.title',
    knowledge: 'knowledge.title',
    prompts: 'prompts.title',
  }

  const pages = {
    overview: { render: () => window.DashboardPages?.overview?.() },
    workflow: { render: () => window.DashboardPages?.workflow?.() },
    topology: { render: () => window.DashboardPages?.topology?.() },
    monitoring: { render: () => window.DashboardPages?.monitoring?.() },
    costs: { render: () => window.DashboardPages?.costs?.() },
    documents: { render: () => window.DashboardPages?.documents?.() },
    knowledge: { render: () => window.DashboardPages?.knowledge?.() },
    prompts: { render: () => window.DashboardPages?.prompts?.() },
  }

  let currentPage = 'overview'
  let chartInstances = []

  function disposeCharts() {
    chartInstances.forEach(c => {
      try {
        c.dispose()
      } catch (error) {
        observeRecoverableError(error)
      }
    })
    chartInstances = []
  }

  function registerChart(instance) {
    chartInstances.push(instance)
  }

  function navigate(page, options = {}) {
    if (!pages[page]) page = 'overview'
    if (!options.force && currentPage === page && $('#app').children.length > 0) return

    setPageCleanup(null)
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
    renderLoading(app)
    try {
      const result = pages[page].render?.()
      if (result?.catch) result.catch(e => {
        renderEmptyState(app, errorMessage(e), { icon: '\u26a0' })
      })
    } catch (e) {
      renderEmptyState(app, errorMessage(e), { icon: '\u26a0' })
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
    if (eventSource) {
      try {
        eventSource.close()
      } catch (error) {
        observeRecoverableError(error)
      }
    }

    eventSource = new EventSource('/api/stream')

    eventSource.addEventListener('init', (e) => {
      sseDot?.classList.add('connected')
      if (sseLabel) sseLabel.textContent = t('sse.live')
    })

    eventSource.addEventListener('event', (e) => {
      try {
        const data = JSON.parse(e.data)
        window.dispatchEvent(new CustomEvent('scale-event', { detail: data.event }))
      } catch (error) {
        observeRecoverableError(error)
      }
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

  async function initProjectSwitcher() {
    const actions = $('.header-actions')
    if (!actions) return
    const projects = await fetchJSON('/api/projects')
    if (!Array.isArray(projects) || projects.length === 0) return
    const current = projects.find(project => project.current) || projects[0]
    if (projects.length === 1) {
      actions.insertBefore(el('span', {
        className: 'text-muted text-sm',
        text: current.name,
        title: current.projectDir,
        style: { whiteSpace: 'nowrap', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis' },
      }), actions.firstChild)
      return
    }
    const select = el('select', {
      className: 'search-box',
      title: 'Project',
      style: { width: '220px' },
    }, projects.map(project => el('option', {
      text: project.name,
      value: project.url || '',
      attrs: { selected: project.current ? true : null },
    })))
    select.addEventListener('change', () => {
      if (select.value) window.location.href = select.value
    })
    actions.insertBefore(select, actions.firstChild)
  }

  void initProjectSwitcher()

  // ── Shared State ───────────────────────────────────────────────────

  window.Dashboard = {
    dom: {
      autoRefreshControl,
      chartContainer,
      copyText,
      dataTable,
      dataNote,
      downloadText,
      el,
      emptyState,
      metricCard,
      panel,
      renderText,
      safeClassToken,
      textBlock,
    },
    fetchJSON,
    formatNumber,
    formatTime,
    relativeTime,
    registerChart,
    renderEmptyState,
    renderLoading,
    getTheme,
    runtimeLabel,
    navigate,
    t,
    $,
    $$,
  }

  // ── Initial Render ─────────────────────────────────────────────────
  // Deferred to after page scripts load (see index.html)
})()
