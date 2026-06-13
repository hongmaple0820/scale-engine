/**
 * Workflow Page v3 - data flow and page events.
 */
;(() => {
  'use strict'

  const { fetchJSON, t, $, $$, dom } = window.Dashboard
  const { el } = dom
  const renderers = window.DashboardWorkflowRenderers

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
    const statusFilter = selectFilter('wf-status-filter', `${t('common.all')} ${t('workflow.status')}`)
    const typeFilter = selectFilter('wf-type-filter', `${t('common.all')} ${t('workflow.type')}`)
    const searchInput = el('input', {
      id: 'wf-search',
      type: 'text',
      className: 'search-box',
      placeholder: `${t('common.search')}...`,
      value: filterText,
      style: { width: '200px' },
    })

    app.replaceChildren(
      el('div', { className: 'tabs', id: 'wf-tabs' }, [
        tabButton('cards', t('workflow.cards'), true),
        tabButton('table', t('workflow.table')),
        tabButton('graph', t('workflow.dependencyGraph')),
        tabButton('gates', t('workflow.gateAnalysis')),
      ]),
      el('div', {
        id: 'wf-filters',
        style: { display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' },
      }, [statusFilter, typeFilter, searchInput, el('span', { className: 'text-muted text-sm', id: 'wf-count' })]),
      el('div', { id: 'wf-content' }, [el('div', { className: 'loading-placeholder', text: t('common.loading') })])
    )

    currentState = await fetchJSON('/api/state')
    allArtifacts = flattenArtifacts(currentState?.artifacts ?? [])
    await hydrateActions(allArtifacts)
    populateFilters(statusFilter, typeFilter)

    let currentTab = 'cards'
    statusFilter.addEventListener('change', event => { filterStatus = event.target.value; renderCurrentTab() })
    typeFilter.addEventListener('change', event => { filterType = event.target.value; renderCurrentTab() })
    searchInput.addEventListener('input', event => { filterText = event.target.value.toLowerCase(); renderCurrentTab() })
    $('#wf-tabs').addEventListener('click', (event) => {
      const tab = event.target.dataset?.tab
      if (!tab) return
      currentTab = tab
      $$('#wf-tabs .tab').forEach(node => node.classList.toggle('active', node.dataset.tab === tab))
      renderCurrentTab()
    })

    function renderCurrentTab() {
      renderTab(currentTab, getFiltered(), currentState)
    }

    renderCurrentTab()
  }

  async function hydrateActions(artifacts) {
    await Promise.all(artifacts.map(async (artifact) => {
      try {
        const data = await fetchJSON(`/api/artifacts/${artifact.id}/actions`)
        artifact.availableActions = data?.actions ?? []
      } catch (error) {
        observeRecoverableError(error)
        artifact.availableActions = []
      }
    }))
  }

  function selectFilter(id, label) {
    return el('select', { id, className: 'search-box', style: { width: '140px' } }, [option('all', label)])
  }

  function tabButton(tab, label, active = false) {
    return el('div', { className: ['tab', active ? 'active' : ''].filter(Boolean).join(' '), text: label, dataset: { tab } })
  }

  function option(value, label) {
    return el('option', { value, text: label })
  }

  function populateFilters(statusSel, typeSel) {
    const statuses = new Set(allArtifacts.map(artifact => artifact.status).filter(Boolean))
    const types = new Set(allArtifacts.map(artifact => artifact.type).filter(Boolean))
    statusSel.append(...STATUS_ORDER.filter(status => statuses.has(status)).map(status => option(status, status)))
    statusSel.value = statuses.has(filterStatus) ? filterStatus : 'all'
    typeSel.append(...[...types].sort().map(type => option(type, type)))
    typeSel.value = types.has(filterType) ? filterType : 'all'
  }

  function getFiltered() {
    let result = allArtifacts
    if (filterStatus !== 'all') result = result.filter(artifact => artifact.status === filterStatus)
    if (filterType !== 'all') result = result.filter(artifact => artifact.type === filterType)
    if (filterText) {
      result = result.filter((artifact) => {
        const title = String(artifact.title ?? '').toLowerCase()
        const type = String(artifact.type ?? '').toLowerCase()
        return title.includes(filterText) || type.includes(filterText)
      })
    }
    if (!sortCol) return result
    return [...result].sort((left, right) => {
      const leftValue = left[sortCol] ?? ''
      const rightValue = right[sortCol] ?? ''
      const comparison = typeof leftValue === 'number' ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue))
      return sortDir === 'asc' ? comparison : -comparison
    })
  }

  function renderTab(tab, artifacts, state) {
    void state
    const container = $('#wf-content')
    const countNode = $('#wf-count')
    if (countNode) countNode.textContent = t('workflow.artifactCount', { count: artifacts.length })
    const ctx = {
      onSort: column => {
        if (sortCol === column) sortDir = sortDir === 'asc' ? 'desc' : 'asc'
        else { sortCol = column; sortDir = 'asc' }
        renderers.renderTable(container, getFiltered(), ctx)
      },
      sortCol: () => sortCol,
      sortDir: () => sortDir,
      wireActionButtons,
    }
    if (tab === 'table') return renderers.renderTable(container, artifacts, ctx)
    if (tab === 'graph') return renderers.renderDependencyGraph(container, artifacts)
    if (tab === 'gates') return renderers.renderGateAnalysis(container, artifacts)
    return renderers.renderCards(container, artifacts, ctx)
  }

  function showToast(msg, type = 'info') {
    let toast = $('#wf-toast')
    if (!toast) {
      toast = el('div', { id: 'wf-toast' })
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

  function flattenArtifacts(roots) {
    const result = []
    const walk = (nodes, depth = 0) => {
      for (const node of nodes ?? []) {
        result.push({ ...node, depth })
        walk(node.children, depth + 1)
      }
    }
    walk(roots)
    return result
  }

  function wireActionButtons(container) {
    $$('.wf-action', container).forEach((button) => {
      button.addEventListener('click', async () => {
        const { id, action } = button.dataset
        const originalText = button.textContent
        button.disabled = true
        button.textContent = t('common.loading')
        try {
          const response = await fetch(`/api/artifacts/${id}/transition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          })
          const data = await response.json()
          if (data.success) {
            showToast(`${t('workflow.gates')} \u2713`, 'success')
            renderWorkflow()
          } else {
            restoreActionButton(button, originalText)
            showToast(t('workflow.transitionFailed', { error: data.error }), 'error')
          }
        } catch (error) {
          restoreActionButton(button, originalText)
          showToast(t('workflow.error', { message: errorMessage(error) }), 'error')
        }
      })
    })
  }

  function restoreActionButton(button, text) {
    button.disabled = false
    button.textContent = text
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || 'Unknown error')
  }

  function observeRecoverableError(error) {
    void error
  }

  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.workflow = renderWorkflow
})()
