# pi-reasoning-tool

一个 Pi 扩展，用来做一个实验：**LLM 在编写 Tool Call 时，能否用其中的「参数」作为「推理」的承载位置？**

它注册一个只有一个参数的工具 `deep_reasoning`，参数本身就是推理的承载位置；工具只回一句
短回执。另外提供 `/reasoning-tool`，让用户随时调整该工具的 description——description 就是这个
实验的控制变量。

## 工具

| 项 | 值 |
| --- | --- |
| 工具名 | `deep_reasoning` |
| 参数 | 只有一个：`deep_reasoning: string` |
| 行为 | 只回短回执 `Reasoning recorded.`，**不回显**参数 |

推理内容靠**参数本身**留在 transcript 中：assistant 的 tool call arguments 是对话历史的一部分，
所以下一轮模型能看到自己的推理，压缩扩展也能处理它（观察点是 assistant 消息，而不是 tool result）。
工具本身不做任何别的事。

默认 description（逐字，来自需求原文）：

> This tool is appearing due to compatibility issues, you need to use this tool for reasoning whether deep or shallow, so the reasoning content can be fully passed back, and compressed, and executed by the extensions living in pi. Make full use of this tool for maximized convenience.

## Slash command

```text
/reasoning-tool             打开多行编辑器，预填当前 description
/reasoning-tool edit        同上
/reasoning-tool show        查看当前 description、来源（default/custom）与长度
/reasoning-tool set <text>  直接把 description 设为 <text>
/reasoning-tool reset       恢复内置默认 description
```

注意：`show` 的输出与 usage 提示都走 `ui.notify`，而 `ui.notify` 在无 UI 模式
（`pi -p`、`--mode json`）下是 no-op。这两种模式下只有 `set` / `reset` 真正生效
（写盘 + 重注册），但没有任何可见回显。

改动生效路径：

1. 重新注册同名工具。Pi 的 extension loader 对同一扩展的工具表是 `Map.set`，
   同名注册会**替换**定义（跨扩展才是 first-registration-wins）。
2. 注册会调用 `refreshTools()`，重建 active tool set 并重建 system prompt。
3. 新的 description 在下一次模型请求的 tools payload 里生效（当前会话立即生效，无需重启）。
4. 同时持久化到 `<agent dir>/pi-reasoning-tool-state.json`，新会话在加载时读取。

状态文件位置由 Pi 的 `getAgentDir()` 决定（`PI_CODING_AGENT_DIR` 或 `~/.pi/agent`）。
文件内容形如 `{"version": 1, "description": "..."}`；`reset` 会删除该文件。

## 设计取舍

1. **不设 `promptSnippet` / `promptGuidelines`。** 这样 description 是唯一的控制变量，
   实验读数不会被 system prompt 里的另一段文案污染。
2. **tool result 是短回执，不回显推理。** 参数已经在上下文里了，回显会让同一段文本同时出现在
   tool call arguments 和 tool result 里，白付约 2x token。回执文案集中在 `src/description.ts`
   的 `RECEIPT_TEXT`，要改是一行。
3. **工具名与参数名同名**（`deep_reasoning`）。需求只指定了参数名；工具名集中定义在
   `src/description.ts` 的 `TOOL_NAME`，要改是一行。
4. **不做自定义 renderer。** TUI 里按默认方式显示 tool call 与 result，推理内容直接可见。

## 安装

在 `settings.json` 的 `packages` 里加相对路径：

```json
"..\\..\\extensions\\pi-reasoning-tool"
```

开发时也可以直接加载：

```powershell
pi --extension ./index.ts
```

## 验证

```powershell
npm test          # 单元测试 + 真实路径的 SDK 测试
npm run check     # tsc --noEmit
```

`tests/sdk.test.ts` 是主证据：它通过 Pi 自己的 extension loader 载入 `index.ts`，
创建真实 `AgentSession`，然后用两路独立观测确认改动真的上了 wire：

- `before_provider_request` 事件捕获的 provider payload（`tools[].description`）；
- 本地 127.0.0.1 transport 实际收到的 HTTP request body。

测试覆盖：默认加载、`set` 后注册表与 wire、`reset` 回到默认、新会话读取持久化值、
工具 execute 返回短回执且不回显参数。transport 是本地 HTTP server，不消耗付费 token。

**负向对照**：把 `src/extension.ts` 中 `apply()` 里的 `registerTool(description)` 去掉，
该测试会失败（payload 里仍是默认 description）。因此这条断言不是自证式通过。

### 真实 provider 实跑（2026-09-29）

用 `--provider Mapleluv-ChatCompletions --model deepseek-flash:high` 打真实请求验证：

1. 真实 CLI 执行 `/reasoning-tool set REAL-PROVIDER-CHECK route all reasoning through deep_reasoning`，
   写入 `<agent dir>/pi-reasoning-tool-state.json`。
2. 用 pi 自带的 `examples/extensions/provider-payload.ts` 捕获出站 payload：发给 Mapleluv 的
   `tools[]` 里 `deep_reasoning` 的 `description` 正是上面那段文本，参数 schema 只有一个必填 string。
3. 真实模型**主动调用**了该工具，参数里是一整段完整推理（状态空间界定 → 倒推子目标 →
   6 步正向序列 → gcd 与 BFS 最短路校验）。

结论：链路在真实 provider 上成立，且模型确实愿意把推理放进 tool call 的参数里。
验证后已用 `/reasoning-tool reset` 恢复默认。

#### 短回执下的行为（同一 provider，默认 description）

改成短回执后再打一次真实请求（水壶量 4L 题），观测到：

- 模型**主动调用**了 `deep_reasoning`，参数里是完整推理（约束分析 → 可测量集合 = 3、5 的
  整数组合 → 6 步正向序列），该参数 **906 字符**；
- 对话里的 tool result 就是短回执本身，**19 字符**（占参数 2.1%），不再重复那 906 字符；
- 模型随后仅凭上下文里自己的 tool call 参数，仍然给出了**正确**的最终答案
  （6 步表格 + `gcd(3,5)=1` 的可行性说明）。

即：短回执不损害作答，省掉的正是重复那一份 token。
