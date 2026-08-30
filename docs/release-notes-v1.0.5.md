## What changed

- Fixed the empty-state panel appearing above real duplicate results.
- Replaced the ambiguous "Select all newer copies" control with a clear choice:
  **Delete newer** or **Delete older**.
- Switching the policy immediately changes which image is protected and which
  copies are selected.
- Comparisons now label the survivor as **KEEP OLDEST** or **KEEP NEWEST**.
- Individual files can still be deselected before deletion.
- Added a main-process safeguard that always leaves at least one file in every
  duplicate group.

See the [installation and usage guide](https://github.com/designlook/image-deduper#install)
for platform-specific instructions.
