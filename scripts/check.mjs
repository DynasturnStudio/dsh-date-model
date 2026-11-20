// 本地渲染/交互检查：不开浏览器，用最小 DOM + React shim 把 client.js 真跑一遍。
// 覆盖：注册座椅 → 点开日历 → 换月（Q 级跟着变）→ 点日期（预览变）→ 确定（写入 + 提示）。
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const problems = []
const fail = (message) => { problems.push(message) }
const ok = (condition, message) => { if (!condition) fail(message) }

/* ---------------- 最小 DOM ---------------- */
function makeNode(tag) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    children: [],
    childNodes: [],
    parentNode: null,
    style: {},
    className: '',
    attributes: {},
    _listeners: {},
    appendChild(child) {
      child.parentNode = node
      node.children.push(child)
      node.childNodes.push(child)
      return child
    },
    removeChild(child) {
      const index = node.children.indexOf(child)
      if (index >= 0) {
        node.children.splice(index, 1)
        node.childNodes.splice(index, 1)
        child.parentNode = null
      }
      return child
    },
    addEventListener(type, fn) { (node._listeners[type] ||= []).push(fn) },
    removeEventListener(type, fn) {
      const list = node._listeners[type]
      if (!list) return
      const index = list.indexOf(fn)
      if (index >= 0) list.splice(index, 1)
    },
    setAttribute(key, value) { node.attributes[key] = String(value) },
    hasAttribute(key) { return key in node.attributes },
    getAttribute(key) { return key in node.attributes ? node.attributes[key] : null },
    querySelector(selector) {
      const wanted = String(selector).trim().toLowerCase()
      const visit = (root) => {
        for (const child of root.children || []) {
          const hit = wanted.startsWith('.')
            ? String(child.className || '').split(/\s+/).includes(wanted.slice(1))
            : String(child.tagName || '').toLowerCase() === wanted
          if (hit) return child
          const nested = visit(child)
          if (nested) return nested
        }
        return null
      }
      return visit(node)
    },
    getBoundingClientRect() { return { top: 600, bottom: 628, left: 600, right: 900, width: 300, height: 28 } },
    contains(other) {
      let cursor = other
      while (cursor) {
        if (cursor === node) return true
        cursor = cursor.parentNode
      }
      return false
    },
  }
  let text = ''
  Object.defineProperty(node, 'parentElement', {
    get: () => (node.parentNode && node.parentNode.nodeType === 1 ? node.parentNode : null),
  })
  Object.defineProperty(node, 'textContent', {
    get: () => text,
    set: (value) => {
      text = String(value)
      if (text === '') { node.children.length = 0; node.childNodes.length = 0 }
    },
  })
  Object.defineProperty(node, 'innerHTML', {
    get: () => '',
    set: (value) => { if (value === '') { node.children.length = 0; node.childNodes.length = 0 } },
  })
  return node
}

function makeText(value) {
  return { nodeType: 3, children: [], childNodes: [], parentNode: null, textContent: String(value) }
}

function walk(node, visit) {
  visit(node)
  for (const child of node.children || []) walk(child, visit)
  return node
}

const documentListeners = {}
const doc = {
  documentElement: makeNode('html'),
  head: makeNode('head'),
  body: makeNode('body'),
  createElement: (tag) => makeNode(tag),
  createElementNS: (ns, tag) => makeNode(tag),
  createTextNode: (text) => makeText(text),
  getElementById(id) {
    let found = null
    for (const root of [doc.head, doc.body]) {
      walk(root, (node) => { if (!found && node.attributes && node.attributes.id === id) found = node })
    }
    return found
  },
  querySelectorAll(selector) {
    const classes = String(selector).split(',').map((part) => part.trim()).filter((part) => part.startsWith('.'))
    const found = []
    for (const root of [doc.head, doc.body]) {
      walk(root, (node) => {
        const name = String(node.className || '')
        if (!name) return
        for (const item of classes) if (name.split(/\s+/).includes(item.slice(1))) { found.push(node); break }
      })
    }
    return found
  },
  addEventListener(type, fn) { (documentListeners[type] ||= []).push(fn) },
  removeEventListener(type, fn) {
    const list = documentListeners[type]
    if (!list) return
    const index = list.indexOf(fn)
    if (index >= 0) list.splice(index, 1)
  },
}
doc.body.attributes['data-ds-dark-theme'] = ''

