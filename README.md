# dsh-trail

DeepSeek Harness（DSH）插件开发工程（骨架阶段，功能待定）。

## 这是什么

一个贴合 DSH 惯例的 Cordis 插件工程骨架：

- **Host 半区**（`src/index.ts`）：插件默认入口，演示配置注入、核心服务与可逆副作用；
- **Client 半区**（`src/client.ts`）：经 `exports["./client"]` 导出，演示「可选服务」读取模式；
- **纯逻辑层**（`src/options.ts` / `src/lib.ts`）：与平台无关、可直接单测；
- **挂载示例**（`cordis.yml`）：展示插件如何作为组合行进入 DSH 组合。

## 目录结构

```text
.
├── cordis.yml            # 组合行示例（dsh web --patch / agent preset 用）
├── package.json          # 包声明：exports["./client"]、dsh.client（platform: web）
├── tsconfig.json         # strict + NodeNext ESM
├── vitest.config.ts
├── src/
│   ├── index.ts          # Host 插件入口（name / Config / apply）
│   ├── client.ts         # Client 插件入口（./client 子路径）
│   ├── options.ts        # 配置：类型 + schemastery Schema + normalizeOptions
│   └── lib.ts            # 纯业务逻辑占位
└── tests/
    ├── options.test.ts
    ├── lib.test.ts
    └── plugin-shape.test.ts   # 插件形状 + cordis.yml 结构校验
```

## 常用命令

```bash
pnpm install     # 安装依赖
pnpm typecheck   # 类型检查
pnpm test        # 跑单测
pnpm build       # 构建到 lib/
pnpm verify      # 类型检查 + 测试 + 构建 一条龙
```

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
3. 将 `cordis.yml` 落到实际部署：
   - 开发期：把包 link 进 DSH 的 `node_modules`，用 `dsh web --patch cordis.yml` 挂载验证；
   - 发布期：发布到 npm 后按 `name` 直接引用。
4. 需要 React UI 时再引入 `react`（DSH web 用 React 18）与 `@types/react`。
