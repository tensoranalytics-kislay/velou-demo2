-- Enriched dataset integration: add indexed attributes to Product

-- Fit & Construction
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "silhouetteCut" TEXT,
  ADD COLUMN IF NOT EXISTS "length" TEXT,
  ADD COLUMN IF NOT EXISTS "sleeve" TEXT,
  ADD COLUMN IF NOT EXISTS "neckline" TEXT,
  ADD COLUMN IF NOT EXISTS "closureConstruction" TEXT,
  ADD COLUMN IF NOT EXISTS "lined" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "fitPreference" TEXT,
  ADD COLUMN IF NOT EXISTS "riseWaist" TEXT,
  ADD COLUMN IF NOT EXISTS "stretchLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "bodyIntent" TEXT,
  ADD COLUMN IF NOT EXISTS "comfortIntent" TEXT,

  -- Fabric Properties
  ADD COLUMN IF NOT EXISTS "fabricFamily" TEXT,
  ADD COLUMN IF NOT EXISTS "handfeel" TEXT,
  ADD COLUMN IF NOT EXISTS "warmthWeight" TEXT,
  ADD COLUMN IF NOT EXISTS "breathability" TEXT,
  ADD COLUMN IF NOT EXISTS "opacity" TEXT,
  ADD COLUMN IF NOT EXISTS "wrinkleBehavior" TEXT,

  -- Style & Occasion
  ADD COLUMN IF NOT EXISTS "formalityLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "occasionContext" TEXT[],
  ADD COLUMN IF NOT EXISTS "dressCode" TEXT,
  ADD COLUMN IF NOT EXISTS "seasonalCues" TEXT,

  -- Weather & Comfort
  ADD COLUMN IF NOT EXISTS "temperatureIntent" TEXT,
  ADD COLUMN IF NOT EXISTS "humidityFriendly" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "movementNeeds" TEXT,

  -- Problem-Solution
  ADD COLUMN IF NOT EXISTS "problemSolutions" TEXT[],
  ADD COLUMN IF NOT EXISTS "functionFeatures" TEXT[],

  -- Color Details
  ADD COLUMN IF NOT EXISTS "colorShade" TEXT,
  ADD COLUMN IF NOT EXISTS "colorUndertone" TEXT,
  ADD COLUMN IF NOT EXISTS "multicolor" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "seasonalPalette" TEXT,

  -- Inclusivity
  ADD COLUMN IF NOT EXISTS "inclusivitySizing" TEXT;

-- Indexes for new columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_silhouette_cut') THEN
    CREATE INDEX "idx_product_silhouette_cut" ON "Product" ("silhouetteCut");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_length') THEN
    CREATE INDEX "idx_product_length" ON "Product" ("length");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_sleeve') THEN
    CREATE INDEX "idx_product_sleeve" ON "Product" ("sleeve");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_neckline') THEN
    CREATE INDEX "idx_product_neckline" ON "Product" ("neckline");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_formality_level') THEN
    CREATE INDEX "idx_product_formality_level" ON "Product" ("formalityLevel");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_temperature_intent') THEN
    CREATE INDEX "idx_product_temperature_intent" ON "Product" ("temperatureIntent");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_humidity_friendly') THEN
    CREATE INDEX "idx_product_humidity_friendly" ON "Product" ("humidityFriendly");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_color_shade') THEN
    CREATE INDEX "idx_product_color_shade" ON "Product" ("colorShade");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_color_undertone') THEN
    CREATE INDEX "idx_product_color_undertone" ON "Product" ("colorUndertone");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_multicolor') THEN
    CREATE INDEX "idx_product_multicolor" ON "Product" ("multicolor");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_occasion_context') THEN
    CREATE INDEX "idx_product_occasion_context" ON "Product" USING GIN ("occasionContext");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_problem_solutions') THEN
    CREATE INDEX "idx_product_problem_solutions" ON "Product" USING GIN ("problemSolutions");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_function_features') THEN
    CREATE INDEX "idx_product_function_features" ON "Product" USING GIN ("functionFeatures");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_category_length_formality') THEN
    CREATE INDEX "idx_product_category_length_formality" ON "Product" ("category", "length", "formalityLevel");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_temperature_humidity') THEN
    CREATE INDEX "idx_product_temperature_humidity" ON "Product" ("temperatureIntent", "humidityFriendly");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_body_comfort') THEN
    CREATE INDEX "idx_product_body_comfort" ON "Product" ("bodyIntent", "comfortIntent");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_product_shade_undertone') THEN
    CREATE INDEX "idx_product_shade_undertone" ON "Product" ("colorShade", "colorUndertone");
  END IF;
END$$;