const store = new Map()
const win = {
  innerWidth: 1280,
  innerHeight: 800,
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
  getComputedStyle: () => ({ backgroundColor: 'rgb(20, 22, 26)' }),
  setTimeout: (fn) => { fn(); return 0 },
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1' },
  __ModuleLoader__: { load(definition) { win.__definition = definition } },
}

/* ---------------- React shim ---------------- */
const effects = []
function hostElement(type, props, children) {
  const node = makeNode(type)
  node.__props = props || {}
  for (const child of children || []) {
    if (child === null || child === undefined || child === false) continue
    if (typeof child === 'object' && child.__props) node.appendChild(child)
    else node.appendChild(makeText(String(child)))
  }
  if (node.__props.ref && typeof node.__props.ref === 'object') node.__props.ref.current = node
  return node
}
const ReactShim = {
  createElement(type, props, ...children) {
    const merged = { ...(props || {}) }
    if (children.length) merged.children = children.length === 1 ? children[0] : children
    if (typeof type === 'function') return type(merged)
    return hostElement(type, merged, children)
  },
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useEffect(fn) { effects.push(fn) },
  useRef(value) { return { current: value === undefined ? null : value } },
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
  Fragment: 'Fragment',
}
const requireShim = (name) => {
  if (name === 'react') return ReactShim
  throw new Error(`客户端不许引外部依赖，但它 require 了 ${name}`)
}

/* ---------------- 跑起来 ---------------- */
const sandbox = {
  window: win,
  document: doc,
  console,
  Date,
  Math,
  JSON,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Set,
  Map,
  Error,
  RegExp,
  Intl,
  Promise,
  isNaN,
  parseInt,
  parseFloat,
}
// 固定一个已知组合：2026-11-07 / 数字 4 和 1 → deepseek-v4.1-flash-1107
store.set('dsh-date-model/selection', JSON.stringify({ y: 2026, m: 10, d: 7, major: 4, minor: 1, tier: 'flash' }))

vm.createContext(sandbox)
try {
  vm.runInContext(code, sandbox, { filename: 'client.js' })
} catch (error) {
  console.log(`FAIL  client.js 求值就炸了：${error?.message ?? error}`)
  process.exit(1)
}
const definition = win.__definition
ok(Boolean(definition), 'client.js 没有调用 window.__ModuleLoader__.load')
ok(definition?.id === 'dsh-date-model', `模块 id 不对：${definition?.id}`)
if (problems.length) { console.log('FAIL\n  - ' + problems.join('\n  - ')); process.exit(1) }

const mod = definition.factory(requireShim)
ok(mod.inject.includes('slots') && mod.inject.includes('remote') && mod.inject.includes('remote.settings'), 'inject 缺 slots / remote / remote.settings')

const registered = []
const settingsCalls = []
const fakeCtx = {
  slots: {
    inject(target, callback) { callback(); return () => {} },
    register(spec, component) { registered.push({ spec, component }); return { dispose: () => {} } },
    provide() {},
    declare() {},
  },
  remote: {
    settings: {
      describe: () => Promise.resolve({
        ok: true,
        value: {
          writable: true,
          namespaces: [
            { ns: 'date-model', revision: 5, value: {} },
            { ns: 'agent-default-model', revision: 2, value: { provider: 'qwen-token-plan-cn', model: 'deepseek-v4.1-flash' } },
          ],
        },
      }),
      update: (ns, patch, revision) => {
        settingsCalls.push([ns, patch, revision])
        return Promise.resolve({ ok: true, value: { ns, revision: revision + 1 } })
      },
    },
  },
  effect(fn) { fn(); return () => {} },
  inject() {},
  get() {},
  on() {},
}
// 模拟 HMR：上一代模块开着弹层就被重新求值，留下一个挂在 body 上的空壳
const orphan = makeNode('div')
orphan.className = 'dm-pop dm'
doc.body.appendChild(orphan)

