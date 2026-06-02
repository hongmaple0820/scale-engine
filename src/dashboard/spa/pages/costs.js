/**
 * Costs Page v2 — Model comparison radar, efficiency gauge, token waterfall, optimization tips
 */
;(() => {
  'use strict'

  const { fetchJSON, formatNumber, registerChart, getTheme, t, $, $$ } = window.Dashboard

  // Model pricing (USD per 1M tokens, approximate)
  const MODEL_PRICING = {
    'claude-opus-4': { input: 15, output: 75 },
    'claude-sonnet-4': { input: 3, output: 15 },
    'claude-haiku-3.5': { input: 0.80, output: 4 },
    'gpt-4o': { input: 2.50, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'default': { input: 3, output: 15 },
  }

  async function renderCosts() {
    const app = $('#app')
    app.innerHTML = `
      <div class="metrics-row" id="cost-metrics"></div>
      <div class="tabs" id="cost-tabs">
        <div class="tab active" data-tab="overview">${t('costs.overview')}</div>
        <div class="tab" data-tab="models">${t('costs.modelComparison')}</div>
        <div class="tab" data-tab="optimization">${t('costs.optimization')}</div>
      </div>
      <div id="cost-content"></div>
    `

    const metrics = await fetchJSON('/api/metrics')
    renderCostMetrics(metrics)

    let currentTab = 'overview'
    $('#cost-tabs').addEventListener('click', (e) => {
      const tab = e.target.dataset?.tab
      if (!tab) return
      currentTab = tab
      $$('#cost-tabs .tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab))
      renderCostTab(tab, metrics)
    })

    renderCostTab('overview', metrics)
  }

  function renderCostMetrics(metrics) {
    const container = $('#cost-metrics')
    const cmd = metrics?.commandRuns
    const model = metrics?.modelUsage

    const totalTokens = (model?.totalInputTokens ?? 0) + (model?.totalOutputTokens ?? 0)
    const savedTokens = cmd?.savedEstimatedTokens ?? 0
    const efficiency = cmd?.rawEstimatedTokens > 0
      ? ((savedTokens / cmd.rawEstimatedTokens) * 100).toFixed(1) + '%'
      : '0%'
    const estimatedCost = estimateCost(model)

    container.innerHTML = [
      { label: t('costs.totalTokens'), value: formatNumber(totalTokens), cls: '' },
      { label: t('costs.rawEstTokens'), value: formatNumber(cmd?.rawEstimatedTokens ?? 0), cls: '' },
      { label: t('costs.tokensSaved'), value: formatNumber(savedTokens), cls: 'accent' },
      { label: t('costs.compressionRate'), value: efficiency, cls: 'accent' },
      { label: t('costs.estCost'), value: '$' + estimatedCost.toFixed(2), cls: '' },
    ].map(c => `
      <div class="metric-card">
        <div class="metric-label">${c.label}</div>
        <div class="metric-value ${c.cls}">${c.value}</div>
      </div>
    `).join('')
  }

  function renderCostTab(tab, metrics) {
    const container = $('#cost-content')
    switch (tab) {
      case 'overview': renderOverview(container, metrics); break
      case 'models': renderModelComparison(container, metrics); break
      case 'optimization': renderOptimization(container, metrics); break
    }
  }

  // ── Overview ───────────────────────────────────────────────────────

  function renderOverview(container, metrics) {
    const cmd = metrics?.commandRuns

    container.innerHTML = `
      <div class="grid-2 mb-24">
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('costs.tokenUsage')}</span></div>
          <div class="chart-area" id="cost-token-chart"></div>
        </div>
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('costs.compressionEfficiency')}</span></div>
          <div class="chart-area" id="cost-gauge"></div>
        </div>
      </div>
      <div class="grid-2">
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('costs.tokenWaterfall')}</span></div>
          <div class="chart-area" id="cost-waterfall"></div>
        </div>
        <div class="panel">
          <div class="panel-title">${t('costs.costBreakdownByModel')}</div>
          <div id="cost-model-table"></div>
        </div>
      </div>
    `

    renderTokenChart(metrics)
    renderEfficiencyGauge(metrics)
    renderWaterfall(metrics)
    renderModelTable(metrics)
  }

  function renderTokenChart(metrics) {
    const el = $('#cost-token-chart')
    const cmd = metrics?.commandRuns
    if (!cmd || cmd.total === 0) {
      el.innerHTML = `<div class="empty-state"><p>${t('costs.noTokenData')}</p></div>`
      return
    }

    const chart = echarts.init(el, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)

    chart.setOption({
      tooltip: { trigger: 'axis', formatter: (p) => p.map(s => `${s.seriesName}: ${formatNumber(s.value)}`).join('<br/>') },
      legend: { textStyle: { color: '#a1a1a1' }, bottom: 0 },
      grid: { left: 80, right: 20, top: 20, bottom: 40 },
      xAxis: {
        type: 'category',
        data: [t('costs.rawEst'), t('costs.afterCompression'), t('costs.saved')],
        axisLabel: { color: '#a1a1a1' },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#a1a1a1', formatter: (v) => formatNumber(v) },
        splitLine: { lineStyle: { color: '#2a2a2a' } },
      },
      series: [{
        name: t('costs.tokens'),
        type: 'bar', barWidth: 50,
        data: [
          { value: cmd.rawEstimatedTokens, itemStyle: { color: '#5588ff', borderRadius: [4, 4, 0, 0] } },
          { value: cmd.compressedEstimatedTokens, itemStyle: { color: '#ffaa00', borderRadius: [4, 4, 0, 0] } },
          { value: cmd.savedEstimatedTokens, itemStyle: { color: '#00dc82', borderRadius: [4, 4, 0, 0] } },
        ],
        label: {
          show: true, position: 'top',
          formatter: (p) => formatNumber(p.value),
          color: '#a1a1a1', fontSize: 11,
        },
      }],
    })
  }

  function renderEfficiencyGauge(metrics) {
    const el = $('#cost-gauge')
    const cmd = metrics?.commandRuns
    if (!cmd || cmd.rawEstimatedTokens === 0) {
      el.innerHTML = `<div class="empty-state"><p>${t('common.noData')}</p></div>`
      return
    }

    const efficiency = (cmd.savedEstimatedTokens / cmd.rawEstimatedTokens) * 100
    const chart = echarts.init(el, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)

    chart.setOption({
      series: [{
        type: 'gauge',
        startAngle: 200, endAngle: -20,
        min: 0, max: 100,
        progress: { show: true, width: 18, itemStyle: { color: '#00dc82' } },
        axisLine: { lineStyle: { width: 18, color: [[1, '#2a2a2a']] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        title: { show: true, offsetCenter: [0, '30%'], color: '#a1a1a1', fontSize: 13 },
        detail: {
          valueAnimation: true, fontSize: 32, fontWeight: 'bold',
          color: '#00dc82', offsetCenter: [0, '-10%'],
          formatter: '{value}%',
        },
        data: [{ value: efficiency.toFixed(1), name: t('costs.compressionEfficiency') }],
      }],
    })
  }

  function renderWaterfall(metrics) {
    const el = $('#cost-waterfall')
    const cmd = metrics?.commandRuns
    const model = metrics?.modelUsage
    if (!cmd || !model) {
      el.innerHTML = `<div class="empty-state"><p>${t('common.noData')}</p></div>`
      return
    }

    const chart = echarts.init(el, getTheme() === 'dark' ? 'dark' : null)
    registerChart(chart)

    const inputTokens = model.totalInputTokens ?? 0
    const outputTokens = model.totalOutputTokens ?? 0

    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 80, right: 20, top: 20, bottom: 30 },
      xAxis: {
        type: 'category',
        data: [t('costs.input'), t('costs.output'), t('costs.total'), t('costs.compressed'), t('costs.saved')],
        axisLabel: { color: '#a1a1a1' },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#a1a1a1', formatter: (v) => formatNumber(v) },
        splitLine: { lineStyle: { color: '#2a2a2a' } },
      },
      series: [{
        type: 'bar', barWidth: 40,
        data: [
          { value: inputTokens, itemStyle: { color: '#5588ff', borderRadius: [4, 4, 0, 0] } },
          { value: outputTokens, itemStyle: { color: '#aa88ff', borderRadius: [4, 4, 0, 0] } },
          { value: inputTokens + outputTokens, itemStyle: { color: '#888', borderRadius: [4, 4, 0, 0] } },
          { value: cmd.compressedEstimatedTokens, itemStyle: { color: '#ffaa00', borderRadius: [4, 4, 0, 0] } },
          { value: cmd.savedEstimatedTokens, itemStyle: { color: '#00dc82', borderRadius: [4, 4, 0, 0] } },
        ],
        label: { show: true, position: 'top', formatter: (p) => formatNumber(p.value), color: '#a1a1a1', fontSize: 10 },
      }],
    })
  }

  function renderModelTable(metrics) {
    const container = $('#cost-model-table')
    const model = metrics?.modelUsage
    if (!model?.models?.length) {
      container.innerHTML = `<div class="text-muted text-sm">${t('costs.noModelUsage')}</div>`
      return
    }

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t('costs.model')}</th>
            <th>${t('costs.inputTokens')}</th>
            <th>${t('costs.outputTokens')}</th>
            <th>${t('costs.requests')}</th>
            <th>${t('costs.estCost')}</th>
          </tr>
        </thead>
        <tbody>
          ${model.models.map(m => {
            const cost = estimateModelCost(m.model, m.inputTokens, m.outputTokens)
            return `
              <tr>
                <td style="font-weight:500">${m.model}</td>
                <td>${formatNumber(m.inputTokens)}</td>
                <td>${formatNumber(m.outputTokens)}</td>
                <td>${m.requestCount}</td>
                <td style="color:#00dc82">$${cost.toFixed(2)}</td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
    `
  }

  // ── Model Comparison ───────────────────────────────────────────────

  function renderModelComparison(container, metrics) {
    const model = metrics?.modelUsage
    if (!model?.models?.length) {
      container.innerHTML = `<div class="empty-state"><p>${t('costs.noModelData')}</p></div>`
      return
    }

    container.innerHTML = `
      <div class="grid-2 mb-24">
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('costs.modelUsageRadar')}</span></div>
          <div class="chart-area" id="cost-radar"></div>
        </div>
        <div class="chart-container">
          <div class="chart-header"><span class="chart-title">${t('costs.tokenDistByModel')}</span></div>
          <div class="chart-area" id="cost-model-pie"></div>
        </div>
      </div>
      <div class="chart-container">
        <div class="chart-header"><span class="chart-title">${t('costs.costPerRequest')}</span></div>
        <div class="chart-area" id="cost-per-req"></div>
      </div>
    `

    // Radar
    const radarEl = $('#cost-radar')
    if (radarEl) {
      const chart = echarts.init(radarEl, getTheme() === 'dark' ? 'dark' : null)
      registerChart(chart)
      const models = model.models.slice(0, 5)
      const maxInput = Math.max(...models.map(m => m.inputTokens), 1)
      const maxOutput = Math.max(...models.map(m => m.outputTokens), 1)
      const maxReqs = Math.max(...models.map(m => m.requestCount), 1)

      chart.setOption({
        tooltip: {},
        legend: { data: models.map(m => m.model), textStyle: { color: '#a1a1a1', fontSize: 10 }, bottom: 0 },
        radar: {
          indicator: [
            { name: t('costs.inputTokens'), max: maxInput },
            { name: t('costs.outputTokens'), max: maxOutput },
            { name: t('costs.requests'), max: maxReqs },
            { name: t('costs.estCost'), max: Math.max(...models.map(m => estimateModelCost(m.model, m.inputTokens, m.outputTokens)), 0.01) },
          ],
          axisName: { color: '#a1a1a1', fontSize: 10 },
        },
        series: [{
          type: 'radar',
          data: models.map((m, i) => ({
            name: m.model,
            value: [
              m.inputTokens, m.outputTokens, m.requestCount,
              estimateModelCost(m.model, m.inputTokens, m.outputTokens),
            ],
            areaStyle: { opacity: 0.1 },
          })),
        }],
      })
    }

    // Pie
    const pieEl = $('#cost-model-pie')
    if (pieEl) {
      const chart = echarts.init(pieEl, getTheme() === 'dark' ? 'dark' : null)
      registerChart(chart)
      chart.setOption({
        tooltip: { trigger: 'item' },
        series: [{
          type: 'pie', radius: ['35%', '65%'],
          label: { color: '#a1a1a1', formatter: '{b}\n{d}%' },
          data: model.models.map(m => ({
            name: m.model,
            value: m.inputTokens + m.outputTokens,
          })),
        }],
      })
    }

    // Cost per request
    const cprEl = $('#cost-per-req')
    if (cprEl) {
      const chart = echarts.init(cprEl, getTheme() === 'dark' ? 'dark' : null)
      registerChart(chart)
      const modelsWithCost = model.models.map(m => ({
        name: m.model,
        cost: m.requestCount > 0 ? estimateModelCost(m.model, m.inputTokens, m.outputTokens) / m.requestCount : 0,
      })).sort((a, b) => b.cost - a.cost)

      chart.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: 150, right: 40, top: 10, bottom: 30 },
        xAxis: { type: 'value', axisLabel: { color: '#a1a1a1', formatter: (v) => '$' + v.toFixed(3) }, splitLine: { lineStyle: { color: '#2a2a2a' } } },
        yAxis: { type: 'category', data: modelsWithCost.map(m => m.name), axisLabel: { color: '#a1a1a1', fontSize: 11 } },
        series: [{
          type: 'bar',
          data: modelsWithCost.map(m => ({
            value: m.cost,
            itemStyle: { color: '#5588ff', borderRadius: [0, 4, 4, 0] },
          })),
          barWidth: 20,
          label: { show: true, position: 'right', formatter: (p) => '$' + p.value.toFixed(4), color: '#a1a1a1', fontSize: 10 },
        }],
      })
    }
  }

  // ── Optimization ───────────────────────────────────────────────────

  function renderOptimization(container, metrics) {
    const cmd = metrics?.commandRuns
    const model = metrics?.modelUsage
    const tips = generateOptimizationTips(metrics)

    container.innerHTML = `
      <div class="panel mb-24">
        <div class="panel-title">${t('costs.optimizationScore')}</div>
        <div style="display:flex;align-items:center;gap:24px;padding:12px 0">
          <div style="font-size:48px;font-weight:700;color:${getScoreColor(getOptimizationScore(metrics))}">${getOptimizationScore(metrics)}</div>
          <div>
            <div style="font-size:14px;color:var(--text-1);margin-bottom:4px">${getScoreLabel(getOptimizationScore(metrics))}</div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">${t('costs.recommendations')} <span class="count">(${tips.length})</span></div>
        ${tips.length === 0 ? `<div class="text-muted text-sm">${t('costs.noOptTips')}</div>` : `
          <div style="display:flex;flex-direction:column;gap:12px">
            ${tips.map(tip => `
              <div style="display:flex;gap:12px;padding:12px;background:var(--bg-2);border-radius:var(--radius);border-left:3px solid ${tip.color}">
                <div style="font-size:16px;flex-shrink:0">${tip.icon}</div>
                <div>
                  <div style="font-size:14px;font-weight:500;margin-bottom:4px">${tip.title}</div>
                  <div style="font-size:13px;color:var(--text-1)">${tip.description}</div>
                  ${tip.impact ? `<div style="font-size:12px;color:var(--accent);margin-top:4px">${t('costs.potentialSavings', { impact: tip.impact })}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `
  }

  function generateOptimizationTips(metrics) {
    const tips = []
    const cmd = metrics?.commandRuns
    const model = metrics?.modelUsage

    if (!cmd || !model) return tips

    const efficiency = cmd.rawEstimatedTokens > 0 ? cmd.savedEstimatedTokens / cmd.rawEstimatedTokens : 0

    // Compression tips
    if (efficiency < 0.3) {
      tips.push({
        icon: '&#128230;',
        title: t('costs.tipLowCompression'),
        description: t('costs.tipLowCompressionDesc'),
        color: '#ff4444',
        impact: t('costs.tipLowCompressionImpact'),
      })
    }

    // Model selection tips
    for (const m of model.models ?? []) {
      if (m.model.includes('opus') && m.requestCount > 10) {
        tips.push({
          icon: '&#128176;',
          title: t('costs.tipDowngrade', { model: m.model }),
          description: t('costs.tipDowngradeDesc', { count: m.requestCount }),
          color: '#ffaa00',
          impact: t('costs.tipDowngradeImpact', { cost: (estimateModelCost(m.model, m.inputTokens, m.outputTokens) * 0.7).toFixed(2) }),
        })
      }
    }

    // Failed commands
    if (cmd.failed > 0 && cmd.total > 0) {
      const failRate = cmd.failed / cmd.total
      if (failRate > 0.1) {
        tips.push({
          icon: '&#9888;',
          title: t('costs.tipHighFailRate'),
          description: t('costs.tipHighFailRateDesc', { rate: (failRate * 100).toFixed(0) }),
          color: '#ff4444',
          impact: t('costs.tipHighFailRateImpact', { count: formatNumber(cmd.failed * 1000) }),
        })
      }
    }

    // Large output tokens
    if (model.totalOutputTokens > model.totalInputTokens * 2) {
      tips.push({
        icon: '&#128221;',
        title: t('costs.tipHighOutputRatio'),
        description: t('costs.tipHighOutputRatioDesc'),
        color: '#5588ff',
        impact: t('costs.tipHighOutputRatioImpact'),
      })
    }

    // General tips
    if (tips.length === 0) {
      tips.push({
        icon: '&#10003;',
        title: t('costs.tipLookingGood'),
        description: t('costs.tipLookingGoodDesc'),
        color: '#00dc82',
      })
    }

    return tips
  }

  function getOptimizationScore(metrics) {
    const cmd = metrics?.commandRuns
    if (!cmd || cmd.rawEstimatedTokens === 0) return 0

    let score = 0
    const efficiency = cmd.savedEstimatedTokens / cmd.rawEstimatedTokens
    score += Math.min(efficiency * 40, 40) // max 40 points for compression

    const passRate = cmd.total > 0 ? cmd.passed / cmd.total : 0
    score += passRate * 30 // max 30 points for pass rate

    const model = metrics?.modelUsage
    if (model?.models?.length) {
      const hasCheapModels = model.models.some(m => m.model.includes('haiku') || m.model.includes('mini'))
      if (hasCheapModels) score += 15 // bonus for using cheap models
    }

    score += 15 // base score for having metrics
    return Math.min(Math.round(score), 100)
  }

  function getScoreColor(score) {
    if (score >= 80) return '#00dc82'
    if (score >= 50) return '#ffaa00'
    return '#ff4444'
  }

  function getScoreLabel(score) {
    if (score >= 80) return t('costs.scoreExcellent')
    if (score >= 60) return t('costs.scoreGood')
    if (score >= 40) return t('costs.scoreFair')
    return t('costs.scoreNeedsAttention')
  }

  // ── Cost Estimation ────────────────────────────────────────────────

  function estimateCost(model) {
    if (!model?.models?.length) return 0
    let total = 0
    for (const m of model.models) {
      total += estimateModelCost(m.model, m.inputTokens, m.outputTokens)
    }
    return total
  }

  function estimateModelCost(modelName, inputTokens, outputTokens) {
    const pricing = Object.entries(MODEL_PRICING).find(([k]) => modelName.toLowerCase().includes(k))?.[1]
      ?? MODEL_PRICING.default
    return (inputTokens / 1e6 * pricing.input) + (outputTokens / 1e6 * pricing.output)
  }

  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.costs = renderCosts
})()
