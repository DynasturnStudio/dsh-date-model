// Host 半边的无宿主自检：用假 ctx / 假配置跑 apply()，确认：
//   1. Config 能加载（link 安装时 schemastery 从 profile 找到）；
//   2. 系统提示词 section 优先读 profile 的 cordis.patch.yml（写完落盘立刻生效），
//      文件里没有时才回退到内存里的 volatile 配置；
//   3. 脏值（空格、超长、控制字符）不会进提示词。
// 用法：node scripts/host-check.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 隔离：把 profile 指向临时目录，自检不读本机真实配置
const tempProfile = mkdtempSync(join(tmpdir(), 'dsh-date-model-host-'))
process.env.DSH_PROFILE_DIR = tempProfile
const patchPath = join(tempProfile, 'cordis.patch.yml')

function writePatch(identity) {
  const lines = ['- id: date-model', '  name: dsh-date-model', '  config:']
  if (identity === undefined) lines.push('    legacy: true')
  else lines.push(`    identity: ${identity}`)
  lines.push('  disabled: false', '')
  writeFileSync(patchPath, lines.join('\n'), 'utf8')
}

writePatch(undefined)

const { apply, inject, Config } = await import('../index.js')

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

  // 1) 文件里有名字：以文件为准（模拟设置写入落盘后 Host 内存还没刷新）
  writePatch('deepseek-v4.1-flash-1107')
  const text = section.text()
  ok(text.includes('deepseek-v4.1-flash-1107'), `section 文本没带名字：${text}`)
  ok(text.includes('你是谁'), 'section 文本没说明"你是谁"该怎么答')

  // 2) 换名字后立刻跟着变
  writePatch('deepseek-v12.30-pro-1231')
  ok(section.text().includes('deepseek-v12.30-pro-1231'), '换名字后 section 没跟着变')
  ok(!section.text().includes('deepseek-v4.1-flash-1107'), '旧名字应被替换掉')

  // 3) 文件里没有 identity 时回退到内存配置
  writePatch(undefined)
  current = 'deepseek-v4.1-flash-1107'
  ok(section.text().includes('deepseek-v4.1-flash-1107'), '文件没有 identity 时应回退到配置值')

  // 4) 脏值不会进提示词（文件与配置两条路径都测）
  for (const bad of ['   ', 'has space', '带中文', 'x'.repeat(200), 'a\\nb', 'a\nb']) {
    writePatch(JSON.stringify(bad).replace(/^"|"$/g, ''))
    current = bad
    ok(section.text() === '', `脏值应被挡住：${JSON.stringify(bad)}`)
  }
}

for (const dispose of disposers) {
  try { dispose() } catch { /* ignore */ }
}
try { rmSync(tempProfile, { recursive: true, force: true }) } catch { /* ignore */ }

if (problems.length) {
  console.log(`FAIL  ${problems.length} 个问题`)
  for (const problem of problems) console.log(`  - ${problem}`)
  process.exit(1)
}
console.log(`PASS  Host 半边：section 优先读 cordis.patch.yml（写完立刻生效）+ 配置回退 + 脏值过滤${hasSchemaKit ? ' + Config(volatile)' : '；Config 项跳过（本机没装 @deepseek-ai/schemastery）'}`)
