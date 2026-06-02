/**
 * Monitoring Page v2 — Defect trends, gate timeline, command stats, enhanced detector view
 */
;(() => {
  'use strict'

  const { fetchJSON, formatTime, relativeTime, formatNumber, registerChart, getTheme, t, $, $$ } = window.Dashboard

  async function renderMonitoring() {
    const app = $('#app')
    app.innerHTML = `
      <div class="metrics-row" id="mon-metrics"></div>
      <div class="tabs" id="mon-tabs">
        <div class="tab active" data-tab="overview">${t('monitoring.overview')}</div>
        <div class="tab" data-tab="detectors">${t('monitoring.detectors')}</div>
        <div class="tab" data-tab="defects">${t('monitoring.defects')}</div>
        <div class="tab" data-tab="commands">${t('monitoring.commands')}</div>
      </div>
      <div id="mon-content"></div>
    `

    const [state, metrics] = await Promise.all([
      fetchJSON('/api/state'),
      fetchJSON('/api/metrics'),
    ])

    renderMonMetrics(state, metrics)

    let currentTab = 'overview'
    $('#mon-tabs').addEventListener('click', (e) => {
      const tab = e.target.dataset?.tab
      if (!tab) return
      currentTab = tab
      $$('#mon-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab))
      renderMonTab(tab, state, metrics)
    })

    renderMonTab('overview', state, metrics)
  }

  function renderMonMetrics(state, metrics) {
    const container = $('#mon-metrics')
    const detectors = state?.detectorStats?.length ?? 0
    const defects = state?.autoDefectStats?.autoCreatedCount ?? 0
    const commands = metrics?.commandRuns?.total ?? 0
    const cmdPassRate = commands > 0 ? ((metrics.commandRuns.passed / commands) * 100).toFixed(0) + '%' : '-'
    const events = state?.recentEvents?.length ?? 0

    container.innerHTML = [
      { label: t('monitoring.activeDetectors'), value: detectors, cls: '' },
      { label: t('monitoring.autoDefects'), value: formatNumber(defects), cls: defects > 0 ? '' : 'accent' },
      { label: t('monitoring.commandRuns'), value: formatNumber(commands), cls: '' },
      { label: t('monitoring.commandPassRate'), value: cmdPassRate, cls: parseInt(cmdPassRate) >= 80 ? 'accent' : '' },
      { label: t('monitoring.recentEvents'), value: events, cls: '' },
    ].map(c => `
      <div class="metric-card">
        <div class="metric-label">${c.label}</div>
        <div class="metric-value ${c.cls}">${c.value}</div>
      </div>
    `).join('')
  }

  function renderMonTab(tab, state, metrics) {
    const container = $('#mon-content')
    switch (tab) {
      case 'overview': renderOverview(container, state, metrics); break
      case 'detectors': renderDetectors(container, state); break
      case 'defects': renderDefects(container, state); break
      case 'commands': renderCommands(container, metrics); break
    }
  }

  // ── Overview ───────────────────────────────────────────────────────

  function renderOverview(container, state, metrics) {
    container.innerHTML = `
      <div class="grid-2 mb-24">
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('monitoring.defectsByRootCause')}</span></div>
          <div class="chart-area" id="mon-rootcause-chart"></div>
        </div>
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('monitoring.defectsBySeverity')}</span></div>
          <div class="chart-area" id="mon-severity-chart"></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('monitoring.commandStatus')}</span></div>
          <div class="chart-area" id="mon-cmd-chart"></div>
        </div>
        <div class="panel">
          <div class="panel-title">${t('monitoring.recentEvents')} <span class="count">(${(state?.recentEvents ?? []).length})</span></div>
          <div class="event-stream" id="mon-events" style="max-height:300px"></div>
        </div>
      </div>
    `

    renderRootCauseChart(state)
    renderSeverityChart(state)
    renderCommandChart(metrics)
    renderEventStream(state)
  }

  function renderRootCauseChart(state) {
    const el = $('#mon-rootcause-chart')
    const data = state?.autoDefectStats?.byRootCause ?? {}
    const entries = Object.entries(data)

    if (entries.length === 0) {
      el.innerHTML = `<div class="empty-state"><p>${t('monitoring.noDefectData')}</p></div>`
      return
    }

    const chart = echarts.init(el, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)

    const colors = ['#ff4444', '#ffaa00', '#5588ff', '#00dc82', '#aa88ff', '#ff6688', '#44cccc']
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 120, right: 20, top: 10, bottom: 30 },
      xAxis: { type: 'value', axisLabel: { color: '#a1a1a1' }, splitLine: { lineStyle: { color: '#2a2a2a' } } },
      yAxis: { type: 'category', data: entries.map(([k]) => k), axisLabel: { color: '#a1a1a1', fontSize: 11 } },
      series: [{
        type: 'bar',
        data: entries.map(([, v], i) => ({
          value: v,
          itemStyle: { color: colors[i % colors.length], borderRadius: [0, 4, 4, 0] },
        })),
        barWidth: 20,
      }],
    })
  }

  function renderSeverityChart(state) {
    const el = $('#mon-severity-chart')
    const data = state?.autoDefectStats?.bySeverity ?? {}
    const entries = Object.entries(data)

    if (entries.length === 0) {
      el.innerHTML = `<div class="empty-state"><p>${t('common.noData')}</p></div>`
      return
    }

    const chart = echarts.init(el, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)

    const severityColors = { low: '#00dc82', medium: '#ffaa00', high: '#ff4444', critical: '#ff0000' }
    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [{
        type: 'pie', radius: ['40%', '70%'],
        label: { color: '#a1a1a1', formatter: '{b}\n{d}%' },
        data: entries.map(([sev, count]) => ({
          name: sev, value: count,
          itemStyle: { color: severityColors[sev] || '#888' },
        })),
      }],
    })
  }

  function renderCommandChart(metrics) {
    const el = $('#mon-cmd-chart')
    const cmd = metrics?.commandRuns
    if (!cmd || cmd.total === 0) {
      el.innerHTML = `<div class="empty-state"><p>${t('monitoring.noCommandData')}</p></div>`
      return
    }

    const chart = echarts.init(el, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)

    chart.setOption({
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie', radius: ['40%', '70%'],
        label: { color: '#a1a1a1', formatter: '{b}\n{c}' },
        data: [
          { name: t('monitoring.passed'), value: cmd.passed, itemStyle: { color: '#00dc82' } },
          { name: t('monitoring.failed'), value: cmd.failed, itemStyle: { color: '#ff4444' } },
        ],
      }],
    })
  }

  function renderEventStream(state) {
    const container = $('#mon-events')
    const events = state?.recentEvents ?? []

    if (events.length === 0) {
      container.innerHTML = `<div class="text-muted text-sm">${t('overview.noEvents')}</div>`
      return
    }

    container.innerHTML = events.slice(0, 30).map(e => `
      <div class="event-item">
        <span class="event-type">${e.type}</span>
        <span class="text-sm">${e.artifactId ? t('monitoring.artifactPrefix', { id: e.artifactId.slice(0, 8) }) : ''}</span>
        <span class="event-time">${relativeTime(e.timestamp)}</span>
      </div>
    `).join('')
  }

  // ── Detectors ──────────────────────────────────────────────────────

  function renderDetectors(container, state) {
    const detectors = state?.detectorStats ?? []

    if (detectors.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="icon">&#128270;</div><p>${t('monitoring.noDetectorData')}</p></div>`
      return
    }

    container.innerHTML = `
      <div class="panel mb-24">
        <div class="panel-title">${t('monitoring.detectorPerformance')}</div>
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('monitoring.detectors')}</th>
              <th>${t('monitoring.triggerDistribution')}</th>
              <th>${t('monitoring.defectsBySeverity')}</th>
              <th>${t('monitoring.recentEvents')}</th>
              <th>${t('monitoring.health')}</th>
            </tr>
          </thead>
          <tbody>
            ${detectors.map(d => {
              const highSev = (d.bySeverity?.high ?? 0) + (d.bySeverity?.critical ?? 0)
              const health = highSev > 5 ? 'critical' : highSev > 0 ? 'warning' : 'ok'
              const healthColor = { ok: '#00dc82', warning: '#ffaa00', critical: '#ff4444' }[health]
              return `
                <tr>
                  <td style="font-weight:500">${d.name}</td>
                  <td>${d.totalTriggers}</td>
                  <td>${Object.entries(d.bySeverity ?? {}).map(([s, c]) =>
                    `<span class="severity-badge severity-${s}">${s}: ${c}</span>`
                  ).join(' ')}</td>
                  <td class="text-muted text-sm">${d.lastTrigger ? relativeTime(d.lastTrigger) : '-'}</td>
                  <td><span style="color:${healthColor};font-weight:500">${health.toUpperCase()}</span></td>
                </tr>
              `
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="chart-container">
        <div class="chart-header"><span class="chart-title">${t('monitoring.triggerDistribution')}</span></div>
        <div class="chart-area" id="mon-det-chart"></div>
      </div>
    `

    // Detector trigger chart
    const el = $('#mon-det-chart')
    if (el && detectors.length > 0) {
      const chart = echarts.init(el, getTheme() === 'dark' ? 'dark' : null)
      registerChart(chart)

      chart.setOption({
        tooltip: { trigger: 'axis' },
        legend: { textStyle: { color: '#a1a1a1' }, bottom: 0 },
        grid: { left: 120, right: 20, top: 20, bottom: 40 },
        xAxis: { type: 'value', axisLabel: { color: '#a1a1a1' }, splitLine: { lineStyle: { color: '#2a2a2a' } } },
        yAxis: { type: 'category', data: detectors.map(d => d.name), axisLabel: { color: '#a1a1a1', fontSize: 11 } },
        series: ['low', 'medium', 'high', 'critical'].map(sev => ({
          name: sev,
          type: 'bar',
          stack: 'total',
          data: detectors.map(d => d.bySeverity?.[sev] ?? 0),
          itemStyle: { color: { low: '#00dc82', medium: '#ffaa00', high: '#ff4444', critical: '#ff0000' }[sev] },
          barWidth: 18,
        })),
      })
    }
  }

  // ── Defects ────────────────────────────────────────────────────────

  function renderDefects(container, state) {
    const defects = state?.autoDefectStats?.recentDefects ?? []
    const byRootCause = state?.autoDefectStats?.byRootCause ?? {}
    const bySeverity = state?.autoDefectStats?.bySeverity ?? {}

    container.innerHTML = `
      <div class="grid-3 mb-24">
        ${Object.entries(byRootCause).slice(0, 6).map(([cause, count]) => `
          <div class="metric-card">
            <div class="metric-label">${cause}</div>
            <div class="metric-value">${count}</div>
          </div>
        `).join('')}
      </div>
      <div class="panel">
        <div class="panel-title">${t('monitoring.recentAutoDefects')} <span class="count">(${defects.length})</span></div>
        ${defects.length === 0 ? `<div class="text-muted text-sm">${t('monitoring.noAutoDefects')}</div>` : `
          <table class="data-table">
            <thead><tr><th>${t('monitoring.defects')}</th><th>${t('monitoring.defectsByRootCause')}</th><th>${t('monitoring.defectsBySeverity')}</th><th>${t('monitoring.detectors')}</th><th>${t('monitoring.recentEvents')}</th></tr></thead>
            <tbody>
              ${defects.map(d => `
                <tr>
                  <td style="font-weight:500">${d.title}</td>
                  <td class="text-muted">${d.rootCause}</td>
                  <td><span class="severity-badge severity-${d.severity}">${d.severity}</span></td>
                  <td class="text-muted">${d.detector}</td>
                  <td class="text-muted text-sm">${relativeTime(d.createdAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>
    `
  }

  // ── Commands ───────────────────────────────────────────────────────

  function renderCommands(container, metrics) {
    const cmd = metrics?.commandRuns
    if (!cmd) {
      container.innerHTML = `<div class="empty-state"><p>${t('monitoring.noCommandData')}</p></div>`
      return
    }

    const efficiency = cmd.rawEstimatedTokens > 0
      ? ((cmd.savedEstimatedTokens / cmd.rawEstimatedTokens) * 100).toFixed(1)
      : '0'

    container.innerHTML = `
      <div class="metrics-row mb-24">
        <div class="metric-card">
          <div class="metric-label">${t('monitoring.totalRuns')}</div>
          <div class="metric-value">${formatNumber(cmd.total)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">${t('monitoring.passed')}</div>
          <div class="metric-value accent">${formatNumber(cmd.passed)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">${t('monitoring.failed')}</div>
          <div class="metric-value">${formatNumber(cmd.failed)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">${t('monitoring.tokenSavings')}</div>
          <div class="metric-value accent">${efficiency}%</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('monitoring.tokenBreakdown')}</span></div>
          <div class="chart-area" id="mon-token-breakdown"></div>
        </div>
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('monitoring.passFailRatio')}</span></div>
          <div class="chart-area" id="mon-passfail"></div>
        </div>
      </div>
    `

    // Token breakdown
    const tokenEl = $('#mon-token-breakdown')
    if (tokenEl) {
      const chart = echarts.init(tokenEl, getTheme() === 'dark' ? 'dark' : null)
      registerChart(chart)
      chart.setOption({
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        series: [{
          type: 'pie', radius: ['40%', '70%'],
          label: { color: '#a1a1a1', formatter: '{b}\n{d}%' },
          data: [
            { name: t('monitoring.compressed'), value: cmd.compressedEstimatedTokens, itemStyle: { color: '#5588ff' } },
            { name: t('monitoring.saved'), value: cmd.savedEstimatedTokens, itemStyle: { color: '#00dc82' } },
          ],
        }],
      })
    }

    // Pass/Fail
    const pfEl = $('#mon-passfail')
    if (pfEl) {
      const chart = echarts.init(pfEl, getTheme() === 'dark' ? 'dark' : null)
      registerChart(chart)
      chart.setOption({
        tooltip: { trigger: 'item' },
        series: [{
          type: 'pie', radius: ['40%', '70%'],
          label: { color: '#a1a1a1', formatter: '{b}\n{c}' },
          data: [
            { name: t('monitoring.passed'), value: cmd.passed, itemStyle: { color: '#00dc82' } },
            { name: t('monitoring.failed'), value: cmd.failed, itemStyle: { color: '#ff4444' } },
          ],
        }],
      })
    }
  }

  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.monitoring = renderMonitoring
})()
