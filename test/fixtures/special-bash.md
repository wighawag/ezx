# Special characters: bash block

```bash
mkdir -p out
```

## Plain bash block

```bash
NAME=world
printf '%s\n' "greeting ${NAME} `echo sub` $(echo paren)" > out/bash-out.txt
printf '%s\n' 'back\slash \n literal \\ double' >> out/bash-out.txt
printf '%s\n' "$((1 + 2))" >> out/bash-out.txt
cat > out/bash-heredoc.txt << 'END'
type Hex = `0x${string}`;
a \n b \\ c \u0041
END
```
