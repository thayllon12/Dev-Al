# DEV AI Platform V8: Theme Refactor & Mobile UX

This update focuses on moving to a more robust CSS variable-based theme system, fixing menu positioning with Portals, and completely redesigning the mobile settings experience.

## User Review & Critical Decisions

- **CSS Variables**: Centralizing theme tokens in `:root` to ensure zero-flicker and easier maintenance.
- **Portal Menus**: Switching from `absolute` to `Portal` (fixed positioning relative to viewport) for message menus to prevent clipping and overflow issues.
- **Mobile Settings**: Transitioning to a "Drill-down" list style (list -> detail) for mobile screens instead of side-by-side tabs.
- **Welcome Permissions**: A blocking overlay on first session load to request Mic/Camera permissions clearly.

## 1. Overview & Core Concept

- **What It Does**: Polishes the "Premium" feel by fixing visual glitches and making the app truly "mobile-first".
- **Key Value**: Provides a consistent, professional-grade interface that works flawlessly across themes and screen sizes.

## 2. User Experience & Visual Design

- **Theming**: Instant transitions using CSS vars (e.g., `--background`, `--foreground`).
- **Input Area**: Cleaned up input without the "black box" background; text legibility fix for light mode.
- **Navigation**: Restored "Share" icon and added missing interaction triggers (Long Press) for history items.
- **AI Controls**: Accessible primary actions (TTS, Copy, Regenerate) always visible before the overflow menu.

## 3. Key Product Decisions & Trade-Offs

- **Portal Approach**:
    - *Chosen Approach*: Use `ReactDOM.createPortal` for menus.
    - *Why*: It solves the `overflow: hidden` problem on message bubbles and allows precise positioning relative to the trigger.
- **Theme Logic**:
    - *Chosen Approach*: `useEffect` on `settings.theme` updates a `data-theme` or `class` on `html` which updates CSS vars.
    - *Why*: Tailwind handles the `dark:` variant well, but variables allow better dynamic control for non-Tailwind properties.

## 4. Technical Architecture & Data Strategy

- **Theme Store**: Syncs `localStorage` -> `State` -> `Firestore`.
- **Portal Container**: Added to `index.html` as `#portal-root`.
- **Permissions Flag**: Tracked in `sessionStorage` to ensure the modal only appears once per session.

## 5. Implementation Steps

1.  **CSS Refactor**: Add variables to `index.css`. Update `App.tsx` to set class/vars correctly.
2.  **Portal Component**: Build `PortalMenu` in `src/components/PortalMenu.tsx`.
3.  **ChatView Refactor**: Update message footers and add long-press to history.
4.  **Settings Redesign**: Implement the category list -> category view logic for mobile.
5.  **CodeBlock Polish**: Fix width constraints and header wrapping.
6.  **Welcome Modal**: Implement `WelcomePermissionsModal`.
