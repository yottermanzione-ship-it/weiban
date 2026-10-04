// dependency-cruiser 配置：检查服务器模块之间的循环依赖。规则本体在 @weiban/eslint-config，这里只引用。
// 运行：pnpm lint:deps（pnpm lint 会一起运行）。
export { default } from '@weiban/eslint-config/dependency-cruiser';
