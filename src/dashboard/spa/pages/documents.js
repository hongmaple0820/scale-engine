/**
 * Documents Page v2 — Markdown rendering, full-text search, doc metadata, favorites
 */
;(() => {
  'use strict'

  const { fetchJSON, t, $, $$ } = window.Dashboard

  let currentDoc = null
  let allDocs = []
  let favorites = new Set(JSON.parse(localStorage.getItem('scale-doc-favorites') || '[]'))

  async function renderDocuments() {
    const app = $('#app')
    app.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center">
        <input type="text" class="search-box" placeholder="${t('documents.searchPlaceholder')}" id="doc-search" style="flex:1;max-width:400px">
        <button class="topo-btn" id="doc-refresh">${t('common.refresh')}</button>
        <span class="text-muted text-sm" id="doc-count"></span>
      </div>
      <div class="doc-layout">
        <div class="doc-tree" id="doc-tree">
          <div class="loading-placeholder" style="height:200px">${t('common.loading')}</div>
        </div>
        <div class="doc-renderer" id="doc-renderer">
          <div class="empty-state">
            <div class="icon">&#128196;</div>
            <p>${t('documents.selectHint')}</p>
            <p class="text-muted text-sm" style="margin-top:8px">${t('documents.supportedTypes')}</p>
          </div>
        </div>
      </div>
    `

    allDocs = await fetchJSON('/api/documents') ?? []
    renderDocTree(allDocs)

    // Wire search
    $('#doc-search').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase()
      if (!q) {
        renderDocTree(allDocs)
      } else {
        const filtered = allDocs.filter(d =>
          d.name.toLowerCase().includes(q) || d.path.toLowerCase().includes(q)
        )
        renderDocTree(filtered)
      }
    })

    // Wire refresh
    $('#doc-refresh').addEventListener('click', async () => {
      allDocs = await fetchJSON('/api/documents') ?? []
      renderDocTree(allDocs)
    })
  }

  function renderDocTree(docs) {
    const tree = $('#doc-tree')
    $('#doc-count').textContent = t('documents.docCount', { count: docs.length })

    if (docs.length === 0) {
      tree.innerHTML = `<div class="text-muted text-sm" style="padding:12px">${t('documents.noDocuments')}</div>`
      return
    }

    // Group by folder
    const folders = {}
    for (const doc of docs) {
      const parts = doc.path.split('/')
      const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root'
      if (!folders[folder]) folders[folder] = []
      folders[folder].push(doc)
    }

    // Sort folders, favorites first
    const sortedFolders = Object.entries(folders).sort(([a], [b]) => {
      const aHasFav = folders[a].some(d => favorites.has(d.path))
      const bHasFav = folders[b].some(d => favorites.has(d.path))
      if (aHasFav && !bHasFav) return -1
      if (!aHasFav && bHasFav) return 1
      return a.localeCompare(b)
    })

    let html = ''

    // Favorites section
    const favDocs = docs.filter(d => favorites.has(d.path))
    if (favDocs.length > 0) {
      html += `<div class="doc-tree-folder">&#9733; ${t('documents.favorites')}</div>`
      for (const file of favDocs) {
        html += renderDocItem(file, true)
      }
    }

    for (const [folder, files] of sortedFolders) {
      html += `<div class="doc-tree-folder">${folder === 'root' ? '/' : folder}</div>`
      // Sort: favorites first, then by name
      const sorted = [...files].sort((a, b) => {
        const aFav = favorites.has(a.path) ? 0 : 1
        const bFav = favorites.has(b.path) ? 0 : 1
        return aFav - bFav || a.name.localeCompare(b.name)
      })
      for (const file of sorted) {
        html += renderDocItem(file, false)
      }
    }

    tree.innerHTML = html

    // Wire click handlers
    $$('.doc-tree-item', tree).forEach(item => {
      item.addEventListener('click', (e) => {
        // Don't trigger on favorite button click
        if (e.target.classList.contains('doc-fav-btn')) return
        $$('.doc-tree-item', tree).forEach(i => i.classList.remove('active'))
        item.classList.add('active')
        loadDocument(item.dataset.path, item.dataset.type)
      })
    })

    // Wire favorite buttons
    $$('.doc-fav-btn', tree).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const path = btn.dataset.path
        if (favorites.has(path)) {
          favorites.delete(path)
        } else {
          favorites.add(path)
        }
        localStorage.setItem('scale-doc-favorites', JSON.stringify([...favorites]))
        renderDocTree(docs)
      })
    })
  }

  function renderDocItem(file, isFavSection) {
    const icon = getDocIcon(file.type)
    const isFav = favorites.has(file.path)
    return `
      <div class="doc-tree-item" data-path="${file.path}" data-type="${file.type}" style="display:flex;align-items:center;gap:6px">
        <span>${icon}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${file.name}</span>
        <span class="text-muted text-sm" style="flex-shrink:0">${formatSize(file.size)}</span>
        <span class="doc-fav-btn" data-path="${file.path}" style="cursor:pointer;color:${isFav ? '#ffaa00' : 'var(--text-2)'};font-size:12px" title="${isFav ? t('documents.removeFromFavorites') : t('documents.addToFavorites')}">${isFav ? '&#9733;' : '&#9734;'}</span>
      </div>
    `
  }

  function getDocIcon(type) {
    switch (type) {
      case 'html': return '&#127760;'
      case 'json': return '&#128196;'
      case 'md': return '&#128221;'
      default: return '&#128196;'
    }
  }

  async function loadDocument(path, type) {
    const renderer = $('#doc-renderer')
    renderer.innerHTML = `<div class="loading-placeholder">${t('common.loading')}</div>`

    try {
      const res = await fetch(`/api/documents/${path}`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const text = await res.text()

      if (type === 'html') {
        // Render HTML in iframe for isolation
        renderer.innerHTML = `
          <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <span style="font-weight:600">${path.split('/').pop()}</span>
              <span class="text-muted text-sm" style="margin-left:8px">${formatSize(text.length)}</span>
            </div>
            <div style="display:flex;gap:8px">
              <button class="topo-btn doc-open-ext" title="${t('common.newTab')}">&#8599; ${t('common.newTab')}</button>
            </div>
          </div>
          <iframe src="/api/documents/${path}" style="width:100%;height:calc(100% - 50px);min-height:550px;border:1px solid var(--border);border-radius:var(--radius)"></iframe>
        `
        renderer.querySelector('.doc-open-ext')?.addEventListener('click', () => {
          window.open(`/api/documents/${path}`, '_blank')
        })
      } else if (type === 'md') {
        // Render markdown with basic parsing
        renderer.innerHTML = `
          <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <span style="font-weight:600">${path.split('/').pop()}</span>
              <span class="text-muted text-sm" style="margin-left:8px">${formatSize(text.length)}</span>
            </div>
          </div>
          <div class="markdown-body" style="line-height:1.7;color:var(--text-0)">${renderMarkdown(text)}</div>
        `
      } else if (type === 'json') {
        try {
          const json = JSON.parse(text)
          const formatted = JSON.stringify(json, null, 2)
          renderer.innerHTML = `
            <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <span style="font-weight:600">${path.split('/').pop()}</span>
                <span class="text-muted text-sm" style="margin-left:8px">${Object.keys(json).length} ${t('documents.keys')} &middot; ${formatSize(text.length)}</span>
              </div>
              <button class="topo-btn doc-copy" title="${t('common.copy')}">${t('common.copy')}</button>
            </div>
            <pre style="font-size:13px;line-height:1.5;white-space:pre-wrap;color:var(--text-1);background:var(--bg-2);padding:16px;border-radius:var(--radius);overflow:auto;max-height:calc(100% - 50px)">${syntaxHighlightJSON(formatted)}</pre>
          `
          renderer.querySelector('.doc-copy')?.addEventListener('click', () => {
            navigator.clipboard.writeText(formatted)
            renderer.querySelector('.doc-copy').textContent = t('common.copied')
            setTimeout(() => { renderer.querySelector('.doc-copy').textContent = t('common.copy') }, 1500)
          })
        } catch {
          renderer.innerHTML = `<pre style="font-size:13px;white-space:pre-wrap;color:var(--text-1)">${escapeHtml(text)}</pre>`
        }
      } else {
        renderer.innerHTML = `
          <div style="margin-bottom:12px">
            <span style="font-weight:600">${path.split('/').pop()}</span>
            <span class="text-muted text-sm" style="margin-left:8px">${formatSize(text.length)}</span>
          </div>
          <pre style="font-size:13px;white-space:pre-wrap;color:var(--text-1);line-height:1.5">${escapeHtml(text)}</pre>
        `
      }
      currentDoc = path
    } catch (e) {
      renderer.innerHTML = `<div class="empty-state"><div class="icon">&#9888;</div><p>${t('documents.failedToLoad')}: ${e.message}</p></div>`
    }
  }

  // ── Markdown Renderer ──────────────────────────────────────────────

  function renderMarkdown(md) {
    let html = escapeHtml(md)

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3 style="margin:20px 0 8px;font-size:16px;color:var(--text-0)">$1</h3>')
    html = html.replace(/^## (.+)$/gm, '<h2 style="margin:24px 0 10px;font-size:18px;color:var(--text-0)">$1</h2>')
    html = html.replace(/^# (.+)$/gm, '<h1 style="margin:28px 0 12px;font-size:22px;color:var(--text-0)">$1</h1>')

    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre style="background:var(--bg-2);padding:12px;border-radius:var(--radius);font-size:13px;line-height:1.5;overflow:auto;margin:12px 0"><code>${code}</code></pre>`
    )

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-2);padding:2px 6px;border-radius:3px;font-size:12px">$1</code>')

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')

    // Lists
    html = html.replace(/^- (.+)$/gm, '<div style="padding:2px 0;padding-left:16px;position:relative"><span style="position:absolute;left:0;color:var(--text-2)">-</span>$1</div>')
    html = html.replace(/^\* (.+)$/gm, '<div style="padding:2px 0;padding-left:16px;position:relative"><span style="position:absolute;left:0;color:var(--text-2)">*</span>$1</div>')

    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:20px 0">')

    // Paragraphs (double newline)
    html = html.replace(/\n\n/g, '</p><p style="margin:8px 0">')

    // Single newlines within paragraphs
    html = html.replace(/\n/g, '<br/>')

    return `<div style="font-size:14px">${html}</div>`
  }

  // ── Helpers ────────────────────────────────────────────────────────

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function syntaxHighlightJSON(json) {
    return json
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"([^"]+)":/g, '<span style="color:#5588ff">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span style="color:#00dc82">"$1"</span>')
      .replace(/: (\d+\.?\d*)/g, ': <span style="color:#ffaa00">$1</span>')
      .replace(/: (true|false|null)/g, ': <span style="color:#aa88ff">$1</span>')
  }

  // Search integration
  window.addEventListener('search', (e) => {
    const q = e.detail.toLowerCase()
    $$('.doc-tree-item').forEach(item => {
      const name = item.textContent.toLowerCase()
      item.style.display = name.includes(q) ? '' : 'none'
    })
  })

  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.documents = renderDocuments
})()
