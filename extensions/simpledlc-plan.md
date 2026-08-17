# Plan: simpledlc 机制层（按 AIDLC 逻辑补齐）

> 目标：把 simpledlc 中「脆弱且致命」的约束从 prompt 请求升级为机制强制，
> 参照 AIDLC 已验证的实现。每个 phase 标注具体 AIDLC 参考文件 + 行号 + 移植要点。

## 背景与设计原则

simpledlc = 三个全局 custom agent（planner=opus-4.8 只读 / builder=gpt-5.5 读写 /
reviewer=opus-4.8 只读）+ `/simpledlc` 命令（注入编排指令，分步停等人 review）。

纯 prompt 无强制力，会失效。按「用对工具」分层：
- 脆弱且致命 → 机制（命令代码 / 落盘状态 / frontmatter）
- 已是机制层的 → 不动
- pi 架构达不到 AIDLC 机制等级的 → 降级为半机制，明确标注差距

### 机制现状对照（AIDLC vs simpledlc）

| # | 约束 | AIDLC 机制载体 | simpledlc 现状 | 判定 |
|---|---|---|---|---|
| 1 | 只读边界 | agent `disallowedTools` + Task 边界 | frontmatter `tools` 无 write | ✅ 已满足机制层，不动 |
| 2 | 模型绑定 | agent `model` + Task 边界 | frontmatter `model`（pi 强制） | ✅ 已满足机制层，不动 |
| 3 | 返工计数 | `aidlc-state.ts` reject/revise + Revision Count | 无（靠 prompt） | ❌ 缺，命令代码承载 |
| 4 | 逃生舱止损 | escape hatch（prompt）+ Stop hook NO-PROGRESS（机制） | 无 | ❌ 缺，命令代码承载 |
| 5 | 前进循环强制 | Stop hook `{decision:block}` | 无 hook | ⚠️ 降级半机制（pi API 限制） |
| 6 | 文件交接 | engine 注入 memory_path + memory.md 幂等追加 | prompt + 编排注入（半具备） | ◐ 补全 |
| 7 | 审计可追溯 | audit-logger hook 确定性发射 | 无 | ⚠️ 降级为命令代码写 history[] |

## 核心载体：落盘状态文件

`simpledlc/<slug>/.state.json` —— 承载 #3/#4/#7。

```json
{
  "slug": "add-vpc-module",
  "task": "原始任务文本",
  "phase": "plan|build|review|done",
  "review_round": 0,
  "verdict": "APPROVED|NEEDS_CHANGES|null",
  "escape_hatch_offered": false,
  "guard": { "signature": "phase::historyLen", "count": 0 },
  "history": [ {"ts": "", "event": "", "phase": "", "round": 0, "note": ""} ]
}
```

读写只由 `simpledlc.ts` 命令代码做（确定性），agent 不碰。

**AIDLC 参考**：`core/tools/aidlc-lib.ts:2054-2140`
（`readStateFile` / `writeStateFile` / `getField` / `setField`）。
AIDLC 状态存 markdown 字段，simpledlc 简化为 JSON（无需 checkbox 协议）。

---

## Phase 1 — 状态文件 + 返工计数（#3、#7）

### AIDLC 参考实现
- **`core/tools/aidlc-state.ts:1721-1779` `handleReject`** —— 返工计数权威范式：
  - 读 `Revision Count` → 非数字强制归 0（`:1743-1746`，防手改/缺失）→ +1 → 写回
  - lost-update 安全：读→自增→写 在 `withAuditLock` 内（`:1734`）。
    simpledlc 单进程可简化为同步读写，但保留「先算后写、可重入幂等」思路
- **`core/tools/aidlc-state.ts:1781-1811` `handleRevise`** —— 状态转移 `[R]→[?]`，
  simpledlc 对应 `phase: build→review` 回转
- **`core/tools/aidlc-audit.ts:260-296` `appendAuditEntryUnlocked`** —— 审计追加格式：
  - 追加而非覆盖（`appendFileSync`，`:293`）
  - **换行转义防伪造**（`:287` `.replace(/\r?\n/g, "\\n")`）——
    simpledlc 写 history[] note 时同样转义，防任务文本注入伪造记录
  - 事件类型白名单校验（`:234-238`）—— simpledlc `event` 字段同样枚举校验

### simpledlc 实现
`simpledlc.ts` 新增 `readState / writeState / appendHistory(event, note)`；
`review_round` 由代码自增（对应 Revision Count）；`history[]` 每步追加
（对应 appendAuditEntry）。

---

## Phase 2 — 逃生舱止损（#4）

### AIDLC 参考实现
- **`core/aidlc-common/protocols/stage-protocol.md:75-93` `Revision loop escape hatch`**
  —— 阈值语义权威定义：
  - `:76`：**3 轮**后加第三选项（simpledlc `MAX_REVIEW_ROUNDS = 3`）
  - `:87`：`Accept as-is` 选项 → simpledlc 用 `ctx.ui.select` 三选项（继续修/接受/放弃）
  - `:91`：接受后记审计（"accepted as-is after N cycles"）→
    simpledlc `appendHistory("ESCAPE_HATCH_ACCEPTED", ...)`
  - `:93`：第 2 轮预告逃生舱即将出现 → simpledlc 可选，round==2 注入里加提示
