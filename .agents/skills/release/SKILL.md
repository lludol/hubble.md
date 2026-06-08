---
name: release
description: Prepare Hubble desktop releases using tag-triggered GitHub Releases. Use when cutting, automating, or explaining app releases, version bumps, tags, GitHub Actions publishing, Electron artifacts, or updater release management.
---

# Release

Use Git tags as the release trigger. Prefer explicit tags over detecting version bump commits.

## Desktop release flow

1. Bump `apps/desktop/package.json` version.
2. Commit with a short message, e.g. `release desktop 0.1.2`.
3. Tag the commit, e.g. `desktop-v0.1.2`.
4. Push the branch and tag.
5. GitHub Actions builds, signs, notarizes, packages, creates the GitHub Release, and uploads Electron artifacts.

If using electron-builder GitHub publish, set `publish.releaseType = "release"` or expect a draft release that must be manually published.

Expected release artifacts:

- `latest-mac.yml`
- `Hubble-x.y.z-arm64-mac.zip`
- `Hubble-x.y.z-arm64.dmg`
- `.blockmap` files
