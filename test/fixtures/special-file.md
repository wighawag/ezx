# Special characters: file extraction

```bash
mkdir -p out
```

## File extraction

> file: `out/sample.ts`

```typescript
// a `comment` with backticks
export type Hex = `0x${string}`;
const s = "line\nbreak \\ done \u0041 \x41";
const re = /\d+\s*\$/;
EZXEOF
const t = `${1 + 1} and \` and \${not}`;
const single = 'it\'s';
```
