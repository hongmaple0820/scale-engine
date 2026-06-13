/**
 * Safe DOM renderers for the topology page.
 */
;(() => {
  'use strict'

  const { t, dom } = window.Dashboard
  const { el, emptyState } = dom

  const LAYER_COLORS = {
    api: '#00dc82',
    service: '#5588ff',
    data: '#ffaa00',
    ui: '#ff6688',
    utility: '#aa88ff',
    config: '#888888',
    test: '#44cccc',
    unknown: '#555555',
  }

  function renderLayout(app) {
    app.replaceChildren(
      el('div', { className: 'topology-controls', id: 'topo-controls' }, [
        layoutButton('cose', t('topology.force'), true),
        layoutButton('breadthfirst', t('topology.tree')),
        layoutButton('circle', t('topology.circle')),
        layoutButton('concentric', t('topology.concentric')),
        layoutButton('dagre', t('topology.dag')),
        separator(),
        el('button', { className: 'topo-btn', id: 'topo-fit', text: t('topology.fitView'), title: t('topology.fitView') }),
        el('button', { className: 'topo-btn', id: 'topo-export-png', text: `PNG ${t('topology.exportPNG')}`, title: t('topology.exportPNG') }),
        el('button', { className: 'topo-btn', id: 'topo-export-json', text: `JSON ${t('topology.exportJSON')}`, title: t('topology.exportJSON') }),
        separator(),
        el('input', { id: 'topo-filter', type: 'text', className: 'search-box', placeholder: t('topology.searchNodes'), style: { width: '180px' } }),
        el('span', { id: 'topo-stats', className: 'text-muted text-sm', style: { alignSelf: 'center' } }),
      ]),
      el('div', { style: { display: 'flex', gap: '16px', height: 'calc(100vh - 140px)' } }, [
        el('div', { style: { flex: '1', minWidth: '0', position: 'relative' } }, [
          el('div', { id: 'topology-cy', style: { width: '100%', height: '100%' } }),
          el('div', { id: 'topo-minimap', style: minimapStyle() }),
        ]),
        el('div', { id: 'topo-sidebar', style: sidebarStyle() }, [
          panel('topo-detail', [el('div', { className: 'panel-title', text: t('topology.nodes') }), el('div', { className: 'text-muted text-sm', text: t('common.search') })]),
          panel('topo-legend', [el('div', { className: 'panel-title' }, [document.createTextNode(t('topology.layers')), el('span', { className: 'count', id: 'topo-layer-count' })]), el('div', { id: 'topo-layer-legend' })]),
          panel('topo-domains-panel', [el('div', { className: 'panel-title', text: t('topology.domains') }), el('div', { id: 'topo-domains' })]),
          panel('topo-kind-filter', [el('div', { className: 'panel-title', text: t('topology.kinds') }), el('div', { id: 'topo-kind-legend' })]),
        ]),
      ])
    )
  }

  function renderNoData(container) {
    if (container) container.replaceChildren(emptyState(t('topology.noData')))
  }

  function renderLayerLegend({ container, countNode, topologyData, activeLayerFilters, onToggle }) {
    if (!container || !topologyData) return
    const layers = countBy(topologyData.nodes, node => node.layer ?? 'unknown')
    const total = topologyData.nodes.length
    if (countNode) countNode.textContent = t('topology.layerNodeStats', { layers: Object.keys(layers).length, nodes: total })
    container.replaceChildren(...Object.entries(layers)
      .sort((left, right) => right[1] - left[1])
      .map(([layer, count]) => legendItem({
        className: 'topo-legend-item',
        dataset: { layer },
        active: !activeLayerFilters.has(layer),
        swatch: swatch(LAYER_COLORS[layer] || '#555', false),
        label: layer,
        meta: `${count} (${((count / total) * 100).toFixed(1)}%)`,
        onClick: () => onToggle(layer),
      })))
  }

  function renderKindFilter({ container, topologyData, activeKindFilters, onToggle }) {
    if (!container || !topologyData) return
    const kinds = countBy(topologyData.nodes, node => node.kind ?? 'unknown')
    container.replaceChildren(...Object.entries(kinds)
      .sort((left, right) => right[1] - left[1])
      .map(([kind, count]) => legendItem({
        className: 'topo-kind-item',
        dataset: { kind },
        active: !activeKindFilters.has(kind),
        label: kind,
        meta: String(count),
        onClick: () => onToggle(kind),
      })))
  }

  function renderDomainPanel({ container, domainData, onSelect }) {
    if (!container) return
    if (!domainData?.domains?.length) {
      container.replaceChildren(el('div', { className: 'text-muted text-sm', text: t('topology.noDomains') }))
      return
    }
    const children = domainData.domains.slice(0, 12).map(domain => legendItem({
      className: 'topo-domain-item',
      dataset: { domain: domain.name },
      swatch: swatch(hashColor(domain.name), true),
      label: domain.name,
      meta: String(domain.nodes?.length ?? 0),
      onClick: () => onSelect(domain),
    }))
    if (domainData.flows?.length) children.push(flowList(domainData.flows.slice(0, 5)))
    container.replaceChildren(...children)
  }

  function renderDomainDetail(panelNode, domain) {
    if (!panelNode || !domain) return
    const color = hashColor(domain.name)
    const rows = (domain.nodes ?? []).slice(0, 20).map(node => {
      const row = el('div', { style: { fontSize: '12px', padding: '3px 0', color: 'var(--text-1)' } })
      row.append(document.createTextNode(node.name ?? ''))
      row.append(el('span', { text: ` (${node.kind ?? '-'})`, style: { color: 'var(--text-2)' } }))
      return row
    })
    if ((domain.nodes?.length ?? 0) > 20) {
      rows.push(el('div', { text: t('topology.moreNodes', { count: domain.nodes.length - 20 }), style: { fontSize: '12px', color: 'var(--text-2)' } }))
    }
    panelNode.replaceChildren(
      el('div', { className: 'panel-title', text: domain.name, style: { color } }),
      el('div', { text: `${domain.nodes?.length ?? 0} nodes`, style: { fontSize: '13px', color: 'var(--text-1)', marginBottom: '8px' } }),
      el('div', { style: { maxHeight: '200px', overflowY: 'auto' } }, rows)
    )
  }

  function renderMinimapCanvas(container) {
    const canvas = el('canvas', { attrs: { width: 160, height: 120 } })
    container.replaceChildren(canvas)
    return canvas
  }

  function renderNodeEmpty(panelNode) {
    if (!panelNode) return
    panelNode.replaceChildren(
      el('div', { className: 'panel-title', text: t('topology.nodeDetails') }),
      el('div', { className: 'text-muted text-sm', text: t('topology.clickNodeHint') })
    )
  }

  function renderNodeDetail(panelNode, data, metrics) {
    if (!panelNode) return
    const layerColor = LAYER_COLORS[data.layer] || '#888'
    const children = [
      el('div', { className: 'panel-title', text: data.kind ?? '-', style: { color: layerColor } }),
      el('div', { text: data.label ?? '', style: { fontSize: '15px', fontWeight: '600', marginBottom: '12px' } }),
      nodeMeta(data, metrics, layerColor),
    ]
    if (metrics.callers.length > 0) children.push(nameList(t('topology.calledBy', { count: metrics.callers.length }), metrics.callers))
    if (metrics.callees.length > 0) children.push(nameList(t('topology.calls', { count: metrics.callees.length }), metrics.callees))
    panelNode.replaceChildren(...children)
  }

  function nodeMeta(data, metrics, layerColor) {
    const rows = [
      labelValue(t('topology.layer'), el('span', { text: data.layer ?? '-', style: { color: layerColor } })),
      labelValue(t('topology.file'), el('span', { text: data.filePath ?? '-', style: { wordBreak: 'break-all' } })),
    ]
    if (data.line) rows.push(labelValue(t('topology.line'), document.createTextNode(String(data.line))))
    if (data.signature) rows.push(labelValue(t('topology.signature'), el('code', { text: data.signature, style: { fontSize: '12px', wordBreak: 'break-all' } })))
    if (data.domain) rows.push(labelValue(t('topology.domain'), document.createTextNode(String(data.domain))))
    rows.push(labelValue(`${t('topology.degree')}:`, document.createTextNode(`in=${metrics.inDegree} out=${metrics.outDegree}`)))
    return el('div', { style: { fontSize: '13px', color: 'var(--text-1)' } }, rows)
  }

  function labelValue(label, valueNode) {
    const row = el('div', { style: { marginBottom: '6px' } })
    row.append(el('strong', { text: label }), document.createTextNode(' '), valueNode)
    return row
  }

  function nameList(title, names) {
    return el('div', { style: { marginTop: '10px', fontSize: '12px' } }, [
      el('div', { text: title, style: { color: 'var(--text-2)', marginBottom: '4px' } }),
      ...names.map(name => el('div', { text: name, style: { color: 'var(--text-1)', padding: '1px 0' } })),
    ])
  }

  function legendItem({ className, dataset = {}, active = true, swatch: swatchNode, label, meta, onClick }) {
    const node = el('div', { className, dataset, style: legendItemStyle(active) }, [
      swatchNode,
      el('span', { text: label, style: { color: 'var(--text-1)', flex: '1', overflow: 'hidden', textOverflow: 'ellipsis' } }),
      el('span', { text: meta, style: { color: 'var(--text-2)', fontSize: '11px', flexShrink: '0' } }),
    ].filter(Boolean))
    node.addEventListener('click', onClick)
    return node
  }

  function flowList(flows) {
    return el('div', { style: { marginTop: '12px', paddingTop: '8px', borderTop: '1px solid var(--border)' } }, [
      el('div', { text: t('topology.detectedFlows'), style: { fontSize: '11px', color: 'var(--text-2)', marginBottom: '6px' } }),
      ...flows.map(flow => el('div', { text: `${flow.from} -> ${flow.to}`, style: { fontSize: '12px', color: 'var(--text-1)', padding: '3px 0' } })),
    ])
  }

  function layoutButton(layout, label, active = false) {
    return el('button', { className: `topo-btn${active ? ' active' : ''}`, text: label, dataset: { layout } })
  }

  function panel(id, children) {
    return el('div', { className: 'panel', id }, children)
  }

  function separator() {
    return el('span', { style: { marginLeft: '12px', borderLeft: '1px solid var(--border)', paddingLeft: '12px' } })
  }

  function swatch(color, round) {
    return el('div', { style: { width: round ? '10px' : '12px', height: round ? '10px' : '12px', borderRadius: round ? '50%' : '3px', background: color, flexShrink: '0' } })
  }

  function legendItemStyle(active) {
    return { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 6px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', opacity: active ? '1' : '0.35' }
  }

  function sidebarStyle() {
    return { width: '300px', flexShrink: '0', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }
  }

  function minimapStyle() {
    return { position: 'absolute', bottom: '12px', right: '12px', width: '160px', height: '120px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden', opacity: '0.8' }
  }

  function countBy(items, selector) {
    const counts = {}
    for (const item of items ?? []) {
      const key = selector(item)
      counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
  }

  function hashColor(str) {
    const text = String(str ?? '')
    let hash = 0
    for (let i = 0; i < text.length; i++) hash = text.charCodeAt(i) + ((hash << 5) - hash)
    return `hsl(${hash % 360}, 60%, 55%)`
  }

  window.DashboardTopologyRenderers = {
    LAYER_COLORS,
    renderDomainDetail,
    renderDomainPanel,
    renderKindFilter,
    renderLayerLegend,
    renderLayout,
    renderMinimapCanvas,
    renderNoData,
    renderNodeDetail,
    renderNodeEmpty,
  }
})()
