# Releasing

We publish immutable GitHub tags and releases. Pi can install a tagged Git repository directly, so npm publishing is not required.

## Prepare the release

1. Create a release branch from `main`.
2. Update `version` in `package.json` and `package-lock.json` with `npm version --no-git-tag-version <major|minor|patch>`.
3. Move entries from `Unreleased` in `CHANGELOG.md` into a dated version section.
4. Run the full check:

   ```bash
   npm ci
   npm run check
   ```

5. Open a pull request and merge it after CI passes.

## Publish the release

Create an annotated tag from the verified `main` commit:

```bash
git checkout main
git pull --ff-only
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

The release workflow verifies that the tag matches `package.json`, reruns all checks, builds the package tarball, and creates the GitHub Release with generated notes.

Do not move or reuse a published tag. Publish a new patch release to correct a bad release.