try {
  mod.apply(fakeCtx)
} catch (error) {
  console.log(`FAIL  apply() 抛出：${error?.stack ?? error}`)
  process.exit(1)
}
ok(!doc.body.children.includes(orphan), 'apply() 没有清掉上一代模块留下的孤儿弹层')
ok(registered.length === 1, `注册数量应为 1，实际 ${registered.length}`)
ok(registered[0]?.spec?.name === 'conversation.input.right', `注册槽位不对：${registered[0]?.spec?.name}`)
if (problems.length) { console.log('FAIL\n  - ' + problems.join('\n  - ')); process.exit(1) }

/* 造一个假的「真实模型座位」：座位上的文字就是当前真实模型名（切模型会变） */
const fakeRow = makeNode('div')
const fakeSeat = makeNode('div')
fakeSeat.textContent = 'deepseek-account/deepseek-flash'
const fakeSeatButton = makeNode('button')
fakeSeatButton.setAttribute('aria-label', 'deepseek-account/deepseek-flash')
fakeSeat.appendChild(fakeSeatButton)
fakeRow.appendChild(fakeSeat)

let chip = null
try {
  chip = ReactShim.createElement(registered[0].component, {})
} catch (error) {
  console.log(`FAIL  座椅组件渲染抛出：${error?.stack ?? error}`)
  process.exit(1)
}
fakeRow.appendChild(chip)
for (const effect of effects.splice(0)) {
  try { effect() } catch (error) { fail(`座椅 effect 抛出：${error?.message ?? error}`) }
}

/* 1b. 挂载即写 Host 插件配置（settings 通道，不产生会话记录） */
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
ok(settingsCalls.length >= 1, '座椅挂载后没有把名字写进 Host 配置')
ok(settingsCalls[0]?.[0] === 'date-model', `写配置的命名空间不对：${settingsCalls[0]?.[0]}`)
ok(settingsCalls[0]?.[1]?.identity === 'deepseek-v4.1-flash-1107', `写进配置的名字不对：${JSON.stringify(settingsCalls[0]?.[1])}`)
ok(settingsCalls[0]?.[2] === 5, `写配置没带 revision：${settingsCalls[0]?.[2]}`)

/* 1c. hover 提示 = 真实座位上的模型名（切模型会跟着变） */
const rerendered = ReactShim.createElement(registered[0].component, {})
const rerenderedButton = rerendered.children?.[0] ?? rerendered
const rerenderedTitle = String((rerenderedButton && rerenderedButton.__props && rerenderedButton.__props.title) || '')
ok(rerenderedTitle === 'deepseek-account/deepseek-flash', `hover 提示应是座位上的真实模型名，实际：${rerenderedTitle}`)
ok(String((rerenderedButton.__props || {})['aria-label']) === 'deepseek-v4.1-flash-1107', 'aria-label 应保持自己的名字（不是真实模型名）')
ok(fakeSeat.style.display === 'none', '真实模型座位应该被藏起来')
ok(fakeSeat.hasAttribute('data-dsh-date-model-hidden'), '藏起来的座位要打标记，卸载时好还原')

const chipButton = walk(chip, () => {}).children?.[0] ?? chip.children?.[0]
const chipText = (() => {
  let text = ''
  walk(chip, (node) => { if (node.nodeType === 3) text += node.textContent })
  return text
})()
ok(chipText.includes('deepseek-v4.1-flash-1107'), `座椅文字不对：${chipText}`)
ok(typeof (chipButton && chipButton.__props && chipButton.__props.onClick) === 'function', '座椅按钮没有 onClick')

/* 2. 点开：时钟应该是 4:01 */
chipButton.__props.onClick({ stopPropagation() {}, target: chipButton })
const pop = (() => { let found = null; walk(doc.body, (node) => { if (!found && node.className && String(node.className).includes('dm-pop')) found = node }); return found })()
ok(Boolean(pop), '点开之后没有出现 .dm-pop')
if (!pop) { console.log('FAIL\n  - ' + problems.join('\n  - ')); process.exit(1) }

