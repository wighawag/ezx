# ezx Example

This example demonstrates both ezx features:

## 1. Directory Context Persistence

First, let's set up our working directory:

```bash
mkdir -p demo-project
# set the current directory
cd demo-project
```

## 2. File Extraction

Let's extract some files into the demo-project directory:

### Extract a package.json

```typescript
// file: package.json
{
  "name": "demo-project",
  "version": "1.0.0",
  "description": "A demo project",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  }
}
```

### Extract a README.md

```markdown
<!-- file: README.md -->
# Demo Project

This project was created using ezx!
```

### Extract an index.js file

```javascript
// file: index.js
console.log('Hello from ezx!')
console.log('Current directory:', process.cwd())
```

Now this block will automatically prepend `cd demo-project`:

```bash
echo "We are in the demo-project directory"
pwd
```

Another bash block in the same directory:

```bash
echo "Still in demo-project!"
touch demo.txt
ls -la
```

## Verify

Check that everything is in place (still in demo-project):

```bash
echo "Files in demo-project:"
ls -la
```

## Cleanup

```bash
cd ..
rm -rf demo-project
echo "Cleanup complete!"
```