- **`core/aidlc-common/protocols/stage-protocol.md:164`** —— Accept as-is 等价 Approve 的处理

### simpledlc 实现
`review_round >= 3 && !escape_hatch_offered` → 命令停止自动注入下一轮，
改 `ctx.ui.select` 问人类，置 `escape_hatch_offered = true`。

---

## Phase 3 — 前进循环（#5，降级半机制）

### AIDLC 参考实现
- **`core/hooks/aidlc-stop.ts:174-245` NO-PROGRESS 计数** —— 止损防死锁权威范式：
  - `progressSignature`（`:211-224`）：`stage::auditLen` 组合签名，签名不变=无进展 →
    simpledlc 用 `phase::history.length` 作签名
  - `GuardRecord {signature, count}`（`:189-192`）持久化 →
    simpledlc 存进 `.state.json` 的 `guard` 字段
  - `INTERACTIVE_BLOCK_CAP = 2`（`:139`）：交互模式连续 2 次无进展就放手 →
    simpledlc 注入上限

### 明确差距（已核实 pi API）
pi 的 `turn_end` / `agent_end` 是 `ExtensionHandler<Event>` **无 Result 类型**
（`types.d.ts:839-841`），返回 void，**不能像 `aidlc-stop.ts:170` 那样
`{decision:"block"}`**。所以 simpledlc 只能在 `pi.on("agent_end")` 里
observe + `pi.sendUserMessage` 主动注入（半机制），无法硬 block。

### simpledlc 实现
`pi.on("agent_end")` 读 `.state.json`，若 phase 未 done 且有停滞则注入提醒；
带 signature 计数，连续 2 次无进展停止注入。

---

## Phase 4 — 路径注入 + agent 联动（#6）

### AIDLC 参考实现
- **`core/aidlc-common/conductor.md`（"Framing the persona" 节）**：
  "subagent stage 必须在 prompt 里传 context，子 agent 看不到对话历史，绝不自己注入
  persona" —— 「engine 注入路径、不靠 agent 记」的权威依据。simpledlc 编排注入路径 = 同逻辑
- **`core/aidlc-common/conductor.md`（"Keeping the diary" 节）**：
  `memory.md` 幂等、重入不覆盖、累积追加 —— build-log / review 追加约定参考
  （`## Fix round N` / `## Review round N`）

### simpledlc 实现
1. `simpledlc.ts` 注入 builder/reviewer 指令时，把 `<slug>` 三文件路径直接写进 prompt
   （+ round>0 时明示上一轮 review 路径）
2. 三个 agent `.md` 补 prompt：builder 读 review.md 追加 `## Fix round N`；
   reviewer 读旧 review 标 `## Review round N`（prompt 层兜底）

---

## 明确不做（AIDLC 有、simpledlc 架构无等价物）
- **#5 硬 block**：`aidlc-stop.ts:170` 的 `{decision:block}` 契约 —— pi 事件无 Result 类型，
  不可复刻，Phase 3 已降级半机制
- **#7 独立 audit hook**：`core/hooks/aidlc-audit-logger.ts` 那套 —— 不引入，
  降级为 Phase 1 命令代码写 history[]
- **锁机制**：`aidlc-lib.ts:2695 withAuditLock`、`aidlc-audit.ts:241 acquireAuditLock`
  —— simpledlc 单进程无并发，不需要

---

## 交付物
1. 重写 `~/.pi/agent/extensions/simpledlc.ts`（Phase 1-4）
2. 三个 agent `.md` prompt 补丁（Phase 4）
3. `.state.json` 格式（命令自动生成，无需手建）

## 验证
- `bun build simpledlc.ts --target=node`（类型/语法）
- 单元：构造各阶段 `.state.json`，验证 `review_round` 自增、逃生舱 3 轮触发、
  history 追加 + 换行转义
- 端到端：真实小任务跑 plan→build→review→强制返工到 3 轮→逃生舱触发

---

## 参考文件速查

| Phase | AIDLC 文件 | 行号 | 用途 |
|---|---|---|---|
| 核心 | `core/tools/aidlc-lib.ts` | 2054-2140 | 状态读写范式 |
| 1 | `core/tools/aidlc-state.ts` | 1721-1811 | 返工计数 reject/revise |
| 1 | `core/tools/aidlc-audit.ts` | 260-296 | 审计追加 + 换行转义 |
| 2 | `core/aidlc-common/protocols/stage-protocol.md` | 75-93, 164 | 逃生舱 3 轮阈值 |
| 3 | `core/hooks/aidlc-stop.ts` | 174-245, 139, 170 | NO-PROGRESS + block 契约 |
| 4 | `core/aidlc-common/conductor.md` | Framing/Diary 节 | 路径注入 + 幂等追加 |
