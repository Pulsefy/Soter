# Onboarding: the Wave-Based Contribution Workflow

Soter is developed in **waves**: batches of issues opened together, claimed by
contributors, and expected to land within a rough timeframe. This guide
explains how that works so a contributor arriving mid-wave can get productive
without needing to ask a maintainer directly.

## How a wave works

1. **Issues are opened per wave.** At the start of a wave, a batch of issues is
   created and labelled (you'll see a wave label such as `Stellar Wave` on
   them). Each issue carries a short description, acceptance criteria, and a
   complexity estimate.
2. **You claim one.** Comment on an unassigned issue to ask for it (or follow
   whatever claim convention is pinned for the current wave). A maintainer
   assigns it to you. **One issue at a time** is the norm unless told otherwise
   — it keeps issues available for others and turnaround predictable.
3. **You open a PR.** Work on a branch, keep the PR small and focused, and link
   the issue with `Closes #<issue-number>` in the description. Include tests or
   a short manual test plan and make sure the repo's CI checks pass.
4. **Review and merge.** A maintainer reviews; you address feedback; it merges.

## Expected turnaround

- **Your side:** aim to open a PR within a few days of being assigned. If life
  gets in the way, say so on the issue — an honest heads-up is always better
  than silence.
- **A stale claim** (assigned but no PR and no update for a while) may be
  **unassigned and recycled** so someone else can pick it up. This is not
  personal; it keeps the wave moving.
- **If you were unassigned** and still want the issue, comment again — if it is
  still open you can be reassigned.

## Review turnaround (an honest note)

Review capacity has been a repeated bottleneck across recent waves. Reviews are
done in batches rather than instantly, so **expect your PR to wait** before it
is looked at, and expect more than one review round on non-trivial changes. You
can help it move faster by:

- Keeping the PR small and scoped to a single issue.
- Writing a clear problem statement + how you tested it.
- Making CI green before requesting review.
- Responding promptly to review comments.

A ready, green, well-described PR is reviewed and merged far faster than a large
or failing one — the best way to work around limited review capacity is to make
each PR trivially easy to review.

## Getting help

- Read the component READMEs (`app/backend`, `app/frontend`, `app/mobile`,
  `app/onchain`, `app/ai-service`) and the top-level [`README.md`](../README.md).
- For how the pieces fit together, see the other documents in [`doc/`](.),
  including the [architecture decision log](decisions/README.md).

> Note: this repository does not currently ship an issue template. If one is
> added under `.github/ISSUE_TEMPLATE/`, link back to this guide from it so new
> contributors find the workflow from the issue they are claiming.
