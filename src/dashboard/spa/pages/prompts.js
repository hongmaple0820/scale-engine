/**
 * Prompt Studio - built-in vibe templates, phase prompt registry, and optimizer.
 */
;(() => {
  'use strict'

  const { copyText, downloadText, fetchJSON, formatTime, t, $, dom } = window.Dashboard
  const { autoRefreshControl, dataNote, el, emptyState, metricCard, panel, renderText } = dom

  let report = null
  let activeKey = ''
  let currentFilter = 'all'
  let currentQuery = ''
  let lastOptimization = null

  async function renderPrompts() {
    const app = $('#app')
    const search = el('input', {
      id: 'prompt-search',
      type: 'text',
      className: 'search-box',
      placeholder: t('prompts.searchPlaceholder'),
      style: { flex: '1', maxWidth: '420px' },
    })
    const filter = el('select', {
      id: 'prompt-filter',
      className: 'search-box',
      title: t('prompts.filterLabel'),
      style: { width: '180px' },
    }, [
      el('option', { value: 'all', text: t('prompts.all') }),
      el('option', { value: 'vibe', text: t('prompts.vibeTemplates') }),
      el('option', { value: 'phase', text: t('prompts.phasePrompts') }),
      el('option', { value: 'pack', text: t('prompts.packs') }),
      el('option', { value: 'custom', text: t('prompts.customPrompts') }),
    ])
    const refresh = el('button', { id: 'prompt-refresh', className: 'topo-btn', text: t('common.refresh') })
    const copyReport = el('button', { id: 'prompt-copy-report', className: 'topo-btn', text: t('prompts.copyReport') })
    const exportReport = el('button', { id: 'prompt-export-report', className: 'topo-btn', text: t('prompts.exportReport') })

    app.replaceChildren(
      el('div', { className: 'page-toolbar' }, [
        search,
        filter,
        refresh,
        copyReport,
        exportReport,
        autoRefreshControl(loadPrompts),
      ]),
      el('div', { id: 'prompt-data-note' }),
      el('div', { className: 'metric-grid', id: 'prompt-summary' }),
      el('div', { className: 'prompt-layout' }, [
        el('div', { className: 'prompt-list', id: 'prompt-list' }, [
          el('div', { className: 'loading-placeholder', text: t('common.loading'), style: { height: '180px' } }),
        ]),
        el('div', { className: 'prompt-detail', id: 'prompt-detail' }, [
          emptyStateWithHint(t('prompts.noPromptSelected'), t('prompts.dataHint'), '\u25a1'),
        ]),
      ]),
      panel(t('prompts.optimizer'), 'prompt-optimizer', { className: 'mt-3' }),
    )

    filter.addEventListener('change', () => {
      currentFilter = filter.value
      renderPromptList()
    })
    search.addEventListener('input', () => {
      currentQuery = search.value.trim().toLowerCase()
      renderPromptList()
    })
    refresh.addEventListener('click', loadPrompts)
    copyReport.addEventListener('click', () => copyText(JSON.stringify(promptStudioPayload(), null, 2), copyReport))
    exportReport.addEventListener('click', () => {
      downloadText(`scale-prompts-${Date.now()}.json`, JSON.stringify(promptStudioPayload(), null, 2), 'application/json;charset=utf-8')
    })

    renderOptimizer()
    await loadPrompts()
  }

  async function loadPrompts() {
    const nextReport = await fetchJSON('/api/prompts')
    if (!nextReport) {
      const list = $('#prompt-list')
      if (list) renderText(list, t('prompts.failedToLoad'))
      return
    }
    report = nextReport
    renderDataNote()
    renderSummary()
    renderPromptList()
  }

  function renderDataNote() {
    const node = $('#prompt-data-note')
    if (!node || !report) return
    node.replaceChildren(dataNote([
      { strong: true, text: t('common.snapshot') },
      `${t('common.lastLoaded')}: ${formatTime(Date.now())}`,
      t('prompts.dataHint'),
      `${t('prompts.commands')}: ${Object.values(report.commands || {}).filter(Boolean).length}`,
    ]))
  }

  function renderSummary() {
    const summary = $('#prompt-summary')
    if (!summary || !report) return
    summary.replaceChildren(
      metricCard(t('prompts.vibeTemplates'), report.summary?.vibeTemplates ?? 0),
      metricCard(t('prompts.phasePrompts'), report.summary?.phasePrompts ?? 0),
      metricCard(t('prompts.packs'), report.summary?.packs ?? 0),
      metricCard(t('prompts.customPrompts'), report.summary?.customPrompts ?? 0),
    )
  }

  function renderPromptList() {
    const list = $('#prompt-list')
    if (!list || !report) return
    const items = filteredItems()
    if (items.length === 0) {
      activeKey = ''
      list.replaceChildren(emptyStateWithHint(t('prompts.noPrompts'), t('prompts.noPromptsHint'), '\u25cc'))
      renderPromptDetail(null)
      return
    }
    if (!items.some(item => item.key === activeKey)) activeKey = items[0].key
    list.replaceChildren(...items.map(item => {
      const button = el('button', {
        className: ['prompt-list-item', item.key === activeKey ? 'active' : ''].filter(Boolean).join(' '),
        dataset: { key: item.key },
        title: item.title,
      }, [
        el('span', { className: 'prompt-list-title', text: item.title }),
        el('span', { className: 'prompt-list-meta' }, [
          el('span', { className: 'badge badge-muted', text: itemTypeLabel(item.kind) }),
          el('span', { text: item.meta }),
        ]),
      ])
      button.addEventListener('click', () => {
        activeKey = item.key
        renderPromptList()
      })
      return button
    }))
    renderPromptDetail(items.find(item => item.key === activeKey) || items[0])
  }

  function renderPromptDetail(item) {
    const container = $('#prompt-detail')
    if (!container) return
    if (!item) {
      container.replaceChildren(emptyStateWithHint(t('prompts.noPromptSelected'), t('prompts.dataHint'), '\u25a1'))
      return
    }
    if (item.kind === 'vibe') renderVibeDetail(container, item.raw)
    if (item.kind === 'phase') renderPhaseDetail(container, item.raw)
    if (item.kind === 'pack') renderPackDetail(container, item.raw)
  }

  function renderVibeDetail(container, template) {
    const promptText = template.copyPrompt || ''
    container.replaceChildren(
      detailHeader(template.title, template.scenario, [
        actionButton(t('prompts.copyPrompt'), button => copyText(promptText, button)),
        actionButton(t('prompts.downloadPrompt'), () => downloadText(`scale-vibe-${template.id}.md`, promptText)),
        actionButton(t('prompts.copyCommand'), button => copyText(template.command, button)),
      ]),
      metaGrid([
        [t('prompts.promptId'), template.id],
        [t('prompts.phase'), template.phase],
        [t('prompts.role'), template.role],
        [t('prompts.command'), template.command],
      ]),
      detailSections([
        [t('prompts.bestFor'), template.bestFor],
        [t('prompts.workflow'), template.scaleWorkflow],
        [t('prompts.skills'), template.suggestedSkills],
        [t('prompts.tools'), template.suggestedTools],
        [t('prompts.outputs'), template.outputs],
        [t('prompts.questions'), template.coachingQuestions],
      ]),
      promptCode(promptText),
    )
  }

  function renderPhaseDetail(container, prompt) {
    const promptText = prompt.template || ''
    const actions = [
      actionButton(t('prompts.copyPrompt'), button => copyText(promptText, button)),
      actionButton(t('prompts.downloadPrompt'), () => downloadText(`scale-phase-${safeName(prompt.id)}.md`, promptText)),
    ]
    if (prompt.command) actions.push(actionButton(t('prompts.copyCommand'), button => copyText(prompt.command, button)))
    container.replaceChildren(
      detailHeader(prompt.name, prompt.description, actions),
      metaGrid([
        [t('prompts.promptId'), prompt.id],
        [t('prompts.source'), sourceLabel(prompt.source)],
        [t('prompts.phase'), prompt.phase],
        [t('prompts.command'), prompt.command || t('prompts.noCommand')],
        [t('prompts.estimatedTime'), prompt.estimatedTime],
        [t('prompts.outputFile'), prompt.outputFile || '-'],
      ]),
      detailSections([
        [t('prompts.userLevels'), prompt.userLevels],
        [t('prompts.dependencies'), prompt.dependencies?.length ? prompt.dependencies : [t('common.none')]],
      ]),
      promptCode(promptText),
    )
  }

  function renderPackDetail(container, pack) {
    const payload = JSON.stringify(pack, null, 2)
    container.replaceChildren(
      detailHeader(pack.name, pack.description, [
        actionButton(t('prompts.copyCommand'), button => copyText(pack.command, button)),
        actionButton(t('common.copyJson'), button => copyText(payload, button)),
        actionButton(t('common.exportJson'), () => downloadText(`scale-pack-${pack.id}.json`, payload, 'application/json;charset=utf-8')),
      ]),
      metaGrid([
        [t('prompts.promptId'), pack.id],
        [t('prompts.phase'), (pack.phases || []).join(', ')],
        [t('prompts.command'), pack.command],
        [t('prompts.packTemplates'), (pack.templateIds || []).join(', ')],
      ]),
      promptCode(payload),
    )
  }

  function renderOptimizer() {
    const container = $('#prompt-optimizer')
    if (!container) return
    const rawPrompt = el('textarea', {
      id: 'prompt-optimize-input',
      className: 'prompt-textarea',
      placeholder: t('prompts.rawPromptPlaceholder'),
    })
    const title = el('input', {
      id: 'prompt-optimize-title',
      type: 'text',
      className: 'search-box',
      placeholder: t('prompts.titlePlaceholder'),
      style: { width: '220px' },
    })
    const files = el('input', {
      id: 'prompt-optimize-files',
      type: 'text',
      className: 'search-box',
      placeholder: t('prompts.filesPlaceholder'),
      style: { width: '220px' },
    })
    const criteria = el('input', {
      id: 'prompt-optimize-criteria',
      type: 'text',
      className: 'search-box',
      placeholder: t('prompts.criteriaPlaceholder'),
      style: { width: '260px' },
    })
    const language = el('select', {
      id: 'prompt-optimize-language',
      className: 'search-box',
      title: t('prompts.language'),
      style: { width: '120px' },
    }, [
      el('option', { value: 'auto', text: t('prompts.auto') }),
      el('option', { value: 'zh', text: 'ZH' }),
      el('option', { value: 'en', text: 'EN' }),
    ])
    const optimize = el('button', { id: 'prompt-optimize-run', className: 'topo-btn', text: t('prompts.optimize'), disabled: true })
    const result = el('div', { id: 'prompt-optimize-result', style: { marginTop: '14px' } })

    rawPrompt.addEventListener('input', () => {
      optimize.disabled = rawPrompt.value.trim().length === 0
    })
    optimize.addEventListener('click', () => optimizePrompt({
      rawPrompt: rawPrompt.value,
      title: title.value,
      language: language.value,
      files: files.value,
      successCriteria: criteria.value,
    }, optimize))

    container.replaceChildren(
      el('div', { className: 'action-row', style: { marginBottom: '12px' } }, [title, language, files, criteria, optimize]),
      rawPrompt,
      result,
    )
    renderOptimizationResult()
  }

  async function optimizePrompt(input, button) {
    const resultContainer = $('#prompt-optimize-result')
    if (resultContainer) renderText(resultContainer, t('common.loading'))
    const original = button.textContent
    button.disabled = true
    button.textContent = t('common.refreshing')
    try {
      const response = await fetch('/api/prompts/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`)
      lastOptimization = payload
      renderOptimizationResult()
    } catch (error) {
      if (resultContainer) renderText(resultContainer, t('prompts.optimizeFailed', { error: errorMessage(error) }))
    } finally {
      button.textContent = original
      button.disabled = !$('#prompt-optimize-input')?.value.trim()
    }
  }

  function renderOptimizationResult() {
    const container = $('#prompt-optimize-result')
    if (!container) return
    if (!lastOptimization?.result) {
      container.replaceChildren(emptyStateWithHint(t('prompts.noOptimization'), t('prompts.optimizerHint'), '\u25cc'))
      return
    }
    const result = lastOptimization.result
    const text = result.optimizedPrompt || ''
    container.replaceChildren(
      el('div', { className: 'prompt-quality' }, [
        el('span', { className: 'prompt-score', text: `${result.quality?.score ?? 0}/100` }),
        el('span', { className: 'text-muted text-sm', text: `${t('prompts.intent')}: ${result.intent?.type || '-'}` }),
        el('span', { className: 'text-muted text-sm', text: `${t('prompts.originalChars')}: ${result.stats?.originalChars ?? 0}` }),
        el('span', { className: 'text-muted text-sm', text: `${t('prompts.optimizedChars')}: ${result.stats?.optimizedChars ?? 0}` }),
      ]),
      el('div', { className: 'action-row', style: { marginBottom: '12px' } }, [
        actionButton(t('prompts.copyOptimized'), button => copyText(text, button)),
        actionButton(t('prompts.downloadOptimized'), () => downloadText(`scale-optimized-prompt-${Date.now()}.md`, text)),
        actionButton(t('common.copyJson'), button => copyText(JSON.stringify(lastOptimization, null, 2), button)),
      ]),
      detailSections([
        [t('prompts.missingInfo'), result.quality?.missingInfo?.length ? result.quality.missingInfo : [t('prompts.noMissingInfo')]],
        [t('prompts.improvements'), result.quality?.improvements || []],
      ]),
      renderOptimizationSections(result.sections),
      promptCode(text),
    )
  }

  function renderOptimizationSections(sections) {
    if (!sections) return el('div')
    const rows = [
      ['objective', t('prompts.section.objective')],
      ['context', t('prompts.section.context')],
      ['constraints', t('prompts.section.constraints')],
      ['acceptanceCriteria', t('prompts.section.acceptance')],
      ['executionRules', t('prompts.section.execution')],
      ['deliverables', t('prompts.section.deliverables')],
      ['risks', t('prompts.section.risks')],
      ['missingInfoQuestions', t('prompts.section.questions')],
    ]
    return el('div', { className: 'prompt-section-list' }, rows.map(([key, label]) => {
      const value = sections[key]
      const items = Array.isArray(value) ? value : [value].filter(Boolean)
      return el('div', { className: 'prompt-section' }, [
        el('div', { className: 'prompt-section-title', text: label }),
        el('ul', {}, items.length ? items.map(item => el('li', { text: item })) : [el('li', { text: t('common.none') })]),
      ])
    }))
  }

  function filteredItems() {
    const all = promptItems()
    return all.filter(item => {
      if (currentFilter === 'vibe' && item.kind !== 'vibe') return false
      if (currentFilter === 'phase' && item.kind !== 'phase') return false
      if (currentFilter === 'pack' && item.kind !== 'pack') return false
      if (currentFilter === 'custom' && item.source === 'builtin') return false
      if (!currentQuery) return true
      return item.search.includes(currentQuery)
    })
  }

  function promptItems() {
    if (!report) return []
    const vibe = (report.vibeTemplates || []).map(template => ({
      key: `vibe:${template.id}`,
      kind: 'vibe',
      id: template.id,
      title: template.title,
      meta: `${template.phase} / ${template.role}`,
      source: 'builtin',
      raw: template,
      search: searchable([template.id, template.title, template.phase, template.role, template.scenario, template.bestFor, template.suggestedSkills]),
    }))
    const phase = (report.phasePrompts || []).map(prompt => ({
      key: `phase:${prompt.id}`,
      kind: 'phase',
      id: prompt.id,
      title: prompt.name,
      meta: `${sourceLabel(prompt.source)} / ${prompt.phase}`,
      source: prompt.source,
      raw: prompt,
      search: searchable([prompt.id, prompt.name, prompt.phase, prompt.description, prompt.source, prompt.userLevels]),
    }))
    const packs = (report.packs || []).map(pack => ({
      key: `pack:${pack.id}`,
      kind: 'pack',
      id: pack.id,
      title: pack.name,
      meta: (pack.phases || []).join(' / '),
      source: 'builtin',
      raw: pack,
      search: searchable([pack.id, pack.name, pack.description, pack.phases, pack.templateIds]),
    }))
    return [...vibe, ...phase, ...packs]
  }

  function detailHeader(title, subtitle, actions) {
    return el('div', { className: 'panel' }, [
      el('div', { className: 'prompt-detail-head' }, [
        el('div', {}, [
          el('div', { className: 'prompt-detail-title', text: title }),
          el('div', { className: 'text-muted text-sm', text: subtitle || '' }),
        ]),
        el('div', { className: 'action-row' }, actions),
      ]),
    ])
  }

  function metaGrid(entries) {
    return el('div', { className: 'prompt-meta-grid' }, entries.map(([label, value]) => (
      el('div', { className: 'prompt-meta-box' }, [
        el('div', { className: 'prompt-meta-label', text: label }),
        el('div', { className: 'prompt-meta-value', text: value == null || value === '' ? '-' : String(value) }),
      ])
    )))
  }

  function detailSections(entries) {
    return el('div', { className: 'prompt-section-list' }, entries.map(([label, values]) => {
      const items = Array.isArray(values) ? values : [values].filter(Boolean)
      return el('div', { className: 'prompt-section' }, [
        el('div', { className: 'prompt-section-title', text: label }),
        el('ul', {}, items.length ? items.map(value => el('li', { text: value })) : [el('li', { text: t('common.none') })]),
      ])
    }))
  }

  function promptCode(text) {
    return el('pre', { className: 'prompt-code', text: text || '' })
  }

  function actionButton(label, onClick) {
    const button = el('button', { className: 'topo-btn', text: label })
    button.addEventListener('click', () => onClick(button))
    return button
  }

  function emptyStateWithHint(title, hint, icon) {
    return el('div', { className: 'empty-state' }, [
      icon ? el('div', { className: 'icon', text: icon }) : null,
      el('p', { text: title }),
      el('div', { className: 'empty-desc text-muted', text: hint }),
    ])
  }

  function sourceLabel(source) {
    if (source === 'project') return t('prompts.project')
    if (source === 'global') return t('prompts.global')
    return t('prompts.builtin')
  }

  function itemTypeLabel(kind) {
    if (kind === 'vibe') return t('prompts.vibeTemplate')
    if (kind === 'phase') return t('prompts.phasePrompt')
    return t('prompts.pack')
  }

  function promptStudioPayload() {
    return report || { summary: {}, vibeTemplates: [], phasePrompts: [], packs: [] }
  }

  function searchable(parts) {
    return parts.flatMap(part => Array.isArray(part) ? part : [part]).filter(Boolean).join(' ').toLowerCase()
  }

  function safeName(value) {
    return String(value || 'prompt').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'prompt'
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || 'Unknown error')
  }

  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.prompts = renderPrompts
})()