const findAll = (predicate) => { const out = []; walk(pop, (node) => { if (predicate(node)) out.push(node) }); return out }
const find = (predicate) => findAll(predicate)[0] || null
// 原生 DOM 里的文字：文本节点，或「只有 textContent、没有子节点」的叶子元素（el() 的 text 写法）。
const textOf = (node) => {
  let text = ''
  if (!node) return text
  walk(node, (n) => {
    if (n.nodeType === 3) text += n.textContent
    else if (n.children && n.children.length === 0 && n.textContent) text += n.textContent
  })
  return text
}
const attrLabel = (node) => (node.attributes && node.attributes['aria-label']) || (node.__props && node.__props['aria-label']) || ''
const buttonByLabel = (label) => find((node) => attrLabel(node) === label)
const hasClass = (node, name) => String((node && node.className) || '').split(/\s+/).includes(name)
const fireOn = (node, type, event = {}) => {
  if (!node) return false
  const listeners = (node._listeners && node._listeners[type]) || []
  for (const fn of listeners.slice()) fn({ stopPropagation() {}, target: node, ...event })
  return listeners.length > 0
}
const fire = (node, event = {}) => {
  if (!node) return false
  if (node.__props && typeof node.__props.onClick === 'function') {
    node.__props.onClick({ stopPropagation() {}, target: node, ...event })
    return true
  }
  return fireOn(node, 'click', event)
}
const clockText = () => ''
const nameText = () => textOf(find((n) => hasClass(n, 'dm-name')))
const attrOf = (node, name) => (node.attributes && node.attributes[name]) || (node.__props && node.__props[name]) || ''

ok(nameText() === 'deepseek-v4.1-flash-1107', `名字不对：${nameText()}`)
ok(!/[\u4e00-\u9fff]/.test(textOf(pop)), `面板里混进了中文：${textOf(pop).slice(0, 120)}`)

/* 3. 两个数字盘 */
const wheels = findAll((n) => hasClass(n, 'dm-wheel'))
ok(wheels.length === 2, `数字盘数量不对：${wheels.length}`)
const itemIn = (wheel, value) => {
  let hit = null
  walk(wheel, (n) => { if (!hit && hasClass(n, 'dm-wheel-item') && attrOf(n, 'data-v') === String(value)) hit = n })
  return hit
}
ok(Boolean(itemIn(wheels[0], 12)), '第一个数字盘里找不到 12')
fire(itemIn(wheels[0], 12))
ok(nameText() === 'deepseek-v12.1-flash-1107', `调完第一位数名字不对：${nameText()}`)
fire(itemIn(wheels[1], 30))
ok(nameText() === 'deepseek-v12.30-flash-1107', `调完第二位数名字不对：${nameText()}`)

/* 4. 点 11-22：日期段跟着变 */
fire(buttonByLabel('2026-11-22'))
ok(nameText() === 'deepseek-v12.30-flash-1122', `点完日期名字不对：${nameText()}`)

/* 4b. 天气档位：六个真实天气单词的图标格子（无文字），选中态和日历的白块一致 */
const tierButtons = () => findAll((n) => hasClass(n, 'dm-tier-btn'))
const weathers = tierButtons().map((n) => attrOf(n, 'aria-label'))
ok(tierButtons().length === 7, `天气档位数量不对：${tierButtons().length}`)
ok(weathers.join(',') === 'flash,pro,rain,cloudy,snow,fog,clear', `天气档位顺序不对：${weathers.join(',')}`)
ok(tierButtons().every((n) => n.children.some((c) => String(c.tagName || c.tag || '').toLowerCase() === 'svg')), '档位格子不是图标')
const tick = (index, weather) => {
  fire(tierButtons()[index])
  ok(nameText() === `deepseek-v12.30-${weather}-1122`, `切到 ${weather} 名字不对：${nameText()}`)
  ok(attrOf(find((n) => hasClass(n, 'dm-body')), 'data-tier') === weather, `切到 ${weather} 后整块天气没跟着换`)
}
tick(1, 'pro')
tick(2, 'rain')
tick(3, 'cloudy')
tick(4, 'snow')
tick(5, 'fog')
tick(6, 'clear')
tick(0, 'flash')

