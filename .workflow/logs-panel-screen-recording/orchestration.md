# Orchestration

## Work packets

- **logs-audit:** current SSE, panel integration, filtering, resource behavior.
- **recording-audit:** current stream surfaces, composition geometry, browser API.
- **risk-audit:** simulator isolation, E2E plan, cleanup and adversarial cases.
- **root:** integrate design, run TDD loops, own all edits and simulator actions.

## Integration policy

- Agents own disjoint implementation packets after the design is locked; root
  audits and integrates every shared seam.
- Root resolves conflicts against current source and tests.
- No speculative backend rewrite; each shared utility must serve a shipped UI.
- Existing unrelated worktree changes are preserved.

## Verification order

1. Failing seam test before each implementation slice.
2. Focused Bun tests after each green step.
3. Package typecheck/build.
4. Full repository test command.
5. Isolated real-simulator browser E2E.
6. Adversarial diff review and final rerun.
