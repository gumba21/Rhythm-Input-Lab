# Development workflow

## Receiving updates made on GitHub

In Git GUI:

1. Open the local `Rhythm-Input-Lab` repository.
2. Choose **Remote → Fetch from → origin**.
3. Choose **Merge → Local Merge** and merge `origin/develop` into `develop`.

At a terminal, the equivalent is:

```bash
git checkout develop
git pull
```

## Pushing your own changes

1. Make sure the current branch is `develop`.
2. Run `run-tests.bat`.
3. In Git GUI, click **Rescan**.
4. Review the changed and untracked files.
5. Click **Stage Changed**.
6. Enter a descriptive commit message.
7. Click **Commit**.
8. Choose **Remote → Push** and push `develop` to `origin`.

Do not commit generated attempts, reports, virtual environments, cache files, or ZIP builds. The root `.gitignore` excludes the common cases.

`main` is reserved for stable releases. Normal work should be committed to `develop` first.
