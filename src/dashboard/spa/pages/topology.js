/**
 * Topology Page v2 — Layer aggregation, domain flows, export, minimap, enhanced interactions
 */
;(() => {
  'use strict'

  const { fetchJSON, registerChart, getTheme, t, $, $$ } = window.Dashboard

  const LAYER_COLORS = {
    api: '#00dc82', service: '#5588ff', data: '#ffaa00',
    ui: '#ff6688', utility: '#aa88ff', config: '#888888',
    test: '#44cccc', unknown: '#555555',
  }

  let cy = null
  let topologyData = null
  let domainData = null
  let activeLayerFilters = new Set()
  let activeKindFilters = new Set()

  async function renderTopology() {
    const app = $('#app')
    app.innerHTML = `
      <div class="topology-controls" id="topo-controls">
        <button class="topo-btn active" data-layout="cose">${t('topology.force')}</button>
        <button class="topo-btn" data-layout="breadthfirst">${t('topology.tree')}</button>
        <button class="topo-btn" data-layout="circle">${t('topology.circle')}</button>
        <button class="topo-btn" data-layout="concentric">${t('topology.concentric')}</button>
        <button class="topo-btn" data-layout="dagre">${t('topology.dag')}</button>
        <span style="margin-left:12px;border-left:1px solid var(--border);padding-left:12px"></span>
        <button class="topo-btn" id="topo-fit" title="${t('topology.fitView')}">${t('topology.fitView')}</button>
        <button class="topo-btn" id="topo-export-png" title="${t('topology.exportPNG')}">&#128247; ${t('topology.exportPNG')}</button>
        <button class="topo-btn" id="topo-export-json" title="${t('topology.exportJSON')}">&#128196; ${t('topology.exportJSON')}</button>
        <span style="margin-left:12px;border-left:1px solid var(--border);padding-left:12px"></span>
        <input type="text" class="search-box" placeholder="${t('topology.searchNodes')}" id="topo-filter" style="width:180px">
        <span id="topo-stats" class="text-muted text-sm" style="align-self:center"></span>
      </div>
      <div style="display:flex;gap:16px;height:calc(100vh - 140px)">
        <div style="flex:1;min-width:0;position:relative">
          <div id="topology-cy" style="width:100%;height:100%"></div>
          <div id="topo-minimap" style="position:absolute;bottom:12px;right:12px;width:160px;height:120px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px;overflow:hidden;opacity:0.8"></div>
        </div>
        <div style="width:300px;flex-shrink:0;display:flex;flex-direction:column;gap:16px;overflow-y:auto" id="topo-sidebar">
          <div class="panel" id="topo-detail">
            <div class="panel-title">${t('topology.nodes')}</div>
            <div class="text-muted text-sm">${t('common.search')}</div>
          </div>
          <div class="panel" id="topo-legend">
            <div class="panel-title">${t('topology.layers')} <span class="count" id="topo-layer-count"></span></div>
            <div id="topo-layer-legend"></div>
          </div>
          <div class="panel" id="topo-domains-panel">
            <div class="panel-title">${t('topology.domains')}</div>
            <div id="topo-domains"></div>
          </div>
          <div class="panel" id="topo-kind-filter">
            <div class="panel-title">${t('topology.kinds')}</div>
            <div id="topo-kind-legend"></div>
          </div>
        </div>
      </div>
    `

    // Fetch topology + domains in parallel
    const [topo, domains] = await Promise.all([
      fetchJSON('/api/topology'),
      fetchJSON('/api/topology/domains'),
    ])

    topologyData = topo
    domainData = domains

    if (!topologyData?.nodes?.length) {
      $('#topology-cy').innerHTML = `<div class="empty-state"><p>${t('topology.noData')}</p></div>`
      return
    }

    renderLayerLegend()
    renderDomainPanel()
    renderKindFilter()
    initCytoscape(topologyData)
    wireControls()
    wireKeyboard()
  }

  // ── Legend & Filters ────────────────────────────────────────────────

  function renderLayerLegend() {
    const container = $('#topo-layer-legend')
    const layers = {}
    for (const n of topologyData.nodes) {
      const layer = n.layer ?? 'unknown'
      layers[layer] = (layers[layer] ?? 0) + 1
    }

    const total = topologyData.nodes.length
    $('#topo-layer-count').textContent = t('topology.layerNodeStats', { layers: Object.keys(layers).length, nodes: total })

    container.innerHTML = Object.entries(layers)
      .sort((a, b) => b[1] - a[1])
      .map(([layer, count]) => {
        const pct = ((count / total) * 100).toFixed(1)
        const active = !activeLayerFilters.has(layer)
        return `
          <div class="topo-legend-item" data-layer="${layer}" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer;font-size:13px;${active ? '' : 'opacity:0.35'}">
            <div style="width:12px;height:12px;border-radius:3px;background:${LAYER_COLORS[layer] || '#555'};flex-shrink:0"></div>
            <span style="color:var(--text-1);flex:1">${layer}</span>
            <span style="color:var(--text-2);font-size:11px">${count} (${pct}%)</span>
          </div>
        `
      }).join('')

    // Click to toggle layer filter
    $$('.topo-legend-item', container).forEach(el => {
      el.addEventListener('click', () => {
        const layer = el.dataset.layer
        if (activeLayerFilters.has(layer)) {
          activeLayerFilters.delete(layer)
        } else {
          activeLayerFilters.add(layer)
        }
        renderLayerLegend()
        applyFilters()
      })
    })
  }

  function renderKindFilter() {
    const container = $('#topo-kind-legend')
    const kinds = {}
    for (const n of topologyData.nodes) {
      kinds[n.kind] = (kinds[n.kind] ?? 0) + 1
    }

    container.innerHTML = Object.entries(kinds)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => {
        const active = !activeKindFilters.has(kind)
        return `
          <div class="topo-kind-item" data-kind="${kind}" style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:13px;${active ? '' : 'opacity:0.35'}">
            <span style="color:var(--text-1);flex:1">${kind}</span>
            <span style="color:var(--text-2);font-size:11px">${count}</span>
          </div>
        `
      }).join('')

    $$('.topo-kind-item', container).forEach(el => {
      el.addEventListener('click', () => {
        const kind = el.dataset.kind
        if (activeKindFilters.has(kind)) {
          activeKindFilters.delete(kind)
        } else {
          activeKindFilters.add(kind)
        }
        renderKindFilter()
        applyFilters()
      })
    })
  }

  function renderDomainPanel() {
    const container = $('#topo-domains')
    if (!domainData?.domains?.length) {
      container.innerHTML = `<div class="text-muted text-sm">${t('topology.noDomains')}</div>`
      return
    }

    container.innerHTML = domainData.domains.slice(0, 12).map(d => {
      const color = hashColor(d.name)
      return `
        <div class="topo-domain-item" data-domain="${d.name}" style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer;font-size:13px">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
          <span style="color:var(--text-1);flex:1">${d.name}</span>
          <span style="color:var(--text-2);font-size:11px">${d.nodes?.length ?? 0}</span>
        </div>
      `
    }).join('')

    // Click domain to highlight its nodes
    $$('.topo-domain-item', container).forEach(el => {
      el.addEventListener('click', () => {
        const domainName = el.dataset.domain
        const domain = domainData.domains.find(d => d.name === domainName)
        if (!domain || !cy) return

        const nodeIds = new Set((domain.nodes ?? []).map(n => n.id))
        cy.elements().removeClass('highlighted dimmed')
        cy.nodes().forEach(node => {
          if (nodeIds.has(node.id())) {
            node.addClass('highlighted')
          } else {
            node.addClass('dimmed')
          }
        })

        // Show domain info in detail panel
        showDomainDetail(domain)
      })
    })

    // Show flows if available
    if (domainData.flows?.length) {
      container.innerHTML += `
        <div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border)">
          <div style="font-size:11px;color:var(--text-2);margin-bottom:6px">${t('topology.detectedFlows')}</div>
          ${domainData.flows.slice(0, 5).map(f => `
            <div style="font-size:12px;color:var(--text-1);padding:3px 0">
              ${f.from} &rarr; ${f.to}
            </div>
          `).join('')}
        </div>
      `
    }
  }

  function showDomainDetail(domain) {
    const panel = $('#topo-detail')
    const color = hashColor(domain.name)
    panel.innerHTML = `
      <div class="panel-title" style="color:${color}">${domain.name}</div>
      <div style="font-size:13px;color:var(--text-1);margin-bottom:8px">${domain.nodes?.length ?? 0} nodes</div>
      <div style="max-height:200px;overflow-y:auto">
        ${(domain.nodes ?? []).slice(0, 20).map(n => `
          <div style="font-size:12px;padding:3px 0;color:var(--text-1)">${n.name} <span style="color:var(--text-2)">(${n.kind})</span></div>
        `).join('')}
        ${(domain.nodes?.length ?? 0) > 20 ? `<div style="font-size:12px;color:var(--text-2)">${t('topology.moreNodes', { count: domain.nodes.length - 20 })}</div>` : ''}
      </div>
    `
  }

  // ── Cytoscape ──────────────────────────────────────────────────────

  function initCytoscape(data) {
    if (!window.cytoscape) {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/cytoscape@3/dist/cytoscape.min.js'
      script.onload = () => {
        // Load dagre layout for DAG mode
        const script2 = document.createElement('script')
        script2.src = 'https://cdn.jsdelivr.net/npm/cytoscape-dagre@2/cytoscape-dagre.min.js'
        script2.onload = () => buildGraph(data)
        script2.onerror = () => buildGraph(data) // fallback without dagre
        document.head.appendChild(script2)
      }
      document.head.appendChild(script)
    } else {
      buildGraph(data)
    }
  }

  function buildGraph(data) {
    const container = $('#topology-cy')
    if (!container) return

    // Limit nodes for performance, prioritizing by degree
    const maxNodes = 800
    const degreeMap = new Map()
    for (const e of data.edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1)
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1)
    }

    const sortedNodes = [...data.nodes].sort((a, b) =>
      (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0)
    )
    const nodes = sortedNodes.slice(0, maxNodes)
    const nodeIds = new Set(nodes.map(n => n.id))
    const edges = data.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))

    // Size nodes by degree
    const maxDegree = Math.max(...nodes.map(n => degreeMap.get(n.id) ?? 0), 1)

    $('#topo-stats').textContent = `${nodes.length}/${data.nodes.length} ${t('topology.nodes')}, ${edges.length} ${t('topology.edges')}`

    cy = cytoscape({
      container,
      elements: [
        ...nodes.map(n => {
          const degree = degreeMap.get(n.id) ?? 0
          const size = 8 + Math.round((degree / maxDegree) * 20)
          return {
            data: {
              id: n.id, label: n.name, layer: n.layer ?? 'unknown',
              kind: n.kind, filePath: n.filePath, line: n.line,
              signature: n.signature, domain: n.domain, degree, size,
            },
          }
        }),
        ...edges.map((e, i) => ({
          data: { id: `e${i}`, source: e.source, target: e.target, kind: e.kind },
        })),
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': ele => LAYER_COLORS[ele.data('layer')] || '#555',
            'label': ele => ele.data('degree') > 3 ? ele.data('label') : '',
            'color': '#a1a1a1',
            'font-size': '10px',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'width': 'data(size)',
            'height': 'data(size)',
            'border-width': 1,
            'border-color': '#333',
            'transition-property': 'background-color, border-color, opacity',
            'transition-duration': '0.15s',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#00dc82',
            'font-weight': 'bold',
            'label': 'data(label)',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1,
            'line-color': '#333',
            'target-arrow-color': '#333',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'opacity': 0.3,
            'transition-property': 'line-color, opacity, width',
            'transition-duration': '0.15s',
          },
        },
        {
          selector: '.highlighted',
          style: {
            'background-color': '#00dc82',
            'line-color': '#00dc82',
            'target-arrow-color': '#00dc82',
            'opacity': 1,
            'width': 2,
            'z-index': 10,
          },
        },
        {
          selector: '.search-match',
          style: {
            'border-width': 3,
            'border-color': '#ffaa00',
            'background-color': '#ffaa00',
            'label': 'data(label)',
            'z-index': 20,
          },
        },
        {
          selector: '.dimmed',
          style: { 'opacity': 0.08 },
        },
      ],
      layout: { name: 'cose', animate: false, padding: 30, nodeRepulsion: () => 4000 },
      minZoom: 0.05,
      maxZoom: 10,
      wheelSensitivity: 0.3,
    })

    // Hover highlight
    cy.on('mouseover', 'node', (e) => {
      const node = e.target
      const neighborhood = node.neighborhood().add(node)
      cy.elements().removeClass('highlighted').not(neighborhood).addClass('dimmed')
      neighborhood.removeClass('dimmed').addClass('highlighted')
    })

    cy.on('mouseout', 'node', () => {
      cy.elements().removeClass('highlighted dimmed')
    })

    // Click handler
    cy.on('tap', 'node', (e) => {
      showNodeDetail(e.target.data())
      highlightNeighbors(e.target)
    })

    cy.on('tap', (e) => {
      if (e.target === cy) {
        cy.elements().removeClass('highlighted dimmed')
        showNodeDetail(null)
      }
    })

    // Render minimap
    renderMinimap()
  }

  function highlightNeighbors(node) {
    const neighborhood = node.neighborhood().add(node)
    cy.elements().removeClass('highlighted').addClass('dimmed')
    neighborhood.removeClass('dimmed').addClass('highlighted')
  }

  // ── Minimap ────────────────────────────────────────────────────────

  function renderMinimap() {
    const miniContainer = $('#topo-minimap')
    if (!miniContainer || !cy) return

    // Simple minimap using canvas
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 120
    miniContainer.innerHTML = ''
    miniContainer.appendChild(canvas)

    function drawMinimap() {
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, 160, 120)
      ctx.fillStyle = getTheme() === 'dark' ? '#111' : '#f5f5f5'
      ctx.fillRect(0, 0, 160, 120)

      const bb = cy.elements().boundingBox()
      if (bb.w === 0 || bb.h === 0) return

      const scaleX = 150 / bb.w
      const scaleY = 110 / bb.h
      const scale = Math.min(scaleX, scaleY)
      const offsetX = (160 - bb.w * scale) / 2 - bb.x1 * scale
      const offsetY = (120 - bb.h * scale) / 2 - bb.y1 * scale

      cy.nodes().forEach(node => {
        const pos = node.position()
        const x = pos.x * scale + offsetX
        const y = pos.y * scale + offsetY
        const color = LAYER_COLORS[node.data('layer')] || '#555'
        ctx.fillStyle = color
        ctx.fillRect(x - 1, y - 1, 2, 2)
      })

      // Draw viewport rectangle
      const ext = cy.extent()
      const vx = ext.x1 * scale + offsetX
      const vy = ext.y1 * scale + offsetY
      const vw = ext.w * scale
      const vh = ext.h * scale
      ctx.strokeStyle = '#00dc82'
      ctx.lineWidth = 1
      ctx.strokeRect(vx, vy, vw, vh)
    }

    cy.on('viewport', drawMinimap)
    drawMinimap()
  }

  // ── Node Detail ────────────────────────────────────────────────────

  function showNodeDetail(data) {
    const panel = $('#topo-detail')
    if (!data) {
      panel.innerHTML = `
        <div class="panel-title">${t('topology.nodeDetails')}</div>
        <div class="text-muted text-sm">${t('topology.clickNodeHint')}</div>
      `
      return
    }

    // Find connected nodes
    const node = cy?.getElementById(data.id)
    const inDegree = node?.indegree?.() ?? 0
    const outDegree = node?.outdegree?.() ?? 0
    const callers = node?.incomers('node').map(n => n.data('label')).slice(0, 10) ?? []
    const callees = node?.outgoers('node').map(n => n.data('label')).slice(0, 10) ?? []

    panel.innerHTML = `
      <div class="panel-title" style="color:${LAYER_COLORS[data.layer] || '#888'}">${data.kind}</div>
      <div style="font-size:15px;font-weight:600;margin-bottom:12px">${data.label}</div>
      <div style="font-size:13px;color:var(--text-1)">
        <div style="margin-bottom:6px"><strong>${t('topology.layer')}</strong> <span style="color:${LAYER_COLORS[data.layer] || '#888'}">${data.layer}</span></div>
        <div style="margin-bottom:6px"><strong>${t('topology.file')}</strong> <span style="word-break:break-all">${data.filePath ?? '-'}</span></div>
        ${data.line ? `<div style="margin-bottom:6px"><strong>${t('topology.line')}</strong> ${data.line}</div>` : ''}
        ${data.signature ? `<div style="margin-bottom:6px"><strong>${t('topology.signature')}</strong> <code style="font-size:12px;word-break:break-all">${data.signature}</code></div>` : ''}
        ${data.domain ? `<div style="margin-bottom:6px"><strong>${t('topology.domain')}</strong> ${data.domain}</div>` : ''}
        <div style="margin-bottom:6px"><strong>${t('topology.degree')}:</strong> in=${inDegree} out=${outDegree}</div>
      </div>
      ${callers.length > 0 ? `
        <div style="margin-top:10px;font-size:12px">
          <div style="color:var(--text-2);margin-bottom:4px">${t('topology.calledBy', { count: callers.length })}</div>
          ${callers.map(c => `<div style="color:var(--text-1);padding:1px 0">${c}</div>`).join('')}
        </div>
      ` : ''}
      ${callees.length > 0 ? `
        <div style="margin-top:10px;font-size:12px">
          <div style="color:var(--text-2);margin-bottom:4px">${t('topology.calls', { count: callees.length })}</div>
          ${callees.map(c => `<div style="color:var(--text-1);padding:1px 0">${c}</div>`).join('')}
        </div>
      ` : ''}
    `
  }

  // ── Filters ────────────────────────────────────────────────────────

  function applyFilters() {
    if (!cy) return

    const searchQ = ($('#topo-filter')?.value ?? '').toLowerCase()

    cy.nodes().forEach(node => {
      const layer = node.data('layer')
      const kind = node.data('kind')
      const label = node.data('label').toLowerCase()
      const filePath = (node.data('filePath') ?? '').toLowerCase()

      const layerOk = activeLayerFilters.size === 0 || !activeLayerFilters.has(layer)
      const kindOk = activeKindFilters.size === 0 || !activeKindFilters.has(kind)
      const searchOk = !searchQ || label.includes(searchQ) || filePath.includes(searchQ)

      node.style('display', (layerOk && kindOk) ? 'element' : 'none')

      if (searchQ && searchOk && layerOk && kindOk) {
        node.addClass('search-match')
      } else {
        node.removeClass('search-match')
      }
    })

    // Hide edges connected to hidden nodes
    cy.edges().forEach(edge => {
      const src = edge.source().style('display') !== 'none'
      const tgt = edge.target().style('display') !== 'none'
      edge.style('display', (src && tgt) ? 'element' : 'none')
    })

    updateVisibleStats()
  }

  function updateVisibleStats() {
    if (!cy) return
    const visible = cy.nodes().filter(n => n.style('display') !== 'none').length
    const total = topologyData?.nodes?.length ?? 0
    const visibleEdges = cy.edges().filter(e => e.style('display') !== 'none').length
    $('#topo-stats').textContent = `${visible}/${total} ${t('topology.nodes')}, ${visibleEdges} ${t('topology.edges')}`
  }

  // ── Controls ───────────────────────────────────────────────────────

  function wireControls() {
    // Layout buttons
    $$('.topo-btn[data-layout]', $('#topo-controls')).forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.topo-btn[data-layout]').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        if (cy) {
          const name = btn.dataset.layout
          const opts = { name, animate: true, padding: 30 }
          if (name === 'dagre' && cy.dagre) {
            opts.rankDir = 'TB'
            opts.rankSep = 50
          }
          cy.layout(opts).run()
          setTimeout(renderMinimap, 600)
        }
      })
    })

    // Fit
    $('#topo-fit')?.addEventListener('click', () => {
      if (cy) { cy.fit(undefined, 30); renderMinimap() }
    })

    // Guided tour
    $('#topo-tour')?.addEventListener('click', async () => {
      const tour = await fetchJSON('/api/topology/tour')
      if (!tour?.stops?.length) return
      runTour(tour.stops)
    })

    // Export PNG
    $('#topo-export-png')?.addEventListener('click', () => {
      if (!cy) return
      const png = cy.png({ bg: getTheme() === 'dark' ? '#0a0a0a' : '#ffffff', full: true, scale: 2 })
      const link = document.createElement('a')
      link.href = png
      link.download = 'topology.png'
      link.click()
    })

    // Export JSON
    $('#topo-export-json')?.addEventListener('click', () => {
      if (!topologyData) return
      const blob = new Blob([JSON.stringify(topologyData, null, 2)], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = 'topology.json'
      link.click()
      URL.revokeObjectURL(link.href)
    })

    // Search
    let searchTimer = null
    $('#topo-filter')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => applyFilters(), 150)
    })
  }

  function wireKeyboard() {
    const handler = (e) => {
      // Ctrl+F focuses search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        $('#topo-filter')?.focus()
      }
      // Escape clears search and selection
      if (e.key === 'Escape') {
        $('#topo-filter').value = ''
        if (cy) {
          cy.elements().removeClass('highlighted dimmed search-match').style('display', 'element')
          showNodeDetail(null)
        }
        applyFilters()
      }
      // F to fit
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT') {
        if (cy) cy.fit(undefined, 30)
      }
    }
    document.addEventListener('keydown', handler)
  }

  // ── Tour ───────────────────────────────────────────────────────────

  async function runTour(stops) {
    const btn = $('#topo-tour')
    if (btn) { btn.textContent = '...'; btn.disabled = true }

    for (const stop of stops) {
      if (!cy) break
      const node = cy.getElementById(stop.id)
      if (node.length > 0) {
        cy.animate({ center: { eles: node }, zoom: 2 }, { duration: 400 })
        node.select()
        showNodeDetail(node.data())
        highlightNeighbors(node)
        await new Promise(r => setTimeout(r, 2500))
      }
    }

    if (cy) {
      cy.elements().removeClass('highlighted dimmed')
      cy.animate({ fit: { eles: cy.elements(), padding: 30 } }, { duration: 500 })
    }
    if (btn) { btn.textContent = '\u25b6 ' + t('topology.tour'); btn.disabled = false }
  }

  // ── Utils ──────────────────────────────────────────────────────────

  function hashColor(str) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash)
    }
    const h = hash % 360
    return `hsl(${h}, 60%, 55%)`
  }

  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.topology = renderTopology
})()