/* 5. 确定：写入 + 提示 */
fire(find((n) => hasClass(n, 'dm-ok')))
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
const stored = (() => { try { return JSON.parse(store.get('dsh-date-model/selection') || 'null') } catch { return null } })()
ok(Boolean(stored), '确定之后没有写 localStorage')
ok(stored && stored.major === 12 && stored.minor === 30 && stored.d === 22 && stored.tier === 'flash', `写入内容不对：${JSON.stringify(stored)}`)
ok(!doc.body.children.some((node) => String(node.className || '').includes('dm-pop')), '确定之后弹层没关')
const toast = doc.getElementById('dsh-date-model/style/toast')
ok(Boolean(toast) && textOf(toast) === 'deepseek-v12.30-flash-1122', `提示不对：${textOf(toast)}`)
ok(settingsCalls.some((call) => call[1] && call[1].identity === 'deepseek-v12.30-flash-1122'), '确定之后没有把新名字写进 Host 配置')

/* 5b. 小眼睛：随时显隐真实模型选择器 */
chipButton.__props.onClick({ stopPropagation() {}, target: chipButton })
const pop2 = (() => { let found = null; walk(doc.body, (node) => { if (!found && node.className && String(node.className).includes('dm-pop')) found = node }); return found })()
const eyeButton = (() => { let hit = null; walk(pop2, (n) => { if (!hit && String((n.attributes || {})['aria-label'] || '').includes('real model selector')) hit = n }); return hit })()
ok(Boolean(eyeButton), '面板里没有小眼睛按钮')
ok(String(eyeButton?.attributes?.['aria-label']).startsWith('show'), `默认应是隐藏态：${eyeButton?.attributes?.['aria-label']}`)
fire(eyeButton)
ok(store.get('dsh-date-model/reveal') === '1', '点小眼睛后没有记住"显示真实模型"')
const eyeAfter = (() => { let hit = null; walk(doc.body, (n) => { if (!hit && String((n.attributes || {})['aria-label'] || '').includes('real model selector')) hit = n }); return hit })()
ok(String(eyeAfter?.attributes?.['aria-label']).startsWith('hide'), '点完小眼睛后图标状态没变')
fire(eyeAfter)
ok(store.get('dsh-date-model/reveal') === '0', '再点一次没有切回隐藏')

/* 6. 再点开：记住上次的数字和日期 */
chipButton.__props.onClick({ stopPropagation() {}, target: chipButton })
const reopened = (() => { let found = null; walk(doc.body, (node) => { if (!found && node.className && String(node.className).includes('dm-pop')) found = node }); return found })()
ok(Boolean(reopened), '第二次点开失败')
if (reopened) {
  let nameNode = null
  walk(reopened, (n) => { if (!nameNode && hasClass(n, 'dm-name')) nameNode = n })
  ok(textOf(nameNode) === 'deepseek-v12.30-flash-1122', '重开面板没记住上次的选择')
}

if (problems.length) {
  console.log(`FAIL  ${problems.length} 个问题`)
  for (const problem of problems) console.log(`  - ${problem}`)
  process.exit(1)
}

/* 7. 无限数字：一直往下滚，能滚出三位数（不再卡在 0–23 / 0–59） */
const wheelOf = (index) => findAll((n) => hasClass(n, 'dm-wheel'))[index]
const itemsOf = (wheel) => { const out = []; walk(wheel, (n) => { if (hasClass(n, 'dm-wheel-item')) out.push(n) }); return out }
const scrollToLastItem = (index) => {
  const wheel = wheelOf(index)
  const items = itemsOf(wheel)
  wheel.scrollTop = (items.length - 1) * 28
  fireOn(wheel, 'scroll')
}
for (let round = 0; round < 3; round += 1) scrollToLastItem(0)
const bigName = nameText()
const big = /^deepseek-v(\d+)\./.exec(bigName)
ok(Boolean(big) && Number(big[1]) >= 240, `滚轮没滚出三位数（应无上限）：${bigName}`)
ok(itemsOf(wheelOf(0)).length >= 100, '滚轮换窗口后项目太少')

console.log('PASS  座椅 + 无限数字盘 + 日期 + 七种天气 + 小眼睛 + 身份推送 全部通过（v4.1-flash-1107 → v12.30-flash-1122，滚到底 → ' + bigName.replace(/^deepseek-/, '') + '）')