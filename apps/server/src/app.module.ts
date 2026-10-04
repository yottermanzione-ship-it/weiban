/**
 * 装配入口：唯一允许 import 所有模块的地方（repo-structure.md 第 3 节）。
 * 新增业务模块时：先在 packages/eslint-config/architecture.js 登记层级，再把模块类加到 imports。
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { PlatformModule, type PlatformOptions } from './platform/index.js';

@Module({})
export class AppModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(options),
        // 业务模块从 D-L0-06 起加入，例如 IdentityModule、BillingModule……
      ],
    };
  }
}
