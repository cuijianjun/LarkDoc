# AGENTS.md

## Project
- Languages: Python, JavaScript
- Editor: VS Code on macOS
- Stack: see package.json / requirements.txt

## Build & Test
- Python tests: pytest <target_file_or_module>
- JS tests: npm test -- <path>
- Never run the full test suite unless explicitly requested.

## Coding Rules
- Write minimal code that satisfies the current task.
- Do not add unused functions, helpers, or abstractions.
- Do not refactor unrelated files.
- Do not change existing tests unless the task requires it.
- Prefer small, focused functions and clear names.

## Testing Rules
- Only run tests for the current module or changed files.
- If adding a feature, add tests only for that feature.
- If fixing a bug, add or update the smallest failing test first.
- Stop after the affected tests pass; do not run unrelated suites.

## Workflow
1. Read the current spec or task.
2. Identify the smallest set of files to change.
3. Implement the change.
4. Run only the affected tests.
5. Stop when the acceptance criteria are met.