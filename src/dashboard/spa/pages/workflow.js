/**
 * Workflow Page v3 — Filtering, dependency graph, gate progress bars, version info, i18n, sorting
 */
;(() => {
  'use strict'

  const { fetchJSON, formatTime, relativeTime, formatNumber, registerChart, getTheme, t, $, $$ } = window.Dashboard

  const STATUS_ORDER = ['BLOCKED', 'IN_PROGRESS', 'REVIEWING', 'PROPOSED', 'DRAFT', 'FROZEN', 'COMPLETED', 'DONE', 'APPROVED', 'REJECTED']

  let allArtifacts = []
  let currentState = null
  let filterStatus = 'all'
  let filterType = 'all'
  let filterText = ''
  let sortCol = null
  let sortDir = 'asc'

  async function renderWorkflow() {
    const app = $('#app')
    app.innerHTML = `
      <div class="tabs" id="wf-tabs">
        <div class="tab active" data-tab="cards">${t('workflow.cards')}</div>
        <div class="tab" data-tab="table">${t('workflow.table')}</div>
        <div class="tab" data-tab="graph">${t('workflow.dependencyGraph')}</div>
        <div class="tab" data-tab="gates">${t('workflow.gateAnalysis')}</div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center;flex-wrap:wrap" id="wf-filters">
        <select id="wf-status-filter" class="search-box" style="width:140px">
          <option value="all">${t('common.all')} ${t('workflow.status')}</option>
        </select>
        <select id="wf-type-filter" class="search-box" style="width:140px">
          <option value="all">${t('common.all')} ${t('workflow.type')}</option>
        </select>
        <input type="text" class="search-box" placeholder="${t('common.search')}..." id="wf-search" style="width:200px">
        <span class="text-muted text-sm" id="wf-count"></span>
      </div>
      <div id="wf-content"><div class="loading-placeholder">${t('common.loading')}</div></div>
    `

    currentState = await fetchJSON('/api/state')
    allArtifacts = flattenArtifacts(currentState?.artifacts ?? [])

    // Enrich with FSM actions (batch, not N+1)
    const actionPromises = allArtifacts.map(async (a) => {
      try {
        const data = await fetchJSON(`/api/artifacts/${a.id}/actions`)
        a.availableActions = data?.actions ?? []
      } catch { a.availableActions = [] }
    })
    await Promise.all(actionPromises)

    populateFilters()

    $('#wf-status-filter').addEventListener('change', (e) => { filterStatus = e.target.value; renderCurrentTab() })
    $('#wf-type-filter').addEventListener('change', (e) => { filterType = e.target.value; renderCurrentTab() })
    $('#wf-search').addEventListener('input', (e) => { filterText = e.target.value.toLowerCase(); renderCurrentTab() })

    let currentTab = 'cards'
    $('#wf-tabs').addEventListener('click', (e) => {
      const tab = e.target.dataset?.tab
      if (!tab) return
      currentTab = tab
      $$('#wf-tabs .tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab))
      renderCurrentTab()
    })

    function renderCurrentTab() {
      const filtered = getFiltered()
      renderTab(currentTab, filtered, currentState)
    }

    renderCurrentTab()
  }

  function populateFilters() {
    const statuses = new Set(allArtifacts.map(a => a.status))
    const types = new Set(allArtifacts.map(a => a.type))

    const statusSel = $('#wf-status-filter')
    for (const s of STATUS_ORDER.filter(s => statuses.has(s))) {
      statusSel.innerHTML += `<option value="${s}">${s}</option>`
    }

    const typeSel = $('#wf-type-filter')
    for (const tp of [...types].sort()) {
      typeSel.innerHTML += `<option value="${tp}">${tp}</option>`
    }
  }

  function getFiltered() {
    let result = allArtifacts
    if (filterStatus !== 'all') result = result.filter(a => a.status === filterStatus)
    if (filterType !== 'all') result = result.filter(a => a.type === filterType)
    if (filterText) result = result.filter(a => a.title.toLowerCase().includes(filterText) || a.type.toLowerCase().includes(filterText))
    if (sortCol) {
      result = [...result].sort((a, b) => {
        const va = a[sortCol] ?? '', vb = b[sortCol] ?? ''
        const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }

  function renderTab(tab, artifacts, state) {
    const container = $('#wf-content')
    $('#wf-count').textContent = t('workflow.artifactCount', { count: artifacts.length })

    switch (tab) {
      case 'cards': renderCards(container, artifacts); break
      case 'table': renderTable(container, artifacts); break
      case 'graph': renderDependencyGraph(container, artifacts); break
      case 'gates': renderGateAnalysis(container, artifacts, state); break
    }
  }

  // ── Toast ───────────────────────────────────────────────────────────

  function showToast(msg, type = 'info') {
    let toast = $('#wf-toast')
    if (!toast) {
      toast = document.createElement('div')
      toast.id = 'wf-toast'
      toast.style.cssText = 'position:fixed;top:70px;right:24px;padding:10px 18px;border-radius:8px;font-size:13px;z-index:999;transition:opacity 0.3s;opacity:0'
      document.body.appendChild(toast)
    }
    const colors = { info: '#5588ff', error: '#ff4444', success: '#00dc82' }
    toast.textContent = msg
    toast.style.background = colors[type] || colors.info
    toast.style.color = '#fff'
    toast.style.opacity = '1'
    setTimeout(() => { toast.style.opacity = '0' }, 3000)
  }

  // ── Cards View ─────────────────────────────────────────────────────

  function renderCards(container, artifacts) {
    if (artifacts.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="icon">&#128220;</div><p>${t('workflow.noArtifactMatch')}</p></div>`
      return
    }

    container.innerHTML = `
      <div class="artifact-grid">
        ${artifacts.map(a => {
          const gates = a.gates ?? []
          const passedGates = gates.filter(g => g.passed).length
          const gateProgress = gates.length > 0 ? Math.round((passedGates / gates.length) * 100) : 0

          return `
            <div class="artifact-card" data-id="${a.id}">
              <div class="artifact-card-header">
                <span class="artifact-card-title">${a.title}</span>
                <span class="badge-status badge-${a.status}">${a.status}</span>
              </div>
              <div class="artifact-card-meta">${a.type} &middot; v${a.version} &middot; ${relativeTime(a.createdAt)}</div>
              ${gates.length > 0 ? `
                <div style="margin:10px 0">
                  <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-2);margin-bottom:4px">
                    <span>${t('workflow.gates')}</span><span>${passedGates}/${gates.length}</span>
                  </div>
                  <div style="height:4px;background:var(--bg-3);border-radius:2px;overflow:hidden">
                    <div style="height:100%;width:${gateProgress}%;background:${gateProgress === 100 ? '#00dc82' : gateProgress > 50 ? '#ffaa00' : '#ff4444'};border-radius:2px;transition:width 0.3s"></div>
                  </div>
                  <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
                    ${gates.map(g => `
                      <span class="gate-pill ${g.passed ? 'passed' : 'failed'}" title="${g.name}">${g.name}</span>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              ${a.children?.length ? `<div style="font-size:11px;color:var(--text-2);margin-top:6px">${t('workflow.childArtifacts', { count: a.children.length })}</div>` : ''}
              <div style="margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap">
                ${(a.availableActions ?? []).map(act => `
                  <button class="topo-btn wf-action" data-id="${a.id}" data-action="${act}">${formatAction(act)}</button>
                `).join('')}
              </div>
            </div>
          `
        }).join('')}
      </div>
    `

    wireActionButtons(container)
  }

  // ── Table View ─────────────────────────────────────────────────────

  function renderTable(container, artifacts) {
    if (artifacts.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>${t('workflow.noArtifactMatch')}</p></div>`
      return
    }

    const sortIcon = (col) => sortCol === col ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : ''

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th style="cursor:pointer" data-sort="title">${t('workflow.colTitle')}${sortIcon('title')}</th>
            <th style="cursor:pointer" data-sort="type">${t('workflow.colType')}${sortIcon('type')}</th>
            <th style="cursor:pointer" data-sort="status">${t('workflow.colStatus')}${sortIcon('status')}</th>
            <th style="cursor:pointer" data-sort="version">${t('workflow.colVersion')}${sortIcon('version')}</th>
            <th>${t('workflow.colGates')}</th>
            <th>${t('workflow.colCreated')}</th>
            <th>${t('workflow.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          ${artifacts.map(a => {
            const gates = a.gates ?? []
            const passedGates = gates.filter(g => g.passed).length
            return `
              <tr>
                <td style="font-weight:500">${a.title}</td>
                <td class="text-muted">${a.type}</td>
                <td><span class="badge-status badge-${a.status}">${a.status}</span></td>
                <td class="text-muted">v${a.version}</td>
                <td>
                  ${gates.length > 0 ? `
                    <span style="color:${passedGates === gates.length ? '#00dc82' : '#ffaa00'}">${passedGates}/${gates.length}</span>
                  ` : '<span class="text-muted">-</span>'}
                </td>
                <td class="text-muted text-sm">${relativeTime(a.createdAt)}</td>
                <td>
                  <div style="display:flex;gap:4px;flex-wrap:wrap">
                    ${(a.availableActions ?? []).map(act => `
                      <button class="topo-btn wf-action" data-id="${a.id}" data-action="${act}" style="font-size:11px;padding:3px 8px">${formatAction(act)}</button>
                    `).join('')}
                  </div>
                </td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
    `

    // Wire sorting
    $$('th[data-sort]', container).forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort
        if (sortCol === col) { sortDir = sortDir === 'asc' ? 'desc' : 'asc' }
        else { sortCol = col; sortDir = 'asc' }
        renderTable(container, getFiltered())
      })
    })

    wireActionButtons(container)
  }

  // ── Dependency Graph ───────────────────────────────────────────────

  function renderDependencyGraph(container, artifacts) {
    if (artifacts.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="icon">&#128220;</div><p>${t('workflow.noArtifacts')}</p></div>`
      return
    }

    container.innerHTML = `
      <div class="chart-container">
        <div class="chart-header">
          <span class="chart-title">${t('workflow.artifactDependencyGraph')}</span>
          <span class="text-muted text-sm">${t('workflow.artifactCount', { count: artifacts.length })}</span>
        </div>
        <div class="chart-area" id="wf-dep-graph" style="height:500px"></div>
      </div>
    `

    const el = $('#wf-dep-graph')
    if (!el) return

    const chart = echarts.init(el, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)

    const statusColors = {
      DRAFT: '#666', REVIEWING: '#ffaa00', FROZEN: '#5588ff',
      COMPLETED: '#00dc82', BLOCKED: '#ff4444', IN_PROGRESS: '#ffaa00',
      DONE: '#00dc82', PROPOSED: '#5588ff', APPROVED: '#00dc82', REJECTED: '#ff4444',
    }

    const nodes = artifacts.map(a => ({
      id: a.id,
      name: a.title.length > 25 ? a.title.slice(0, 22) + '...' : a.title,
      symbolSize: 12 + (a.children?.length ?? 0) * 4,
      itemStyle: { color: statusColors[a.status] || '#888' },
      category: a.type,
    }))

    const links = []
    for (const a of artifacts) {
      for (const child of a.children ?? []) {
        links.push({ source: a.id, target: child.id })
      }
    }

    const categories = [...new Set(artifacts.map(a => a.type))].map(tp => ({ name: tp }))

    chart.setOption({
      tooltip: {
        formatter: (p) => {
          if (p.dataType === 'node') {
            const a = artifacts.find(x => x.id === p.data.id)
            return `<strong>${a?.title ?? p.name}</strong><br/>${a?.type} &middot; ${a?.status}<br/>v${a?.version ?? '?'}`
          }
          return ''
        },
      },
      legend: {
        data: categories.map(c => c.name),
        textStyle: { color: '#a1a1a1', fontSize: 11 },
        bottom: 0,
        type: 'scroll',
      },
      series: [{
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        force: { repulsion: 200, gravity: 0.1, edgeLength: 80 },
        label: { show: true, fontSize: 10, color: '#a1a1a1' },
        data: nodes,
        links,
        categories,
        lineStyle: { color: '#444', curveness: 0.1 },
        emphasis: {
          focus: 'adjacency',
          lineStyle: { width: 3 },
        },
      }],
    })
  }

  // ── Gate Analysis ──────────────────────────────────────────────────

  function renderGateAnalysis(container, artifacts, state) {
    if (artifacts.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="icon">&#128220;</div><p>${t('workflow.noArtifacts')}</p></div>`
      return
    }

    container.innerHTML = `
      <div class="grid-2 mb-24">
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('workflow.gatePassRate')}</span></div>
          <div class="chart-area" id="wf-radar"></div>
        </div>
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('workflow.typeDistribution')}</span></div>
          <div class="chart-area" id="wf-type-chart"></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('workflow.statusDistribution')}</span></div>
          <div class="chart-area" id="wf-status-chart"></div>
        </div>
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('workflow.gateFailuresByName')}</span></div>
          <div class="chart-area" id="wf-gate-bar"></div>
        </div>
      </div>
    `

    // Gate radar
    const gateStats = {}
    for (const a of artifacts) {
      for (const g of a.gates ?? []) {
        if (!gateStats[g.name]) gateStats[g.name] = { passed: 0, total: 0 }
        gateStats[g.name].total++
        if (g.passed) gateStats[g.name].passed++
      }
    }

    const gateNames = Object.keys(gateStats).slice(0, 10)
    if (gateNames.length > 0) {
      const radar = echarts.init($('#wf-radar'), getTheme() === 'dark' ? 'dark' : null)
      registerChart(radar)
      radar.setOption({
        tooltip: {},
        radar: {
          indicator: gateNames.map(g => ({ name: g, max: gateStats[g].total })),
          axisName: { color: '#a1a1a1', fontSize: 10 },
          splitArea: { areaStyle: { color: ['rgba(0,220,130,0.02)', 'rgba(0,220,130,0.05)'] } },
        },
        series: [{
          type: 'radar',
          data: [{
            value: gateNames.map(g => gateStats[g].passed),
            name: t('monitoring.passed'),
            areaStyle: { color: 'rgba(0,220,130,0.2)' },
            lineStyle: { color: '#00dc82' },
            itemStyle: { color: '#00dc82' },
          }, {
            value: gateNames.map(g => gateStats[g].total - gateStats[g].passed),
            name: t('monitoring.failed'),
            areaStyle: { color: 'rgba(255,68,68,0.2)' },
            lineStyle: { color: '#ff4444' },
            itemStyle: { color: '#ff4444' },
          }],
        }],
      })
    } else {
      const el = $('#wf-radar')
      if (el) el.innerHTML = `<div class="empty-state"><p>${t('common.noData')}</p></div>`
    }

    // Type distribution
    const typeCounts = {}
    for (const a of artifacts) typeCounts[a.type] = (typeCounts[a.type] ?? 0) + 1
    if (Object.keys(typeCounts).length > 0) {
      const typeChart = echarts.init($('#wf-type-chart'), getTheme() === 'dark' ? 'dark' : null)
      registerChart(typeChart)
      typeChart.setOption({
        tooltip: { trigger: 'item' },
        series: [{
          type: 'pie', radius: ['35%', '65%'],
          label: { color: '#a1a1a1', fontSize: 11 },
          data: Object.entries(typeCounts).map(([tp, count]) => ({ name: tp, value: count })),
        }],
      })
    }

    // Status distribution
    const statusCounts = {}
    for (const a of artifacts) statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1
    const statusColors = {
      DRAFT: '#666', REVIEWING: '#ffaa00', FROZEN: '#5588ff',
      COMPLETED: '#00dc82', BLOCKED: '#ff4444', IN_PROGRESS: '#ffaa00',
      DONE: '#00dc82', PROPOSED: '#5588ff', APPROVED: '#00dc82', REJECTED: '#ff4444',
    }
    if (Object.keys(statusCounts).length > 0) {
      const statusChart = echarts.init($('#wf-status-chart'), getTheme() === 'dark' ? 'dark' : null)
      registerChart(statusChart)
      statusChart.setOption({
        tooltip: { trigger: 'item' },
        series: [{
          type: 'pie', radius: ['35%', '65%'],
          label: { color: '#a1a1a1', fontSize: 11 },
          data: Object.entries(statusCounts).map(([status, count]) => ({
            name: status, value: count,
            itemStyle: { color: statusColors[status] || '#888' },
          })),
        }],
      })
    }

    // Gate failures bar
    const gateFailures = Object.entries(gateStats)
      .map(([name, s]) => ({ name, failed: s.total - s.passed }))
      .filter(g => g.failed > 0)
      .sort((a, b) => b.failed - a.failed)
      .slice(0, 10)

    if (gateFailures.length > 0) {
      const gateBar = echarts.init($('#wf-gate-bar'), getTheme() === 'dark' ? 'dark' : null)
      registerChart(gateBar)
      gateBar.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: 120, right: 20, top: 10, bottom: 30 },
        xAxis: { type: 'value', axisLabel: { color: '#a1a1a1' }, splitLine: { lineStyle: { color: '#2a2a2a' } } },
        yAxis: { type: 'category', data: gateFailures.map(g => g.name), axisLabel: { color: '#a1a1a1', fontSize: 11 } },
        series: [{
          type: 'bar',
          data: gateFailures.map(g => ({
            value: g.failed,
            itemStyle: { color: '#ff4444', borderRadius: [0, 4, 4, 0] },
          })),
          barWidth: 18,
        }],
      })
    } else {
      const el = $('#wf-gate-bar')
      if (el) el.innerHTML = `<div class="empty-state"><p>${t('common.noData')}</p></div>`
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  function formatAction(action) {
    const map = {
      SUBMIT_FOR_REVIEW: 'Submit',
      APPROVE: 'Approve',
      REJECT: 'Reject',
      COMPLETE: 'Complete',
      FREEZE: 'Freeze',
      UNFREEZE: 'Unfreeze',
      REOPEN: 'Reopen',
      ARCHIVE: 'Archive',
    }
    return map[action] || action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  }

  function flattenArtifacts(roots) {
    const result = []
    const walk = (nodes, depth = 0) => {
      for (const n of nodes ?? []) {
        result.push({ ...n, depth })
        walk(n.children, depth + 1)
      }
    }
    walk(roots)
    return result
  }

  function wireActionButtons(container) {
    $$('.wf-action', container).forEach(btn => {
      btn.addEventListener('click', async () => {
        const { id, action } = btn.dataset
        const originalText = btn.textContent
        btn.disabled = true; btn.textContent = t('common.loading')
        try {
          const res = await fetch(`/api/artifacts/${id}/transition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          })
          const data = await res.json()
          if (data.success) {
            showToast(t('workflow.gates') + ' \u2713', 'success')
            renderWorkflow()
          } else {
            showToast(t('workflow.transitionFailed', { error: data.error }), 'error')
            btn.disabled = false; btn.textContent = originalText
          }
        } catch (e) {
          showToast(t('workflow.error', { message: e.message }), 'error')
          btn.disabled = false; btn.textContent = originalText
        }
      })
    })
  }

  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.workflow = renderWorkflow
})()
