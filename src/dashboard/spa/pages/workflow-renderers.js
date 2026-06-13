/**
 * Workflow page renderers. Kept separate from workflow data flow so the page stays small enough for standards gates.
 */
;(() => {
  'use strict'

  const { relativeTime, registerChart, getTheme, runtimeLabel, t, $, dom } = window.Dashboard
  const { chartContainer, el, emptyState, safeClassToken } = dom
  const STATUS_COLORS = { DRAFT: '#666', REVIEWING: '#ffaa00', FROZEN: '#5588ff', COMPLETED: '#00dc82', BLOCKED: '#ff4444', IN_PROGRESS: '#ffaa00', DONE: '#00dc82', PROPOSED: '#5588ff', APPROVED: '#00dc82', REJECTED: '#ff4444' }

  function renderCards(container, artifacts, ctx) {
    if (artifacts.length === 0) {
      container.replaceChildren(emptyState(t('workflow.noArtifactMatch'), '\uD83D\uDCC4'))
      return
    }
    container.replaceChildren(el('div', { className: 'artifact-grid' }, artifacts.map(artifact => artifactCard(artifact))))
    ctx.wireActionButtons(container)
  }

  function artifactCard(artifact) {
    const gates = artifact.gates ?? []
    const children = [
      el('div', { className: 'artifact-card-header' }, [
        el('span', { className: 'artifact-card-title', text: artifact.title ?? artifact.id ?? '' }),
        statusBadge(artifact.status),
      ]),
      el('div', { className: 'artifact-card-meta', text: `${artifact.type ?? '-'} \u00b7 v${artifact.version ?? '?'} \u00b7 ${relativeTime(artifact.createdAt)}` }),
    ]
    if (gates.length > 0) children.push(gateProgressBlock(gates))
    if (artifact.children?.length) children.push(el('div', { text: t('workflow.childArtifacts', { count: artifact.children.length }), style: { fontSize: '11px', color: 'var(--text-2)', marginTop: '6px' } }))
    children.push(actionButtons(artifact))
    return el('div', { className: 'artifact-card', dataset: { id: artifact.id ?? '' } }, children)
  }

  function renderTable(container, artifacts, ctx) {
    if (artifacts.length === 0) {
      container.replaceChildren(emptyState(t('workflow.noArtifactMatch')))
      return
    }
    const headers = [
      sortableHeader('title', t('workflow.colTitle'), ctx),
      sortableHeader('type', t('workflow.colType'), ctx),
      sortableHeader('status', t('workflow.colStatus'), ctx),
      sortableHeader('version', t('workflow.colVersion'), ctx),
      el('th', { text: t('workflow.colGates') }),
      el('th', { text: t('workflow.colCreated') }),
      el('th', { text: t('workflow.colActions') }),
    ]
    container.replaceChildren(el('table', { className: 'data-table' }, [
      el('thead', {}, [el('tr', {}, headers)]),
      el('tbody', {}, artifacts.map(tableRow)),
    ]))
    ;[...container.querySelectorAll('th[data-sort]')].forEach(header => {
      header.addEventListener('click', () => ctx.onSort(header.dataset.sort))
    })
    ctx.wireActionButtons(container)
  }

  function tableRow(artifact) {
    const gates = artifact.gates ?? []
    const passed = gates.filter(gate => gate.passed).length
    const gateCell = gates.length > 0
      ? el('span', { text: `${passed}/${gates.length}`, style: { color: passed === gates.length ? '#00dc82' : '#ffaa00' } })
      : el('span', { className: 'text-muted', text: '-' })
    return el('tr', {}, [
      el('td', { text: artifact.title ?? artifact.id ?? '', style: { fontWeight: '500' } }),
      el('td', { className: 'text-muted', text: artifact.type ?? '-' }),
      el('td', {}, [statusBadge(artifact.status)]),
      el('td', { className: 'text-muted', text: `v${artifact.version ?? '?'}` }),
      el('td', {}, [gateCell]),
      el('td', { className: 'text-muted text-sm', text: relativeTime(artifact.createdAt) }),
      el('td', {}, [actionButtons(artifact, true)]),
    ])
  }

  function renderDependencyGraph(container, artifacts) {
    if (artifacts.length === 0) {
      container.replaceChildren(emptyState(t('workflow.noArtifacts'), '\uD83D\uDCC4'))
      return
    }
    const graph = chartContainer(t('workflow.artifactDependencyGraph'), 'wf-dep-graph')
    graph.querySelector('.chart-header')?.appendChild(el('span', { className: 'text-muted text-sm', text: t('workflow.artifactCount', { count: artifacts.length }) }))
    const graphArea = graph.querySelector('#wf-dep-graph')
    if (graphArea) graphArea.style.height = '500px'
    container.replaceChildren(graph)

    const graphNode = $('#wf-dep-graph')
    if (!graphNode) return
    const chart = echarts.init(graphNode, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)

    const nodes = artifacts.map(artifact => ({
      id: artifact.id,
      name: truncate(artifact.title ?? artifact.id ?? '', 25),
      symbolSize: 12 + (artifact.children?.length ?? 0) * 4,
      itemStyle: { color: STATUS_COLORS[artifact.status] || '#888' },
      category: artifact.type,
    }))
    const links = []
    for (const artifact of artifacts) for (const child of artifact.children ?? []) links.push({ source: artifact.id, target: child.id })
    const categories = [...new Set(artifacts.map(artifact => artifact.type).filter(Boolean))].map(type => ({ name: type }))

    chart.setOption({
      tooltip: { renderMode: 'richText', formatter: params => nodeTooltip(params, artifacts) },
      legend: { data: categories.map(category => category.name), textStyle: { color: '#a1a1a1', fontSize: 11 }, bottom: 0, type: 'scroll' },
      series: [{ type: 'graph', layout: 'force', roam: true, draggable: true, force: { repulsion: 200, gravity: 0.1, edgeLength: 80 }, label: { show: true, fontSize: 10, color: '#a1a1a1' }, data: nodes, links, categories, lineStyle: { color: '#444', curveness: 0.1 }, emphasis: { focus: 'adjacency', lineStyle: { width: 3 } } }],
    })
  }

  function renderGateAnalysis(container, artifacts) {
    if (artifacts.length === 0) {
      container.replaceChildren(emptyState(t('workflow.noArtifacts'), '\uD83D\uDCC4'))
      return
    }
    container.replaceChildren(
      el('div', { className: 'grid-2 mb-24' }, [chartContainer(t('workflow.gatePassRate'), 'wf-radar'), chartContainer(t('workflow.typeDistribution'), 'wf-type-chart')]),
      el('div', { className: 'grid-2' }, [chartContainer(t('workflow.statusDistribution'), 'wf-status-chart'), chartContainer(t('workflow.gateFailuresByName'), 'wf-gate-bar')])
    )
    const gateStats = {}
    for (const artifact of artifacts) for (const gate of artifact.gates ?? []) {
      if (!gateStats[gate.name]) gateStats[gate.name] = { passed: 0, total: 0 }
      gateStats[gate.name].total++
      if (gate.passed) gateStats[gate.name].passed++
    }
    renderGateRadar(gateStats)
    renderTypeDistribution(artifacts)
    renderStatusDistribution(artifacts)
    renderGateFailures(gateStats)
  }

  function renderGateRadar(gateStats) {
    const node = $('#wf-radar')
    const gateNames = Object.keys(gateStats).slice(0, 10)
    if (!node) return
    if (gateNames.length === 0) return node.replaceChildren(emptyState(t('common.noData')))
    const radar = echarts.init(node, getTheme() === 'dark' ? 'dark' : null)
    registerChart(radar)
    radar.setOption({
      tooltip: {},
      radar: { indicator: gateNames.map(gate => ({ name: gate, max: gateStats[gate].total })), axisName: { color: '#a1a1a1', fontSize: 10 }, splitArea: { areaStyle: { color: ['rgba(0,220,130,0.02)', 'rgba(0,220,130,0.05)'] } } },
      series: [{ type: 'radar', data: [
        { value: gateNames.map(gate => gateStats[gate].passed), name: t('monitoring.passed'), areaStyle: { color: 'rgba(0,220,130,0.2)' }, lineStyle: { color: '#00dc82' }, itemStyle: { color: '#00dc82' } },
        { value: gateNames.map(gate => gateStats[gate].total - gateStats[gate].passed), name: t('monitoring.failed'), areaStyle: { color: 'rgba(255,68,68,0.2)' }, lineStyle: { color: '#ff4444' }, itemStyle: { color: '#ff4444' } },
      ] }],
    })
  }

  function renderTypeDistribution(artifacts) {
    const node = $('#wf-type-chart')
    if (!node) return
    const counts = {}
    for (const artifact of artifacts) counts[artifact.type] = (counts[artifact.type] ?? 0) + 1
    const entries = Object.entries(counts)
    if (entries.length === 0) return node.replaceChildren(emptyState(t('common.noData')))
    const chart = echarts.init(node, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)
    chart.setOption({ tooltip: { trigger: 'item' }, series: [{ type: 'pie', radius: ['35%', '65%'], label: { color: '#a1a1a1', fontSize: 11 }, data: entries.map(([type, count]) => ({ name: type, value: count })) }] })
  }

  function renderStatusDistribution(artifacts) {
    const node = $('#wf-status-chart')
    if (!node) return
    const counts = {}
    for (const artifact of artifacts) counts[artifact.status] = (counts[artifact.status] ?? 0) + 1
    const entries = Object.entries(counts)
    if (entries.length === 0) return node.replaceChildren(emptyState(t('common.noData')))
    const chart = echarts.init(node, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)
    chart.setOption({ tooltip: { trigger: 'item' }, series: [{ type: 'pie', radius: ['35%', '65%'], label: { color: '#a1a1a1', fontSize: 11 }, data: entries.map(([status, count]) => ({ name: runtimeLabel('status', status), value: count, itemStyle: { color: STATUS_COLORS[status] || '#888' } })) }] })
  }

  function renderGateFailures(gateStats) {
    const node = $('#wf-gate-bar')
    if (!node) return
    const failures = Object.entries(gateStats).map(([name, stats]) => ({ name, failed: stats.total - stats.passed })).filter(gate => gate.failed > 0).sort((left, right) => right.failed - left.failed).slice(0, 10)
    if (failures.length === 0) return node.replaceChildren(emptyState(t('common.noData')))
    const chart = echarts.init(node, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 120, right: 20, top: 10, bottom: 30 },
      xAxis: { type: 'value', axisLabel: { color: '#a1a1a1' }, splitLine: { lineStyle: { color: '#2a2a2a' } } },
      yAxis: { type: 'category', data: failures.map(gate => gate.name), axisLabel: { color: '#a1a1a1', fontSize: 11 } },
      series: [{ type: 'bar', data: failures.map(gate => ({ value: gate.failed, itemStyle: { color: '#ff4444', borderRadius: [0, 4, 4, 0] } })), barWidth: 18 }],
    })
  }

  function actionButtons(artifact, compact = false) {
    const style = { marginTop: compact ? '0' : '10px', display: 'flex', gap: compact ? '4px' : '6px', flexWrap: 'wrap' }
    return el('div', { style }, (artifact.availableActions ?? []).map(action => el('button', {
      className: 'topo-btn wf-action',
      text: formatAction(action),
      dataset: { id: artifact.id ?? '', action },
      style: compact ? { fontSize: '11px', padding: '3px 8px' } : {},
    })))
  }

  function gateProgressBlock(gates) {
    const passed = gates.filter(gate => gate.passed).length
    const progress = gates.length > 0 ? Math.round((passed / gates.length) * 100) : 0
    return el('div', { style: { margin: '10px 0' } }, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-2)', marginBottom: '4px' } }, [el('span', { text: t('workflow.gates') }), el('span', { text: `${passed}/${gates.length}` })]),
      el('div', { style: { height: '4px', background: 'var(--bg-3)', borderRadius: '2px', overflow: 'hidden' } }, [el('div', { style: { height: '100%', width: `${progress}%`, background: gateProgressColor(progress), borderRadius: '2px', transition: 'width 0.3s' } })]),
      el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' } }, gates.map(gate => el('span', { className: `gate-pill ${gate.passed ? 'passed' : 'failed'}`, text: gate.name, title: gate.name }))),
    ])
  }

  function sortableHeader(column, label, ctx) {
    const active = ctx.sortCol() === column
    const icon = active ? (ctx.sortDir() === 'asc' ? ' \u2191' : ' \u2193') : ''
    return el('th', { text: `${label}${icon}`, dataset: { sort: column }, style: { cursor: 'pointer' } })
  }

  function statusBadge(status) {
    return el('span', { className: `badge-status badge-${safeClassToken(status)}`, text: runtimeLabel('status', status) })
  }

  function gateProgressColor(progress) {
    if (progress === 100) return '#00dc82'
    return progress > 50 ? '#ffaa00' : '#ff4444'
  }

  function formatAction(action) {
    return runtimeLabel('action', action)
  }

  function nodeTooltip(params, artifacts) {
    if (params.dataType !== 'node') return ''
    const artifact = artifacts.find(candidate => candidate.id === params.data.id)
    return [artifact?.title ?? params.name, `${artifact?.type ?? '-'} - ${runtimeLabel('status', artifact?.status)}`, `v${artifact?.version ?? '?'}`].join('\n')
  }

  function truncate(value, maxLength) {
    const text = String(value ?? '')
    return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3))}...`
  }

  window.DashboardWorkflowRenderers = { renderCards, renderDependencyGraph, renderGateAnalysis, renderTable }
})()
