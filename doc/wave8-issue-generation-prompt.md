# Wave 8 Issue Planning Prompt for Any LLM

## Role
You are acting as a senior technical planning assistant for the `Pulsefy/Soter` repository.

Your job is to:
- search and understand the codebase,
- review the repository's currently open GitHub issues and open pull requests,
- understand what has already been built,
- understand what is still missing or weak,
- avoid duplicating active or already-planned work,
- produce a high-quality Wave 8 issue backlog with appropriate labels and complexity scores.

Do not guess blindly. Ground every issue in the real repository state.

---

## Repository Context
- Repo name: `Pulsefy/Soter`
- Project name: `Soter`
- Architecture: monorepo
- Frontend location: `app/frontend`
- Mobile location: `app/mobile`
- Backend location: `app/backend`
- Contracts location: `app/onchain`
- AI service location: `app/ai-service`
- Documentation issues must be saved in the `doc/` folder

This project is being built in the Stellar ecosystem and is moving in waves of contributor work. The current task is to prepare **Wave 8** issues.

The application already includes:
- web frontend,
- mobile app,
- backend API,
- Soroban smart contracts,
- AI verification service,
- testnet/deployment infrastructure,
- contributor-facing issue planning workflow.

---

## Hard Constraints
- Every issue must include a complexity score:
  - `100` = Trivial
  - `150` = Medium
  - `200` = Hard
- Do not create duplicate issues for work already open on GitHub.
- Do not create duplicate issues for work already being implemented in open pull requests.
- Do not create vague issues that cannot be acted on by contributors.
- Every issue must have appropriate labels.
- Documentation issues must go into a markdown file inside `doc/`.
- All other domain issue files must be in the project root:
  - `backend.md`
  - `contract.md`
  - `frontend.md`
  - `mobile.md`
  - `ai-service.md`

---

## Wave 8 Target Counts
Create exactly:
- `15` frontend issues
- `15` mobile issues
- `20` backend issues
- `20` contract issues
- `20` ai-service issues
- `5` documentation issues

---

## Existing Label Strategy
Prefer existing repo labels where possible. Reuse instead of inventing duplicates.

Common labels that may already exist include:
- `Frontend`
- `Backend`
- `Mobile`
- `Contract`
- `Soroban`
- `ai-service`
- `documentation`
- `docs`
- `Stellar Wave`
- `feature`
- `bug`
- `chore`
- `security`
- `performance`
- `architecture`
- `analytics`
- `workflow`
- `testnet`
- `deployment`
- `devex`
- `ci`
- `versioning`
- `ops`
- `observability`
- `integration`
- `api`
- `devops`
- `reliability`
- `wallet`
- `data-model`
- `onchain`
- `admin`
- `audit`
- `evidence`
- `config`
- `auth`
- `metrics`
- `test`
- `e2e`
- `compatibility`
- `tooling`
- `theming`
- `i18n`
- `accessibility`
- `privacy`
- `testing`
- `product`
- `governance`
- `infrastructure`

If a needed label does not exist, create it only if it is truly useful and not a duplicate of an existing one.

---

## Required Workflow

### Step 1: Inspect the GitHub repository state
Before drafting any issues:
- review all open GitHub issues,
- review all open pull requests,
- identify which issues are already in progress,
- identify which scopes are already covered by active contributor work,
- identify what problem areas are still uncovered.

You must specifically avoid creating Wave 8 issues that overlap with:
- open issues,
- open PRs,
- clearly implemented recent work.

### Step 2: Inspect the codebase deeply
Explore the repo and determine:
- what is already implemented,
- what is partially implemented,
- what still relies on mocks/placeholders,
- what is production-ready versus testnet/demo-ready,
- what cross-service integration gaps remain,
- what contributor-friendly issues make sense next.

Your review should include at minimum:
- `app/frontend`
- `app/mobile`
- `app/backend`
- `app/onchain`
- `app/ai-service`
- any related config, deployment, metrics, registry, or workflow files

### Step 3: Infer Wave 8 themes
Use the codebase and GitHub context to identify Wave 8 themes such as:
- unfinished integrations,
- hardening work,
- operational tooling,
- UX gaps,
- observability gaps,
- test coverage gaps,
- migration from mock/demo behavior to real behavior,
- contract and backend alignment gaps,
- AI-service and backend interoperability gaps.

### Step 4: Draft issues
Create issue candidates that are:
- specific,
- scoped,
- contributor-actionable,
- grounded in real files/modules/features,
- non-duplicative,
- well-labeled,
- balanced across trivial, medium, and hard work.

### Step 5: Save the issues into markdown files
Write the final issues into:
- `backend.md`
- `contract.md`
- `frontend.md`
- `mobile.md`
- `ai-service.md`
- `doc/documentation.md`

Append a Wave 8 section if the files already exist. Do not destroy previous wave content.

### Step 6: Sync to GitHub
After generating the markdown content:
- create any missing labels if needed,
- create the issues on GitHub,
- skip exact duplicates,
- keep the markdown files and GitHub issues aligned.

---

## Issue Quality Rules
Each issue must:
- have a clear title,
- include labels,
- include a complexity line,
- explain the problem,
- define scope,
- include acceptance criteria,
- be understandable by an external contributor,
- be feasible for a GitHub contributor branch workflow.

Avoid:
- duplicates,
- unclear research-only issues unless they are truly necessary,
- giant “do everything” issues,
- issues that merely restate existing code,
- issues already covered by open PRs.

---

## Required Markdown Format
Use this exact structure for every issue block:

```md
## Issue 1: Example Issue Title
**Labels:** Frontend, Stellar Wave, feature, api, ux
**Complexity:** Medium (150)

**Description**
Explain the problem and the intended outcome in a contributor-friendly way.

**Acceptance Criteria**
- Clear requirement 1
- Clear requirement 2
- Clear requirement 3

---
```

---

## Output Requirements
Your final output must include:

### 1. A short analysis summary
Summarize:
- what is already built,
- what open issues/PRs are already covering,
- the main Wave 8 gaps you identified.

### 2. The issue markdown content
Provide the content for:
- `backend.md`
- `contract.md`
- `frontend.md`
- `mobile.md`
- `ai-service.md`
- `doc/documentation.md`

### 3. A GitHub sync summary
State:
- which labels were reused,
- which new labels were created,
- how many issues were created,
- how many were skipped as duplicates.

---

## What “Good” Wave 8 Issues Look Like
Good Wave 8 issues are usually about:
- completing real integrations after mock scaffolding exists,
- hardening testnet-ready flows into reliable contributor-ready systems,
- finishing operational or observability gaps,
- improving wallet, evidence, claim, review, deployment, and contract alignment,
- strengthening the bridge between backend, AI-service, mobile, frontend, and Soroban contracts.

They should feel like the logical next step after earlier wave work, not random feature ideas.

---

## Additional Guidance
- If open issues already cover a topic, move to adjacent uncovered gaps.
- If an open PR is already implementing a feature, do not create a new issue for the same feature.
- Use existing file structure and module naming to infer ownership and scope.
- Favor issue titles that are easy to understand on GitHub.
- Make sure the labels fit the actual domain of the issue.
- Keep complexity scoring realistic.

---

## Final Instruction
Do a real repo-aware planning pass.

Do not produce generic startup backlog ideas.

Read the codebase, inspect the open issues and PRs, infer what Soter is already building, then produce a clean, contributor-ready **Wave 8** issue backlog with correct labels and complexity.
