# dsh-trail

DeepSeek Harness（DSH）插件开发工程：Session Tree / History Index
（给线性 Session 加上可索引、可跳转、可分叉的导航层，见 `DESIGN.md`）。

## 这是什么

一个贴合 DSH 惯例的 Cordis 插件工程（M1：数据链路已接通）：

- **Host 半区**（`src/index.ts`）：注册 `history` 投影单元，把每个会话的
  SessionEvent 折叠为节点树；
- **Client 半区**（`src/client.ts`）：经 `exports["./client"]` 导出，注册
  `shell.overlay` 的真左栏（浮动列 + 内容让位 + 拖宽/记忆 + 行内跳转 +
  fork 续写 + 谱系角标/下拉），经会话列表行投影 `projectionValues.history`
  读取完整索引；
- **纯逻辑层**（`src/history/`）：事件折叠、摘要、类型（与平台无关、可直接单测）；
- **bundle 安装形态**（`cordis.patch.yml`）：包声明 `dsh.bundle.patch`，
  `dsh plugin add` 后自动进 profile 的 bundles 层，组合行随 boot 插入，
  不再需要手工 patch；

## 目录结构

```text
.
├── cordis.patch.yml      # bundle 层：dsh plugin add 安装后自动插入的组合行
├── package.json          # 包声明：name、exports["./client"]、dsh.bundle + dsh.client（platform: web）
├── tsconfig.json         # strict + NodeNext ESM
├── vitest.config.ts
├── scripts/
│   ├── build-client.mjs  # esbuild 打包 client → 浏览器模块加载器 handoff
│   └── smoke.sh          # 挂载验证（独立 trail-test profile 启动 DSH）
├── src/
│   ├── index.ts          # Host 插件入口：注册 history 投影单元
│   ├── client.ts         # Client 插件入口（./client 子路径，factory(require)）
│   ├── history/
│   │   ├── types.ts      # 节点树共享类型（host 折叠 + client 渲染）
│   │   ├── text.ts       # 摘要/文本提取工具（纯函数）
│   │   ├── fold.ts       # 事件折叠：SessionEvent → 节点树（纯 reducer）
│   │   └── schema.ts     # zod schema（host 侧，校验 view 输出）
│   ├── options.ts        # 配置：类型 + schemastery Schema + normalizeOptions
│   └── lib.ts            # 纯业务逻辑占位
└── tests/
    ├── history-fold.test.ts    # 事件折叠单测（turn 分组/摘要/fork 边界）
    ├── host-projection.test.ts # host 投影单元注册与折叠
    ├── client.test.ts          # client bundle factory + 视图渲染
    ├── options.test.ts
    ├── lib.test.ts
    └── plugin-shape.test.ts    # 插件形状 + bundle 安装形态（patch/声明）校验
```

## 数据链路（M1，官方投影通道）

```
SessionEvent 日志（唯一事实来源，只读）
  → host 投影单元 fold.ts 折叠为 per-session 节点树
  → 官方投影缓存持久化（$DSH_HOME/storages/session_projcache.json）
  → client 会话列表行投影 projectionValues.history 读取完整索引（不受对话窗口限制，重启恢复）
```

节点：`nodeKey`（turn）/ `parentKey`（树边）/ `boundarySeq`（turn/end seq，安全
fork 边界）/ kind / 摘要 / 内联文本（有界）。交互：点击节点行内跳转查看
（超出窗口自动翻页兜底），可续写节点提供「续写」（`sessions.fork` +
`sessions.open`），分叉节点行首数字展开共享会话下拉。

## 常用命令

```bash
pnpm install     # 安装依赖
pnpm typecheck   # 类型检查
pnpm test        # 跑单测
pnpm build       # tsc 构建 + esbuild 打 client bundle（lib/client.js）
pnpm verify      # 类型检查 + 测试 + 构建 一条龙
```

## 发布到 npm

包形态已就绪（`main`/`exports["./client"]`/`types` 指向 `lib/`，`files` 只含
`lib` + `cordis.patch.yml` + LICENSE，`dsh.bundle` 声明让 `dsh plugin add` 安装
后自动进 bundles 层）。`prepublishOnly` 会在发布前自动跑 `pnpm verify`，保证
`lib/`（gitignored）始终是新的。

```bash
# 一次性：登录 npm（需要有 npm 账号）
npm login            # 或 pnpm login

# 每次发版：
pnpm version patch   # 或 minor / major；也可手改 package.json
pnpm publish         # 先自动 pnpm verify（typecheck + 测试 + build），再打包上传
git push --tags
```

