/**
 * Knowledge Page - Memory Brain nodes, provider status, and explicit recall.
 */
;(() => {
  'use strict'

  const { copyText, downloadText, fetchJSON, formatTime, runtimeLabel, t, $, dom } = window.Dashboard
  const { autoRefreshControl, dataNote, dataTable, el, emptyState, metricCard, panel, renderText } = dom
  let lastReport = null
  let lastQuery = ''
  let localStatusFilter = ''
  let reviewMessage = ''

  async function renderKnowledge() {
    const app = $('#app')
    const search = el('input', {
      id: 'knowledge-search',
      type: 'text',
      className: 'search-box',
      placeholder: t('knowledge.searchPlaceholder'),
      style: { flex: '1', maxWidth: '460px' },
    })
    const recall = el('button', { id: 'knowledge-recall', className: 'topo-btn', text: t('knowledge.recall') })
    const refresh = el('button', { id: 'knowledge-refresh', className: 'topo-btn', text: t('common.refresh') })
    const copyButton = el('button', { id: 'knowledge-copy-json', className: 'topo-btn', text: t('common.copyJson') })
    const exportButton = el('button', { id: 'knowledge-export', className: 'topo-btn', text: t('knowledge.exportAll') })
    const localFilter = el('select', {
      id: 'knowledge-local-filter',
      className: 'search-box',
      title: t('knowledge.localFilter'),
      style: { width: '180px' },
    }, [
      el('option', { value: '', text: t('knowledge.allStatuses') }),
    ])

    app.replaceChildren(
      el('div', { className: 'page-toolbar' }, [
        search,
        recall,
        refresh,
        copyButton,
        exportButton,
        autoRefreshControl(() => loadKnowledge(search.value.trim())),
        el('label', { className: 'field-label' }, [
          el('span', { text: t('knowledge.localFilter') }),
          localFilter,
        ]),
      ]),
      el('div', { id: 'knowledge-data-note' }),
      el('div', { className: 'metric-grid', id: 'knowledge-summary' }),
      panel(t('knowledge.operations'), 'knowledge-operations'),
      panel(t('knowledge.reviewQueue'), 'knowledge-review'),
      el('div', { className: 'grid-2', style: { marginTop: '16px' } }, [
        panel(t('knowledge.providers'), 'knowledge-providers'),
        panel(t('knowledge.recallResults'), 'knowledge-recall-results'),
      ]),
      panel(t('knowledge.localMemory'), 'knowledge-local', { className: 'mt-3' }),
      panel(t('knowledge.warnings'), 'knowledge-warnings', { className: 'mt-3' }),
    )

    const load = () => loadKnowledge(search.value.trim())
    recall.addEventListener('click', load)
    refresh.addEventListener('click', () => loadKnowledge(''))
    copyButton.addEventListener('click', () => copyKnowledgeSection('all', copyButton))
    exportButton.addEventListener('click', exportKnowledge)
    localFilter.addEventListener('change', () => {
      localStatusFilter = localFilter.value
      renderLocal(lastReport?.local)
    })
    search.addEventListener('keydown', event => {
      if (event.key === 'Enter') load()
    })

    await loadKnowledge('')
  }

  async function loadKnowledge(query) {
    const params = new URLSearchParams({ limit: '20' })
    if (query) {
      params.set('query', query)
      params.set('recall', '1')
    }
    const report = await fetchJSON(`/api/knowledge?${params.toString()}`)
    const localContainer = $('#knowledge-local')
    if (!report) {
      if (localContainer) renderText(localContainer, t('knowledge.failedToLoad'))
      return
    }
    if (!$('#knowledge-summary')) return
    lastReport = report
    lastQuery = query
    renderSummary(report)
    renderDataNote(report)
    renderOperations(report)
    renderReviewQueue(report)
    renderProviders(report.providers)
    renderRecall(report.recall)
    renderLocal(report.local)
    renderWarnings(report.warnings || [])
  }

  function renderDataNote(report) {
    const node = $('#knowledge-data-note')
    if (!node) return
    const providerCount = report.providers?.availableProviderCount ?? 0
    node.replaceChildren(dataNote([
      { strong: true, text: t('common.snapshot') },
      `${t('common.lastLoaded')}: ${formatTime(Date.now())}`,
      t('knowledge.dataHint'),
      `${t('knowledge.providersReady')}: ${providerCount}`,
    ]))
  }

  function renderSummary(report) {
    const summary = $('#knowledge-summary')
    if (!summary) return
    const local = report.local || { total: 0, byStatus: {} }
    const providers = report.providers?.providers || []
    const recallItems = report.recall?.items || []
    summary.replaceChildren(
      metricCard(t('knowledge.localNodes'), local.total ?? 0),
      metricCard(t('knowledge.activeNodes'), local.byStatus?.active ?? 0),
      metricCard(t('knowledge.providersReady'), providers.filter(provider => provider.available).length),
      metricCard(t('knowledge.recalledItems'), recallItems.length),
    )
  }

  function renderOperations(report) {
    const container = $('#knowledge-operations')
    if (!container) return
    const local = report.local || { total: 0, nodes: [] }
    const providers = report.providers?.providers || []
    const recallItems = report.recall?.items || []
    const actions = [
      actionButton(t('knowledge.copyLocal'), button => copyKnowledgeSection('local', button)),
      actionButton(t('knowledge.exportLocal'), () => exportKnowledgeSection('local')),
      actionButton(t('knowledge.copyRecall'), button => copyKnowledgeSection('recall', button)),
      actionButton(t('knowledge.exportRecall'), () => exportKnowledgeSection('recall')),
    ]
    const rows = [
      sourceRow(t('knowledge.localBrainSource'), local.available ? local.total : 0, true),
      sourceRow(t('knowledge.providerSource'), providers.length, true),
      sourceRow(t('knowledge.recallSource'), recallItems.length, true),
    ]
    container.replaceChildren(
      el('div', { className: 'action-row', style: { marginBottom: '12px' } }, actions),
      dataNote([
        { strong: true, text: t('knowledge.managementScope') },
        t('knowledge.managementScopeHint'),
        t('knowledge.fullProviderExportHint'),
      ]),
      dataTable([t('knowledge.source'), t('knowledge.count'), t('knowledge.exportable')], rows),
    )
  }

  function renderReviewQueue(report) {
    const container = $('#knowledge-review')
    if (!container) return
    const packet = memoryReviewPacket(report)
    const copy = actionButton(t('knowledge.copyReviewPacket'), button => copyText(JSON.stringify(packet, null, 2), button))
    const exportButton = actionButton(t('knowledge.exportReviewPacket'), () => {
      downloadText(`scale-memory-review-${Date.now()}.json`, JSON.stringify(packet, null, 2), 'application/json;charset=utf-8')
    })
    const summary = packet.summary
    const blocks = [
      reviewBlock(t('knowledge.candidates'), summary.candidate),
      reviewBlock(t('knowledge.stale'), summary.stale),
      reviewBlock(t('knowledge.rejected'), summary.rejected),
      reviewBlock(t('knowledge.missingEvidence'), summary.missingEvidence),
    ]

    const children = [
      el('div', { className: 'action-row', style: { marginBottom: '12px' } }, [copy, exportButton]),
      el('div', { id: 'knowledge-review-message', className: 'text-muted text-sm', text: reviewMessage, style: { marginBottom: '10px' } }),
      dataNote([{ strong: true, text: t('knowledge.reviewQueue') }, t('knowledge.reviewQueueHint')]),
      el('div', { className: 'review-grid' }, blocks),
    ]

    if (packet.items.length === 0) {
      children.push(emptyStateWithHint(t('knowledge.noReviewItems'), t('knowledge.noReviewItemsHint'), '\u25cc'))
    } else {
      children.push(el('div', { className: 'list' }, packet.items.map(item => renderReviewItem(item))))
    }
    container.replaceChildren(...children)
  }

  function reviewBlock(label, count) {
    return el('div', { className: 'review-item' }, [
      el('div', { className: 'review-count', text: count }),
      el('div', { className: 'review-label', text: label }),
    ])
  }

  function renderReviewItem(item) {
    const copyId = actionButton(t('common.copy'), button => copyText(item.id, button))
    const copyEvidence = actionButton(t('knowledge.evidence'), button => copyText((item.evidencePaths || []).join('\n'), button))
    const reviewActions = reviewActionsFor(item).map(action => actionButton(reviewActionLabel(action), button => reviewMemoryNode(item.id, action, button)))
    return el('div', { className: 'list-item' }, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px' } }, [
        el('strong', { text: item.title || item.id }),
        el('span', { className: 'status-badge', text: runtimeLabel('status', item.status) }),
      ]),
      el('p', { text: item.summary || '', style: { margin: '6px 0', lineHeight: '1.5' } }),
      el('div', { className: 'text-muted text-sm', text: `${item.type} · ${item.layer} · ${t('common.confidence')} ${formatScore(item.confidence)}` }),
      el('div', { className: 'action-row', style: { marginTop: '8px' } }, [copyId, copyEvidence, ...reviewActions]),
    ])
  }

  function reviewActionsFor(item) {
    if (item.status === 'candidate') return ['approve', 'reject']
    if (item.status === 'active' && item.reason === 'missing-evidence') return ['stale']
    if (item.status === 'stale' || item.status === 'rejected') return ['restore']
    return []
  }

  function reviewActionLabel(action) {
    if (action === 'approve') return t('knowledge.approveMemory')
    if (action === 'reject') return t('knowledge.rejectMemory')
    if (action === 'stale') return t('knowledge.markStale')
    return t('knowledge.restoreMemory')
  }

  async function reviewMemoryNode(id, action, button) {
    const message = $('#knowledge-review-message')
    const original = button.textContent
    button.disabled = true
    button.textContent = t('common.refreshing')
    try {
      const response = await fetch(`/api/knowledge/local/${encodeURIComponent(id)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: t('knowledge.reviewReason') }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success) throw new Error(result.error || `${response.status} ${response.statusText}`)
      reviewMessage = t('knowledge.reviewSucceeded', { id: result.evidence?.id || '-' })
      if (message) message.textContent = reviewMessage
      await loadKnowledge(lastQuery)
    } catch (error) {
      reviewMessage = t('knowledge.reviewFailed', { error: errorMessage(error) })
      if (message) message.textContent = reviewMessage
    } finally {
      button.disabled = false
      button.textContent = original
    }
  }

  function memoryReviewPacket(report) {
    const nodes = report?.local?.nodes || []
    const items = nodes
      .filter(node => ['candidate', 'stale', 'rejected'].includes(node.status) || (node.status === 'active' && (node.evidencePaths || []).length === 0))
      .map(node => ({
        id: node.id,
        title: node.title,
        summary: node.summary,
        type: node.type,
        layer: node.layer,
        status: node.status,
        confidence: node.confidence,
        evidencePaths: node.evidencePaths || [],
        updatedAt: node.updatedAt,
        reason: reviewReason(node),
      }))
    return {
      exportedAt: new Date().toISOString(),
      project: report?.project ?? null,
      summary: {
        total: nodes.length,
        candidate: nodes.filter(node => node.status === 'candidate').length,
        stale: nodes.filter(node => node.status === 'stale').length,
        rejected: nodes.filter(node => node.status === 'rejected').length,
        missingEvidence: nodes.filter(node => node.status === 'active' && (node.evidencePaths || []).length === 0).length,
        reviewItems: items.length,
      },
      items,
      writePolicy: t('knowledge.managementScopeHint'),
    }
  }

  function reviewReason(node) {
    if (node.status === 'candidate') return 'candidate'
    if (node.status === 'stale') return 'stale'
    if (node.status === 'rejected') return 'rejected'
    if (node.status === 'active' && (node.evidencePaths || []).length === 0) return 'missing-evidence'
    return 'review'
  }

  function renderProviders(providersReport) {
    const container = $('#knowledge-providers')
    if (!container) return
    const providers = providersReport?.providers || []
    if (providers.length === 0) {
      container.replaceChildren(emptyState(t('knowledge.noProviders'), '\u25cc'))
      return
    }
    container.replaceChildren(el('div', { className: 'list' }, providers.map(provider => el('div', { className: 'list-item' }, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px' } }, [
        el('strong', { text: provider.id }),
        el('span', {
          className: provider.available ? 'status-badge passed' : 'status-badge failed',
          text: provider.available ? t('knowledge.available') : t('knowledge.unavailable'),
        }),
      ]),
      el('div', { className: 'text-muted text-sm', text: `${provider.kind || '-'} · ${provider.reason || ''}` }),
    ]))))
  }

  function renderRecall(recall) {
    const container = $('#knowledge-recall-results')
    if (!container) return
    const items = recall?.items || []
    if (items.length === 0) {
      container.replaceChildren(emptyStateWithHint(t('knowledge.noRecall'), t('knowledge.noRecallHint'), '\u2315'))
      return
    }
    container.replaceChildren(el('div', { className: 'list' }, items.map(item => renderKnowledgeItem({
      title: item.title,
      summary: item.summary,
      status: item.provider,
      meta: `${t('common.score')} ${formatScore(item.score)} · ${t('common.confidence')} ${formatScore(item.confidence)}`,
      evidencePaths: item.evidencePaths || [],
    }))))
  }

  function renderLocal(local) {
    const container = $('#knowledge-local')
    if (!container) return
    const nodes = local?.nodes || []
    if (!local?.available) {
      container.replaceChildren(emptyStateWithHint(t('knowledge.noLocalBrain'), t('knowledge.noLocalBrainHint'), '\u25cc'))
      return
    }
    if (nodes.length === 0) {
      container.replaceChildren(emptyStateWithHint(t('knowledge.noLocalNodes'), t('knowledge.noLocalNodesHint'), '\u25cc'))
      return
    }
    const filtered = localStatusFilter ? nodes.filter(node => node.status === localStatusFilter) : nodes
    updateLocalFilter(nodes)
    if (filtered.length === 0) {
      container.replaceChildren(emptyStateWithHint(t('common.noData'), t('knowledge.managementScopeHint'), '\u25cc'))
      return
    }
    container.replaceChildren(el('div', { className: 'list' }, filtered.map(node => renderKnowledgeItem({
      title: node.title,
      summary: node.summary,
      status: node.status,
      meta: `${node.type} · ${node.layer} · ${t('common.confidence')} ${formatScore(node.confidence)}`,
      evidencePaths: node.evidencePaths || [],
    }))))
  }

  function updateLocalFilter(nodes) {
    const filter = $('#knowledge-local-filter')
    if (!filter) return
    const statuses = [...new Set(nodes.map(node => node.status).filter(Boolean))].sort()
    const current = filter.value
    filter.replaceChildren(
      el('option', { value: '', text: t('knowledge.allStatuses') }),
      ...statuses.map(status => el('option', {
        value: status,
        text: runtimeLabel('status', status),
        attrs: { selected: status === current ? true : null },
      })),
    )
    filter.value = statuses.includes(current) ? current : ''
    localStatusFilter = filter.value
  }

  function renderWarnings(warnings) {
    const container = $('#knowledge-warnings')
    if (!container) return
    if (!warnings.length) {
      container.replaceChildren(el('div', { className: 'text-muted text-sm', text: t('knowledge.noWarnings') }))
      return
    }
    container.replaceChildren(el('ul', {}, warnings.map(warning => el('li', { text: warning }))))
  }

  function renderKnowledgeItem(item) {
    return el('div', { className: 'list-item' }, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px' } }, [
        el('strong', { text: item.title || '(untitled)' }),
        el('span', { className: 'status-badge', text: runtimeLabel('status', item.status) }),
      ]),
      el('p', { text: item.summary || '', style: { margin: '6px 0', lineHeight: '1.5' } }),
      el('div', { className: 'text-muted text-sm', text: item.meta || '' }),
      renderEvidence(item.evidencePaths),
    ])
  }

  function renderEvidence(paths) {
    if (!paths?.length) return el('div', { className: 'text-muted text-sm', text: t('knowledge.noEvidence') })
    return el('div', {
      className: 'text-muted text-sm',
      text: `${t('knowledge.evidence')}: ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? '...' : ''}`,
    })
  }

  function emptyStateWithHint(message, hint, icon) {
    const state = emptyState(message, icon)
    state.appendChild(el('p', { className: 'text-muted text-sm', text: hint, style: { marginTop: '8px' } }))
    return state
  }

  function exportKnowledge() {
    const payload = knowledgePayload('all')
    const text = JSON.stringify(payload, null, 2)
    downloadText(`scale-knowledge-${Date.now()}.json`, text, 'application/json;charset=utf-8')
  }

  function exportKnowledgeSection(section) {
    const text = JSON.stringify(knowledgePayload(section), null, 2)
    downloadText(`scale-knowledge-${section}-${Date.now()}.json`, text, 'application/json;charset=utf-8')
  }

  function copyKnowledgeSection(section, button) {
    return copyText(JSON.stringify(knowledgePayload(section), null, 2), button)
  }

  function knowledgePayload(section) {
    const payload = {
      exportedAt: new Date().toISOString(),
      query: lastQuery,
      section,
    }
    if (section === 'local') return { ...payload, local: lastReport?.local ?? null }
    if (section === 'recall') return { ...payload, recall: lastReport?.recall ?? null }
    if (section === 'providers') return { ...payload, providers: lastReport?.providers ?? null }
    return { ...payload, report: lastReport }
  }

  function actionButton(text, onClick) {
    const button = el('button', { className: 'topo-btn', text })
    button.addEventListener('click', () => onClick(button))
    return button
  }

  function sourceRow(source, count, exportable) {
    return el('tr', {}, [
      el('td', { text: source }),
      el('td', { text: String(count ?? 0) }),
      el('td', { text: exportable ? t('common.yes') : t('common.no') }),
    ])
  }

  function formatScore(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-'
    return value.toFixed(2)
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || 'Unknown error')
  }

  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.knowledge = renderKnowledge
})()
