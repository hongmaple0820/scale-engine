/**
 * Overview Page — Dashboard home with key metrics, charts, and event stream
 */
;(() => {
  'use strict'

  const { fetchJSON, formatNumber, formatTime, relativeTime, registerChart, getTheme, runtimeLabel, t, $, dom } = window.Dashboard
  const { autoRefreshControl, chartContainer, dataNote, dataTable, el, emptyState, metricCard, panel, renderText, safeClassToken } = dom

  async function renderOverview() {
    const app = $('#app')
    const eventCount = el('span', { className: 'count', id: 'ov-event-count' })
    const projectCount = el('span', { className: 'count', id: 'ov-project-count' })
    const refresh = el('button', { className: 'topo-btn', text: t('overview.refreshSnapshot'), title: t('common.manualRefreshHint') })
    async function loadSnapshot() {
      if (!$('#ov-metrics')) return
      const [state, metrics, projects] = await Promise.all([
        fetchJSON('/api/state'),
        fetchJSON('/api/metrics'),
        fetchJSON('/api/projects/summary'),
      ])
      if (!$('#ov-metrics')) return
      renderMetricCards(state, metrics)
      renderOverviewDataNote()
      renderProjectSummary(projects)
      renderArtifactChart(state)
      renderGateChart(metrics)
      renderEventStream(state)
      renderPending(state)
    }
    refresh.addEventListener('click', loadSnapshot)
    app.replaceChildren(
      el('div', { className: 'page-toolbar' }, [
        refresh,
        autoRefreshControl(loadSnapshot),
        el('span', { className: 'section-copy', text: t('overview.dataHint') }),
      ]),
      el('div', { id: 'ov-data-note' }),
      el('div', { className: 'metrics-row', id: 'ov-metrics' }),
      panel(t('overview.projects'), 'ov-projects', { titleSuffix: projectCount }),
      el('div', { className: 'grid-2 mb-24' }, [
        chartContainer(t('overview.artifactDistribution'), 'ov-artifact-chart'),
        chartContainer(t('overview.gateStatus'), 'ov-gate-chart'),
      ]),
      el('div', { className: 'grid-2' }, [
        panel(t('overview.recentEvents'), 'ov-events', { titleSuffix: eventCount }),
        panel(t('overview.pendingActions'), 'ov-pending'),
      ])
    )
    $('#ov-events').className = 'event-stream'

    await loadSnapshot()
  }

  function renderOverviewDataNote() {
    const node = $('#ov-data-note')
    if (!node) return
    node.replaceChildren(dataNote([
      { strong: true, text: t('common.mixedRefresh') },
      `${t('common.lastLoaded')}: ${formatTime(Date.now())}`,
      t('common.manualRefreshHint'),
      t('common.liveStreamHint'),
    ]))
  }

  function renderMetricCards(state, metrics) {
    const container = $('#ov-metrics')
    if (!container) return
    if (!state) {
      renderText(container, t('common.noData'), 'text-muted')
      return
    }

    const artifactCount = countArtifacts(state.artifacts)
    const defectCount = state.autoDefectStats?.totalDefects ?? 0
    const taskCount = metrics?.taskMetrics?.recentTasks ?? 0
    const firstPass = metrics?.taskMetrics?.recentFirstPassRate ?? 0
    const eventCount = state.recentEvents?.length ?? 0
    const savedTokens = metrics?.commandRuns?.savedEstimatedTokens ?? 0

    const cards = [
      { label: t('overview.totalArtifacts'), value: formatNumber(artifactCount), cls: 'accent' },
      { label: t('overview.pendingReviews'), value: formatNumber(taskCount), cls: '' },
      { label: t('overview.activeGates'), value: (firstPass * 100).toFixed(0) + '%', cls: firstPass >= 0.8 ? 'accent' : '' },
      { label: t('overview.defects'), value: formatNumber(defectCount), cls: defectCount > 0 ? '' : 'accent' },
      { label: t('costs.tokensSaved'), value: formatNumber(savedTokens), cls: savedTokens > 0 ? 'accent' : '' },
    ]

    container.replaceChildren(...cards.map(c => metricCard(c.label, c.value, c.cls)))
  }

  function renderProjectSummary(report) {
    const container = $('#ov-projects')
    const countEl = $('#ov-project-count')
    const panelNode = container?.closest('.panel')
    const projects = report?.projects ?? []
    if (!container || !panelNode) return
    if (projects.length <= 1) {
      panelNode.style.display = 'none'
      return
    }
    panelNode.style.display = ''
    countEl.textContent = `(${projects.length})`
    const rows = projects.map(item => {
      const projectLink = item.project.url
        ? el('a', { text: item.project.name, attrs: { href: item.project.url, title: item.project.projectDir } })
        : el('span', { text: item.project.name, title: item.project.projectDir })
      const nameCell = [projectLink]
      if (item.project.current) nameCell.push(el('span', { className: 'count', text: ` ${t('overview.currentProject')}` }))
      return el('tr', {}, [
        el('td', {}, nameCell),
        el('td', {}, [
          el('span', {
            className: `badge ${healthClass(item.health)}`,
            text: runtimeLabel('health', item.health),
          }),
        ]),
        el('td', { text: formatNumber(item.documents?.total ?? 0) }),
        el('td', { text: `${formatNumber(item.knowledge?.active ?? 0)} / ${formatNumber(item.knowledge?.total ?? 0)}` }),
        el('td', { text: `${formatPercent(item.metrics?.commandPassRate)} (${t('common.failedCount', { count: formatNumber(item.metrics?.failedCommandRuns ?? 0) })})` }),
        el('td', { text: formatNumber(item.metrics?.gateFailures ?? 0) }),
      ])
    })
    container.replaceChildren(dataTable([
      t('overview.colProject'),
      t('overview.colHealth'),
      t('overview.colDocuments'),
      t('overview.colMemory'),
      t('overview.colCommands'),
      t('overview.colGateFailures'),
    ], rows))
  }

  function healthClass(health) {
    if (health === 'ready') return 'badge-success'
    if (health === 'missing') return 'badge-danger'
    return 'badge-warning'
  }

  function formatPercent(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-'
    return `${Math.round(value * 100)}%`
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
      el.replaceChildren(emptyState(t('overview.noArtifacts')))
      return
    }

    echarts.getInstanceByDom(el)?.dispose()
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
      el.replaceChildren(emptyState(t('overview.noGateData')))
      return
    }

    const gates = Object.entries(gateFailures.byGate).sort((a, b) => b[1] - a[1]).slice(0, 10)
    const passed = gateFailures.total - gateFailures.failed

    echarts.getInstanceByDom(el)?.dispose()
    const chart = echarts.init(el, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)
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
    if (!container || !countEl) return
    const events = state?.recentEvents ?? []

    if (events.length === 0) {
      countEl.textContent = ''
      renderText(container, t('overview.noEvents'), 'text-muted text-sm')
      return
    }

    countEl.textContent = `(${events.length})`
    container.replaceChildren(...events.slice(0, 20).map(e => {
      const artifactText = e.artifactId ? t('monitoring.artifactPrefix', { id: e.artifactId.slice(0, 8) }) : ''
      return el('div', { className: 'event-item' }, [
        el('span', { className: 'event-type', text: e.type }),
        el('span', { className: 'text-sm', text: artifactText }),
        el('span', { className: 'event-time', text: relativeTime(e.timestamp) }),
      ])
    }))
  }

  function renderPending(state) {
    const container = $('#ov-pending')
    if (!container) return
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
      container.replaceChildren(emptyState(t('overview.noActions'), '\u2713'))
      return
    }

    const rows = pending.slice(0, 10).map(a => {
      const status = String(a.status ?? '')
      return el('tr', {}, [
        el('td', { text: a.title }),
        el('td', { className: 'text-muted', text: a.type }),
        el('td', {}, [
          el('span', { className: `badge-status badge-${safeClassToken(status)}`, text: runtimeLabel('status', status) }),
        ]),
        el('td', { className: 'text-muted text-sm', text: relativeTime(a.createdAt) }),
      ])
    })
    container.replaceChildren(dataTable([
      t('overview.colArtifact'),
      t('workflow.colType'),
      t('workflow.colStatus'),
      t('overview.colTime'),
    ], rows))
  }

  // Export
  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.overview = renderOverview
})()
