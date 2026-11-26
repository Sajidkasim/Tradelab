## Summary
- What changed and why?

## Affected Modules
- [ ] Daily Journal (`/journal`)
- [ ] Strategy Lab (`/lab`)
- [ ] Mindset & Compound Edge (`/mindset`)
- [ ] Backtesting (`/backtesting`)
- [ ] The Matrix (`/matrix`)
- [ ] Learn & Trading Floor (`/learn`)
- [ ] Backend / Database / Auth (`webapp/`, `core/`, `services/`)

## Verification
- [ ] `cd frontend && npm test && npm run build`
- [ ] `pytest -q`
- [ ] Playwright E2E checked (Light, Dark, and Mobile `390px` for UI changes)
- [ ] No `.env`, `.db`, or secret files staged
