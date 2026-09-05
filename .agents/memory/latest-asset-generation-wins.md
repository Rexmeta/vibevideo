---
name: Latest asset generation wins
description: Completion-order rule for overlapping original and explicit media regeneration jobs.
---

When an original media generation and an explicit regeneration overlap, only the newest job for that project, scene, and capability may commit its result. Storage object paths must also be versioned per job rather than shared.

**Why:** Provider and upload completion order is nondeterministic. Without both a latest-job fence and versioned storage paths, an older request can finish last and overwrite the asset the user explicitly regenerated.

**How to apply:** Any new image, audio, or video persistence path that permits overlapping intents must check latest-job authority before committing scene state and avoid writing competing jobs to the same storage object.