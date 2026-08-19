-- =============================================================================
-- 0011_food_source_search.sql — a source for reference-database lookups.
--
-- USDA FoodData Central results were being written as 'manual', which is not
-- true: 'manual' means the numbers were typed in by hand, and these were
-- looked up and scaled from a measured reference value. The distinction is the
-- same one rule 6 is about — being able to tell later which numbers were
-- chosen, which were guessed, and which were read off a reference.
--
-- 'barcode' already covers Open Food Facts. This covers the unbranded side.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds
-- it, so nothing here writes a row with the new value. The application starts
-- using it on the next deploy.
-- =============================================================================

alter type public.food_source add value if not exists 'search';
