# Connected App Spacing Design

## Goal

Give SpotterAI's connected product surfaces a consistent, professional spacing system. Fix the cramped Dashboard panels shown in the reported screenshots and apply the same system to Progress, Nutrition, Quick Log, achievements, charts, and related empty states without changing the product's visual identity or architecture.

## Root cause

The shared `.card` primitive owns only surface styling: background, border, radius, and shadow. Most composite cards correctly provide their own internal layout, but `.dash-card` supplies only a vertical gap and no padding. As a result, card titles, charts, history rows, achievement tiles, and Nutrition content touch the card border. Quick Log is another direct `.card` consumer with the same missing inset.

The correction belongs in the connected product-card styles, not in the global `.card` primitive. Adding padding globally would alter specialized cards that intentionally manage their own edges.

## Chosen approach

Use a shared connected-card spacing system:

- Keep `.card` unchanged.
- Give `.dash-card` and Quick Log a consistent content inset.
- Keep the existing two-column dashboard structure, full-width achievement section, dark instrument-HUD identity, typography, colors, borders, and shadows.
- Refine the child layouts whose current spacing remains uneven after the shared inset is restored.
- Use only the existing 4px-based spacing tokens or values that align to that scale.

This approach fixes the underlying pattern across connected screens while avoiding a risky global card rewrite.

## Spacing system

- Connected-card inset: 24px above 600px; 16px at 600px and below.
- Connected-card title-to-content gap: 12px.
- Dashboard grid gutter: 24px above 960px and 16px at 960px and below.
- Inner control and text gaps: 8px for tightly related items; 12px for separate rows or groups.
- Achievement grid gap: 12px.
- Achievement tile inset: 16px.

Desktop and mobile values remain explicit and predictable. Product typography will not use fluid sizing as part of this spacing change.

## Component behavior

### Dashboard, Progress, and Nutrition cards

All `.dash-card` consumers receive the shared responsive inset and preserve their current content order and functionality. This includes the workout card, weekly-volume and History cards, Progress charts, bodyweight form, exercise-progress card, calorie summary, water tracking, meals, and goals.

Nutrition's two-column targets layout will collapse to one column on narrow phones so proper card padding does not squeeze labels and inputs.

### Quick Log

Quick Log receives the same desktop and mobile inset as the surrounding dashboard cards. Its current form, AI behavior, confirmation flow, and mobile control layout remain unchanged.

### Charts and empty states

The no-data chart state will use a dedicated 132px-high presentation instead of inheriting the live SVG chart's responsive aspect-ratio growth. It will keep the baseline and “No data yet” message, but place them within a compact, vertically balanced area.

History's sole empty row will become a true empty state: vertically centered within a matching 132px minimum content area, free of the normal list-row divider, and balanced against the adjacent chart card. Populated History remains a scrollable list with the existing 460px maximum height.

Live data charts keep their existing rendering and labels. This pass will not introduce a chart library or change stored data.

### Achievements

The achievement grid remains responsive and left-to-right. An incomplete final row is valid and will not be filled with decorative placeholders.

Each tile will use:

- A 16px inset and tokenized 8px internal rhythm.
- A 150px minimum column width above 480px and 140px at 480px and below.
- A consistent 10rem minimum height while remaining able to grow for longer copy.
- Explicit compact line heights for descriptions.
- `margin-top: auto` behavior for the XP label so rewards align across a row.
- Full tile opacity for locked achievements, with the existing icon, background, border, and muted text treatments carrying the locked state.

These changes improve scanning and readability without changing achievement rules, icons, names, or XP values.

## Responsive behavior

- Above 960px: two-column dashboard grid with 24px gutters and 24px card insets.
- From 721px through 960px: preserve two columns with a 16px gutter and 24px card insets.
- At 720px and below, cards stack into one column.
- At 600px and below: use 16px card insets and single-column Nutrition targets.
- At 480px and below: reduce the achievement tile minimum width to 140px.
- Content must not overflow at 320px, 390px, 768px, 960px, 1280px, or 1440px viewport widths.

## Accessibility and professional finish

- Locked achievement copy must remain readable rather than being dimmed through whole-card opacity.
- Empty states remain exposed to assistive technology with meaningful text.
- Existing focus states, touch-target sizing, reduced-motion behavior, semantic headings, and live regions remain intact.
- Spacing changes must not hide, clip, or reorder controls.
- No new decorative motion, nested cards, filler tiles, colors, fonts, or visual effects are introduced.

## Verification

- Run the complete existing Node test suite.
- Run the layout detector after the final CSS changes and resolve or explicitly account for every finding.
- Verify Dashboard, Progress, and Nutrition in a browser at 1440px, 1280px, 960px, 768px, 390px, and 320px.
- Check empty-profile and populated/demo-profile states.
- Confirm Quick Log, workout logging, History expansion, charts, achievements, Nutrition forms, and bodyweight logging still work.
- Compare empty weekly-volume and History cards for balanced height and alignment.
- Confirm achievement tiles have consistent rhythm and XP baselines without truncating longer descriptions.
- Confirm there is no horizontal overflow or cramped two-column control layout on mobile.

## Constraints

- No framework, hosting, or Vercel deployment changes.
- Preserve the PWA, AI endpoints, Firebase sync, service worker, manifest, persistence schemas, evaluator behavior, and existing tests.
- Do not change achievement logic, workout data, chart calculations, or Nutrition behavior.
- Do not add dependencies.
- Preserve unrelated working-tree changes.
