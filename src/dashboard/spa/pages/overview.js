/**
 * Overview Page — Dashboard home with key metrics, charts, and event stream
 */
;(() => {
  'use strict'

  const { fetchJSON, formatNumber, formatTime, relativeTime, registerChart, getTheme, t, $ } = window.Dashboard

  async function renderOverview() {
    const app = $('#app')
    app.innerHTML = `
      <div class="metrics-row" id="ov-metrics"></div>
      <div class="grid-2 mb-24">
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('overview.artifactDistribution')}</span></div>
          <div class="chart-area" id="ov-artifact-chart"></div>
        </div>
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('overview.gateStatus')}</span></div>
          <div class="chart-area" id="ov-gate-chart"></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-title">${t('overview.recentEvents')} <span class="count" id="ov-event-count"></span></div>
          <div class="event-stream" id="ov-events"></div>
        </div>
        <div class="panel">
          <div class="panel-title">${t('overview.pendingActions')}</div>
          <div id="ov-pending"></div>
        </div>
      </div>
    `

    // Fetch data in parallel
    const [state, metrics] = await Promise.all([
      fetchJSON('/api/state'),
      fetchJSON('/api/metrics'),
    ])

    renderMetricCards(state, metrics)
    renderArtifactChart(state)
    renderGateChart(metrics)
    renderEventStream(state)
    renderPending(state)
  }

  function renderMetricCards(state, metrics) {
    const container = $('#ov-metrics')
    if (!state) {
      container.innerHTML = `<div class="text-muted">${t('common.noData')}</div>`
      return
    }

    const artifactCount = countArtifacts(state.artifacts)
    const defectCount = state.autoDefectStats?.totalDefects ?? 0
    const taskCount = metrics?.taskMetrics?.recentTasks ?? 0
    const firstPass = metrics?.taskMetrics?.recentFirstPassRate ?? 0
    const eventCount = state.recentEvents?.length ?? 0

    const cards = [
      { label: t('overview.totalArtifacts'), value: formatNumber(artifactCount), cls: 'accent' },
      { label: t('overview.pendingReviews'), value: formatNumber(taskCount), cls: '' },
      { label: t('overview.activeGates'), value: (firstPass * 100).toFixed(0) + '%', cls: firstPass >= 0.8 ? 'accent' : '' },
      { label: t('overview.defects'), value: formatNumber(defectCount), cls: defectCount > 0 ? '' : 'accent' },
    ]

    container.innerHTML = cards.map(c => `
      <div class="metric-card">
        <div class="metric-label">${c.label}</div>
        <div class="metric-value ${c.cls}">${c.value}</div>
      </div>
    `).join('')
  }

  function countArtifacts(roots) {
    let count = 0
    const walk = (nodes) => {
      for (const n of nodes ?? []) { count++; walk(n.children) }
    }
    walk(roots)
    return count
  }

  function renderArtifactChart(state) {
    const el = $('#ov-artifact-chart')
    if (!el) return

    // Count by status
    const statusCounts = {}
    const walk = (nodes) => {
      for (const n of nodes ?? []) {
        statusCounts[n.status] = (statusCounts[n.status] ?? 0) + 1
        walk(n.children)
      }
    }
    walk(state?.artifacts ?? [])

    const entries = Object.entries(statusCounts)
    if (entries.length === 0) {
      el.innerHTML = `<div class="empty-state"><p>${t('overview.noArtifacts')}</p></div>`
      return
    }

    const chart = echarts.init(el, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)

    const colors = {
      DRAFT: '#666', REVIEWING: '#ffaa00', FROZEN: '#5588ff',
      COMPLETED: '#00dc82', BLOCKED: '#ff4444', IN_PROGRESS: '#ffaa00',
      DONE: '#00dc82', PROPOSED: '#5588ff', APPROVED: '#00dc82', REJECTED: '#ff4444',
    }

    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [{
        type: 'pie', radius: ['40%', '70%'], center: ['50%', '50%'],
        itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 },
        label: { show: true, color: getTheme() === 'dark' ? '#a1a1a1' : '#555' },
        data: entries.map(([status, count]) => ({
          value: count, name: status,
          itemStyle: { color: colors[status] || '#888' },
        })),
      }],
    })

    window.addEventListener('themechange', () => {
      chart.dispose()
      renderArtifactChart(state)
    })
  }

  function renderGateChart(metrics) {
    const el = $('#ov-gate-chart')
    if (!el) return

    const gateFailures = metrics?.gateFailures
    if (!gateFailures || gateFailures.total === 0) {
      el.innerHTML = `<div class="empty-state"><p>${t('overview.noGateData')}</p></div>`
      return
    }

    const chart = echarts.init(el, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)

    const gates = Object.entries(gateFailures.byGate).sort((a, b) => b[1] - a[1]).slice(0, 10)
    const passed = gateFailures.total - gateFailures.failed

    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 60, right: 20, top: 20, bottom: 30 },
      xAxis: { type: 'category', data: [t('monitoring.passed'), t('monitoring.failed')], axisLabel: { color: '#a1a1a1' } },
      yAxis: { type: 'value', axisLabel: { color: '#a1a1a1' }, splitLine: { lineStyle: { color: '#2a2a2a' } } },
      series: [{
        type: 'bar', barWidth: 40,
        data: [
          { value: passed, itemStyle: { color: '#00dc82', borderRadius: [4, 4, 0, 0] } },
          { value: gateFailures.failed, itemStyle: { color: '#ff4444', borderRadius: [4, 4, 0, 0] } },
        ],
      }],
    })
  }

  function renderEventStream(state) {
    const container = $('#ov-events')
    const countEl = $('#ov-event-count')
    const events = state?.recentEvents ?? []

    if (events.length === 0) {
      container.innerHTML = `<div class="text-muted text-sm">${t('overview.noEvents')}</div>`
      return
    }

    countEl.textContent = `(${events.length})`
    container.innerHTML = events.slice(0, 20).map(e => `
      <div class="event-item">
        <span class="event-type">${e.type}</span>
        <span class="text-sm">${e.artifactId ? t('monitoring.artifactPrefix', { id: e.artifactId.slice(0, 8) }) : ''}</span>
        <span class="event-time">${relativeTime(e.timestamp)}</span>
      </div>
    `).join('')
  }

  function renderPending(state) {
    const container = $('#ov-pending')
    const artifacts = state?.artifacts ?? []

    // Find artifacts that need attention (REVIEWING, PROPOSED, BLOCKED)
    const pending = []
    const walk = (nodes) => {
      for (const n of nodes ?? []) {
        if (['REVIEWING', 'PROPOSED', 'BLOCKED', 'IN_PROGRESS'].includes(n.status)) {
          pending.push(n)
        }
        walk(n.children)
      }
    }
    walk(artifacts)

    if (pending.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="icon">&#10003;</div><p>${t('overview.noActions')}</p></div>`
      return
    }

    container.innerHTML = `
      <table class="data-table">
        <thead><tr><th>${t('overview.colArtifact')}</th><th>${t('workflow.colType')}</th><th>${t('workflow.colStatus')}</th><th>${t('overview.colTime')}</th></tr></thead>
        <tbody>
          ${pending.slice(0, 10).map(a => `
            <tr>
              <td>${a.title}</td>
              <td class="text-muted">${a.type}</td>
              <td><span class="badge-status badge-${a.status}">${a.status}</span></td>
              <td class="text-muted text-sm">${relativeTime(a.createdAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  }

  // Export
  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.overview = renderOverview
})()
