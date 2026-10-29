# Button states review

- Added consistent visual states for enabled and disabled native buttons throughout the app.
- Enabled primary actions use a high-contrast teal treatment; enabled secondary actions use a pale green treatment with a visible border.
- Disabled buttons use a neutral grey background, grey text and no shadow, including in dark mode.
- Active filter chips and active navigation items are visually distinct from inactive items.
- Added keyboard-visible focus outlines and touch-action handling.

This is a UI-state styling pass. It does not by itself prove every button's business action works on every device; a full interactive runtime test is still required.

Additional wiring review:
- Connected the license activation and deactivation buttons to the existing license functions.
- Connected the device-ID copy button, with a clipboard fallback and visible success/failure feedback.
