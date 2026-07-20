# GitHub Support request — purge unreachable objects after client-data scrub

> **This file is a local note. Do NOT commit it** (it names the incident). Delete after sending.
> Send via https://support.github.com/ → "Removing sensitive data".

## What happened
Private client data (a customer's hostname, account IDs, dashboard/report/user names,
and a branded walkthrough video) was accidentally committed to the **public** repo
`lucyfuur94/webnav-core`. I have rewritten the entire history with `git-filter-repo`,
force-pushed a clean `main`, and deleted the two feature branches that carried the old
history. The working tree, all reachable commits, and all commit messages are now clean.

## What I need from GitHub
The old (pre-rewrite) commits are now **unreachable** but still resolvable by SHA via
direct URLs, and are still visible in the diffs of two **merged** pull requests. Please:

1. **Run garbage collection** on `lucyfuur94/webnav-core` to purge unreachable objects,
   so old commit SHAs (e.g. `bfb9f7b…`, `23854e3…`, and their ancestors) 404.
2. Purge the cached commit/diff views for merged PRs **#1** and **#2** in that repo.

I understand forks/existing clones are out of scope. There are no active forks I'm aware of.

## Draft message to paste
> Subject: Purge unreachable objects + merged-PR caches after sensitive-data history rewrite
>
> Repo: https://github.com/lucyfuur94/webnav-core (public)
> I force-pushed a `git-filter-repo`-cleaned history to remove private client data and
> deleted the branches that held the old commits. Please garbage-collect the repo so the
> old, now-unreachable commit SHAs are no longer resolvable, and purge the cached diffs of
> merged PRs #1 and #2 which still display the removed data. Thank you.

## After GitHub confirms
- Spot-check a few old SHAs 404 (you saved none here on purpose).
- Rotate anything that was ever exposed alongside the data (the npm token seen in
  `~/.npmrc` during diagnosis — rotate regardless).