发布前可先用 `pnpm pack` 生成 `dsh-trail-plugin-<version>.tgz` 检查包内容
（`npm pack --dry-run` 只列出不生成）。包名 `dsh-trail-plugin` 已在 npm 确认可用。

用户侧安装（与本地路径安装同一机制，只是从 registry 取预构建产物）：

```bash
dsh plugin --profile <name> add dsh-trail-plugin        # 从 npm
dsh plugin --profile <name> add ./dsh-trail-plugin-0.1.0.tgz   # 从 tarball（无网络场景）
```

> git 安装（`add github:<owner>/<repo>`）会拿到源码而不是构建产物，需要包内
> `prepare` 脚本（已有：`pnpm build`）且用户侧在 profile 的
> `pnpm-workspace.yaml` 放行 `allowBuilds`——优先走 npm/tarball 分发预构建产物。

## 挂载验证（smoke test）

单测只能证明代码正确，**证明「DSH 启动时真的加载到了本插件」**要靠真实启动：

```bash
./scripts/smoke.sh
```

脚本做五件事（`DSH_BIN` / `DSH_HOME` / `PROFILE` 均可通过环境变量覆盖；
容器内 dsh 必须以源码方式运行，默认 `pnpm --dir /app dsh`）：

1. `pnpm build` 构建插件；
2. `dsh plugin --profile trail-test add .` 以 **bundle 形态**装进独立测试
   profile（默认 `trail-test`，与正式 GUI 的 `web` profile 隔离）——包声明
   `dsh.bundle`，安装后自动进 `dsh.profile.bundles`，组合行由 bundle 层插入，
   **无需手工写 profile 的 patch**；脚本只补 bundle 层不提供的 storage 栈与
   console logger（web profile 里这些行来自 web-app bundle）；
3. `dsh --profile trail-test --dump-config` 断言组合里恰好有一个
   `id: dsh-trail-plugin` 行（来源为 `# == dsh-trail-plugin` bundle 层）；
4. 启动 DSH 抓启动日志，断言出现
   `hello world from dsh-trail-plugin (host)`。

启动日志形如：

```text
[I] dsh-trail [dsh-trail] hello world from dsh-trail-plugin (host)
```

`ctx.logger('dsh-trail')` 的命名空间是日志第一段，`[dsh-trail]` 是配置里的
`label` 前缀——说明 `config`（`enabled: true, label: dsh-trail`）被正确注入。

> 要把插件挂进正式 GUI（`web` profile，即本机 3080 端口那个）：
> `dsh plugin --profile web add <本仓库路径>`（或 `add link:/绝对路径`），
> 确认 `--dump-config` 出现 bundle 层行，然后重启 GUI。
> 重启会中断当前会话，开发期建议先用 `trail-test` profile 验证。

## 骨架遵循的 DSH 约定

| 项 | 约定 | 依据 |
| --- | --- | --- |
| 包形态 | ESM，`main: lib/index.js`，`exports` 带 `./client` 子路径 | DSH 各包（如 `@deepseek-ai/dsh-client-modules`） |
| 插件形状 | 具名导出 `name` / `Config` / `apply(ctx, config)` | 如 `@deepseek-ai/dsh-hooks-claude-code` |
| 配置校验 | schemastery `z.object({...})`，`z<Options>` 标注 | 同上 |
| Client 声明 | package.json `dsh.client: { platform: "web", ... }` | `packages/client/modules` 扫描逻辑 |
| 日志 | `ctx.logger('name')`，核心服务无需 inject | cordis 4 核心混入 |
| 副作用 | `ctx.effect(() => () => {})` 保证停止/更新时清理 | cordis 4 Fiber |

## 下一步（选定功能后）

1. 在 `src/index.ts`（Host）或 `src/client.ts`（Client）填入真正的功能；
   Host 侧可用 `cordis_inspect_query` 确认 Service / Event / Tool 接口后再写；
   Client 侧先 `Slots.listSubTree` 选定目标 Slot，再 `slots.inject` + `slots.register`。
2. 把新增纯逻辑放进 `src/lib.ts`（或拆分模块）并补单测。
3. 挂载验证用 `./scripts/smoke.sh`（独立 `trail-test` profile）；
   确认要进正式 GUI 时再装进 `web` profile 并重启。
4. 需要 React UI 时再引入 `react`（DSH web 用 React 18）与 `@types/react`。
