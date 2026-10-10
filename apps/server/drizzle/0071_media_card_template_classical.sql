-- 0071（契约 3.1，积压 ㉓）：卡面模板「古风插画」标记（GRW-05 第 2 条）。
ALTER TABLE "media"."card_templates" ADD COLUMN IF NOT EXISTS "classical_style" boolean NOT NULL DEFAULT false;
