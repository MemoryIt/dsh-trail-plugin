# dsh-trail

DeepSeek Harness（DSH）插件开发工程：Session Tree / History Index
（给线性 Session 加上可索引、可跳转、可分叉的导航层，见 `DESIGN.md`）。

## 这是什么

一个贴合 DSH 惯例的 Cordis 插件工程（M1：数据链路已接通）：

- **Host 半区**（`src/index.ts`）：插件默认入口，演示配置注入、核心服务与可逆副作用；
- **Client 半区**（`src/client.ts`）：经 `exports["./client"]` 导出，注册
  `conversation.view` 的「历史索引」tab；M1 数据走官方 client 投影
  （ConversationSnapshot → `src/projection.ts` 派生逻辑节点），与
  ui-conversation 的 StatsLine 同构，天然实时、零轮询；
- **纯逻辑层**（`src/projection.ts` / `src/options.ts` / `src/lib.ts`）：
  与平台无关、可直接单测；
- **挂载示例**（`cordis.yml`）：展示插件如何作为组合行进入 DSH 组合。

## 目录结构

```text
.
├── cordis.yml            # 组合行示例（dsh web --patch / agent preset 用）
├── package.json          # 包声明：exports["./client"]、dsh.client（platform: web）
├── tsconfig.json         # strict + NodeNext ESM
├── vitest.config.ts
├── scripts/
│   ├── build-client.mjs  # esbuild 打包 client → 浏览器模块加载器 handoff
│   └── smoke.sh          # 挂载验证（独立 trail-test profile 启动 DSH）
├── src/
│   ├── index.ts          # Host 插件入口（name / Config / apply）
│   ├── client.ts         # Client 插件入口（./client 子路径，factory(require)）
│   ├── projection.ts     # 逻辑节点派生（纯函数：turn 分组 / 摘要 / fork 边界）
│   ├── options.ts        # 配置：类型 + schemastery Schema + normalizeOptions
│   └── lib.ts            # 纯业务逻辑占位
└── tests/
    ├── projection.test.ts    # 逻辑节点派生单测
    ├── client.test.ts        # client bundle factory + 视图渲染
    ├── options.test.ts
    ├── lib.test.ts
    └── plugin-shape.test.ts  # 插件形状 + cordis.yml 结构校验
```

## 常用命令

```bash
pnpm install     # 安装依赖
pnpm typecheck   # 类型检查
pnpm test        # 跑单测
pnpm build       # tsc 构建 + esbuild 打 client bundle（lib/client.js）
pnpm verify      # 类型检查 + 测试 + 构建 一条龙
```

## 挂载验证（smoke test）

单测只能证明代码正确，**证明「DSH 启动时真的加载到了本插件」**要靠真实启动：

```bash
DSH_BIN='node /app/apps/cli/lib/bin.js' ./scripts/smoke.sh
```

脚本做四件事（`DSH_BIN` / `DSH_HOME` / `PROFILE` 均可通过环境变量覆盖）：

1. `pnpm build` 构建插件；
2. 把插件和 `@deepseek-ai/cordis-plugin-logger-console` 装进独立测试 profile
   （默认 `trail-test`，与正式 GUI 的 `web` profile 隔离）；
3. 在 profile 的 `cordis.patch.yml` 里写入组合行
   （`- id: dsh-trail-plugin / name: '@deepseek-ai/dsh-trail-plugin'`）；
4. 启动 DSH 抓启动日志，断言出现
   `hello world from dsh-trail-plugin (host)`。

启动日志形如：

```text
[I] dsh-trail [dsh-trail] hello world from dsh-trail-plugin (host)
```

`ctx.logger('dsh-trail')` 的命名空间是日志第一段，`[dsh-trail]` 是配置里的
`label` 前缀——说明 `config`（`enabled: true, label: dsh-trail`）被正确注入。

> 要把插件挂进正式 GUI（`web` profile，即本机 3080 端口那个）：
> 把 `scripts/smoke.sh` 里的 `PROFILE` 换成 `web` 再跑，或手工
> `dsh plugin --profile web add <本仓库路径>` 并在
> `$DSH_HOME/profiles/web/cordis.patch.yml` 里加同样的行，然后重启 GUI。
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
