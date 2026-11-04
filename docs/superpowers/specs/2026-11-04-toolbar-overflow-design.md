# Toolbar overflow

User selected option 1: keep the command bar on one row and put commands that do not fit in a `More commands` popup. Preserve Files/Folders mode buttons, existing command handlers, labels, disabled states and selected states. Restore commands when space becomes available; support each active folder tab independently. Keep the current toolbar appearance and size.

Alternatives discussed: two permanent rows (uses more vertical space), or label collapse before overflow (less readable). Implement the selected overflow approach using actual available width, moving secondary commands first and preserving primary commands as long as space permits. Theme and update controls can also enter the popup on narrow windows. No installer or release in scope.

Use the existing keyboard-accessible context popup. Escape/outside click dismiss it; restore trigger focus on Escape. Resizing and mode/tab changes must not leave stale actions in an open popup. Hidden commands remain original DOM buttons, and popup actions invoke their existing handlers.
