-- 0084_builtin_pet_species.sql
-- 换壳 UI 批次（docs/refactor/02 第 6.5 节）：系统自带宠物图鉴，3 物种 × 3 外观，默认上架。
-- 插画是占位：media.objects 行的 storage_key 以 builtin/ 开头，内容由服务器现场画出（media/application/builtin-art.ts），
-- 不在对象存储里。管理员可在后台改名、换图（上传正式插画后改外观的 imageMediaIds）、下架。已存在则跳过。
--> statement-breakpoint
INSERT INTO "media"."objects" ("id", "owner_id", "purpose", "mime_type", "size_bytes", "width", "height", "storage_key", "state", "created_at")
VALUES
  ('5e7a0000-0000-4000-8000-000000000111', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/cat-1-baby.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000112', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/cat-1-junior.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000113', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/cat-1-adult.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000121', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/cat-2-baby.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000122', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/cat-2-junior.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000123', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/cat-2-adult.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000131', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/cat-3-baby.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000132', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/cat-3-junior.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000133', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/cat-3-adult.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000211', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/dog-1-baby.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000212', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/dog-1-junior.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000213', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/dog-1-adult.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000221', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/dog-2-baby.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000222', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/dog-2-junior.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000223', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/dog-2-adult.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000231', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/dog-3-baby.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000232', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/dog-3-junior.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000233', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/dog-3-adult.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000311', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/rabbit-1-baby.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000312', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/rabbit-1-junior.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000313', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/rabbit-1-adult.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000321', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/rabbit-2-baby.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000322', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/rabbit-2-junior.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000323', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/rabbit-2-adult.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000331', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/rabbit-3-baby.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000332', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/rabbit-3-junior.svg', 'ready', now()),
  ('5e7a0000-0000-4000-8000-000000000333', NULL, 'pet_art', 'image/svg+xml', 2048, 256, 256, 'builtin/pet/rabbit-3-adult.svg', 'ready', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "growth"."pet_species" ("id", "name", "intro", "preset_names", "listed", "created_at", "updated_at")
VALUES
  ('5e7a0000-0000-4000-8000-000000000001', '小猫', '软乎乎的小猫，喜欢晒太阳和被摸下巴。', ARRAY['团子','咪咪','橘子','奶糖','芝麻','年糕']::text[], true, now(), now()),
  ('5e7a0000-0000-4000-8000-000000000002', '小狗', '黏人的小狗，见到你就摇尾巴。', ARRAY['豆豆','旺财','可乐','布丁','馒头','球球']::text[], true, now(), now()),
  ('5e7a0000-0000-4000-8000-000000000003', '小兔', '安静的小兔子，爱吃胡萝卜，耳朵会动。', ARRAY['雪球','棉花','小白','糯米','奶茶','跳跳']::text[], true, now(), now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "growth"."pet_appearances" ("id", "species_id", "name", "baby_media_id", "junior_media_id", "adult_media_id", "sort_order", "listed", "created_at")
VALUES
  ('5e7a0000-0000-4000-8000-000000000011', '5e7a0000-0000-4000-8000-000000000001', '橘猫', '5e7a0000-0000-4000-8000-000000000111', '5e7a0000-0000-4000-8000-000000000112', '5e7a0000-0000-4000-8000-000000000113', 0, true, now()),
  ('5e7a0000-0000-4000-8000-000000000012', '5e7a0000-0000-4000-8000-000000000001', '奶牛猫', '5e7a0000-0000-4000-8000-000000000121', '5e7a0000-0000-4000-8000-000000000122', '5e7a0000-0000-4000-8000-000000000123', 1, true, now()),
  ('5e7a0000-0000-4000-8000-000000000013', '5e7a0000-0000-4000-8000-000000000001', '三花猫', '5e7a0000-0000-4000-8000-000000000131', '5e7a0000-0000-4000-8000-000000000132', '5e7a0000-0000-4000-8000-000000000133', 2, true, now()),
  ('5e7a0000-0000-4000-8000-000000000021', '5e7a0000-0000-4000-8000-000000000002', '柴犬', '5e7a0000-0000-4000-8000-000000000211', '5e7a0000-0000-4000-8000-000000000212', '5e7a0000-0000-4000-8000-000000000213', 0, true, now()),
  ('5e7a0000-0000-4000-8000-000000000022', '5e7a0000-0000-4000-8000-000000000002', '小白狗', '5e7a0000-0000-4000-8000-000000000221', '5e7a0000-0000-4000-8000-000000000222', '5e7a0000-0000-4000-8000-000000000223', 1, true, now()),
  ('5e7a0000-0000-4000-8000-000000000023', '5e7a0000-0000-4000-8000-000000000002', '黑白狗', '5e7a0000-0000-4000-8000-000000000231', '5e7a0000-0000-4000-8000-000000000232', '5e7a0000-0000-4000-8000-000000000233', 2, true, now()),
  ('5e7a0000-0000-4000-8000-000000000031', '5e7a0000-0000-4000-8000-000000000003', '白兔', '5e7a0000-0000-4000-8000-000000000311', '5e7a0000-0000-4000-8000-000000000312', '5e7a0000-0000-4000-8000-000000000313', 0, true, now()),
  ('5e7a0000-0000-4000-8000-000000000032', '5e7a0000-0000-4000-8000-000000000003', '灰兔', '5e7a0000-0000-4000-8000-000000000321', '5e7a0000-0000-4000-8000-000000000322', '5e7a0000-0000-4000-8000-000000000323', 1, true, now()),
  ('5e7a0000-0000-4000-8000-000000000033', '5e7a0000-0000-4000-8000-000000000003', '奶茶兔', '5e7a0000-0000-4000-8000-000000000331', '5e7a0000-0000-4000-8000-000000000332', '5e7a0000-0000-4000-8000-000000000333', 2, true, now())
ON CONFLICT DO NOTHING;
