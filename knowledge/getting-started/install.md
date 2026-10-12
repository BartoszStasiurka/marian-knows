---
title: Install
tags: [getting-started, cli]
---

# Install

MarianKnows needs Node.js 20 or newer. The package is not on the npm registry yet; install it from a checkout
of the repository.

## From a checkout

```bash
git clone https://github.com/BartoszStasiurka/marian-knows.git && cd marian-knows
npm install
npm run build
npm link                 # puts `marian-knows` on PATH
```

Check it works:

```bash
marian-knows help
```

## From a tarball

Build a tarball once and install it on any machine with Node.js 20+:

```bash
npm pack                 # clean build, writes marian-knows-<version>.tgz
npm install -g ./marian-knows-0.1.0.tgz
```

## Native module: better-sqlite3

`better-sqlite3` is a native module. It ships prebuilt binaries for common platforms. Elsewhere its install
script compiles it and needs a C++ toolchain (on Debian or Ubuntu: `build-essential` and `python3`). If npm asks
you to approve install scripts, approve `better-sqlite3`.

## Next step

[Quick start](quick-start.md): index a directory and search it.
