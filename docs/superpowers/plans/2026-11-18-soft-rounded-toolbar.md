# Soft Rounded toolbar icons

The user selected concept 4 and requested implementation. Use authored 24px SVGs with rounded 2px strokes, graphite bodies and restrained teal details. Preserve command labels, tooltips, handlers and toolbar overflow. Cover Files, Folders, Settings, overflow and path actions; support both themes.

1. Replace the shared icon geometry and add optional accent paths in `folderChrome.ts`.
2. Reuse the family for Open, Save and Parent path controls. Scope teal selection colors to toolbar chrome, leaving comparison colors intact.
3. Run build and existing accessibility, folder controls and theme checks. Inspect Files/Folders screenshots in both themes and compact overflow.

Verification focus: copy directions, Watch versus Peek, active/disabled contrast, keyboard labels and narrow-window overflow. This is a reversible visual-only change; use existing interaction tests and rendered inspection rather than tests of SVG coordinates.
