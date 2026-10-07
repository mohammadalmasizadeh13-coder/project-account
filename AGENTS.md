# Project workflow

- After every completed project change, create a Git commit and push it to GitHub using the current branch and its configured remote.
- The user has given standing authorization for these commits and pushes. Do not request confirmation again for routine commits or pushes.
- Run checks appropriate to the change, stage the files belonging to that change, and use a clear commit message before pushing.
- Preserve unrelated existing changes, including staged changes. Include them only when they belong to the requested work or the user asks to save them.
- Do not commit secrets, force-push, or rewrite published history.
- If committing or pushing fails, preserve the local work and report the blocker accurately. Only report that work is saved on GitHub after verifying the push succeeded.
