-- 0090 回退：删除官方角色点赞评论、角色制作申请与 plaza 设置表。
DROP TABLE IF EXISTS "plaza"."settings";
--> statement-breakpoint
DROP TABLE IF EXISTS "plaza"."role_requests";
--> statement-breakpoint
DROP TABLE IF EXISTS "plaza"."official_comments";
--> statement-breakpoint
DROP TABLE IF EXISTS "plaza"."official_likes";
