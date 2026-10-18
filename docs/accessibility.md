# Accessibility

This document describes the accessibility patterns used in the Soter frontend.

---

## Pagination status region (issue #276)

### Behavior

When a user navigates to a new page, a screen reader will announce:

```
Page X of Y, showing items A–B
```

where X is the current page, Y is the total number of pages, A is the first visible item number, and B is the last visible item number (capped at `totalItems` on the final page).

### Live-region implementation

The `<Pagination>` component (`src/components/Pagination.jsx`) renders a single polite ARIA live region:

```jsx
<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
  {announcement}
</div>
```

Key design decisions:

- **`aria-live="polite"`** – the announcement waits for the screen reader to finish its current utterance, so it does not interrupt the user.
- **`aria-atomic="true"`** – the entire message is read as one unit, preventing partial reads.
- **`className="sr-only"`** – the region is visually hidden but available to assistive technology; this matches the same pattern used in `ImportRecipientsWizard` and `VerificationFlow`.
- **No announcement on initial render** – `useRef` tracks the previous page value and the effect is skipped on mount, avoiding a redundant "Page 1 of Y" read when the list first loads.
- **No announcement on same-page re-renders** – the effect compares the incoming `page` prop against the stored previous value and only updates the announcement string when they differ.

### Coordination with existing list announcements

The app's other live regions use `aria-live="polite"` for status feedback (wizard steps in `ImportRecipientsWizard`, inline feedback in `InlineFeedback`) and `aria-live="assertive"` for urgent alerts (`NetworkMismatchBanner`).

The `<Pagination>` component:

- Renders **exactly one** `role="status"` live region per instance.
- Must be mounted **once per paginated list** — placing multiple `<Pagination>` instances on the same page would produce duplicate announcements.
- Uses `polite` priority, so it naturally queues behind any concurrent toast or inline feedback without competing.

There is no dedicated marketplace-list announcer in the current codebase. If one is added in the future, coordinate by ensuring it does not also announce page-position changes, and consider a shared `useAnnouncer` hook to serialise messages through a single live region.

### WCAG 2.1 AA compliance

| Criterion | Satisfied by |
|-----------|-------------|
| 1.3.1 Info and Relationships | Pagination buttons have descriptive `aria-label` attributes |
| 2.1.1 Keyboard | Prev/Next are native `<button>` elements, fully keyboard accessible |
| 4.1.3 Status Messages | Page-change announcements delivered via `role="status"` polite live region |

---

## Other patterns

| Component | Pattern |
|-----------|---------|
| `ImportRecipientsWizard` | `role="status" aria-live="polite"` for step-transition and CSV feedback |
| `VerificationFlow` | `role="status" className="sr-only"` for wizard-step announcements |
| `InlineFeedback` | `role="status" aria-live="polite"` for form validation messages |
| `NetworkMismatchBanner` | `aria-live="assertive"` for urgent network-mismatch alerts |
| `ToastProvider` | Radix UI toast (manages its own live region via `@radix-ui/react-toast`) |
