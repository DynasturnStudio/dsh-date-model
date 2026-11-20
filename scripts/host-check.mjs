// Host 半边的无宿主自检：用假 ctx / 假配置跑 apply()，确认：
//   1. Config 能加载（link 安装时 schemastery 从 profile 找到）；
//   2. volatile 字段更新后，系统提示词 section 的文本立刻跟着变；
//   3. 脏值（空格、超长、控制字符）不会进提示词。
// 用法：node scripts/host-check.mjs
import { apply, inject, Config } from '../index.js'

const problems = []
const ok = (cond, message) => { if (!cond) problems.push(message) }

ok(Array.isArray(inject) && inject.includes('systemPrompt'), 'inject 缺 systemPrompt')
ok(!inject.includes('commands'), '不应该再注册会话命令（会在对话里留行）')

// Config 依赖 @deepseek-ai/schemastery；在 DSH 之外的机器（比如 CI）上这个包不一定在，
// 那种情况下跳过这项、不让自检失败——插件本身会降级成「没有配置」，照常加载。
const hasSchemaKit = Boolean(Config)
if (hasSchemaKit) {
  const parsed = Config({})
  ok(parsed && parsed.identity && typeof parsed.identity.get === 'function', 'Config 里 identity 不是 volatile 引用')
  ok(parsed.identity.get() === '', `默认名字应为空，实际：${parsed.identity.get()}`)
  const filled = Config({ identity: 'deepseek-v4.1-flash-1107' })
  ok(filled.identity.get() === 'deepseek-v4.1-flash-1107', 'Config 读不回写入的名字')
}

const sections = []
const disposers = []
const ctx = {
  effect(fn) {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  systemPrompt: {
    section(spec) {
      sections.push(spec)
      return () => {}
    },
  },
}

let current = ''
apply(ctx, { identity: { get: () => current } })

ok(sections.length === 1, `应注册 1 个 systemPrompt section，实际 ${sections.length}`)
const section = sections[0] || {}
ok(section.name === 'date-model-identity', `section 名字不对：${section.name}`)
ok(typeof section.text === 'function', 'section.text 应是函数（每次组装请求时读当前名字）')

if (typeof section.text === 'function') {
  ok(section.text() === '', '还没设置名字时 section 应为空')

  current = 'deepseek-v4.1-flash-1107'
  const text = section.text()
  ok(text.includes('deepseek-v4.1-flash-1107'), `section 文本没带名字：${text}`)
  ok(text.includes('你是谁'), 'section 文本没说明"你是谁"该怎么答')

  current = 'deepseek-v12.30-pro-1231'
  ok(section.text().includes('deepseek-v12.30-pro-1231'), '换名字后 section 没跟着变')
  ok(!section.text().includes('deepseek-v4.1-flash-1107'), '旧名字应被替换掉')

  for (const bad of ['', '   ', 'has space', '带中文', 'x'.repeat(200), 'a\nb']) {
    current = bad
    ok(section.text() === '', `脏值应被挡住：${JSON.stringify(bad)}`)
  }
}

for (const dispose of disposers) {
  try { dispose() } catch { /* ignore */ }
}

if (problems.length) {
  console.log(`FAIL  ${problems.length} 个问题`)
  for (const problem of problems) console.log(`  - ${problem}`)
  process.exit(1)
}
console.log(`PASS  Host 半边：systemPrompt section 正常（<id> → 「你的名字是 <id>」，无会话命令）${hasSchemaKit ? ' + Config(volatile)' : '；Config 项跳过（本机没装 @deepseek-ai/schemastery）'}`)