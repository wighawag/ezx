# Comprehensive Directory Context Test

This test covers various scenarios:

## Scenario 1: Basic directory context

```bash
# set the current directory
mkdir -p dir1
cd dir1
```

```bash
pwd
```

```bash
echo "Still in dir1"
```

## Scenario 2: Directory change with file extraction in between

> `config.json`

```json
{
  "setting": "value"
}
```

```bash
echo "Still in dir1 after file extraction"
```

## Scenario 3: Change to a different directory (relative from dir1)

```bash
# set the current directory
mkdir -p dir2
cd dir2
```

```bash
pwd
```

```bash
echo "Now in dir1/dir2"
```

## Scenario 4: Nested directory change (relative from dir1/dir2)

```bash
mkdir -p subdir
# set the current directory
cd subdir
```

```bash
pwd
```

```bash
echo "Now in dir1/dir2/subdir"
```

## Scenario 5: Go back to parent (dir1/dir2)

```bash
# set the current directory
cd ..
```

```bash
pwd
```

```bash
echo "Back in dir1/dir2"
```

## Cleanup

```bash
cd ../..
rm -rf dir1
echo "Cleanup complete!"
```