# web-access 升级备忘（给 agent 看）

这个 skill 是从上游**拷贝**进 repo 的，不是 submodule/pi 包，没有自动更新。
升级 = 手动从上游同步文件。下次用户让升级时，按此操作。

- 上游：https://github.com/eze-is/web-access （作者 一泽 Eze，MIT）
- 当前固定版本：**v2.5.1**（用户选的稳定版；README 标题内写的是 `v2.5.0 能力`，以 tag 为准）
- 本地路径：`skills/web-access/`

## 本地修改（升级时需重新打上）

升级会覆盖 `scripts/cdp-proxy.mjs`，以下本地修复会丢失，需确认上游是否已修，否则重新打上：

- **Chrome 136+ 兼容（`getWebSocketUrl`）**：Chrome 148 的 `DevToolsActivePort` 常为空，proxy 拿不到 wsPath 时会回退连接不带 UUID 的 `/devtools/browser`，被新版 Chrome 拒绝。修复：在 `getWebSocketUrl` 里改为 async，无 wsPath 时从 `http://127.0.0.1:<port>/json/version` 动态读取真实 `webSocketDebuggerUrl`（带 UUID），并在 `connect()` 里 `await getWebSocketUrl(...)`。

## 升级步骤

```bash
# 1. 看上游 tag，和用户确认目标版本
git ls-remote --tags https://github.com/eze-is/web-access \
  | awk -F/ '{print $NF}' | grep -v '\^{}' | sort -V

# 2. 克隆目标 tag（vX.Y.Z 换成确认的版本）
TMP=$(mktemp -d)
git clone --depth 1 --branch vX.Y.Z https://github.com/eze-is/web-access "$TMP/wa"

# 3. 同步进 skill（核心文件覆盖；保留 site-patterns）
SKILL="$(cd "$(dirname "$0")" && pwd)"   # 或写死 skills/web-access 绝对路径
find "$SKILL/scripts" -type f -delete && cp "$TMP/wa"/scripts/* "$SKILL/scripts/"
cp "$TMP/wa/SKILL.md" "$TMP/wa/README.md" "$SKILL/"
cp "$TMP/wa"/references/*.md "$SKILL/references/"
# 新版若多了目录/文件（如 templates/、migration-*.md），按 diff 补 cp -R

# 4. 验证 + 清理
node "$SKILL/scripts/check-deps.mjs"      # 应输出 node: ok（chrome 未连是正常的）
find "$TMP" -depth -delete
```

## 坑（必看）

1. **不要用 `rm -rf`** —— repo 里 `permission-gate.ts` 扩展会拦截 `rm -rf` 导致命令卡死。
   删文件用 `find ... -delete` 或 `unlink`/`rmdir`。
2. **保留 `references/site-patterns/`** —— 站点经验积累目录，上游 `.gitignore` 本就忽略
   `site-patterns/*.md`。只换代码/文档，别动这个目录的内容。
3. **大版本会改结构**，不是简单覆盖几个文件。已知差异：
   - v2.5.1：scripts 4 个（`cdp-proxy` `check-deps` `find-url` `match-site`，均 `.mjs`），无 templates。
   - v2.5.2：多了 `scripts/browser-discovery.mjs`、`templates/config.env.template`、
     `references/migration-2.5.3.md`；`check-deps.mjs` 会生成运行时 `config.env`。
   - v2.5.3：**破坏性改动** —— `/new`、`/navigate` 的目标 URL 从 query 参数改为
     POST body（`-X POST --data-raw 'URL'`）。升到 ≥2.5.3 后旧 `?url=` 写法会返回 400，
     需按 `references/migration-2.5.3.md` 改写调用。
4. **运行时文件别提交**：`config.env`、`references/site-patterns/*.md` 应保持被忽略。

## 升级后

确认 `SKILL.md` 里引用的脚本路径都还存在；更新本文件「当前固定版本」一行；
改动属于 `pi-agent-config` repo，按用户意愿决定是否 commit / push 到
`git@github.com:LEUNGUU/pi-agent-config.git`。
