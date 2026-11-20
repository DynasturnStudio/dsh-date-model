// 按日期选模型 —— DeepSeek Harness Web 客户端插件（纯界面玩具，不改变真实模型）。
//
// 版本号 = 两个数字 + 档位 + 日期，长得像时间选择器：
//   deepseek-v 4 . 1 - flash - 1107
//              ↑   ↑           ↑
//          数字盘  数字盘      月日
//
// 界面只有：两个滚轮数字盘、一本月历、一行结果。没有一句说明文字。
window.__ModuleLoader__.load({
  id: 'dsh-date-model',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    const STORAGE_KEY = 'dsh-date-model/selection'
    const TIERS = ['flash', 'pro', 'rain', 'cloudy', 'snow', 'fog', 'clear']
    // flash / pro 保留原名；pro = 气象预报图（prognostic chart）；其余用真实天气单词
    const TIER_SHAPES = {
      flash: 'M13.4 1.8 5 13.2h5.5l-1.1 9L19 10.4h-5.6l0-8.6Z',
      pro: 'M3.5 9.8c3.2-4.4 6.8-4.4 10 0s6.8 4.4 10 0M3.5 15.2c3.2-4.4 6.8-4.4 10 0s6.8 4.4 10 0',
      rain: 'M7 8 5.2 13.2M12 7 10.2 12.6M17 8 15.2 13.2',
      snow: 'M12 3v18M4.2 7.5 19.8 16.5M19.8 7.5 4.2 16.5',
      fog: 'M4 8.4h16M4 12h11.6M6.4 15.6h11.2',
      cloudy: 'M6.4 18.2h11.2a3.6 3.6 0 0 0 .4-7.2 5.4 5.4 0 0 0-10.3-1.3 3.7 3.7 0 0 0-1.3 8.5Z',
      clear: 'M20.6 13.4A8.8 8.8 0 1 1 10.6 3.4a7 7 0 0 0 10 10Z',
    }
    const STROKE_TIERS = new Set(['pro', 'rain', 'snow', 'fog'])
    const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
    const MIN_YEAR = 1970
    const MAX_YEAR = 2100
    const PANEL_WIDTH = 320
    const PANEL_ESTIMATE = 560
    const ITEM_H = 28

    const pad = (n) => String(n).padStart(2, '0')
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

    /* ------------------------------------------------------------------ *
     *  版本号
     * ------------------------------------------------------------------ */
    function modelId(sel) {
      return `deepseek-v${sel.major}.${sel.minor}-${sel.tier}-${pad(sel.m + 1)}${pad(sel.d)}`
    }

    const defaultSel = () => {
      const now = new Date()
      return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate(), major: 4, minor: 1, tier: 'flash' }
    }

    /* ------------------------------------------------------------------ *
     *  当前选择（chip 订阅，面板读写）
     * ------------------------------------------------------------------ */
    const listeners = new Set()
    let applied = read()

    function read() {
      try {
        const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null')
        if (raw && Number.isInteger(raw.y) && Number.isInteger(raw.m) && Number.isInteger(raw.d)) {
          const major = Number.isInteger(raw.major) ? raw.major : Number.isInteger(raw.h) ? raw.h : 4
          const minor = Number.isInteger(raw.minor) ? raw.minor : Number.isInteger(raw.min) ? raw.min : 1
          return {
            y: raw.y, m: raw.m, d: raw.d,
            major: Math.max(0, major),
            minor: Math.max(0, minor),
            tier: TIERS.includes(raw.tier) ? raw.tier : 'flash',
          }
        }
      } catch { /* 存储坏了就用默认 */ }
      return defaultSel()
    }
    function write(next) {
      applied = next
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      for (const fn of [...listeners]) fn(next)
    }
    function subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }

    /* ------------------------------------------------------------------ *
     *  深 / 浅色
     * ------------------------------------------------------------------ */
    function isDark() {
      try {
        const root = document.documentElement
        const body = document.body
        if (body && body.hasAttribute('data-ds-dark-theme')) return true
        if (root && root.hasAttribute('data-ds-dark-theme')) return true
        const bg = window.getComputedStyle ? window.getComputedStyle(body).backgroundColor : ''
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg || '')
        if (m) {
          const lum = (Number(m[1]) * 299 + Number(m[2]) * 587 + Number(m[3]) * 114) / 1000
          return lum < 128
        }
      } catch { /* 量不出来就一直深色 */ }
      return true
    }
    const skin = () => (isDark() ? 'dm' : 'dm dm-light')

    /* ------------------------------------------------------------------ *
     *  最小 DOM 助手
     * ------------------------------------------------------------------ */
    function el(tag, props, ...kids) {
      const node = document.createElement(tag)
      if (props) {
        for (const key of Object.keys(props)) {
          const value = props[key]
          if (value === undefined || value === null || value === false) continue
          if (key === 'class') node.className = value
          else if (key === 'text') node.textContent = String(value)
          else if (key === 'style') { for (const name of Object.keys(value)) node.style[name] = value[name] }
          else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2).toLowerCase(), value)
          else node.setAttribute(key, String(value))
        }
      }
      for (const kid of kids.flat(4)) {
        if (kid === undefined || kid === null || kid === false) continue
        node.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)))
      }
      return node
    }

    /* ------------------------------------------------------------------ *
     *  档位图标：flash = 闪电（快），pro = 钻石（强）
     * ------------------------------------------------------------------ */
    function tierIcon(kind) {
      const NS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      svg.setAttribute('width', '14')
      svg.setAttribute('height', '14')
      svg.setAttribute('aria-hidden', 'true')
      const shape = document.createElementNS(NS, 'path')
      shape.setAttribute('d', TIER_SHAPES[kind] || TIER_SHAPES.storm)
      if (STROKE_TIERS.has(kind)) {
        svg.setAttribute('fill', 'none')
        shape.setAttribute('stroke', 'currentColor')
        shape.setAttribute('stroke-width', '1.9')
        shape.setAttribute('stroke-linecap', 'round')
      } else {
        svg.setAttribute('fill', 'currentColor')
      }
      svg.appendChild(shape)
      return svg
    }

    /* ------------------------------------------------------------------ *
     *  让真实模型选择器腾位置（只改显示，卸载还原）
     * ------------------------------------------------------------------ */
    const HIDDEN_ATTR = 'data-dsh-date-model-hidden'
    const hiddenSeats = new Set()

    function modelRow(start) {
      let node = start
      for (let i = 0; i < 6; i += 1) {
        const parent = node.parentElement
        if (!parent) return null
        if (parent.children.length > 1) return parent
        node = parent
      }
      return node.parentElement || null
    }

    function hideRealModelSeat(button) {
      const seat = button.parentElement
      if (!seat) return
      const row = modelRow(seat)
      if (!row) return
      for (const child of Array.from(row.children)) {
        if (child === seat || child.contains(seat)) continue
        if (child.hasAttribute(HIDDEN_ATTR)) continue
        if (!String(child.textContent || '').trim()) continue
        if (!child.querySelector || !child.querySelector('button')) continue
        child.setAttribute(HIDDEN_ATTR, '1')
        child.setAttribute('data-dm-prev-display', child.style.display || '')
        child.style.display = 'none'
        hiddenSeats.add(child)
      }
    }

    /* ------------------------------------------------------------------ *
     *  真实模型名：直接读真实座位上的文字（切模型会变，比配置里的默认值准）
     * ------------------------------------------------------------------ */
    const MODELISH = /(deepseek|qwen|glm|claude|gpt|gemini|llama|kimi|doubao)/i
    let realSeatNode = null

    function cleanLabel(raw) {
      let text = String(raw || '').replace(/\s+/g, ' ').trim()
      text = text.replace(/[▾▴⌄⌃▼▲›»]+/g, '').trim()
      text = text.replace(/^(模型|model)\s*[：:·]\s*/i, '').trim()
      return text
    }

    function attrOf(node, key) {
      try {
        if (!node || typeof node.getAttribute !== 'function') return ''
        return node.getAttribute(key) || ''
      } catch { return '' }
    }

    function firstButton(node) {
      try {
        if (node && typeof node.querySelector === 'function') return node.querySelector('button')
      } catch { /* ignore */ }
      return null
    }

    function seatLabel(node) {
      if (!node) return ''
      const button = firstButton(node)
      const candidates = [
        button ? attrOf(button, 'title') : '',
        button ? attrOf(button, 'aria-label') : '',
        attrOf(node, 'title'),
        node.textContent,
      ].map((raw) => cleanLabel(raw)).filter((label) => label.length > 0)
      if (!candidates.length) return ''
      // 优先挑「像模型名」的那条，再取最短的，避免把上下文用量之类的文字当成模型名
      const modelish = candidates.filter((label) => MODELISH.test(label))
      const pool = modelish.length ? modelish : candidates
      pool.sort((a, b) => a.length - b.length)
      return pool[0]
    }

    function rowSeats(button) {
      const seat = button && button.parentElement
      if (!seat) return []
      const row = modelRow(seat)
      if (!row) return []
      const out = []
      for (const child of Array.from(row.children || [])) {
        if (child === seat || (child.contains && child.contains(seat))) continue
        if (!firstButton(child)) continue
        out.push(child)
      }
      return out
    }

    function pickRealSeat(candidates) {
      let best = null
      for (const node of candidates) {
        if (MODELISH.test(seatLabel(node))) best = node
      }
      return best || candidates[candidates.length - 1] || null
    }

    /** 读真实座位上的当前模型名，变了就通知座椅重渲染（切模型时会走到这里） */
    function syncRealLabel(button) {
      try {
        const seat = pickRealSeat(rowSeats(button))
        if (seat) realSeatNode = seat
        const label = seatLabel(realSeatNode)
        if (label && label !== realModelName) {
          realModelName = label
          try { if (onRealModel) onRealModel(label) } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }

    function restoreModelSeats() {
      for (const node of [...hiddenSeats]) {
        try {
          node.style.display = node.getAttribute('data-dm-prev-display') || ''
          node.removeAttribute('data-dm-prev-display')
          node.removeAttribute(HIDDEN_ATTR)
        } catch { /* ignore */ }
      }
      hiddenSeats.clear()
    }

    function realModelLabel() {
      for (const node of hiddenSeats) {
        const text = String(node.textContent || '').replace(/\s+/g, ' ').trim()
        if (text) return text
      }
      return ''
    }

    /* ------------------------------------------------------------------ *
     *  小眼睛：随时显隐真实模型选择器（状态记在 localStorage）
     * ------------------------------------------------------------------ */
    const REVEAL_KEY = 'dsh-date-model/reveal'
    let revealReal = false
    try { revealReal = window.localStorage.getItem(REVEAL_KEY) === '1' } catch { /* ignore */ }
    let chipButtonRef = null
    let pluginCtx = null
    let lastPushed = ''
    // 真实模型名（从 agent-default-model 配置里读），给 hover 提示用
    let realModelName = ''
    let onRealModel = null

    /* ------------------------------------------------------------------ *
     *  把名字写进 Host 的插件配置（settings 通道，静默、不产生会话记录）
     *  只写本插件那条 profile entry 的 volatile 字段 identity。
     * ------------------------------------------------------------------ */
    const unwrap = (result) => {
      if (result && typeof result === 'object' && 'ok' in result) return result.ok ? result.value : null
      return result
    }

    async function pushIdentity(name, attempt = 0) {
      const ctx = pluginCtx
      if (!ctx || !ctx.remote || !ctx.remote.settings) return
      try {
        const described = unwrap(await ctx.remote.settings.describe())
        const namespaces = described && Array.isArray(described.namespaces) ? described.namespaces : []

        // 顺手把真实模型名捞出来：hover 提示用
        const modelNamespace = namespaces.find((item) => item && String(item.ns || '') === 'agent-default-model')
        const readModel = (namespace) => {
          if (!namespace) return ''
          for (const source of [namespace.value, namespace.user, namespace.base]) {
            const candidate = source && typeof source.model === 'string' ? source.model.trim() : ''
            if (candidate) return candidate
          }
          return ''
        }
        const model = readModel(modelNamespace)
        // 只在还没读到真实座位文字时用配置兜底（座位上的才是当前会话真实模型）
        if (model && !realModelName) {
          realModelName = model
          try { if (onRealModel) onRealModel(model) } catch { /* ignore */ }
        }

        if (!name || name === lastPushed) return
        const target = namespaces.find((item) => item && String(item.ns || '').includes('date-model'))
        if (!target || !target.ns) {
          // settings 服务可能在页面刚加载时还没把这条 entry 登记进来 —— 退避重试几次
          if (attempt < 6) {
            window.setTimeout(() => { pushIdentity(name, attempt + 1) }, 1500 * (attempt + 1))
            return
          }
          try { console.warn('[dsh-date-model] 找不到 date-model 配置命名空间：名字不会生效（Host 半边没加载或没重启）') } catch { /* ignore */ }
          toast('名字已保存，但没能写进提示词')
          return
        }
        lastPushed = name
        try {
          unwrap(await ctx.remote.settings.update(target.ns, { identity: name }, target.revision))
        } catch (conflict) {
          // 修订号冲突时退化为无条件写入
          unwrap(await ctx.remote.settings.update(target.ns, { identity: name }))
        }
      } catch (error) {
        lastPushed = ''
        if (attempt < 3) {
          window.setTimeout(() => { pushIdentity(name, attempt + 1) }, 1500 * (attempt + 1))
          return
        }
        try { console.warn('[dsh-date-model] 写入名字失败：', error) } catch { /* ignore */ }
        toast('名字已保存，但没能写进提示词')
      }
    }

    function setReveal(next) {
      revealReal = Boolean(next)
      try { window.localStorage.setItem(REVEAL_KEY, revealReal ? '1' : '0') } catch { /* ignore */ }
    }

    /** chip 挂载 / 变更时按阀门决定藏还是露 */
    function syncRealSeat(button) {
      if (revealReal) { restoreModelSeats(); return }
      hideRealModelSeat(button)
    }

    function eyeIcon(show) {
      const NS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      svg.setAttribute('width', '15')
      svg.setAttribute('height', '15')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('aria-hidden', 'true')
      const eye = document.createElementNS(NS, 'path')
      eye.setAttribute('d', show
        ? 'M2.6 12S6.2 5.6 12 5.6 21.4 12 21.4 12 17.8 18.4 12 18.4 2.6 12 2.6 12Z'
        : 'M3.4 12S6.9 6.6 12 6.6c1.6 0 3 .4 4.2 1.1M20.6 12s-3.5 5.4-8.6 5.4c-1.6 0-3-.4-4.2-1.1')
      eye.setAttribute('stroke', 'currentColor')
      eye.setAttribute('stroke-width', '1.6')
      eye.setAttribute('stroke-linecap', 'round')
      eye.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(eye)
      const pupil = document.createElementNS(NS, 'circle')
      pupil.setAttribute('cx', '12')
      pupil.setAttribute('cy', '12')
      if (show) {
        pupil.setAttribute('r', '3')
        pupil.setAttribute('fill', 'currentColor')
      } else {
        pupil.setAttribute('r', '2.4')
        pupil.setAttribute('fill', 'none')
        pupil.setAttribute('stroke', 'currentColor')
        pupil.setAttribute('stroke-width', '1.4')
      }
      svg.appendChild(pupil)
      if (!show) {
        const slash = document.createElementNS(NS, 'path')
        slash.setAttribute('d', 'M4.2 19.8 19.8 4.2')
        slash.setAttribute('stroke', 'currentColor')
        slash.setAttribute('stroke-width', '1.6')
        slash.setAttribute('stroke-linecap', 'round')
        svg.appendChild(slash)
      }
      return svg
    }

    /* ------------------------------------------------------------------ *
     *  样式
     * ------------------------------------------------------------------ */
    const STYLE_ID = 'dsh-date-model/style'
    const CSS = `
.dm{--dm-panel:#15171c;--dm-panel2:#1b1e25;--dm-line:#2a2e38;--dm-line2:#22262e;--dm-txt:#e7e9ee;--dm-txt2:#9aa1ad;--dm-txt3:#6a707c;--dm-accent:#6f9bff;--dm-chip-bg:rgba(255,255,255,.045);--dm-chip-line:rgba(255,255,255,.10);--dm-chip-txt:#cfd6e4;--dm-shadow:0 26px 70px rgba(0,0,0,.6);--dm-on-accent:#fff;--dm-band:rgba(255,255,255,.07)}
.dm.dm-light{--dm-panel:#fff;--dm-panel2:#f3f5f9;--dm-line:#dde1e9;--dm-line2:#eceff4;--dm-txt:#1b1f27;--dm-txt2:#5a6270;--dm-txt3:#98a0ac;--dm-accent:#2f5bff;--dm-chip-bg:#fff;--dm-chip-line:#dde1e9;--dm-chip-txt:#39404c;--dm-shadow:0 24px 60px rgba(15,23,42,.18);--dm-on-accent:#fff;--dm-band:rgba(15,23,42,.05)}
.dm-seat{display:inline-flex;align-items:center;min-width:0}
.dm-chip{display:inline-flex;align-items:center;gap:6px;height:28px;max-width:262px;padding:0 9px;border:1px solid var(--dm-chip-line);border-radius:8px;background:var(--dm-chip-bg);color:var(--dm-chip-txt);font:11.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;cursor:pointer;transition:border-color .16s,color .16s}
.dm-chip:hover{border-color:var(--dm-accent);color:var(--dm-txt)}
.dm-chip:focus-visible{outline:2px solid var(--dm-accent);outline-offset:2px}
.dm-chip svg{flex:0 0 auto;opacity:.8}
.dm-chip-icon{display:inline-flex;color:var(--dm-accent)}
.dm-chip[data-tier="flash"]{--dm-accent:#e2a52f}
.dm-chip[data-tier="clear"]{--dm-accent:#9b8bff}
.dm-chip[data-tier="pro"]{--dm-accent:#4fc3b6}
.dm-chip[data-tier="rain"]{--dm-accent:#6fa8dc}
.dm-chip[data-tier="snow"]{--dm-accent:#a9d8ef}
.dm-chip[data-tier="fog"]{--dm-accent:#9fb3ae}
.dm-chip[data-tier="cloudy"]{--dm-accent:#7fa6cc}
.dm-chip-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm-chip-caret{flex:0 0 auto;color:var(--dm-txt3);font-size:9px;line-height:1}
.dm-pop{position:fixed;z-index:2147483000;box-sizing:border-box;display:flex;flex-direction:column;overflow:auto;padding:14px;border:1px solid var(--dm-line);border-radius:14px;background:var(--dm-panel);color:var(--dm-txt);box-shadow:var(--dm-shadow);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;animation:dm-in .16s cubic-bezier(.2,.8,.3,1)}
@keyframes dm-in{from{opacity:0;transform:translateY(6px) scale(.99)}to{opacity:1;transform:none}}
.dm-pop *{box-sizing:border-box}
.dm-body{position:relative;isolation:isolate}
.dm-body>*{position:relative;z-index:1}
.dm-body::before{content:"";position:absolute;inset:-14px;z-index:0;border-radius:14px;pointer-events:none;background-repeat:no-repeat;background-position:right -16px bottom -12px,0 0,0 0;background-size:150px,auto,auto}
.dm-body[data-tier="flash"]{--dm-accent:#f5b942;--dm-on-accent:#231704;--dm-band:rgba(245,185,66,.16)}
.dm-body[data-tier="flash"]::before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 560'%3E%3Cdefs%3E%3Cfilter id='c' x='-30%25' y='-30%25' width='160%25' height='160%25'%3E%3CfeGaussianBlur stdDeviation='10'/%3E%3C/filter%3E%3C/defs%3E%3Cg filter='url(%23c)' fill='%233c4a5f'%3E%3Cellipse cx='56' cy='62' rx='92' ry='34' fill-opacity='.52'/%3E%3Cellipse cx='168' cy='40' rx='112' ry='38' fill-opacity='.60'/%3E%3Cellipse cx='278' cy='66' rx='86' ry='32' fill-opacity='.50'/%3E%3Cellipse cx='118' cy='94' rx='104' ry='26' fill-opacity='.42'/%3E%3Cellipse cx='238' cy='98' rx='96' ry='24' fill-opacity='.38'/%3E%3C/g%3E%3Cg stroke='%23b9d3ff' stroke-opacity='.26' stroke-width='1.1' stroke-linecap='round'%3E%3Cpath d='M34 132 28 168M74 108 68 150M118 124 112 160M156 100 150 146M198 128 192 164M238 106 232 148M276 130 270 166'/%3E%3Cpath d='M52 196 46 236M96 176 90 218M140 200 134 240M182 180 176 222M224 204 218 244M266 184 260 226'/%3E%3Cpath d='M70 272 64 308M116 252 110 292M162 276 156 312M208 256 202 296M252 280 246 316'/%3E%3Cpath d='M92 340 86 374M146 324 140 362M200 344 194 380M240 330 234 366'/%3E%3C/g%3E%3Cg fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M86 102 58 176 84 180 52 258' stroke='%23f5b942' stroke-opacity='.16' stroke-width='9'/%3E%3Cpath d='M86 102 58 176 84 180 52 258' stroke='%23ffe3a6' stroke-opacity='.8' stroke-width='2'/%3E%3Cpath d='M84 180 108 214' stroke='%23ffe3a6' stroke-opacity='.45' stroke-width='1.5'/%3E%3Cpath d='M52 258 34 288' stroke='%23ffe3a6' stroke-opacity='.35' stroke-width='1.4'/%3E%3C/g%3E%3Cg fill='%23fff3d6' fill-opacity='.55'%3E%3Ccircle cx='52' cy='264' r='1.7'/%3E%3Ccircle cx='109' cy='218' r='1.5'/%3E%3C/g%3E%3C/svg%3E"),radial-gradient(120% 38% at 50% -8%,rgba(245,185,66,.16),transparent 62%);background-repeat:no-repeat;background-position:0 0,0 0;background-size:100% 100%,auto;animation:dm-flicker 7.5s ease-in-out infinite}
@keyframes dm-flicker{0%,44%,100%{opacity:1}48%{opacity:.84}52%{opacity:1}68%{opacity:.92}72%{opacity:1}}
@media (prefers-reduced-motion:reduce){.dm-body[data-tier="flash"]::before{animation:none}}
.dm-body[data-tier="pro"]{--dm-accent:#5fd0c4;--dm-on-accent:#06201f;--dm-band:rgba(95,208,196,.16)}
.dm-body[data-tier="pro"]::before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 560'%3E%3Cg stroke='%239fe8e0' stroke-opacity='.08' stroke-width='.7'%3E%3Cpath d='M0 80h320M0 160h320M0 240h320M0 320h320M0 400h320M0 480h320M80 0v560M160 0v560M240 0v560'/%3E%3C/g%3E%3Cg fill='none' stroke='%239fe8e0' stroke-opacity='.20' stroke-width='1.1'%3E%3Cellipse cx='252' cy='96' rx='54' ry='34'/%3E%3Cellipse cx='252' cy='96' rx='86' ry='56'/%3E%3Cellipse cx='252' cy='96' rx='120' ry='80'/%3E%3Cellipse cx='252' cy='96' rx='156' ry='106'/%3E%3C/g%3E%3Cg stroke='%23f6c66a' stroke-opacity='.42' stroke-width='1.4' fill='none'%3E%3Cpath d='M18 392C88 350 148 372 208 352S288 330 320 348'/%3E%3C/g%3E%3Cg fill='%23f6c66a' fill-opacity='.42'%3E%3Cpath d='M94 372l10 8-13 3z'/%3E%3Cpath d='M164 362l10 8-13 3z'/%3E%3Cpath d='M236 348l10 8-13 3z'/%3E%3C/g%3E%3Cg fill='%239fe8e0' fill-opacity='.28'%3E%3Ccircle cx='60' cy='382' r='4.2'/%3E%3Ccircle cx='130' cy='370' r='4.2'/%3E%3C/g%3E%3C/svg%3E"),linear-gradient(180deg,rgba(40,96,100,.22),rgba(20,44,52,.10) 60%,transparent);background-repeat:no-repeat;background-position:0 0,0 0;background-size:100% 100%,auto}
.dm-body[data-tier="clear"]{--dm-accent:#9b8bff;--dm-on-accent:#120f28;--dm-band:rgba(155,139,255,.16)}
.dm-body[data-tier="clear"]::before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 560'%3E%3Cg fill='%23ffffff'%3E%3Ccircle cx='34' cy='44' r='1.3' fill-opacity='.75'/%3E%3Ccircle cx='86' cy='28' r='1' fill-opacity='.5'/%3E%3Ccircle cx='140' cy='52' r='1.6' fill-opacity='.8'/%3E%3Ccircle cx='210' cy='34' r='1.1' fill-opacity='.55'/%3E%3Ccircle cx='268' cy='128' r='1.4' fill-opacity='.7'/%3E%3Ccircle cx='52' cy='150' r='1' fill-opacity='.45'/%3E%3Ccircle cx='120' cy='188' r='1.2' fill-opacity='.5'/%3E%3Ccircle cx='286' cy='258' r='1' fill-opacity='.4'/%3E%3Ccircle cx='40' cy='320' r='1.2' fill-opacity='.45'/%3E%3Ccircle cx='96' cy='404' r='1' fill-opacity='.35'/%3E%3Ccircle cx='264' cy='436' r='1.3' fill-opacity='.5'/%3E%3Ccircle cx='168' cy='504' r='1' fill-opacity='.3'/%3E%3Ccircle cx='300' cy='524' r='1.1' fill-opacity='.35'/%3E%3C/g%3E%3Cg stroke='%23c3baff' stroke-opacity='.22' stroke-width='.8' fill='none'%3E%3Cpath d='M34 44 86 28 140 52 168 30'/%3E%3Cpath d='M210 34 268 128 286 258'/%3E%3C/g%3E%3Cg%3E%3Ccircle cx='266' cy='80' r='42' fill='%23b7a8ff' fill-opacity='.10'/%3E%3Cpath d='M262 44a27 27 0 1 0 19 46 32 32 0 0 1-19-46Z' fill='%23f3ecff' fill-opacity='.55'/%3E%3C/g%3E%3C/svg%3E"),linear-gradient(180deg,rgba(70,60,150,.20),rgba(40,30,90,.09) 55%,transparent),radial-gradient(80% 45% at 96% 4%,rgba(155,139,255,.18),transparent 70%);background-repeat:no-repeat;background-position:0 0,0 0,0 0;background-size:100% 100%,auto,auto}
.dm-body[data-tier="cloudy"]{--dm-accent:#7fa6cc;--dm-on-accent:#0b141c;--dm-band:rgba(127,166,204,.16)}
.dm-body[data-tier="cloudy"]::before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 560'%3E%3Cdefs%3E%3Cfilter id='c' x='-30%25' y='-30%25' width='160%25' height='160%25'%3E%3CfeGaussianBlur stdDeviation='12'/%3E%3C/filter%3E%3C/defs%3E%3Cg filter='url(%23c)' fill='%234a5f78'%3E%3Cellipse cx='50' cy='72' rx='100' ry='36' fill-opacity='.50'/%3E%3Cellipse cx='170' cy='44' rx='120' ry='40' fill-opacity='.56'/%3E%3Cellipse cx='282' cy='78' rx='92' ry='34' fill-opacity='.44'/%3E%3Cellipse cx='110' cy='112' rx='110' ry='28' fill-opacity='.36'/%3E%3Cellipse cx='242' cy='196' rx='122' ry='22' fill-opacity='.20'/%3E%3C/g%3E%3C/svg%3E"),radial-gradient(120% 40% at 50% -8%,rgba(127,166,204,.17),transparent 62%);background-repeat:no-repeat;background-position:0 0,0 0;background-size:100% 100%,auto}
.dm-body[data-tier="fog"]{--dm-accent:#9fb3ae;--dm-on-accent:#0e1614;--dm-band:rgba(159,179,174,.16)}
.dm-body[data-tier="fog"]::before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 560'%3E%3Cdefs%3E%3Cfilter id='f' x='-30%25' y='-30%25' width='160%25' height='160%25'%3E%3CfeGaussianBlur stdDeviation='14'/%3E%3C/filter%3E%3C/defs%3E%3Cg filter='url(%23f)'%3E%3Ccircle cx='160' cy='128' r='44' fill='%23e8f0ec' fill-opacity='.13'/%3E%3Cg fill='%23e8f0ec'%3E%3Cellipse cx='160' cy='212' rx='200' ry='24' fill-opacity='.05'/%3E%3Cellipse cx='150' cy='300' rx='220' ry='28' fill-opacity='.06'/%3E%3Cellipse cx='170' cy='392' rx='205' ry='26' fill-opacity='.05'/%3E%3Cellipse cx='150' cy='478' rx='225' ry='30' fill-opacity='.05'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"),linear-gradient(180deg,rgba(159,179,174,.10),transparent 42%);background-repeat:no-repeat;background-position:0 0,0 0;background-size:100% 100%,auto}
.dm-body[data-tier="rain"]{--dm-accent:#6fa8dc;--dm-on-accent:#0a1622;--dm-band:rgba(111,168,220,.16)}
.dm-body[data-tier="rain"]::before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 560'%3E%3Cdefs%3E%3Cfilter id='c' x='-30%25' y='-30%25' width='160%25' height='160%25'%3E%3CfeGaussianBlur stdDeviation='10'/%3E%3C/filter%3E%3C/defs%3E%3Cg filter='url(%23c)' fill='%233c4a5f'%3E%3Cellipse cx='56' cy='62' rx='92' ry='34' fill-opacity='.52'/%3E%3Cellipse cx='168' cy='40' rx='112' ry='38' fill-opacity='.60'/%3E%3Cellipse cx='278' cy='66' rx='86' ry='32' fill-opacity='.50'/%3E%3Cellipse cx='118' cy='94' rx='104' ry='26' fill-opacity='.42'/%3E%3Cellipse cx='238' cy='98' rx='96' ry='24' fill-opacity='.38'/%3E%3C/g%3E%3Cg stroke='%23b9d3ff' stroke-opacity='.30' stroke-width='1.1' stroke-linecap='round'%3E%3Cpath d='M34 132 28 168M74 108 68 150M118 124 112 160M156 100 150 146M198 128 192 164M238 106 232 148M276 130 270 166'/%3E%3Cpath d='M52 196 46 236M96 176 90 218M140 200 134 240M182 180 176 222M224 204 218 244M266 184 260 226'/%3E%3Cpath d='M70 272 64 308M116 252 110 292M162 276 156 312M208 256 202 296M252 280 246 316'/%3E%3Cpath d='M92 340 86 374M146 324 140 362M200 344 194 380M240 330 234 366'/%3E%3C/g%3E%3C/svg%3E"),radial-gradient(120% 38% at 50% -8%,rgba(111,168,220,.18),transparent 62%);background-repeat:no-repeat;background-position:0 0,0 0;background-size:100% 100%,auto}
.dm-body[data-tier="snow"]{--dm-accent:#a9d8ef;--dm-on-accent:#0b1a24;--dm-band:rgba(169,216,239,.16)}
.dm-body[data-tier="snow"]::before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 560'%3E%3Cdefs%3E%3Cfilter id='c' x='-30%25' y='-30%25' width='160%25' height='160%25'%3E%3CfeGaussianBlur stdDeviation='12'/%3E%3C/filter%3E%3C/defs%3E%3Cg filter='url(%23c)' fill='%23445269'%3E%3Cellipse cx='70' cy='58' rx='96' ry='34' fill-opacity='.45'/%3E%3Cellipse cx='180' cy='38' rx='116' ry='38' fill-opacity='.50'/%3E%3Cellipse cx='284' cy='70' rx='88' ry='30' fill-opacity='.40'/%3E%3C/g%3E%3Cg fill='%23eaf6ff'%3E%3Ccircle cx='40' cy='140' r='1.8' fill-opacity='.7'/%3E%3Ccircle cx='96' cy='110' r='1.4' fill-opacity='.6'/%3E%3Ccircle cx='152' cy='160' r='2' fill-opacity='.75'/%3E%3Ccircle cx='208' cy='126' r='1.5' fill-opacity='.6'/%3E%3Ccircle cx='264' cy='168' r='1.8' fill-opacity='.7'/%3E%3Ccircle cx='64' cy='228' r='1.4' fill-opacity='.55'/%3E%3Ccircle cx='126' cy='264' r='1.9' fill-opacity='.65'/%3E%3Ccircle cx='188' cy='232' r='1.3' fill-opacity='.5'/%3E%3Ccircle cx='246' cy='280' r='1.7' fill-opacity='.6'/%3E%3Ccircle cx='44' cy='330' r='1.5' fill-opacity='.5'/%3E%3Ccircle cx='108' cy='372' r='1.8' fill-opacity='.6'/%3E%3Ccircle cx='172' cy='340' r='1.4' fill-opacity='.5'/%3E%3Ccircle cx='232' cy='392' r='1.9' fill-opacity='.6'/%3E%3Ccircle cx='88' cy='452' r='1.4' fill-opacity='.45'/%3E%3Ccircle cx='156' cy='480' r='1.7' fill-opacity='.55'/%3E%3Ccircle cx='220' cy='446' r='1.3' fill-opacity='.45'/%3E%3Ccircle cx='284' cy='498' r='1.6' fill-opacity='.5'/%3E%3C/g%3E%3C/svg%3E"),linear-gradient(180deg,rgba(120,170,210,.14),transparent 48%);background-repeat:no-repeat;background-position:0 0,0 0;background-size:100% 100%,auto}
.dm-light .dm-body::before{opacity:.55}
.dm-light .dm-body[data-tier="flash"]{--dm-accent:#a86800;--dm-on-accent:#fff;--dm-band:rgba(168,104,0,.10)}
.dm-light .dm-body[data-tier="clear"]{--dm-accent:#5b4bd6;--dm-on-accent:#fff;--dm-band:rgba(91,75,214,.10)}
.dm-light .dm-body[data-tier="pro"]{--dm-accent:#178077;--dm-on-accent:#fff;--dm-band:rgba(23,128,119,.10)}
.dm-light .dm-body[data-tier="cloudy"]{--dm-accent:#3f6f9e;--dm-on-accent:#fff;--dm-band:rgba(63,111,158,.10)}
.dm-light .dm-body[data-tier="fog"]{--dm-accent:#4f7a72;--dm-on-accent:#fff;--dm-band:rgba(79,122,114,.10)}
.dm-light .dm-body[data-tier="rain"]{--dm-accent:#2f6f9e;--dm-on-accent:#fff;--dm-band:rgba(47,111,158,.10)}
.dm-light .dm-body[data-tier="snow"]{--dm-accent:#4d92b8;--dm-on-accent:#fff;--dm-band:rgba(77,146,184,.10)}
.dm-body[data-tier="flash"] .dm-day.is-sel,.dm-body[data-tier="flash"] .dm-ok,.dm-body[data-tier="flash"] .dm-tier-btn.is-on{box-shadow:0 0 22px rgba(245,185,66,.38)}
.dm-body[data-tier="clear"] .dm-day.is-sel,.dm-body[data-tier="clear"] .dm-ok,.dm-body[data-tier="clear"] .dm-tier-btn.is-on{box-shadow:0 0 22px rgba(155,139,255,.38)}
.dm-body[data-tier="pro"] .dm-day.is-sel,.dm-body[data-tier="pro"] .dm-ok,.dm-body[data-tier="pro"] .dm-tier-btn.is-on{box-shadow:0 0 22px rgba(95,208,196,.34)}
.dm-body[data-tier="cloudy"] .dm-day.is-sel,.dm-body[data-tier="cloudy"] .dm-ok,.dm-body[data-tier="cloudy"] .dm-tier-btn.is-on{box-shadow:0 0 22px rgba(127,166,204,.34)}
.dm-body[data-tier="fog"] .dm-day.is-sel,.dm-body[data-tier="fog"] .dm-ok,.dm-body[data-tier="fog"] .dm-tier-btn.is-on{box-shadow:0 0 22px rgba(159,179,174,.32)}
.dm-body[data-tier="rain"] .dm-day.is-sel,.dm-body[data-tier="rain"] .dm-ok,.dm-body[data-tier="rain"] .dm-tier-btn.is-on{box-shadow:0 0 22px rgba(111,168,220,.34)}
.dm-body[data-tier="snow"] .dm-day.is-sel,.dm-body[data-tier="snow"] .dm-ok,.dm-body[data-tier="snow"] .dm-tier-btn.is-on{box-shadow:0 0 22px rgba(169,216,239,.30)}
.dm-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.dm-top-right{display:flex;align-items:center;gap:2px}
.dm-eye svg{display:block}
.dm-eye[aria-pressed="true"]{color:var(--dm-accent)}
.dm-tier{display:flex;gap:3px;padding:3px;border-radius:10px;background:var(--dm-panel2);border:1px solid var(--dm-line2)}
.dm-tier-btn{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:transparent;color:var(--dm-txt3);cursor:pointer;transition:background .15s,color .15s,transform .12s}
.dm-tier-btn:hover{color:var(--dm-txt2);background:rgba(127,127,127,.10)}
.dm-tier-btn:active{transform:scale(.92)}
.dm-tier-btn.is-on{background:var(--dm-accent);color:var(--dm-on-accent)}
.dm-tier svg{display:block}
.dm-x{flex:0 0 auto;width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--dm-txt3);font-size:13px;line-height:1;cursor:pointer}
.dm-x:hover{background:var(--dm-panel2);color:var(--dm-txt)}
.dm-picker{display:flex;align-items:center;justify-content:center;gap:5px;margin:2px 0 12px}
.dm-v{font:13px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dm-txt3);padding-right:2px}
.dm-dot-sep{font:18px/1 ui-monospace,Menlo,Consolas,monospace;color:var(--dm-txt3);padding:0 2px}
.dm-wheel-wrap{position:relative;width:62px;height:84px;border-radius:10px;background:var(--dm-panel2);overflow:hidden}
.dm-wheel-wrap::before,.dm-wheel-wrap::after{content:"";position:absolute;left:0;right:0;height:28px;pointer-events:none;z-index:3}
.dm-wheel-wrap::before{top:0;background:linear-gradient(180deg,var(--dm-panel2),rgba(0,0,0,0))}
.dm-wheel-wrap::after{bottom:0;background:linear-gradient(0deg,var(--dm-panel2),rgba(0,0,0,0))}
.dm-band{position:absolute;left:5px;right:5px;top:28px;height:28px;border-radius:7px;background:var(--dm-band);pointer-events:none;z-index:2}
.dm-wheel{position:relative;z-index:1;height:100%;overflow-y:auto;scroll-snap-type:y mandatory;overscroll-behavior:contain;scrollbar-width:none}
.dm-wheel::-webkit-scrollbar{display:none}
.dm-wheel-list{padding:28px 0}
.dm-wheel-item{display:block;width:100%;height:28px;border:0;background:transparent;color:var(--dm-txt3);font:13px/28px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:center;cursor:pointer;scroll-snap-align:center}
.dm-wheel-item:hover{color:var(--dm-txt2)}
.dm-wheel-item.is-on{color:var(--dm-accent);font-weight:700}
.dm-nav{display:flex;align-items:center;gap:1px;margin:0 0 6px}
.dm-navbtn{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--dm-txt2);font-size:13px;line-height:1;cursor:pointer}
.dm-navbtn:hover{background:var(--dm-panel2);color:var(--dm-txt)}
.dm-navlabel{flex:1;text-align:center;font:12.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dm-txt2)}
.dm-navlabel b{color:var(--dm-txt);font-size:14px}
.dm-week{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:2px}
.dm-week span{text-align:center;font-size:10px;color:var(--dm-txt3);padding:2px 0;font-family:ui-monospace,Menlo,monospace}
.dm-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.dm-day{position:relative;height:32px;border:0;border-radius:8px;background:transparent;color:var(--dm-txt2);font:12px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;cursor:pointer}
.dm-day.is-blank{cursor:default;pointer-events:none}
.dm-day:not(.is-blank):hover{background:var(--dm-panel2);color:var(--dm-txt)}
.dm-day.is-today::after{content:"";position:absolute;bottom:3px;left:50%;width:3px;height:3px;margin-left:-1.5px;border-radius:50%;background:var(--dm-txt3)}
.dm-day.is-sel{background:var(--dm-accent);color:var(--dm-on-accent);font-weight:700}
.dm-day.is-sel::after{content:none}
.dm-name{margin-top:11px;padding-top:10px;border-top:1px solid var(--dm-line2);text-align:center;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dm-accent);overflow-wrap:anywhere}
.dm-acts{display:flex;gap:8px;margin-top:9px}
.dm-cancel{flex:1;height:32px;border:1px solid var(--dm-line);border-radius:8px;background:transparent;color:var(--dm-txt2);font-size:13px;cursor:pointer}
.dm-cancel:hover{color:var(--dm-txt);border-color:var(--dm-txt3)}
.dm-ok{flex:2;height:32px;border:0;border-radius:8px;background:var(--dm-accent);color:var(--dm-on-accent);font-size:14px;font-weight:700;cursor:pointer}
.dm-ok:hover{opacity:.9}
.dm-toast{position:fixed;left:50%;bottom:118px;transform:translate(-50%,10px);z-index:2147483001;padding:8px 14px;border:1px solid var(--dm-line);border-radius:10px;background:var(--dm-panel);color:var(--dm-txt);box-shadow:var(--dm-shadow);font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
.dm-toast.is-on{opacity:1;transform:translate(-50%,0)}
`
    function ensureStyle() {
      try {
        if (document.getElementById(STYLE_ID)) return
        const node = el('style', { id: STYLE_ID })
        node.textContent = CSS
        ;(document.head || document.body).appendChild(node)
      } catch { /* ignore */ }
    }

    /* ------------------------------------------------------------------ *
     *  提示（只给结果）
     * ------------------------------------------------------------------ */
    let toastTimer = 0
    function toast(text) {
      try {
        let node = document.getElementById(STYLE_ID + '/toast')
        if (!node) {
          node = el('div', { id: STYLE_ID + '/toast', class: 'dm-toast ' + skin(), role: 'status', 'aria-live': 'polite' })
          document.body.appendChild(node)
        }
        node.textContent = text
        node.className = 'dm-toast is-on ' + skin()
        window.clearTimeout(toastTimer)
        toastTimer = window.setTimeout(() => { node.className = 'dm-toast ' + skin() }, 2200)
      } catch { /* ignore */ }
    }

    /* ------------------------------------------------------------------ *
     *  弹层定位
     * ------------------------------------------------------------------ */
    let popover = null

    function place(node, rect) {
      const vw = window.innerWidth || 1280
      const vh = window.innerHeight || 800
      const width = clamp(PANEL_WIDTH, 260, vw - 24)
      node.style.width = width + 'px'
      node.style.left = clamp(rect.right - width, 12, vw - width - 12) + 'px'
      const above = rect.top - 16
      if (above >= PANEL_ESTIMATE || above >= 340) {
        node.style.top = 'auto'
        node.style.bottom = Math.round(vh - rect.top + 10) + 'px'
        node.style.maxHeight = Math.max(280, Math.round(above)) + 'px'
      } else {
        node.style.bottom = 'auto'
        node.style.top = Math.round(rect.bottom + 10) + 'px'
        node.style.maxHeight = Math.max(280, Math.round(vh - rect.bottom - 22)) + 'px'
      }
    }

    /* ------------------------------------------------------------------ *
     *  滚轮数字盘：无限数字（不是 0-23 / 0-59，滑到哪算哪，滚到头自动换窗口）
     * ------------------------------------------------------------------ */
    const WHEEL_WINDOW = 240
    const WHEEL_CENTER = 120

    function makeWheel(value, onPick) {
      const LOW = 40
      const HIGH = WHEEL_WINDOW - 40
      let current = Math.max(0, Math.floor(Number(value) || 0))
      let first = Math.max(0, current - WHEEL_CENTER)
      let resetting = false
      let settle = 0
      const items = []
      const values = []
      const list = el('div', { class: 'dm-wheel-list' })
      const wheel = el('div', { class: 'dm-wheel' }, list)

      const mark = (v) => {
        for (let i = 0; i < items.length; i += 1) {
          items[i].className = 'dm-wheel-item' + (values[i] === v ? ' is-on' : '')
        }
      }
      const setScroll = (index) => {
        try { wheel.scrollTop = index * ITEM_H } catch { /* ignore */ }
      }
      const indexOfValue = (v) => v - first

      const build = () => {
        while (list.firstChild) list.removeChild(list.firstChild)
        items.length = 0
        values.length = 0
        for (let i = 0; i < WHEEL_WINDOW; i += 1) {
          const v = first + i
          const item = el('button', {
            class: 'dm-wheel-item' + (v === current ? ' is-on' : ''),
            type: 'button',
            'data-v': String(v),
            'aria-label': String(v),
            text: String(v),
          })
          item.addEventListener('click', () => jump(v))
          items.push(item)
          values.push(v)
          list.appendChild(item)
        }
      }
      const recenter = (v) => {
        current = v
        first = Math.max(0, v - WHEEL_CENTER)
        build()
        mark(v)
        resetting = true
        setScroll(indexOfValue(v))
        window.setTimeout(() => { resetting = false }, 200)
      }
      const jump = (v) => {
        const index = indexOfValue(v)
        if (index >= 0 && index < WHEEL_WINDOW) {
          current = v
          mark(v)
          setScroll(index)
        } else {
          recenter(v)
        }
        onPick(v)
      }

      build()
      // 挂到 DOM 之前 scrollTop 不生效，等一拍再滚到位
      window.setTimeout(() => {
        try { if (wheel.isConnected !== false) setScroll(indexOfValue(current)) } catch { /* ignore */ }
      }, 0)
      wheel.addEventListener('scroll', () => {
        window.clearTimeout(settle)
        settle = window.setTimeout(() => {
          if (resetting) return
          const index = clamp(Math.round((wheel.scrollTop || 0) / ITEM_H), 0, WHEEL_WINDOW - 1)
          const v = first + index
          if (v === current) return
          current = v
          mark(v)
          onPick(v)
          // 快滑到窗口边缘时把窗口平移过来，可以一直滚下去
          if (index < LOW || index > HIGH) recenter(v)
        }, 70)
      })
      return el('div', { class: 'dm-wheel-wrap' }, el('div', { class: 'dm-band' }), wheel)
    }

    /* ------------------------------------------------------------------ *
     *  面板：两个数字盘 + 月历 + 结果
     * ------------------------------------------------------------------ */
    function buildPanel(state, actions) {
      const y = state.y
      const m = state.m

      const top = el('div', { class: 'dm-top' },
        el('div', { class: 'dm-tier', role: 'group' },
          ...TIERS.map((tier) => el('button', {
            class: 'dm-tier-btn' + (state.tier === tier ? ' is-on' : ''),
            type: 'button',
            'aria-pressed': state.tier === tier ? 'true' : 'false',
            'aria-label': tier,
            title: tier,
            'data-tier': tier,
            onClick: () => actions.setTier(tier),
          }, tierIcon(tier))),
        ),
        el('div', { class: 'dm-top-right' },
          el('button', {
            class: 'dm-x dm-eye',
            type: 'button',
            'aria-label': revealReal ? 'hide real model selector' : 'show real model selector',
            'aria-pressed': revealReal ? 'true' : 'false',
            title: revealReal ? 'hide real model selector' : 'show real model selector',
            onClick: actions.toggleReveal,
          }, eyeIcon(revealReal)),
          el('button', { class: 'dm-x', type: 'button', 'aria-label': 'close', onClick: actions.cancel, text: '✕' }),
        ),
      )

      const picker = el('div', { class: 'dm-picker' },
        el('span', { class: 'dm-v', text: 'v' }),
        makeWheel(state.major, (v) => actions.setMajor(v)),
        el('span', { class: 'dm-dot-sep', text: '.' }),
        makeWheel(state.minor, (v) => actions.setMinor(v)),
      )

      const nav = el('div', { class: 'dm-nav' },
        el('button', { class: 'dm-navbtn', type: 'button', 'aria-label': 'prev year', onClick: () => actions.nav(0, -1), text: '«' }),
        el('button', { class: 'dm-navbtn', type: 'button', 'aria-label': 'prev month', onClick: () => actions.nav(-1, 0), text: '‹' }),
        el('div', { class: 'dm-navlabel' }, el('b', { text: String(y) }), ' / ', pad(m + 1)),
        el('button', { class: 'dm-navbtn', type: 'button', 'aria-label': 'next month', onClick: () => actions.nav(1, 0), text: '›' }),
        el('button', { class: 'dm-navbtn', type: 'button', 'aria-label': 'next year', onClick: () => actions.nav(0, 1), text: '»' }),
      )

      const week = el('div', { class: 'dm-week' }, ...WEEK.map((label) => el('span', { text: label })))

      const first = new Date(y, m, 1).getDay()
      const days = new Date(y, m + 1, 0).getDate()
      const now = new Date()
      const cells = []
      const total = Math.ceil((first + days) / 7) * 7
      for (let i = 0; i < total; i += 1) {
        const d = i - first + 1
        if (d < 1 || d > days) {
          cells.push(el('div', { class: 'dm-day is-blank', 'aria-hidden': 'true' }))
          continue
        }
        const isSel = state.d === d
        const isToday = now.getFullYear() === y && now.getMonth() === m && now.getDate() === d
        cells.push(el('button', {
          class: 'dm-day' + (isSel ? ' is-sel' : '') + (isToday ? ' is-today' : ''),
          type: 'button',
          'aria-label': `${y}-${pad(m + 1)}-${pad(d)}`,
          'aria-pressed': isSel ? 'true' : 'false',
          onClick: () => actions.pick(d),
          text: d,
        }))
      }
      const grid = el('div', { class: 'dm-grid' }, ...cells)

      const name = el('div', { class: 'dm-name', text: modelId(state) })
      state.sync = () => { name.textContent = modelId(state) }

      const acts = el('div', { class: 'dm-acts' },
        el('button', { class: 'dm-cancel', type: 'button', onClick: actions.cancel, text: '✕' }),
        el('button', { class: 'dm-ok', type: 'button', onClick: actions.apply, text: '✓' }),
      )

      return el('div', { class: 'dm-body', 'data-tier': state.tier }, top, picker, nav, week, grid, name, acts)
    }

    /* ------------------------------------------------------------------ *
     *  打开 / 关闭
     * ------------------------------------------------------------------ */
    function openPopover(anchorEl) {
      if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return
      closePopover()
      sweepPopovers()
      const anchorRect = anchorEl.getBoundingClientRect()
      if (!anchorRect || (!anchorRect.width && !anchorRect.height && !anchorRect.top && !anchorRect.right)) return

      const state = {
        y: applied.y, m: applied.m, d: applied.d,
        major: applied.major, minor: applied.minor, tier: applied.tier,
        sync: null,
      }

      const node = el('div', { class: 'dm-pop ' + skin(), role: 'dialog', 'aria-modal': 'false' })
      const repaint = () => {
        try {
          node.innerHTML = ''
          node.appendChild(buildPanel(state, actions))
        } catch {
          closePopover()
        }
      }

      const actions = {
        setTier: (tier) => { state.tier = tier; repaint() },
        toggleReveal: () => {
          setReveal(!revealReal)
          try {
            if (revealReal) restoreModelSeats()
            else if (chipButtonRef) hideRealModelSeat(chipButtonRef)
          } catch { /* ignore */ }
          repaint()
        },
        setMajor: (value) => { state.major = Math.max(0, Math.floor(value)); if (state.sync) state.sync() },
        setMinor: (value) => { state.minor = Math.max(0, Math.floor(value)); if (state.sync) state.sync() },
        nav: (dm, dy) => {
          let m = state.m + dm
          let y = state.y + dy
          if (m < 0) { m = 11; y -= 1 }
          if (m > 11) { m = 0; y += 1 }
          if (y < MIN_YEAR || y > MAX_YEAR) return
          state.y = y
          state.m = m
          repaint()
        },
        pick: (d) => { state.d = d; repaint() },
        cancel: () => closePopover(),
        apply: () => {
          const next = { y: state.y, m: state.m, d: state.d, major: state.major, minor: state.minor, tier: state.tier }
          write(next)
          pushIdentity(modelId(next))
          closePopover()
          toast(modelId(next))
        },
      }

      const onDocPointer = (event) => {
        const target = event.target
        if (node.contains && node.contains(target)) return
        if (target === anchorEl || (anchorEl.contains && anchorEl.contains(target))) return
        closePopover()
      }
      const onKeyDown = (event) => {
        if (event.key !== 'Escape') return
        if (event.stopPropagation) event.stopPropagation()
        closePopover()
      }
      const onResize = () => {
        const rect = anchorEl.getBoundingClientRect()
        if (!rect || (!rect.width && !rect.height)) closePopover()
        else place(node, rect)
      }

      const detach = () => {
        try { document.removeEventListener('click', onDocPointer, true) } catch { /* ignore */ }
        try { document.removeEventListener('keydown', onKeyDown, true) } catch { /* ignore */ }
        try { window.removeEventListener('resize', onResize) } catch { /* ignore */ }
        try { if (node.parentNode) node.parentNode.removeChild(node) } catch { /* ignore */ }
      }

      document.body.appendChild(node)
      place(node, anchorRect)
      repaint()
      popover = { node, detach }

      window.setTimeout(() => {
        if (!popover || popover.node !== node) return
        document.addEventListener('click', onDocPointer, true)
      }, 0)
      document.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('resize', onResize)
    }

    function closePopover() {
      if (!popover) return
      const current = popover
      popover = null
      try { current.detach() } catch { /* ignore */ }
    }

    /** HMR 会重新求值模块，上一代开着的弹层没人关 —— 挂载时顺手扫掉。 */
    function sweepPopovers() {
      try {
        for (const node of Array.from(document.querySelectorAll('.dm-pop, .dm-toast'))) {
          if (node && node.parentNode) node.parentNode.removeChild(node)
        }
      } catch { /* ignore */ }
    }

    /* ------------------------------------------------------------------ *
     *  座椅
     * ------------------------------------------------------------------ */
    function WheelIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 8, y: 3.5, width: 8, height: 17, rx: 3, stroke: 'currentColor', strokeWidth: 1.8 }),
        h('path', { d: 'M4.5 8.5h2.2M4.5 12h2.2M4.5 15.5h2.2M17.3 8.5h2.2M17.3 12h2.2M17.3 15.5h2.2', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
      )
    }

    function Chip(props) {
      const [value, setValue] = useState(applied)
      const [realName, setRealName] = useState(realModelName)
      const ref = useRef(null)
      useEffect(() => subscribe(setValue), [])
      useEffect(() => {
        // 打开界面就把当前选择写进 Host 配置 → 系统提示词里的名字；顺便取回真实模型名
        onRealModel = (model) => { try { setRealName(model) } catch { /* ignore */ } }
        pushIdentity(modelId(applied))
        return () => { onRealModel = null }
      }, [])
      useEffect(() => {
        const button = ref.current
        if (!button) return undefined
        chipButtonRef = button
        let observer = null
        const sync = () => {
          try { syncRealSeat(button) } catch { /* ignore */ }
          try { syncRealLabel(button) } catch { /* ignore */ }
        }
        sync()
        const timer = window.setTimeout(sync, 260)
        // 兜底轮询：切模型时座位可能整块重建，光靠 MutationObserver 万一漏了也能跟上
        const tick = window.setInterval(sync, 2500)
        try {
          const MutationObserverCtor = window.MutationObserver
          if (MutationObserverCtor) {
            const seat = button.parentElement
            const row = seat ? modelRow(seat) : null
            if (row) {
              observer = new MutationObserverCtor(() => { try { sync() } catch { /* ignore */ } })
              // characterData：切模型时座位文字是对着文本节点改的
              observer.observe(row, { childList: true, subtree: true, characterData: true })
            }
          }
        } catch { /* ignore */ }
        return () => {
          window.clearTimeout(timer)
          try { if (tick) window.clearInterval(tick) } catch { /* ignore */ }
          if (chipButtonRef === button) chipButtonRef = null
          try { if (observer) observer.disconnect() } catch { /* ignore */ }
        }
      }, [])
      const id = modelId(value)
      // hover 提示：只显示对应的真实模型名（拿不到时退回真实座位的文字，再退回自己的假名）
      const hoverTitle = realName || realModelName || realModelLabel() || id
      return h('span', { className: 'dm-seat' },
        h('button', {
          ref,
          type: 'button',
          className: 'dm-chip ' + skin(),
          'data-tier': value.tier,
          title: hoverTitle,
          'aria-label': id,
          'aria-haspopup': 'dialog',
          onClick: (event) => {
            if (event && event.stopPropagation) event.stopPropagation()
            openPopover(ref.current)
          },
        },
          h('span', { className: 'dm-chip-icon' }, h(WheelIcon)),
          h('span', { className: 'dm-chip-label' }, id),
          h('span', { className: 'dm-chip-caret', text: '▾' }),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     *  插件入口
     * ------------------------------------------------------------------ */
    return {
      inject: ['slots', 'remote', 'remote.settings'],
      apply(ctx) {
        pluginCtx = ctx
        sweepPopovers()
        ensureStyle()
        ctx.effect(() => {
          const dispose = ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
            name: 'conversation.input.right',
            id: 'date-model',
            order: 100,
          }, Chip))
          return () => {
            closePopover()
            if (typeof dispose === 'function') dispose()
            else if (dispose && typeof dispose.dispose === 'function') dispose.dispose()
          }
        })
        ctx.effect(() => () => {
          closePopover()
          restoreModelSeats()
          try {
            const style = document.getElementById(STYLE_ID)
            if (style && style.parentNode) style.parentNode.removeChild(style)
            const tip = document.getElementById(STYLE_ID + '/toast')
            if (tip && tip.parentNode) tip.parentNode.removeChild(tip)
          } catch { /* ignore */ }
        })
      },
    }
  },
})