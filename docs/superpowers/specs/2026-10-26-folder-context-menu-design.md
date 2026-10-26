# Folder context menu

Approved intent: expose folder selection and comparison directly in the Explorer main context menu, like the supplied Beyond Compare example.

Use the existing native C++ IExplorerCommand DLL and sparse MSIX registration. Keep the file submenu unchanged. Register one folder-specific command with ECF_DEFAULT and no children. Its title and action change from `Select Left Folder for Compare` to `Compare Folders to “name”` after selection. Remember the folder separately from the existing file selection; clear it after successful launch so the next pair can be selected. Failed launches retain the selection.

Alternatives: retaining the submenu misses the requested placement; registering two simultaneous verbs can cause Windows 11 to group them back into a flyout. The adaptive single command is the implementation choice for the approved main-menu behavior.

Only single filesystem directories are supported. Reject files, virtual items and mixed pairs. If the remembered left folder is no longer available, select the current folder as the new left folder and explain this in a message. Use existing UTF-16 process launch and recursive Folder Compare routing. Do not change signing/trust settings or restart Explorer. Building and validating this change does not publish a release or replace the installed app.
