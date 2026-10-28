# Blocks inside list items

- first step

  ```bash
  printf '%s\n' "list `echo sub` ${HOME:+home} back\slash" > list-out.txt
  ```

- second step, indented prose after an empty line

    still part of the list item

  ```bash
  printf '%s\n' 'second \n' >> list-out.txt
  ```
