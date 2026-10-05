/** 在组合根传入角色读取提供方，保持 policy/characters 的源码依赖单向。 */
import { Global, Module, type DynamicModule, type Type } from '@nestjs/common';
import { PolicyService } from './application/policy.js';
import { POLICY_PORT, POLICY_CHARACTER_READ } from './tokens.js';
@Global()
@Module({})
export class PolicyModule {
  static forRoot(input: { imports: Type<unknown>[]; characterReadToken: symbol }): DynamicModule {
    return {
      module: PolicyModule,
      imports: input.imports,
      providers: [
        PolicyService,
        { provide: POLICY_CHARACTER_READ, useExisting: input.characterReadToken },
        { provide: POLICY_PORT, useExisting: PolicyService },
      ],
      exports: [POLICY_PORT],
    };
  }
}
