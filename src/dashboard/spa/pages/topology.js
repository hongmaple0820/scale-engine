/**
 * Topology page controller. Rendering lives in topology-renderers.js so this
 * file stays focused on data flow, Cytoscape setup, and interactions.
 */
;(() => {
  'use strict'

  const { fetchJSON, registerChart, getTheme, t, $, $$ } = window.Dashboard
  const renderers = window.DashboardTopologyRenderers
  const { LAYER_COLORS } = renderers

  let cy = null
  let topologyData = null
  let domainData = null
  let activeLayerFilters = new Set()
  let activeKindFilters = new Set()

  async function renderTopology() {
    const app = $('#app')
    renderers.renderLayout(app)

    const [topo, domains] = await Promise.all([
      fetchJSON('/api/topology'),
      fetchJSON('/api/topology/domains'),
    ])

    topologyData = topo
    domainData = domains
    cy = null

    if (!topologyData?.nodes?.length) {
      renderers.renderNoData($('#topology-cy'))
      return
    }

    renderLayerLegend()
    renderDomainPanel()
    renderKindFilter()
    initCytoscape(topologyData)
    wireControls()
    wireKeyboard()
  }

  function renderLayerLegend() {
    renderers.renderLayerLegend({
      container: $('#topo-layer-legend'),
      countNode: $('#topo-layer-count'),
      topologyData,
      activeLayerFilters,
      onToggle: layer => {
        toggleFilter(activeLayerFilters, layer)
        renderLayerLegend()
        applyFilters()
      },
    })
  }

  function renderKindFilter() {
    renderers.renderKindFilter({
      container: $('#topo-kind-legend'),
      topologyData,
      activeKindFilters,
      onToggle: kind => {
        toggleFilter(activeKindFilters, kind)
        renderKindFilter()
        applyFilters()
      },
    })
  }

  function renderDomainPanel() {
    renderers.renderDomainPanel({
      container: $('#topo-domains'),
      domainData,
      onSelect: domain => {
        if (!domain || !cy) return
        const nodeIds = new Set((domain.nodes ?? []).map(node => node.id))
        cy.elements().removeClass('highlighted dimmed')
        cy.nodes().forEach(node => {
          node.addClass(nodeIds.has(node.id()) ? 'highlighted' : 'dimmed')
        })
        showDomainDetail(domain)
      },
    })
  }

  function showDomainDetail(domain) {
    renderers.renderDomainDetail($('#topo-detail'), domain)
  }

  function initCytoscape(data) {
    if (!window.cytoscape) {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/cytoscape@3/dist/cytoscape.min.js'
      script.onload = () => {
        const dagre = document.createElement('script')
        dagre.src = 'https://cdn.jsdelivr.net/npm/cytoscape-dagre@2/cytoscape-dagre.min.js'
        dagre.onload = () => buildGraph(data)
        dagre.onerror = () => buildGraph(data)
        document.head.appendChild(dagre)
      }
      document.head.appendChild(script)
      return
    }
    buildGraph(data)
  }

  function buildGraph(data) {
    const container = $('#topology-cy')
    if (!container) return

    const maxNodes = 800
    const degreeMap = buildDegreeMap(data.edges)
    const sortedNodes = [...data.nodes].sort((a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0))
    const nodes = sortedNodes.slice(0, maxNodes)
    const nodeIds = new Set(nodes.map(node => node.id))
    const edges = data.edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    const maxDegree = Math.max(...nodes.map(node => degreeMap.get(node.id) ?? 0), 1)

    $('#topo-stats').textContent = `${nodes.length}/${data.nodes.length} ${t('topology.nodes')}, ${edges.length} ${t('topology.edges')}`
    cy = cytoscape({
      container,
      elements: [
        ...nodes.map(node => graphNode(node, degreeMap, maxDegree)),
        ...edges.map((edge, index) => ({ data: { id: `e${index}`, source: edge.source, target: edge.target, kind: edge.kind } })),
      ],
      style: graphStyles(),
      layout: { name: 'cose', animate: false, padding: 30, nodeRepulsion: () => 4000 },
      minZoom: 0.05,
      maxZoom: 10,
      wheelSensitivity: 0.3,
    })

    cy.on('mouseover', 'node', event => {
      const node = event.target
      const neighborhood = node.neighborhood().add(node)
      cy.elements().removeClass('highlighted').not(neighborhood).addClass('dimmed')
      neighborhood.removeClass('dimmed').addClass('highlighted')
    })
    cy.on('mouseout', 'node', () => cy.elements().removeClass('highlighted dimmed'))
    cy.on('tap', 'node', event => {
      showNodeDetail(event.target.data())
      highlightNeighbors(event.target)
    })
    cy.on('tap', event => {
      if (event.target === cy) {
        cy.elements().removeClass('highlighted dimmed')
        showNodeDetail(null)
      }
    })

    renderMinimap()
  }

  function buildDegreeMap(edges) {
    const degreeMap = new Map()
    for (const edge of edges) {
      degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1)
      degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1)
    }
    return degreeMap
  }

  function graphNode(node, degreeMap, maxDegree) {
    const degree = degreeMap.get(node.id) ?? 0
    return {
      data: {
        id: node.id,
        label: node.name,
        layer: node.layer ?? 'unknown',
        kind: node.kind,
        filePath: node.filePath,
        line: node.line,
        signature: node.signature,
        domain: node.domain,
        degree,
        size: 8 + Math.round((degree / maxDegree) * 20),
      },
    }
  }

  function graphStyles() {
    return [
      {
        selector: 'node',
        style: {
          'background-color': ele => LAYER_COLORS[ele.data('layer')] || '#555',
          label: ele => ele.data('degree') > 3 ? ele.data('label') : '',
          color: '#a1a1a1',
          'font-size': '10px',
          'text-valign': 'bottom',
          'text-margin-y': 5,
          width: 'data(size)',
          height: 'data(size)',
          'border-width': 1,
          'border-color': '#333',
          'transition-property': 'background-color, border-color, opacity',
          'transition-duration': '0.15s',
        },
      },
      { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#00dc82', 'font-weight': 'bold', label: 'data(label)' } },
      { selector: 'edge', style: { width: 1, 'line-color': '#333', 'target-arrow-color': '#333', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', opacity: 0.3, 'transition-property': 'line-color, opacity, width', 'transition-duration': '0.15s' } },
      { selector: '.highlighted', style: { 'background-color': '#00dc82', 'line-color': '#00dc82', 'target-arrow-color': '#00dc82', opacity: 1, width: 2, 'z-index': 10 } },
      { selector: '.search-match', style: { 'border-width': 3, 'border-color': '#ffaa00', 'background-color': '#ffaa00', label: 'data(label)', 'z-index': 20 } },
      { selector: '.dimmed', style: { opacity: 0.08 } },
    ]
  }

  function highlightNeighbors(node) {
    const neighborhood = node.neighborhood().add(node)
    cy.elements().removeClass('highlighted').addClass('dimmed')
    neighborhood.removeClass('dimmed').addClass('highlighted')
  }

  function renderMinimap() {
    const miniContainer = $('#topo-minimap')
    if (!miniContainer || !cy) return
    const canvas = renderers.renderMinimapCanvas(miniContainer)

    function drawMinimap() {
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, 160, 120)
      ctx.fillStyle = getTheme() === 'dark' ? '#111' : '#f5f5f5'
      ctx.fillRect(0, 0, 160, 120)

      const bb = cy.elements().boundingBox()
      if (bb.w === 0 || bb.h === 0) return
      const scale = Math.min(150 / bb.w, 110 / bb.h)
      const offsetX = (160 - bb.w * scale) / 2 - bb.x1 * scale
      const offsetY = (120 - bb.h * scale) / 2 - bb.y1 * scale

      cy.nodes().forEach(node => {
        const pos = node.position()
        ctx.fillStyle = LAYER_COLORS[node.data('layer')] || '#555'
        ctx.fillRect(pos.x * scale + offsetX - 1, pos.y * scale + offsetY - 1, 2, 2)
      })

      const ext = cy.extent()
      ctx.strokeStyle = '#00dc82'
      ctx.lineWidth = 1
      ctx.strokeRect(ext.x1 * scale + offsetX, ext.y1 * scale + offsetY, ext.w * scale, ext.h * scale)
    }

    cy.on('viewport', drawMinimap)
    drawMinimap()
  }

  function showNodeDetail(data) {
    const panel = $('#topo-detail')
    if (!data) {
      renderers.renderNodeEmpty(panel)
      return
    }
    const node = cy?.getElementById(data.id)
    renderers.renderNodeDetail(panel, data, {
      inDegree: node?.indegree?.() ?? 0,
      outDegree: node?.outdegree?.() ?? 0,
      callers: node?.incomers('node').map(item => item.data('label')).slice(0, 10) ?? [],
      callees: node?.outgoers('node').map(item => item.data('label')).slice(0, 10) ?? [],
    })
  }

  function applyFilters() {
    if (!cy) return
    const searchQ = ($('#topo-filter')?.value ?? '').toLowerCase()

    cy.nodes().forEach(node => {
      const layer = node.data('layer')
      const kind = node.data('kind')
      const label = String(node.data('label') ?? '').toLowerCase()
      const filePath = String(node.data('filePath') ?? '').toLowerCase()
      const layerOk = activeLayerFilters.size === 0 || !activeLayerFilters.has(layer)
      const kindOk = activeKindFilters.size === 0 || !activeKindFilters.has(kind)
      const searchOk = !searchQ || label.includes(searchQ) || filePath.includes(searchQ)

      node.style('display', layerOk && kindOk ? 'element' : 'none')
      node.toggleClass('search-match', Boolean(searchQ && searchOk && layerOk && kindOk))
    })

    cy.edges().forEach(edge => {
      const visible = edge.source().style('display') !== 'none' && edge.target().style('display') !== 'none'
      edge.style('display', visible ? 'element' : 'none')
    })
    updateVisibleStats()
  }

  function updateVisibleStats() {
    if (!cy) return
    const visible = cy.nodes().filter(node => node.style('display') !== 'none').length
    const total = topologyData?.nodes?.length ?? 0
    const visibleEdges = cy.edges().filter(edge => edge.style('display') !== 'none').length
    $('#topo-stats').textContent = `${visible}/${total} ${t('topology.nodes')}, ${visibleEdges} ${t('topology.edges')}`
  }

  function wireControls() {
    $$('.topo-btn[data-layout]', $('#topo-controls')).forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.topo-btn[data-layout]').forEach(item => item.classList.remove('active'))
        btn.classList.add('active')
        if (!cy) return
        const opts = { name: btn.dataset.layout, animate: true, padding: 30 }
        if (opts.name === 'dagre' && cy.dagre) {
          opts.rankDir = 'TB'
          opts.rankSep = 50
        }
        cy.layout(opts).run()
        setTimeout(renderMinimap, 600)
      })
    })

    $('#topo-fit')?.addEventListener('click', () => {
      if (cy) { cy.fit(undefined, 30); renderMinimap() }
    })
    $('#topo-export-png')?.addEventListener('click', exportPng)
    $('#topo-export-json')?.addEventListener('click', exportJson)

    let searchTimer = null
    $('#topo-filter')?.addEventListener('input', () => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => applyFilters(), 150)
    })
  }

  function exportPng() {
    if (!cy) return
    const link = document.createElement('a')
    link.href = cy.png({ bg: getTheme() === 'dark' ? '#0a0a0a' : '#ffffff', full: true, scale: 2 })
    link.download = 'topology.png'
    link.click()
  }

  function exportJson() {
    if (!topologyData) return
    const blob = new Blob([JSON.stringify(topologyData, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'topology.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function wireKeyboard() {
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault()
        $('#topo-filter')?.focus()
      }
      if (event.key === 'Escape') {
        const filter = $('#topo-filter')
        if (filter) filter.value = ''
        if (cy) {
          cy.elements().removeClass('highlighted dimmed search-match').style('display', 'element')
          showNodeDetail(null)
        }
        applyFilters()
      }
      if (event.key === 'f' && !event.ctrlKey && !event.metaKey && document.activeElement.tagName !== 'INPUT') {
        if (cy) cy.fit(undefined, 30)
      }
    })
  }

  function toggleFilter(filters, value) {
    if (filters.has(value)) filters.delete(value)
    else filters.add(value)
  }

  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.topology = renderTopology
})()
