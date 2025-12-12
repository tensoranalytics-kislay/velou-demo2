# Unused Files Audit Report

This document lists files that can be safely removed from the repository without affecting the pipeline or breaking the code.

## Summary

**Total files that can be removed: 30+ files**

---

## 1. Unused Components (2 files)

### `src/components/Chat/PageTypeSimulator.tsx`
- **Status**: Not imported or used anywhere in the codebase
- **Reason**: Component exists but is never referenced
- **Safe to remove**: ✅ Yes

### `src/components/Admin/` (empty directory)
- **Status**: Empty directory
- **Reason**: No files in this directory
- **Safe to remove**: ✅ Yes

---

## 2. Legacy API Route (1 file)

### `src/app/api/assistant/route.ts`
- **Status**: Not used by frontend
- **Reason**: Frontend uses `/api/assistant/stream` instead. This non-streaming endpoint is never called.
- **Note**: However, it might be kept for backward compatibility or external API consumers. **Review before removing.**
- **Safe to remove**: ⚠️ Review first (might be used by external consumers)

---

## 3. Debug/Test Scripts (3 files)

### `scripts/assistantSmoke.ts`
- **Status**: Not referenced in package.json
- **Reason**: Standalone test script, not part of npm scripts
- **Safe to remove**: ✅ Yes (unless used manually for testing)

### `scripts/test-orchestrator-refactor.ts`
- **Status**: Not referenced in package.json
- **Reason**: One-time test script for refactoring verification
- **Safe to remove**: ✅ Yes

### `debug/llm_constraints_test.ts`
- **Status**: Debug file in debug/ directory
- **Reason**: Temporary debug script, not part of main codebase
- **Safe to remove**: ✅ Yes

---

## 4. Historical Documentation Files (18 files)

These are old changelogs, implementation summaries, and fix documentation that are no longer needed:

### Root-level documentation:
- `AUDIT_INDUSTRY_AGNOSTIC.md` - Historical audit document
- `BUG_FIXES_SUMMARY.md` - Old bug fix summary
- `CAROUSEL_LAYOUT_DOCUMENTATION.md` - Historical documentation
- `CHANGELOG_DISCOVERY_FIXES.md` - Old changelog
- `CHANGELOG_DISCOVERY_PIPELINE.md` - Old changelog
- `DATASET_CONTEXT_FLOW.md` - Historical flow documentation
- `DIAGNOSIS_AND_FIXES.md` - Old diagnosis document
- `DISCOVERY_FIXES_PLAN.md` - Old plan document
- `DISCOVERY_ROBUSTNESS_IMPLEMENTATION.md` - Historical implementation doc
- `GENDER_RANKING_FIXES.md` - Old fix documentation
- `IMPLEMENTATION_SUMMARY.md` - Historical summary
- `ORCHESTRATOR_REFACTOR_VERIFICATION.md` - Old verification doc
- `PENDING_SUGGESTION_FIX.md` - Old fix documentation
- `PIPELINE_DOCUMENTATION.md` - **KEEP** - Contains useful pipeline documentation (review first)
- `SEARCH_REFACTOR_SUMMARY.md` - Old summary
- `TAXONOMY_AWARE_PROMPT_UPDATE.md` - Old update doc
- `VELOU_ROUTER_IMPLEMENTATION.md` - Historical implementation doc

**Note**: `PIPELINE_DOCUMENTATION.md` might contain useful information - review before removing.

### Docs directory:
- `docs/catalog_ingestion_v1.md` - Old version documentation (if v2 exists)
- `docs/db-debug-product-new-column.md` - Debug documentation for resolved issue
- `docs/llm_model_selection.md` - **KEEP** - Referenced in README.md

**Safe to remove**: ✅ Most of them (except `PIPELINE_DOCUMENTATION.md` and `docs/llm_model_selection.md` which are referenced)

---

## 5. Unused Assets (7+ files)

