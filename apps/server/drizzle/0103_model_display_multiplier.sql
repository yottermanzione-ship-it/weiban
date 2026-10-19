-- 会员 v5（16 号 §2.1）：模型展示倍率。NULL = 按「(0.8×输入售价 + 0.2×输出售价) / 基准模型同算式」自动计算；只展示，不参与扣费。
ALTER TABLE model_access.model_catalog ADD COLUMN display_multiplier double precision,
  ADD CONSTRAINT model_catalog_display_multiplier_range CHECK (display_multiplier IS NULL OR (display_multiplier >= 0 AND display_multiplier <= 1000));
