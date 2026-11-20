// 按日期选模型 —— Host 半边。
//
// 浏览器半边把选中的版本号写进本插件的 volatile 配置（settings 通道：静默、不产生任何会话记录），
// 这里读出来塞进系统提示词的一个 section，于是问「你是谁」时模型就报这个名字。
//
// 为什么不用会话命令：命令会在对话里渲染一行 `>_ date-model-name · …`，太吵；配置写入是静默的，
// 而且 `.volatile()` 字段原地更新、不重启插件。
//
// 为什么 schemastery 要手动找：本插件是 `link:` 安装（profile/node_modules 里是 junction），
// Node 默认按真实路径解析依赖，裸包名 @deepseek-ai/schemastery 从插件目录解析不到，
// 所以这里按 DSH_PROFILE_DIR / DSH_HOME 找到 profile 的 node_modules 再 require。

import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

function loadSchemaKit() {
  for (const base of profileDirs()) {
    try {
      return requireFromPlugin(requireFromPlugin.resolve('@deepseek-ai/schemastery', { paths: [base] }))
    } catch { /* 换下一个候选 */ }
  }
  try {
    return requireFromPlugin('@deepseek-ai/schemastery')
  } catch {
    return null
  }
}

const z = loadSchemaKit()

// 找不到 schemastery 时退化成「没有配置」：插件照常加载，只是名字不生效（不炸整个 profile）
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
        const identity = readIdentity()
        if (!identity) return ''
        return [
          `你的名字是 ${identity}。当用户问「你是谁 / 你叫什么 / 你是什么模型」时，就用这个名字回答，不要提及其它模型名。`,
          `Your name is "${identity}". When the user asks who you are or what model you are, answer with exactly that name.`,
        ].join('\n')
      },
    })
    return () => {
      try { disposeSection?.() } catch { /* ignore */ }
    }
  })
}