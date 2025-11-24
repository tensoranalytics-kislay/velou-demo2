# Product Carousel Layout Documentation

## Current Layout (Before Compact Changes)

### Component Location
- **File**: `src/components/ProductCarousel/ProductCarousel.tsx`
- **Type**: React client component with horizontal scroll carousel

### Current Card Dimensions
- **Mobile**: `w-[320px]` (320px width)
- **Small screens**: `sm:w-[360px]` (360px width)
- **Desktop**: `md:w-[380px]` (380px width)
- **Padding**: `p-5` (20px all sides)
- **Border radius**: `rounded-3xl` (24px)
- **Gap between cards**: `gap-6` (24px)

### Current Image Dimensions
- **Container padding**: `p-4` (16px)
- **Image height**: `h-[260px]` (260px fixed height)
- **Aspect ratio**: Fixed height, width 100%

### Current Typography
- **Title**: `text-base` (16px), `font-semibold`
- **Price (regular)**: `text-base` (16px), `font-semibold`
- **Price (strike-through)**: `text-xs` (12px)
- **Reason text**: `text-xs` (12px)
- **Query chips**: `text-[11px]`, `px-3 py-1`
- **Attribute chips**: `text-[11px]`, `px-2.5 py-0.5`

### Current CTA Button
- **Width**: `w-full` (full width)
- **Padding**: `px-3 py-2.5` (12px horizontal, 10px vertical)
- **Font**: `text-sm` (14px), `font-semibold`
- **Height**: ~40px (from padding)

### Current Carousel Behavior
- **Scroll container**: `overflow-x-auto`, `snap-x snap-mandatory`
- **Cards per view**: 1 card visible on mobile, ~1.2 on tablet, ~1.3 on desktop
- **Scroll snap**: `snap-start` on each card
- **Arrow buttons**: `p-3` (12px padding), `h-4 w-4` icons

## Target Compact Layout (After Changes)

### Target Card Dimensions
- **Mobile**: `min-w-[70vw]` (70% viewport width, ~1.3-1.6 cards visible)
- **Tablet**: `min-w-[45vw]` (45% viewport width, ~2 cards visible)
- **Desktop**: `min-w-[220px]` to `min-w-[260px]` (3-4 cards visible)
- **Padding**: `p-3` (12px all sides) - 40% reduction
- **Border radius**: Keep `rounded-3xl` (no change)
- **Gap between cards**: `gap-3` or `gap-4` (12-16px) - 33-50% reduction

### Target Image Dimensions
- **Container padding**: `p-2` or `p-2.5` (8-10px) - 40-50% reduction
- **Image height**: `h-[140px]` to `h-[160px]` (40-45% reduction from 260px)
- **Aspect ratio**: Consider `aspect-square` or `aspect-[4/5]` for consistency

### Target Typography
- **Title**: `text-sm` (14px) or `text-[13px]`/`text-[14px]`, `line-clamp-2`
- **Price (regular)**: `text-sm` (14px), `font-semibold`
- **Price (strike-through)**: `text-xs` (12px) - no change
- **Reason text**: `text-xs` (12px) - no change, or hide on smallest screens
- **Query chips**: `text-[11px]` or `text-[12px]`, `px-2 py-0.5` (tighter)
- **Attribute chips**: `text-[11px]`, `px-2 py-0.5` (tighter)

### Target CTA Button
- **Width**: Keep `w-full` or make more compact
- **Height**: `h-8` (32px) - 20% reduction
- **Padding**: `px-3 py-1.5` (12px horizontal, 6px vertical)
- **Font**: `text-sm` (14px) - no change

### Target Carousel Behavior
- **Scroll container**: Same (`overflow-x-auto`, `snap-x snap-mandatory`)
- **Cards per view**: 
  - Mobile: 1+ cards with next card peeking (~1.3-1.6 visible)
  - Desktop: 3-4 cards visible without scrolling
- **Arrow buttons**: Smaller (`p-2` or `p-2.5`), `h-3 w-3` icons

## Size Reduction Summary

| Element | Current | Target | Reduction |
|---------|---------|--------|-----------|
| Card width (desktop) | 380px | 220-260px | 32-42% |
| Card padding | 20px | 12px | 40% |
| Image height | 260px | 140-160px | 38-46% |
| Title font | 16px | 13-14px | 12-19% |
| Gap between cards | 24px | 12-16px | 33-50% |
| Button height | ~40px | 32px | 20% |

## Test Coverage

Tests are in `tests/product_carousel_compact_layout.test.tsx`:
- T1: Carousel layout (horizontal scroll, multi-card view, snap)
- T2: Card compactness (reduced width, reduced padding)
- T3: Content scaling (typography, chips, button, image)
- T4: Carousel gap and spacing

5 tests currently failing (as expected) - will pass after implementation.