### Public directory:
- `public/lucky-brand-logo.png` - Old brand logo (replaced by uploaded logos)
- `public/lucky-brand-logo.svg` - Old brand logo (replaced by uploaded logos)
- `public/file.svg` - Not referenced anywhere
- `public/globe.svg` - Not referenced anywhere
- `public/next.svg` - Default Next.js logo (not used)
- `public/vercel.svg` - Default Vercel logo (not used)
- `public/window.svg` - Not referenced anywhere

### Root directory:
- `Velou_Wordmark_Black_1080px.webp` - Not referenced in code
- `image.png` - Not referenced in code

**Safe to remove**: ✅ Yes (unless these are used for branding/marketing purposes)

---

## 6. Old CSV Files (2 files)

### Root directory:
- `loccitane_unified_catalog.csv` - Old catalog file (if not needed for reference)
- `products_2025-11-20_10:52:20.csv` - Old catalog file (if not needed for reference)

**Note**: These might be kept for reference or testing. Review before removing.
**Safe to remove**: ⚠️ Review first (might be used for testing/reference)

---

## 7. Test Files (Review - Some may be outdated)

### Gender-related tests (if gender filtering is no longer a feature):
These test files test gender extraction/filtering functionality. Since gender filtering is still in the codebase (used in search), these tests are likely still relevant:

- `tests/detectGenderTokens.test.ts` - **KEEP** - Tests active functionality
- `tests/gender_extraction.test.ts` - **KEEP** - Tests active functionality
- `tests/gender_and_ranking.test.ts` - **KEEP** - Tests active functionality
- `tests/gender_plumbing.test.ts` - **KEEP** - Tests active functionality
- `tests/orchestrator_gender_merge.test.ts` - **KEEP** - Tests active functionality
- `tests/relaxation_gender_persistence.test.ts` - **KEEP** - Tests active functionality
- `tests/dbRankedSearch_genderFilter.test.ts` - **KEEP** - Tests active functionality

**Note**: Gender filtering is still actively used in the codebase, so these tests should be kept.

---

## 8. Scripts (Review)

### `scripts/importCatalogFromCsv.ts`
- **Status**: Referenced in package.json as `seed:catalog`
- **Reason**: Used for catalog ingestion via npm script
- **Safe to remove**: ❌ **NO** - This is actively used

---

## Files to Keep (Important)

These files might seem unused but are actually important:

1. **`src/lib/llm/orchestrator.ts`** - Re-export file, used as import path throughout codebase
2. **`src/app/api/assistant/route.ts`** - Might be used by external consumers (review first)
3. **`PIPELINE_DOCUMENTATION.md`** - Referenced in README, contains useful documentation
4. **`docs/llm_model_selection.md`** - Referenced in README
5. **All test files** - Keep for test coverage
6. **`scripts/importCatalogFromCsv.ts`** - Used via npm script

---

## Recommended Action Plan

### Phase 1: Safe to Remove Immediately
1. `src/components/Chat/PageTypeSimulator.tsx`
2. `src/components/Admin/` (empty directory)
3. `scripts/assistantSmoke.ts`
4. `scripts/test-orchestrator-refactor.ts`
5. `debug/llm_constraints_test.ts`
6. Most historical documentation files (except those referenced in README)
7. Unused SVG/image files in public/

### Phase 2: Review Before Removing
1. `src/app/api/assistant/route.ts` - Check if external consumers use it
2. `PIPELINE_DOCUMENTATION.md` - Review if it contains useful info
3. Old CSV files - Check if needed for testing/reference
4. Old logo files - Check if needed for branding

### Phase 3: Keep
1. All test files (they test active functionality)
2. `scripts/importCatalogFromCsv.ts` (used via npm script)
3. `src/lib/llm/orchestrator.ts` (re-export file, used for imports)
4. Documentation referenced in README

---

## Estimated Space Savings

- Components: ~1-2 KB
- Scripts: ~5-10 KB
- Documentation: ~200-300 KB
- Assets: ~500 KB - 2 MB (depending on image sizes)
- **Total**: ~700 KB - 2.3 MB

---

## Notes

- Always test after removing files to ensure nothing breaks
- Consider moving historical documentation to a `docs/archive/` folder instead of deleting
- Keep a backup before bulk deletion
- Review git history if unsure about a file's purpose


