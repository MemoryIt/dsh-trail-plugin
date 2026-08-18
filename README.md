# dsh-trail-plugin

DeepSeek Harness（DSH）插件：**Session Tree / History Index**——给线性会话日志加上
可索引、可跳转、可分叉的导航层。

npm 包名：`dsh-trail-plugin`（MIT）。

## 这是什么

DSH 的会话本质是一条线性滚动的对话日志：只能顺着往下看，找不到"刚才那轮说了什么"，
更没法从某个历史节点继续。dsh-trail-plugin 在会话列表左侧加一个**历史索引栏**，把每个会话的
事件日志折叠成**节点树**——每轮对话一个逻辑节点，行内显示摘要与文本，支持：

- **行内跳转**：点击任意节点，直接跳到那轮对话在聊天流里的位置；
- **续写（fork）**：从任意节点 fork 出新的子会话继续，不打断当前会话；
- **分叉切换**：有分叉的节点带角标，展开共享会话下拉，一键切换；
- **可拖宽、可折叠**：左栏宽度与折叠状态会被记住，刷新不丢。

索引通过 DSH 官方投影通道持久化（`$DSH_HOME/storages/session_projcache.json`），
重启后恢复，不受对话窗口已加载条数限制。

## 安装

### 前置要求

- DSH（`dsh` CLI 可用，profile 机制正常）
- Node.js ≥ 20

### 从 npm 安装（推荐）

```bash
dsh plugin --profile web add dsh-trail-plugin
```

> `--profile` 换成你实际使用的 profile 名（默认 GUI 是 `web`）。bundle 层改动需要
> **整进程重启 DSH** 才生效，装完请重启。

### 验证安装

重启后看两处：

- 启动日志出现：`[I] dsh-trail [dsh-trail] hello world from dsh-trail-plugin (host)`
  （日志里的 `dsh-trail` 是日志命名空间与默认 `label`，不是包名）
- GUI 会话列表左侧出现「历史索引」左栏（含当前会话的节点树）

### 其他安装方式

| 方式 | 命令 | 说明 |
| --- | --- | --- |
| npm tarball | `dsh plugin --profile web add ./dsh-trail-plugin-0.1.0.tgz` | 无网络/内网场景 |
| git | `dsh plugin --profile web add github:MemoryIt/dsh-trail-plugin` | 需在 profile 的 `pnpm-workspace.yaml` 放行 `allowBuilds` |
| 本地源码 | `dsh plugin --profile web add /path/to/dsh-trail-plugin` | 开发调试用 |

## 使用

安装并重启后，进入任意会话，左侧即是「历史索引」：

- **节点行**：每个逻辑节点对应一轮对话，显示摘要；行尾「续写」按钮在鼠标悬停时出现。
- **跳转**：点击节点行，聊天流自动滚动到该轮（目标在未加载的历史里时自动加载更早
  内容；目标无独立气泡时定位到邻近内容；失败会给出原因提示）。
- **续写**：悬停节点行，点「续写」，从该节点 fork 出子会话并自动打开。
- **分叉切换**：有分叉的节点行首显示数字角标，点击展开共享会话下拉（子会话摘要 +
  切换），可跳去任意分支查看/续写。
- **拖宽 / 折叠**：拖动左栏右缘调整宽度（240–480px）；点左栏右上角 `<-` 折叠，
  折叠后点对话区左上角的 `->` 展开。宽度与折叠状态会被记住。

## 配置

插件配置通过 profile 的用户层 patch（`$DSH_HOME/profiles/<name>/cordis.patch.yml`）
覆盖。可配置项：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否启用插件 |
| `label` | `dsh-trail` | 日志与标识前缀 |

示例（覆盖同 id 行时需要写全其余字段）：

```yaml
- id: dsh-trail-plugin
  name: dsh-trail-plugin
  config:
    enabled: true
    label: my-trail
```

## 工作原理（摘要）

会话事件日志（唯一事实来源，只读）→ host 投影单元折叠为每会话节点树 → 官方投影
缓存持久化 → 浏览器端左栏读取并渲染。插件不改写任何会话数据，续写走 DSH 官方
`sessions.fork` 接口。架构细节见 [DESIGN.md](DESIGN.md)。

## 常见问题

- **刷新后左栏"消失"了？** 多半是处于折叠态：折叠按钮是一个贴在对话区左上角的
  `->` 半圆，点击即展开（折叠态会被记住）。
- **点击跳转提示「聊天视图未激活」？** 当前在 Trajectory 等非聊天视图，手动切回
  「对话」视图再试。
- **提示「目标节点未加载或不存在（可能已压缩）」？** 该轮内容已被官方压缩清理，
  无法定位到独立气泡，会尝试定位到邻近内容。
- **提示「加载历史超时」？** 历史过深（数千条），可重试。
- **某些旧会话没有索引？** 只有 `session.jsonl.zstd` 压缩日志的极旧会话不在补齐
  范围内；有 `log.jsonl` 的会话均会补齐。
- **会不会改动我的会话数据？** 不会。插件只读事件日志，写路径只有官方
  `sessions.fork`（创建新会话）。

## 开发者

开发、测试、挂载验证与发布流程见 [DEVELOPMENT.md](DEVELOPMENT.md)；架构与设计取舍
见 [DESIGN.md](DESIGN.md)。常用命令：

```bash
pnpm install           # 安装依赖
pnpm verify            # typecheck + 测试 + 构建 一条龙
./scripts/smoke.sh     # 挂载验证（独立 trail-test profile 启动 DSH）
```

## License

MIT
