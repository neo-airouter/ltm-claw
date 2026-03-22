# Repository Instructions

## Publishing

1. Ensure `version` in `package.json` is updated
2. Commit the version bump
3. Tag: `git tag v<version>` and push tags
4. Run `npm publish --access public`

## Development

```bash
# Type check
npx tsc --noEmit
```
