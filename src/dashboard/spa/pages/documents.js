/**
 * Documents Page v2 - Markdown rendering, full-text search, doc metadata, favorites.
 */
;(() => {
  'use strict'

  const { copyText, downloadText, fetchJSON, formatTime, t, $, $$, dom } = window.Dashboard
  const { autoRefreshControl, dataNote, el, emptyState, panel, renderText } = dom

  let currentDoc = null
  let allDocs = []
  let favorites = new Set(JSON.parse(localStorage.getItem('scale-doc-favorites') || '[]'))

  async function renderDocuments() {
    const app = $('#app')
    const search = el('input', {
      id: 'doc-search',
      type: 'text',
      className: 'search-box',
      placeholder: t('documents.searchPlaceholder'),
      style: { flex: '1', maxWidth: '400px' },
    })
    const refresh = el('button', { id: 'doc-refresh', className: 'topo-btn', text: t('common.refresh') })
    const copyIndex = el('button', { id: 'doc-copy-index', className: 'topo-btn', text: t('documents.copyIndex') })
    const downloadIndex = el('button', { id: 'doc-download-index', className: 'topo-btn', text: t('documents.downloadIndex') })
    async function loadDocs() {
      allDocs = await fetchJSON('/api/documents') ?? []
      if (!$('#doc-tree')) return
      renderDocTree(allDocs)
      renderDocDataNote(allDocs)
      renderPrototypeGallery(allDocs)
    }

    app.replaceChildren(
      el('div', { className: 'page-toolbar' }, [
        search,
        refresh,
        copyIndex,
        downloadIndex,
        autoRefreshControl(loadDocs),
        el('div', { className: 'toolbar-spacer' }),
        el('span', { className: 'text-muted text-sm', id: 'doc-count' }),
      ]),
      el('div', { id: 'doc-data-note' }),
      panel(t('documents.prototypeGallery'), 'doc-prototypes'),
      el('div', { className: 'doc-layout' }, [
        el('div', { className: 'doc-tree', id: 'doc-tree' }, [
          el('div', { className: 'loading-placeholder', text: t('common.loading'), style: { height: '200px' } }),
        ]),
        el('div', { className: 'doc-renderer', id: 'doc-renderer' }, [
          emptyStateWithHint(t('documents.selectHint'), `${t('documents.supportedTypes')}. ${t('documents.prototypeHint')}`, '\uD83D\uDCC4'),
        ]),
      ])
    )

    await loadDocs()

    search.addEventListener('input', (event) => {
      const query = event.target.value.toLowerCase()
      const docs = query
        ? allDocs.filter(doc => doc.name.toLowerCase().includes(query) || doc.path.toLowerCase().includes(query))
        : allDocs
      renderDocTree(docs)
    })

    refresh.addEventListener('click', loadDocs)
    copyIndex.addEventListener('click', () => copyText(documentIndexText(allDocs), copyIndex))
    downloadIndex.addEventListener('click', () => {
      downloadText(`scale-documents-${Date.now()}.json`, JSON.stringify(documentIndexPayload(allDocs), null, 2), 'application/json;charset=utf-8')
    })
  }

  function renderDocDataNote(docs) {
    const node = $('#doc-data-note')
    if (!node) return
    const htmlCount = docs.filter(doc => doc.type === 'html').length
    node.replaceChildren(dataNote([
      { strong: true, text: t('common.snapshot') },
      `${t('common.lastLoaded')}: ${formatTime(Date.now())}`,
      t('documents.dataHint'),
      t('documents.previewable', { count: htmlCount }),
    ]))
  }

  function renderPrototypeGallery(docs) {
    const container = $('#doc-prototypes')
    if (!container) return
    const prototypes = docs.filter(doc => doc.type === 'html')
    if (prototypes.length === 0) {
      container.replaceChildren(emptyStateWithHint(t('documents.noPrototypes'), t('documents.noPrototypesHint'), '\u25cc'))
      return
    }
    container.replaceChildren(el('div', { className: 'prototype-grid' }, prototypes.map(doc => {
      const preview = el('button', { className: 'topo-btn', text: t('documents.preview') })
      preview.addEventListener('click', () => selectDocument(doc.path, doc.type))
      const open = el('button', { className: 'topo-btn', text: t('common.newTab') })
      open.addEventListener('click', () => window.open(documentUrl(doc.path), '_blank'))
      const copy = el('button', { className: 'topo-btn', text: t('documents.copyLink') })
      copy.addEventListener('click', () => copyText(new URL(documentUrl(doc.path), window.location.origin).href, copy))
      return el('div', { className: 'prototype-card' }, [
        el('div', { className: 'prototype-preview' }, [
          el('iframe', { attrs: { src: documentUrl(doc.path), title: doc.name } }),
        ]),
        el('div', { className: 'prototype-body' }, [
          el('div', { className: 'prototype-title', text: doc.name, title: doc.path }),
          el('div', { className: 'prototype-meta', text: `${doc.path} · ${formatSize(doc.size ?? 0)}` }),
          el('div', { className: 'action-row' }, [preview, open, copy]),
        ]),
      ])
    })))
  }

  function renderDocTree(docs) {
    const tree = $('#doc-tree')
    if (!tree) return
    const count = $('#doc-count')
    if (count) count.textContent = t('documents.docCount', { count: docs.length })

    if (docs.length === 0) {
      tree.replaceChildren(el('div', {
        className: 'text-muted text-sm',
        text: t('documents.noDocuments'),
        style: { padding: '12px' },
      }))
      return
    }

    const children = []
    const favDocs = docs.filter(doc => favorites.has(doc.path))
    if (favDocs.length > 0) {
      children.push(el('div', { className: 'doc-tree-folder', text: `\u2605 ${t('documents.favorites')}` }))
      children.push(...favDocs.map(file => renderDocItem(file)))
    }

    for (const [folder, files] of sortedFolders(docs)) {
      children.push(el('div', { className: 'doc-tree-folder', text: folder === 'root' ? '/' : folder }))
      children.push(...sortDocs(files).map(file => renderDocItem(file)))
    }

    tree.replaceChildren(...children)
    wireTree(tree, docs)
  }

  function sortedFolders(docs) {
    const folders = {}
    for (const doc of docs) {
      const parts = doc.path.split('/')
      const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root'
      if (!folders[folder]) folders[folder] = []
      folders[folder].push(doc)
    }
    return Object.entries(folders).sort(([left], [right]) => {
      const leftHasFav = folders[left].some(doc => favorites.has(doc.path))
      const rightHasFav = folders[right].some(doc => favorites.has(doc.path))
      if (leftHasFav && !rightHasFav) return -1
      if (!leftHasFav && rightHasFav) return 1
      return left.localeCompare(right)
    })
  }

  function sortDocs(files) {
    return [...files].sort((left, right) => {
      const leftFav = favorites.has(left.path) ? 0 : 1
      const rightFav = favorites.has(right.path) ? 0 : 1
      return leftFav - rightFav || left.name.localeCompare(right.name)
    })
  }

  function renderDocItem(file) {
    const isFav = favorites.has(file.path)
    return el('div', {
      className: ['doc-tree-item', currentDoc === file.path ? 'active' : ''].filter(Boolean).join(' '),
      dataset: { path: file.path, type: file.type },
      style: { display: 'flex', alignItems: 'center', gap: '6px' },
    }, [
      el('span', { text: getDocIcon(file.type) }),
      el('span', {
        text: file.name,
        style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      }),
      el('span', { className: 'text-muted text-sm', text: formatSize(file.size), style: { flexShrink: '0' } }),
      el('span', {
        className: 'doc-fav-btn',
        text: isFav ? '\u2605' : '\u2606',
        title: isFav ? t('documents.removeFromFavorites') : t('documents.addToFavorites'),
        dataset: { path: file.path },
        style: { cursor: 'pointer', color: isFav ? '#ffaa00' : 'var(--text-2)', fontSize: '12px' },
      }),
    ])
  }

  function wireTree(tree, docs) {
    $$('.doc-tree-item', tree).forEach((item) => {
      item.addEventListener('click', (event) => {
        if (event.target.classList.contains('doc-fav-btn')) return
        selectDocument(item.dataset.path, item.dataset.type)
      })
    })
    $$('.doc-fav-btn', tree).forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        const path = button.dataset.path
        if (favorites.has(path)) favorites.delete(path)
        else favorites.add(path)
        localStorage.setItem('scale-doc-favorites', JSON.stringify([...favorites]))
        renderDocTree(docs)
      })
    })
  }

  function selectDocument(path, type) {
    const tree = $('#doc-tree')
    if (tree) {
      $$('.doc-tree-item', tree).forEach(node => node.classList.toggle('active', node.dataset.path === path))
    }
    loadDocument(path, type)
  }

  function getDocIcon(type) {
    switch (type) {
      case 'html': return '\uD83C\uDF10'
      case 'json': return '\uD83D\uDCC4'
      case 'md': return '\uD83D\uDCDD'
      default: return '\uD83D\uDCC4'
    }
  }

  async function loadDocument(path, type) {
    const renderer = $('#doc-renderer')
    if (!renderer) return
    renderer.replaceChildren(el('div', { className: 'loading-placeholder', text: t('common.loading') }))

    try {
      const res = await fetch(documentUrl(path))
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const text = await res.text()
      if (!renderer.isConnected || $('#doc-renderer') !== renderer) return

      if (type === 'html') renderHtmlDocument(renderer, path, text)
      else if (type === 'md') renderMarkdownDocument(renderer, path, text)
      else if (type === 'json') renderJsonDocument(renderer, path, text)
      else renderPlainDocument(renderer, path, text)

      currentDoc = path
    } catch (error) {
      renderer.replaceChildren(emptyState(`${t('documents.failedToLoad')}: ${errorMessage(error)}`, '\u26A0'))
    }
  }

  function renderHtmlDocument(renderer, path, text) {
    const openButton = el('button', {
      className: 'topo-btn doc-open-ext',
      text: `\u2197 ${t('common.newTab')}`,
      title: t('common.newTab'),
    })
    openButton.addEventListener('click', () => window.open(documentUrl(path), '_blank'))
    renderer.replaceChildren(
      docHeader(path, formatSize(text.length), documentActions(path, text, [openButton])),
      el('iframe', {
        attrs: { src: documentUrl(path) },
        style: {
          width: '100%',
          height: 'calc(100% - 50px)',
          minHeight: '550px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        },
      })
    )
  }

  function renderMarkdownDocument(renderer, path, text) {
    renderer.replaceChildren(
      docHeader(path, formatSize(text.length), documentActions(path, text)),
      renderMarkdown(text)
    )
  }

  function renderJsonDocument(renderer, path, text) {
    try {
      const json = JSON.parse(text)
      const formatted = JSON.stringify(json, null, 2)
      renderer.replaceChildren(
        docHeader(path, `${Object.keys(json).length} ${t('documents.keys')} \u00b7 ${formatSize(text.length)}`, documentActions(path, formatted)),
        renderJsonPre(formatted)
      )
    } catch (error) {
      observeRecoverableError(error)
      renderPlainDocument(renderer, path, text)
    }
  }

  function renderPlainDocument(renderer, path, text) {
    renderer.replaceChildren(
      docHeader(path, formatSize(text.length), documentActions(path, text)),
      el('pre', {
        text,
        style: { fontSize: '13px', whiteSpace: 'pre-wrap', color: 'var(--text-1)', lineHeight: '1.5' },
      })
    )
  }

  function docHeader(path, meta, actions = []) {
    return el('div', {
      style: { marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    }, [
      el('div', {}, [
        el('span', { text: fileName(path), style: { fontWeight: '600' } }),
        el('span', { className: 'text-muted text-sm', text: meta, style: { marginLeft: '8px' } }),
      ]),
      actions.length ? el('div', { style: { display: 'flex', gap: '8px' } }, actions) : null,
    ])
  }

  function documentActions(path, text, extraActions = []) {
    const copyButton = el('button', { className: 'topo-btn doc-copy', text: t('common.copy'), title: t('common.copy') })
    copyButton.addEventListener('click', async () => {
      try {
        await copyText(text, copyButton)
      } catch (error) {
        observeRecoverableError(error)
      }
    })
    const downloadButton = el('button', { className: 'topo-btn doc-download', text: t('common.download'), title: t('common.download') })
    downloadButton.addEventListener('click', () => downloadText(fileName(path), text, contentTypeForPath(path)))
    return [copyButton, downloadButton, ...extraActions]
  }

  function documentIndexPayload(docs) {
    return {
      exportedAt: new Date().toISOString(),
      count: docs.length,
      previewableHtml: docs.filter(doc => doc.type === 'html').length,
      documents: docs.map(doc => ({
        name: doc.name,
        path: doc.path,
        type: doc.type,
        size: doc.size,
      })),
    }
  }

  function documentIndexText(docs) {
    return documentIndexPayload(docs).documents
      .map(doc => `${doc.type}\t${formatSize(doc.size ?? 0)}\t${doc.path}`)
      .join('\n')
  }

  function contentTypeForPath(path) {
    const lower = String(path).toLowerCase()
    if (lower.endsWith('.json')) return 'application/json;charset=utf-8'
    if (lower.endsWith('.html')) return 'text/html;charset=utf-8'
    if (lower.endsWith('.md')) return 'text/markdown;charset=utf-8'
    return 'text/plain;charset=utf-8'
  }

  function renderMarkdown(markdown) {
    const root = el('div', { className: 'markdown-body', style: { fontSize: '14px', lineHeight: '1.7', color: 'var(--text-0)' } })
    const lines = markdown.replace(/\r\n/g, '\n').split('\n')
    let codeLines = []
    let codeLang = ''
    let paragraph = []
    let list = null

    const flushParagraph = () => {
      if (paragraph.length === 0) return
      const p = el('p', { style: { margin: '8px 0' } })
      appendInline(p, paragraph.join(' '))
      root.appendChild(p)
      paragraph = []
    }
    const flushList = () => {
      if (!list) return
      root.appendChild(list)
      list = null
    }
    const flushCode = () => {
      const code = el('code', { text: codeLines.join('\n') })
      const pre = el('pre', {
        attrs: codeLang ? { 'data-lang': codeLang } : {},
        style: { background: 'var(--bg-2)', padding: '12px', borderRadius: 'var(--radius)', fontSize: '13px', lineHeight: '1.5', overflow: 'auto', margin: '12px 0' },
      }, [code])
      root.appendChild(pre)
      codeLines = []
      codeLang = ''
    }

    for (const line of lines) {
      const fence = line.match(/^```(\w*)\s*$/)
      if (fence && codeLang === '' && codeLines.length === 0) {
        flushParagraph()
        flushList()
        codeLang = fence[1] || 'plain'
        codeLines = ['__OPEN__']
        continue
      }
      if (fence && codeLines.length > 0) {
        codeLines.shift()
        flushCode()
        continue
      }
      if (codeLines.length > 0) {
        codeLines.push(line)
        continue
      }

      if (!line.trim()) {
        flushParagraph()
        flushList()
        continue
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/)
      if (heading) {
        flushParagraph()
        flushList()
        root.appendChild(headingNode(heading[1].length, heading[2]))
        continue
      }
      if (/^---+$/.test(line.trim())) {
        flushParagraph()
        flushList()
        root.appendChild(el('hr', { style: { border: 'none', borderTop: '1px solid var(--border)', margin: '20px 0' } }))
        continue
      }
      const item = line.match(/^[-*]\s+(.+)$/)
      if (item) {
        flushParagraph()
        if (!list) list = el('ul', { style: { margin: '8px 0 8px 20px' } })
        const li = el('li', { style: { padding: '2px 0' } })
        appendInline(li, item[1])
        list.appendChild(li)
        continue
      }
      paragraph.push(line.trim())
    }

    if (codeLines.length > 0) {
      codeLines.shift()
      flushCode()
    }
    flushParagraph()
    flushList()
    return root
  }

  function headingNode(level, text) {
    const sizes = { 1: '22px', 2: '18px', 3: '16px' }
    const margins = { 1: '28px 0 12px', 2: '24px 0 10px', 3: '20px 0 8px' }
    const node = el(`h${level}`, { style: { margin: margins[level], fontSize: sizes[level], color: 'var(--text-0)' } })
    appendInline(node, text)
    return node
  }

  function appendInline(parent, text) {
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g
    let lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      if (match.index > lastIndex) parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
      parent.appendChild(inlineNode(match[0]))
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) parent.appendChild(document.createTextNode(text.slice(lastIndex)))
  }

  function inlineNode(token) {
    if (token.startsWith('**')) return el('strong', { text: token.slice(2, -2) })
    if (token.startsWith('`')) return el('code', { text: token.slice(1, -1), style: { background: 'var(--bg-2)', padding: '2px 6px', borderRadius: '3px', fontSize: '12px' } })
    if (token.startsWith('*')) return el('em', { text: token.slice(1, -1) })
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (!link) return document.createTextNode(token)
    return el('a', { text: link[1], attrs: { href: safeHref(link[2]), target: '_blank', rel: 'noopener noreferrer' } })
  }

  function renderJsonPre(formatted) {
    const pre = el('pre', {
      style: { fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre-wrap', color: 'var(--text-1)', background: 'var(--bg-2)', padding: '16px', borderRadius: 'var(--radius)', overflow: 'auto', maxHeight: 'calc(100% - 50px)' },
    })
    const tokenPattern = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b/gi
    let lastIndex = 0
    for (const match of formatted.matchAll(tokenPattern)) {
      if (match.index > lastIndex) pre.appendChild(document.createTextNode(formatted.slice(lastIndex, match.index)))
      pre.appendChild(jsonToken(match[0], formatted.slice(match.index + match[0].length)))
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < formatted.length) pre.appendChild(document.createTextNode(formatted.slice(lastIndex)))
    return pre
  }

  function jsonToken(token, tail) {
    const color = token.startsWith('"')
      ? (tail.trimStart().startsWith(':') ? '#5588ff' : '#00dc82')
      : (/^(true|false|null)$/i.test(token) ? '#aa88ff' : '#ffaa00')
    return el('span', { text: token, style: { color } })
  }

  function emptyStateWithHint(message, hint, icon) {
    const state = emptyState(message, icon)
    state.appendChild(el('p', { className: 'text-muted text-sm', text: hint, style: { marginTop: '8px' } }))
    return state
  }

  function documentUrl(path) {
    return `/api/documents/${String(path).split('/').map(segment => encodeURIComponent(segment)).join('/')}`
  }

  function safeHref(value) {
    const href = String(value || '')
    if (/^(https?:|mailto:|#|\/)/i.test(href)) return href
    return '#'
  }

  function fileName(path) {
    return String(path).split('/').pop() || path
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || 'Unknown error')
  }

  function observeRecoverableError(error) {
    void error
  }

  window.addEventListener('search', (event) => {
    const query = event.detail.toLowerCase()
    $$('.doc-tree-item').forEach((item) => {
      const name = item.textContent.toLowerCase()
      item.style.display = name.includes(query) ? '' : 'none'
    })
  })

  window.DashboardPages = window.DashboardPages || {}
  window.DashboardPages.documents = renderDocuments
})()
