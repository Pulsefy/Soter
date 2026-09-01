# Route-Level Loading States Guide

To prevent perceived app breakage on slow field connections, all primary route directories under `src/app/[locale]/` must implement a dedicated `loading.tsx` file.

## Requirements
1. **Layout Preservation:** Skeletons must mirror the exact padding, grid structure, and container heights of the target view to eliminate Content Layout Shift (CLS).
2. **Reduced Motion Compliance:** Utilize Tailwind's `motion-reduce:animate-none` utility on all shimmer or pulse animations.
3. **Slow Connection Handling:** Include a deferred secondary text message if requests exceed 4 seconds.