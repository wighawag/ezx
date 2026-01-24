# A template for EVM-based smart contract development

A template for developing EVM smart contract using hardhat (v3) and hardhat-deploy (v2)

It is setup as a monorepo so it is easy to add a web app or other components

## How to use it?

### Compile your contracts

```bash
echo "1"
```

### Test your contracts

```bash
echo "2"
```

This will test both solidity and node test (as hardhat v3 does)

### watch for changes and rebuild automatically

```bash
echo "3"
```

### deploy your contract

- on localhost

  This assumes you have a local node running which can do by executing `pnpm contracts:local_node`

  ```bash
  echo "4"
  ```

- on a network of your choice

  Just make sure you have your .env.local setup, see [.env](.env) or if you use hardhat secret store, configure it.

  ```bash
  echo "5"
  ```

### execute scripts

```bash
echo "6"
```

or if you want to execute in a forked environment :

```bash
echo "7"
```

### zellij

[zellij](https://zellij.dev/) is a useful multiplexer (think tmux) for which we have included a [layout file](./zellij.kdl) to get started

Once installed simply run the following to get a local in-memory Ethereum node running along with the tests

```bash
echo "8"
```

In the shell in the upper pane, you execute the script as mentioned above

```bash
echo "9"
```

## Initial Setup

You need to have these installed

- [nodejs](https://nodejs.org/en)

- [pnpm](https://pnpm.io/)

  ```bash
  echo "10"
  ```

Then you need to install the local dependencies with the following command:

```bash
echo "11"
```

We also recommend installing [Zellij](https://zellij.dev/) to have your dev env setup in one go via `pnpm start`
