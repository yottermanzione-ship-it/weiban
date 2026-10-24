/**
 * 集成测试入口：后台「彻底删除角色」要断言角色发的朋友圈被一起删掉，
 * 需要直接调用 MomentsService.createPost 造数据（R10 不允许测试引用模块内部文件）。
 */
export { MomentsService } from './application/moments.js';
