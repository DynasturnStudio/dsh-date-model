// 按日期选模型 —— Host 半边。
//
// 浏览器半边把选中的版本号写进本插件的 volatile 配置（settings 通道：静默、不产生任何会话记录），
// 这里读出来塞进系统提示词的一个 section，于是问「你是谁」时模型就报这个名字。
//
// 两个坑（都踩过，注释留证）：
// 1) 本插件是外部安装（profile/node_modules 里可能是 link/junction），裸包名 @deepseek-ai/schemastery
//    从插件目录解析不到，所以这里按 DSH_PROFILE_DIR / DSH_HOME / ~/.dsh/profiles/* 找 profile 的
//    node_modules。**必须用动态 import() 走 ESM 入口**：Host 启动早期用 require() 加载 ESM 版
//    schemastery 会撞上 cosmokit 的模块加载竞态（"not yet fully loaded"），Config 变空，
//    settings 就不会注册本插件的命名空间，表现为「界面上改名字但写不进去」。
// 2) settings 写入会把值落盘，但 Host 内存里的插件配置不一定会立刻刷新；所以拼提示词时
//    **优先直接读 profile 的 cordis.patch.yml**，内存配置只做兜底。

import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const requireFromPlugin = createRequire(import.meta.url)

/** profile 目录候选：环境变量优先，兜底扫 ~/.dsh/profiles/*（宿主进程里不一定有 DSH_* 环境变量） */
function profileDirs() {
  const dirs = []
  if (process.env.DSH_PROFILE_DIR) dirs.push(process.env.DSH_PROFILE_DIR)
  if (process.env.DSH_HOME) dirs.push(join(process.env.DSH_HOME, 'profiles', process.env.DSH_PROFILE || 'desktop'))
  try {
    const root = join(homedir(), '.dsh', 'profiles')
    for (const name of readdirSync(root)) dirs.push(join(root, name))
  } catch { /* ignore */ }
  return dirs
}

/** 把解析到的 cjs 入口换成同名 ESM 入口（schemastery 两个入口都在） */
function esmSibling(resolved) {
  return resolved.replace(/index\.(cjs|js)$/, 'index.mjs')
}

async function importEsm(filePath) {
  const mod = await import(pathToFileURL(filePath).href)
  return mod && mod.default ? mod.default : mod
}

/**
 * 加载 schemastery。用动态 import()（ESM），不要用 require()：见文件头第 1 条。
 * 找不到就返回 null —— 插件照常加载，只是名字注入降级（不炸整个 profile）。
 */
async function loadSchemaKit() {
  const candidates = []
  for (const base of profileDirs()) {
    try {
      candidates.push(esmSibling(requireFromPlugin.resolve('@deepseek-ai/schemastery', { paths: [base] })))
    } catch { /* 换下一个候选 */ }
  }
  try {
    candidates.push(esmSibling(requireFromPlugin.resolve('@deepseek-ai/schemastery')))
  } catch { /* ignore */ }

  for (const file of [...new Set(candidates)]) {
    try {
      const kit = await importEsm(file)
      if (kit && typeof kit.object === 'function') return kit
    } catch { /* 换下一个候选 */ }
  }
  return null
}

const z = await loadSchemaKit()

export const Config = z
  ? z.object({
    identity: z.string().default('').description('当前选中的版本号，由日历界面写入').volatile(),
  })
  : undefined

export const inject = ['systemPrompt']

const SECTION_NAME = 'date-model-identity'
// 尽量靠后：越晚出现，越贴近本轮对话
const SECTION_ORDER = 9500
// 名字会进系统提示词，做个保守的白名单，挡住奇怪的写入
const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const PATCH_FILE = 'cordis.patch.yml'
const ENTRY_ID = 'date-model'

/**
 * 直接从 profile 的 cordis.patch.yml 里读 identity。
 *
 * 为什么需要它：settings 写入会把值落盘，但 Host 侧内存里的插件配置不一定立刻刷新，
 * 导致系统提示词还停在旧名字（表现为「改了名字但对话里还是旧的」）。每次拼提示词时读一遍
 * 文件（几 KB）最可靠——文件才是写入的源头。
 *
 * 返回值：null = 这个 profile 里没有本插件；'' = 有插件但还没写过名字。
 */
function readIdentityFromPatchFile(profileDir) {
  let lines
  try {
    lines = readFileSync(join(profileDir, PATCH_FILE), 'utf8').split(/\r?\n/)
  } catch {
    return null
  }
  let inBlock = false
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (!inBlock) {
      if (trimmed.startsWith('- id:')) {
        const value = trimmed.slice('- id:'.length).trim().replace(/^["']|["']$/g, '')
        if (value === ENTRY_ID) inBlock = true
      }
      continue
    }
    // 下一个顶层列表项，说明本段结束
    if (trimmed.startsWith('- ')) break
    const match = line.match(/^\s+identity:\s*(.+)$/)
    if (match) {
      const value = match[1].trim().replace(/^["']|["']$/g, '').trim()
      return IDENTITY_PATTERN.test(value) ? value : ''
    }
  }
  return inBlock ? '' : null
}

function readIdentityFromPatchFiles() {
  const dirs = []
  if (process.env.DSH_PROFILE_DIR) dirs.push(process.env.DSH_PROFILE_DIR)
  for (const dir of profileDirs()) if (!dirs.includes(dir)) dirs.push(dir)
  for (const dir of dirs) {
    const value = readIdentityFromPatchFile(dir)
    if (value !== null) return value
  }
  return ''
}

export function apply(ctx, config) {
  const readIdentity = () => {
    try {
      const field = config && config.identity
      const value = field && typeof field.get === 'function' ? field.get() : field
      const identity = typeof value === 'string' ? value.trim() : ''
      return IDENTITY_PATTERN.test(identity) ? identity : ''
    } catch {
      return ''
    }
  }

  ctx.effect(() => {
    const disposeSection = ctx.systemPrompt.section({
      name: SECTION_NAME,
      order: SECTION_ORDER,
      text: () => {
        // 文件优先：即使 Host 内存里的配置没刷新，下一次请求也会用最新落盘的名字
        const identity = readIdentityFromPatchFiles() || readIdentity()
        if (!identity) return ''
        return [
          `你的名字是 ${identity}。以本条为准：当用户问「你是谁 / 你叫什么 / 你是什么模型」时，就用这个名字回答；如果对话历史里你之前说过别的名字，一律以本条为准并纠正。`,
          `Your name is "${identity}". Treat this line as authoritative: if you previously answered with a different name in this conversation, correct it to this one.`,
        ].join('\n')
      },
    })
    return () => {
      try { disposeSection?.() } catch { /* ignore */ }
    }
  })
}
