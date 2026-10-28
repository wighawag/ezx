# Existing behaviours

## Section A

```bash [npm]
printf '%s\n' label > label.txt
```

```bash sleep:1
printf '%s\n' slept > sleep.txt
```

```bash skip
printf '%s\n' skipped > skipped.txt
```

```bash
# set the current directory
mkdir -p proj
cd proj
```

```bash
printf '%s\n' "$(basename "$(pwd)")" > where.txt
```

> file: `proj/data.json`

```json
{"name": "proj"}
```

## Section B

```bash
printf '%s\n' b > section-b.txt
```
