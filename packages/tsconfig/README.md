# @weiban/tsconfig · 共享 TypeScript 配置

负责人：运维负责人。规则依据 `docs/architecture/engineering-standards.md` 第 1 节（`strict: true`、禁止 `any`）。

| 文件         | 给谁用                                                                            |
| ------------ | --------------------------------------------------------------------------------- |
| `base.json`  | 所有 TypeScript 子项目的公共底座：严格模式、ESM、Bundler 解析、只做类型检查不输出 |
| `node.json`  | 服务器、脚本、配置包（带 Node 类型）                                              |
| `react.json` | 网页、管理后台（带 DOM 类型和 JSX）                                               |

用法（在子项目的 `tsconfig.json` 里）：

```json
{
  "extends": "@weiban/tsconfig/node.json",
  "include": ["src"]
}
```

并在子项目 `package.json` 的 `devDependencies` 加 `"@weiban/tsconfig": "workspace:*"`。

需要输出 JS 的子项目（例如服务器构建）在自己的配置里覆盖 `noEmit`、`outDir`；NestJS 需要的装饰器选项（`experimentalDecorators`、`emitDecoratorMetadata`）由后端负责人在 `apps/server` 里自行开启，不放进共享底座。
