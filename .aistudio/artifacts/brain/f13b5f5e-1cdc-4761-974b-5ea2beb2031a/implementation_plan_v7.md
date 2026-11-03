# DEV AI Platform V7: UI Polish & Live Rework

This iteration focuses on fixing critical UI regressions (context menus, code block overflows), implementing full Light Mode support, and redesigning the "Dev Live" experience to be more functional and aesthetic.

## User Review & Critical Decisions

> [!IMPORTANT]
> The context menus and code blocks currently break the mobile layout. I will switch to `absolute` positioning for menus and flex-basis constraints for code blocks to fix this immediately.

- **Dev Live Controls**: Moved to a discreet floating island in the bottom-right corner.
- **Camera Background**: When active, the camera feed becomes the full-screen backdrop, replacing animations.
- **Light Mode**: I will implement a complete light theme using `dark:*` Tailwind pairs across all components.

## 1. Overview & Core Concept

- **What It Does**: Polishes the core chat experience and upgrades the "Live" voice/video calling feature.
- **Key Value**: Provides a consistent, responsive, and functional interface across all devices and themes.

## 2. User Experience & Visual Design

- **Visual Identity**: Premium matte aesthetic (Dark) / Clean minimal airy (Light).
- **Dev Live Redesign**:
    - **Background**: Full-screen camera feed or blurred glass background for voice only.
    - **Controls**: Minimal pill-shaped controller with small icons.
    - **Animations**: Voice activity indicators that overlay subtly on the background.
- **Responsive Code Blocks**: Headers will no longer expand beyond the screen; only the code itself will scroll horizontally.

## 3. Key Product Decisions & Trade-Offs

- **Menu Positioning**:
    - *Chosen Approach*: Use `absolute` instead of `fixed` for message menus.
    - *Why*: `fixed` breaks when scrolling or within transformed containers. `absolute` ensures the menu stays relative to the message bubble.
- **Microphone Permissions**:
    - *Chosen Approach*: Trigger `getUserMedia` explicitly when entering Dev Live.
    - *Why*: To ensure real voice detection rather than simulated animations.

## 4. Technical Architecture & Data Strategy

```unicode
┌───────────────────────────────────────────────────────────┐
│                      App.tsx (Root)                       │
│    ┌───────────────┬───────────────────┬──────────────┐   │
│    │    Sidebar    │   Chat Container  │ DevLiveModal │   │
│    │ (History/ID)  │  (Messages/Input) │ (Audio/Video)│   │
│    └───────────────┴───────────────────┴──────────────┘   │
└───────────────────────────────────────────────────────────┘
          │                   │                  │
    ┌─────▼─────┐       ┌─────▼─────┐      ┌─────▼─────┐
    │ Firestore │       │ Gemini API│      │ Media API │
    └───────────┘       └───────────┘      └───────────┘
```

- **Theme Persistence**: Synced between `localStorage` and `document.documentElement` classes.
- **Voice State**: Managed via Web Audio API to detect volume levels in real-time.
