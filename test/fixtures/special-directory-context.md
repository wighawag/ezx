# Special characters: directory context

## Directory context

```bash
# set the current directory
mkdir -p ctx/sub
cd ctx
```

> file: `ctx/stripped.txt`

```text
prefix `stripped` ${HOME} \n
```

> file: `sub/relative.txt`

```text
relative to `ctx` ${HOME} \n
```

```bash
printf '%s\n' "in $(basename "$(pwd)") ${PWD##*/} `echo ok`" > here.txt
```
