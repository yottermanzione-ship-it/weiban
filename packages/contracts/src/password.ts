import { z } from 'zod';

/** 新密码统一规则，独立于身份与管理接口，避免它们相互导入。 */
export const Password = z.string().min(8).max(128);
