# Toolbar selected state fix (0.3.3)

Folders All/Diffs/Same already filtered real entries, but never set aria-pressed,
so none displayed the selected-button styling. A regression assertion failed with
`all selected state after all: null !== 'true'` before the fix.

FolderView now derives the selected preset from its actual status set. The same
preset definitions supply dispatch and selected state. Custom Filters selections
clear all preset highlights until the selection matches a preset. Existing Minor,
Peek, Structure, filesystem filtering and file contents are unchanged.

Files already updated its selected CSS class and filtered Monaco lines. Its toggle
buttons now expose matching aria-pressed values as well.

Regression coverage in scripts/test-folder-controls.mjs checks real Rust folder
results, All/Diffs/Same selected state, custom Filters, icon and label clicks,
Files All/Diffs/Context rendered lines and selection, Minor/Wrap, mode switching
and adjacent folder controls. Browser tests use Edge; native release smoke is
recorded after the release build below.

Verification passed: test:folders (10 workspace scenarios, 6 control groups and
tree/model checks), test:editor (7 scenarios), typecheck and Windows NSIS build.
Real 0.3.3 portable app: Folders All showed 7 rows, Diffs 3, Same 4 (including the
parent folder); the clicked preset alone was highlighted. Opening changed.sql and
clicking Files Diffs highlighted Diffs and showed the FILTERED LINE bars. Context
highlighted Context and restored surrounding lines. No sample files were edited.
The current machine's Explorer development registration was updated to 0.3.3.
