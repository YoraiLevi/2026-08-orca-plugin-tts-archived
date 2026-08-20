# Spec Kit ("speckit") — workflow, templates, and adoption plan

**Researched**: 2026-08-20 · **Source of truth**: `github/spec-kit` @ `abfc66b670c81b9758f1f47f18f7fea0f48686cf` (main, 2026-08-20), latest release **v0.16.5** (2026-08-19).

## Verdict

- **"speckit" is GitHub's Spec Kit** (`github/spec-kit`, MIT), an agent-agnostic toolkit for Spec-Driven Development shipped as the `specify` CLI. No ambiguity: every other GitHub hit for the term is a project *using* it, not a rival tool by that name. The commands are literally namespaced `speckit.*`.
- **It is not installed here.** `which specify` → not found. `uvx` is present at `/Users/m5air/.local/bin/uvx`, so bootstrapping is one command away. Nothing was installed.
- **Adopt it — partially.** Adopt the artifact set and the templates (constitution, spec, plan, tasks, checklist) and the phase discipline. That is where the value is: familiar headings, testable requirements, `[NEEDS CLARIFICATION]` markers, story-sliced task graphs.
- **Skip the machinery we don't need**: extensions, presets, bundles, `taskstoissues`, the branch-per-feature hook. They add config surface for a solo/small-team plugin project with no Jira, no GitHub issue workflow, no compliance regime.
- **Constitution and our memory files are complementary, not duplicative.** Spec Kit's `.specify/memory/constitution.md` = *immutable engineering principles* (durable, rarely edited, gate for `analyze`). Our `STATE.md`/`HANDOFF.md`/`PITFALLS.md` = *session-mutable project state* (where we are, what bit us). Keep both; put a one-line cross-reference in each. Do not put project status in the constitution and do not put principles in HANDOFF.

## The workflow

The exact command sequence, from the README's Get Started and the Available Slash Commands table. In Claude Code these install as **skills**, so they are invoked `/speckit.constitution` (slash-command mode) or `$speckit-constitution` / `/skill:speckit-constitution` (skills mode) — see "Adoption plan".

| # | Phase | Command | Input | Output artifact | Path |
|---|-------|---------|-------|-----------------|------|
| 0 | Bootstrap | `specify init` (CLI, not a slash command) | integration choice | framework files + agent commands | `.specify/`, `.claude/skills/speckit.*/SKILL.md` |
| 1 | Principles | `/speckit.constitution` | prose principles | constitution | `.specify/memory/constitution.md` |
| 2 | Specify | `/speckit.specify` | feature description (what + why, no stack) | feature spec + quality checklist | `specs/NNN-slug/spec.md`, `specs/NNN-slug/checklists/requirements.md` |
| 3 | Clarify *(optional, recommended)* | `/speckit.clarify` | — | spec, amended in place | `specs/NNN-slug/spec.md` |
| 4 | Plan | `/speckit.plan` | tech stack + architecture choices | plan + Phase 0/1 design docs | `specs/NNN-slug/plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/` |
| 5 | Tasks | `/speckit.tasks` | — | dependency-ordered task list | `specs/NNN-slug/tasks.md` |
| 6 | Checklist *(optional)* | `/speckit.checklist` | domain/focus | custom quality checklist | `specs/NNN-slug/checklists/<name>.md` |
| 7 | Analyze *(optional, recommended)* | `/speckit.analyze` | — | **read-only** consistency report (no file written) | console |
| 8 | Implement | `/speckit.implement` | optional task filter | code + checked-off tasks | source tree, `tasks.md` |
| 9 | Converge *(optional)* | `/speckit.converge` | — | remaining work appended as new tasks | `specs/NNN-slug/tasks.md` |
| — | Issues *(optional)* | `/speckit.taskstoissues` | — | GitHub issues | github.com |

Notes drawn from the command templates:

- The feature directory name is `NNN-slug` by default (`sequential` numbering; `timestamp` = `YYYYMMDD-HHMMSS-slug` if `.specify/init-options.json` sets `feature_numbering: "timestamp"`). The resolved path is persisted to `.specify/feature.json` so downstream commands find it **without relying on the git branch name** (`templates/commands/specify.md`, step 3).
- `plan.md` is written by `/speckit.plan`; **`tasks.md` is explicitly not** — that is `/speckit.tasks`' output (`templates/plan-template.md`, Documentation tree).
- `/speckit.analyze` is **STRICTLY READ-ONLY** and "MUST run only after `/speckit.tasks` has successfully produced a complete `tasks.md`" (`templates/commands/analyze.md`, Goal + Operating Constraints).
- Every command has extension-hook pre/post checks against `.specify/extensions.yml`. With no extensions installed, they no-op silently.

## Templates

Reproduced verbatim from `templates/` at commit `abfc66b`. `__SPECKIT_COMMAND_*__` placeholders are substituted with the agent's real invocation syntax at install time.

### Constitution — `templates/constitution-template.md`

```markdown
# [PROJECT_NAME] Constitution
<!-- Example: Spec Constitution, TaskFlow Constitution, etc. -->

## Core Principles

### [PRINCIPLE_1_NAME]
<!-- Example: I. Library-First -->
[PRINCIPLE_1_DESCRIPTION]
<!-- Example: Every feature starts as a standalone library; Libraries must be self-contained, independently testable, documented; Clear purpose required - no organizational-only libraries -->

### [PRINCIPLE_2_NAME]
<!-- Example: II. CLI Interface -->
[PRINCIPLE_2_DESCRIPTION]
<!-- Example: Every library exposes functionality via CLI; Text in/out protocol: stdin/args → stdout, errors → stderr; Support JSON + human-readable formats -->

### [PRINCIPLE_3_NAME]
<!-- Example: III. Test-First (NON-NEGOTIABLE) -->
[PRINCIPLE_3_DESCRIPTION]
<!-- Example: TDD mandatory: Tests written → User approved → Tests fail → Then implement; Red-Green-Refactor cycle strictly enforced -->

### [PRINCIPLE_4_NAME]
<!-- Example: IV. Integration Testing -->
[PRINCIPLE_4_DESCRIPTION]
<!-- Example: Focus areas requiring integration tests: New library contract tests, Contract changes, Inter-service communication, Shared schemas -->

### [PRINCIPLE_5_NAME]
<!-- Example: V. Observability, VI. Versioning & Breaking Changes, VII. Simplicity -->
[PRINCIPLE_5_DESCRIPTION]
<!-- Example: Text I/O ensures debuggability; Structured logging required; Or: MAJOR.MINOR.BUILD format; Or: Start simple, YAGNI principles -->

## [SECTION_2_NAME]
<!-- Example: Additional Constraints, Security Requirements, Performance Standards, etc. -->

[SECTION_2_CONTENT]
<!-- Example: Technology stack requirements, compliance standards, deployment policies, etc. -->

## [SECTION_3_NAME]
<!-- Example: Development Workflow, Review Process, Quality Gates, etc. -->

[SECTION_3_CONTENT]
<!-- Example: Code review requirements, testing gates, deployment approval process, etc. -->

## Governance
<!-- Example: Constitution supersedes all other practices; Amendments require documentation, approval, migration plan -->

[GOVERNANCE_RULES]
<!-- Example: All PRs/reviews must verify compliance; Complexity must be justified; Use [GUIDANCE_FILE] for runtime development guidance -->

**Version**: [CONSTITUTION_VERSION] | **Ratified**: [RATIFICATION_DATE] | **Last Amended**: [LAST_AMENDED_DATE]
<!-- Example: Version: 2.1.1 | Ratified: 2025-06-13 | Last Amended: 2025-07-16 -->
```

`/speckit.constitution` also prepends a **Sync Impact Report** as an HTML comment at the top of the file after each update, and overwrites `.specify/memory/constitution.md` in place (`templates/commands/constitution.md`, steps 4 and 6).

### Spec — `templates/spec-template.md`

```markdown
# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`

**Created**: [DATE]

**Status**: Draft

**Input**: User description: "$ARGUMENTS"

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.

  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently - e.g., "Can be fully tested by [specific action] and delivers [specific value]"]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
2. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

### User Story 3 - [Brief Title] (Priority: P3)

[Describe this user journey in plain language]

**Why this priority**: [Explain the value and why it has this priority level]

**Independent Test**: [Describe how this can be tested independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right edge cases.
-->

- What happens when [boundary condition]?
- How does system handle [error scenario]?

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST [specific capability, e.g., "allow users to create accounts"]
- **FR-002**: System MUST [specific capability, e.g., "validate email addresses"]
- **FR-003**: Users MUST be able to [key interaction, e.g., "reset their password"]
- **FR-004**: System MUST [data requirement, e.g., "persist user preferences"]
- **FR-005**: System MUST [behavior, e.g., "log all security events"]

*Example of marking unclear requirements:*

- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, OAuth?]
- **FR-007**: System MUST retain user data for [NEEDS CLARIFICATION: retention period not specified]

### Key Entities *(include if feature involves data)*

- **[Entity 1]**: [What it represents, key attributes without implementation]
- **[Entity 2]**: [What it represents, relationships to other entities]

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: [Measurable metric, e.g., "Users can complete account creation in under 2 minutes"]
- **SC-002**: [Measurable metric, e.g., "System handles 1000 concurrent users without degradation"]
- **SC-003**: [User satisfaction metric, e.g., "90% of users successfully complete primary task on first attempt"]
- **SC-004**: [Business metric, e.g., "Reduce support tickets related to [X] by 50%"]

## Assumptions

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right assumptions based on reasonable defaults
  chosen when the feature description did not specify certain details.
-->

- [Assumption about target users, e.g., "Users have stable internet connectivity"]
- [Assumption about scope boundaries, e.g., "Mobile support is out of scope for v1"]
- [Assumption about data/environment, e.g., "Existing authentication system will be reused"]
- [Dependency on existing system/service, e.g., "Requires access to the existing user profile API"]
```

### Plan — `templates/plan-template.md`

```markdown
# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
```

### Tasks — `templates/tasks-template.md`

Full template is 252 lines; the load-bearing structure, verbatim (sample task bodies elided where marked, since the command is instructed to delete them anyway):

```markdown
---

description: "Task list template for feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: The examples below include test tasks. Tests are OPTIONAL - only include them if explicitly requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- **Web app**: `backend/src/`, `frontend/src/`
- **Mobile**: `api/src/`, `ios/src/` or `android/src/`
- Paths shown below assume single project - adjust based on plan.md structure

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create project structure per implementation plan
- [ ] T002 Initialize [language] project with [framework] dependencies
- [ ] T003 [P] Configure linting and formatting tools

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

Examples of foundational tasks (adjust based on your project):

- [ ] T004 Setup database schema and migrations framework
- [ ] T005 [P] Implement authentication/authorization framework
- [ ] T006 [P] Setup API routing and middleware structure
- [ ] T007 Create base models/entities that all stories depend on
- [ ] T008 Configure error handling and logging infrastructure
- [ ] T009 Setup environment configuration management

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 1 (OPTIONAL - only if tests requested) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T010 [P] [US1] Contract test for [endpoint] in tests/contract/test_[name].py
- [ ] T011 [P] [US1] Integration test for [user journey] in tests/integration/test_[name].py

### Implementation for User Story 1

- [ ] T012 [P] [US1] Create [Entity1] model in src/models/[entity1].py
- [ ] T013 [P] [US1] Create [Entity2] model in src/models/[entity2].py
- [ ] T014 [US1] Implement [Service] in src/services/[service].py (depends on T012, T013)
- [ ] T015 [US1] Implement [endpoint/feature] in src/[location]/[file].py
- [ ] T016 [US1] Add validation and error handling
- [ ] T017 [US1] Add logging for user story 1 operations

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - [Title] (Priority: P2)
[... same shape ...]

## Phase 5: User Story 3 - [Title] (Priority: P3)
[... same shape ...]

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] TXXX [P] Documentation updates in docs/
- [ ] TXXX Code cleanup and refactoring
- [ ] TXXX Performance optimization across all stories
- [ ] TXXX [P] Additional unit tests (if requested) in tests/unit/
- [ ] TXXX Security hardening
- [ ] TXXX Run quickstart.md validation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - May integrate with US1/US2 but should be independently testable

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- Models before services
- Services before endpoints
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Models within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
```

### Checklist — `templates/checklist-template.md`

```markdown
# [CHECKLIST TYPE] Checklist: [FEATURE NAME]

**Purpose**: [Brief description of what this checklist covers]
**Created**: [DATE]
**Feature**: [Link to spec.md or relevant documentation]

**Note**: This custom checklist is generated by the `/speckit.checklist` command based on feature context and requirements.
**Review Ownership**: This checklist is a reviewer-owned requirements-quality review artifact. Mark an item `[x]` only when the reviewer determines the requirements-quality criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.

## [Category 1]

- [ ] CHK001 First checklist item with clear action
- [ ] CHK002 Second checklist item
- [ ] CHK003 Third checklist item

## [Category 2]

- [ ] CHK004 Another category item
- [ ] CHK005 Item with specific criteria
- [ ] CHK006 Final item in this category

## Notes

- Mark items `[x]` only after review confirms the requirement-quality criterion is satisfied
- Leave items unchecked when they still require clarification, correction, or reviewer evaluation
- `/speckit.implement` reads checklist checkbox state as a gate and must not modify markers
- `checklists/requirements.md` has a separate built-in lifecycle maintained by `/speckit.specify` and `/speckit.clarify`
- Add comments or findings inline
- Link to relevant resources or documentation
- Items are numbered sequentially for easy reference
```

### The built-in spec-quality checklist

`/speckit.specify` always emits `specs/NNN-slug/checklists/requirements.md` with this fixed body, then self-validates the spec against it, iterating up to 3 times (`templates/commands/specify.md`, step 8):

```markdown
# Specification Quality Checklist: [FEATURE NAME]

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: [DATE]
**Feature**: [Link to spec.md]

## Content Quality

- [ ] No implementation details (languages, frameworks, APIs)
- [ ] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous
- [ ] Success criteria are measurable
- [ ] Success criteria are technology-agnostic (no implementation details)
- [ ] All acceptance scenarios are defined
- [ ] Edge cases are identified
- [ ] Scope is clearly bounded
- [ ] Dependencies and assumptions identified

## Feature Readiness

- [ ] All functional requirements have clear acceptance criteria
- [ ] User scenarios cover primary flows
- [ ] Feature meets measurable outcomes defined in Success Criteria
- [ ] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before /speckit.clarify or /speckit.plan
```

## Principles

Stated in the README's Core Philosophy, `spec-driven.md`, and enforced mechanically by the templates:

- **Specifications become executable.** "Code has been king — specifications were just scaffolding... Spec-Driven Development changes this: specifications become executable, directly generating working implementations rather than just guiding them." (README)
- **Intent before mechanism.** The spec defines the *what* and *why*; the plan defines the *how*. `/speckit.specify` is explicitly told: "Focus on the **what** and **why**, not the tech stack." The quality checklist fails the spec if implementation details leak in.
- **Multi-step refinement, not one-shot generation.** Four sequential artifacts (constitution → spec → plan → tasks) with gates between them, rather than prompt→code.
- **Bounded ambiguity.** `[NEEDS CLARIFICATION: specific question]` markers are the ambiguity channel — but capped: "**LIMIT: Maximum 3 [NEEDS CLARIFICATION] markers total**", prioritized "scope > security/privacy > user experience > technical details". Everything else gets an informed default, recorded in the Assumptions section. `/speckit.clarify` asks up to 5 targeted questions and writes answers back into the spec.
- **Testable requirements, technology-agnostic success criteria.** "Each requirement must be testable"; "Each criterion must be verifiable without implementation details" (`templates/commands/specify.md`, flow steps 5–6).
- **Independently testable, prioritized user stories.** Each story is a standalone MVP slice — developable, testable, deployable, demonstrable on its own.
- **The constitution is non-negotiable and gates the plan.** `plan.md` has a Constitution Check gate that must pass *before* Phase 0 research and be re-checked after Phase 1 design. `/speckit.analyze` treats constitution conflicts as automatically **CRITICAL**, requiring the spec/plan/tasks to change — "not dilution, reinterpretation, or silent ignoring of the principle."
- **Complexity must be justified in writing.** `plan.md`'s Complexity Tracking table: Violation | Why Needed | Simpler Alternative Rejected Because.
- **Historical note on TDD:** `spec-driven.md` describes an "Article III: Test-First Imperative (NON-NEGOTIABLE)" — no code before failing, user-approved tests. But the *current* `tasks` command has relaxed this: "**Tests are OPTIONAL**: Only generate test tasks if explicitly requested in the feature specification or if user requests TDD approach." If we want test tasks, **we must say so in the spec or the constitution.** (See adoption plan.)

## User story / acceptance criteria format

Exact shape, per `templates/spec-template.md`:

```markdown
### User Story N - [Brief Title] (Priority: PN)

[Journey in plain language]

**Why this priority**: [value + why this rank]

**Independent Test**: [how this can be tested standalone]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [expected outcome]
```

Requirements are `**FR-NNN**: System MUST …` / `Users MUST be able to …`. Success criteria are `**SC-NNN**: [measurable, technology-agnostic outcome]`.

### Worked example for the ORCA TTS plugin

```markdown
### User Story 1 - Speak the current selection (Priority: P1)

A user reading a long agent answer in ORCA highlights a paragraph, presses the
speak hotkey, and hears it read aloud in a natural voice. They press the hotkey
again and playback stops immediately. Nothing about their editing state changes.

**Why this priority**: This is the smallest slice that delivers the product's core
value — the agent gaining a voice — with no dependency on streaming, chunking, or
conversation UI. It is demonstrable in one keystroke and is the MVP.

**Independent Test**: Can be fully tested by selecting text in an ORCA session,
pressing the hotkey, and confirming audible speech matching the selection, with a
second press halting it — no huddle mode, no auto-speak, no settings UI required.

**Acceptance Scenarios**:

1. **Given** a non-empty text selection in an ORCA session, **When** the user presses
   the speak hotkey, **Then** audio playback of that exact text begins within 1 second.
2. **Given** audio is currently playing, **When** the user presses the speak hotkey again,
   **Then** playback stops within 200 ms and no further audio is emitted.
3. **Given** an empty selection, **When** the user presses the speak hotkey, **Then** no
   audio plays and a non-blocking notice explains that nothing is selected.
4. **Given** the configured speech engine is unreachable, **When** the user presses the
   speak hotkey, **Then** a non-blocking error surfaces naming the engine, and the
   ORCA session remains fully usable.

---

### User Story 2 - Hear agent replies as they stream (Priority: P2)

With huddle mode enabled, the user asks a question and hears the agent's answer spoken
in digestible chunks as it streams, rather than waiting for the full reply. They can
mute mid-answer without cancelling the agent's work.

**Why this priority**: Delivers the conversational experience, but depends on the
playback pipeline proven by US1 and on tapping the reply stream, so it follows P1.

**Independent Test**: Enable huddle mode, send one prompt, and confirm speech begins
before the reply finishes rendering and that muting stops audio while text keeps
streaming.

**Acceptance Scenarios**:

1. **Given** huddle mode is on, **When** an agent reply begins streaming, **Then** the
   first complete sentence is spoken before the reply has finished rendering.
2. **Given** a reply is being spoken, **When** the user mutes, **Then** audio stops
   within 200 ms and the agent's reply continues to stream and render unaffected.
3. **Given** a reply contains a fenced code block, **When** it is spoken, **Then** the
   code block is not read verbatim and is announced as a code block instead.

### Edge Cases

- What happens when the user changes the selection while audio is still playing?
- How does the system handle a reply that streams faster than speech can keep up?
- What happens when the audio output device disappears mid-playback?
- How does the system handle text containing emoji, URLs, or non-Latin scripts?

## Requirements

### Functional Requirements

- **FR-001**: System MUST speak the user's current text selection on a single hotkey press.
- **FR-002**: System MUST stop playback immediately on a second press of the same hotkey.
- **FR-003**: System MUST segment streaming agent replies into speakable chunks at
  sentence boundaries before the reply is complete.
- **FR-004**: System MUST surface engine failures without interrupting the ORCA session.
- **FR-005**: Users MUST be able to enable and disable huddle mode without restarting ORCA.
- **FR-006**: System MUST select a speech engine via [NEEDS CLARIFICATION: local-only,
  cloud, or user-configurable with a local default?]

## Success Criteria

### Measurable Outcomes

- **SC-001**: Audio begins within 1 second of the hotkey press for selections up to 500 words.
- **SC-002**: In huddle mode, the first spoken word occurs no more than 2 seconds after the
  agent's reply starts streaming.
- **SC-003**: Stopping playback takes effect within 200 ms in 99% of attempts.
- **SC-004**: A first-time user can enable huddle mode and hear a spoken reply without
  consulting documentation.
```

Note what is absent by design: no engine name, no Python module, no class, no audio library. Those belong in `plan.md`'s Technical Context.

## Adoption plan for this repo

**Recommendation: partial adopt — artifacts and templates yes, tooling installed but lightly used, ecosystem features skipped.**

### Proposed layout

```text
orca-plugin-tts/
├── STATE.md                     # ours — where we are right now
├── HANDOFF.md                   # ours — what the next agent needs; add a pointer to the constitution
├── PITFALLS.md                  # ours — what bit us
├── .specify/
│   ├── memory/
│   │   └── constitution.md      # Spec Kit — durable engineering principles (the gate)
│   ├── templates/               # Spec Kit — the 5 templates, verbatim
│   ├── scripts/bash/            # Spec Kit — prerequisite/path helper scripts
│   ├── .gitignore               # Spec Kit — ignores feature.json (machine-local)
│   └── integration.json, init-options.json, integrations/, workflows/
├── .claude/skills/speckit.*/SKILL.md   # 10 command skills (claude integration = skills mode)
├── specs/
│   └── 001-speak-selection/
│       ├── spec.md
│       ├── checklists/requirements.md
│       ├── plan.md
│       ├── research.md
│       ├── data-model.md
│       ├── quickstart.md
│       ├── contracts/
│       └── tasks.md
└── docs/
    ├── .research/               # ours — hot research (this file)
    └── .discussion/             # ours — open questions
```

### What we adopt

| Piece | Adopt? | Why |
|---|---|---|
| `spec.md` template + user-story format | **Yes** | Exactly the shape we need for user stories, flows, acceptance criteria. Reviewable, familiar. |
| `plan.md` + Technical Context + Constitution Check | **Yes** | This is where the class design and ORCA API decisions land, gated by principles. |
| `tasks.md` story-sliced, `[P]`/`[USn]`-labelled | **Yes** | Gives us the dependency graph and MVP ordering for free. |
| `.specify/memory/constitution.md` | **Yes** | Our engineering principles need a home that is not HANDOFF. |
| `research.md`, `data-model.md`, `contracts/`, `quickstart.md` | **Yes, as produced** | These are our failure-mode analysis and class-design homes. |
| `checklists/requirements.md` (auto) + `/speckit.checklist` | **Yes** | The failure-mode analysis fits a custom checklist ("unit tests for English"). |
| `/speckit.clarify` and `/speckit.analyze` | **Yes** | Cheap, read-only, catch drift between spec/plan/tasks. |
| Test tasks | **Yes — must opt in explicitly** | Tests default to OFF. We put "Test-First (NON-NEGOTIABLE)" in the constitution *and* state "tests required, TDD ordering" in the spec, so `/speckit.tasks` generates them. |
| Extensions / presets / bundles | **Skip** | Config surface with no payoff for one plugin and a small team. Revisit only if the spec format needs org-wide enforcement. |
| `/speckit.taskstoissues` | **Skip** | We have no GitHub issue workflow on this repo. |
| Branch-per-feature hook | **Skip** | Spec dir naming is independent of branch (`.specify/feature.json` holds the pointer). We keep working on `main`/topic branches as we already do. |
| `/speckit.implement` fully autonomous | **Partially** | Use it as a task-driver, not a hands-off build. Our quality bar wants human-gated increments at each Checkpoint. |

### How it coexists with STATE / HANDOFF / PITFALLS — no duplication

The split is by **mutability and audience**:

- **`.specify/memory/constitution.md` — principles.** Slow-changing, versioned (`Version | Ratified | Last Amended`), and *machine-enforced* by the plan's Constitution Check and by `/speckit.analyze`. Contains: test policy, ORCA-plugin boundary rules, latency budgets as standing constraints, "no vendor lock-in on TTS engines", complexity justification rules. Contains **no project status**.
- **`STATE.md` / `HANDOFF.md` — current position.** Fast-changing, human-read, not gated by anything. HANDOFF gains one line: *"Engineering principles live in `.specify/memory/constitution.md`; per-feature specs live in `specs/NNN-slug/`."* HANDOFF's "Where things live" section becomes the index into `specs/`. Nothing in HANDOFF restates a principle.
- **`PITFALLS.md` — empirical scar tissue.** Feeds the constitution and specs: a recurring pitfall gets promoted into a constitution principle or an FR; the pitfall entry then just cites it. Pitfalls stay chronological and raw.
- **`docs/.research/` → `specs/NNN-slug/research.md`.** Our cold→hot→cold lifecycle still governs *exploratory* research (ORCA API surface, `block/buzz` architecture, engine landscape). Once a feature is specified, Spec Kit's `research.md` holds the *decisions for that feature* and cites our `docs/.research/` artifacts. Research does not move; the feature research doc references it.
- **`docs/.discussion/`** stays ours and is where a `[NEEDS CLARIFICATION]` marker escalates to when it needs a Question + Options + Recommendation body rather than a 3-option inline table.

**One risk worth naming:** `/speckit.constitution` **overwrites** `.specify/memory/constitution.md` wholesale on each run. Treat that file as generated-by-command, and never hand-edit it in a way you would grieve losing — commit before running it. This belongs in PITFALLS once observed.

### Suggested first three features

1. `001-speak-selection` — the P1 MVP above.
2. `002-huddle-mode` — streaming, chunking, mute.
3. `003-engine-abstraction` — if the engine choice turns out to need its own spec rather than being a plan decision inside 001.

## Install

**Not executed.** Run from the repo root. `uvx` is present; `specify` is not installed.

```bash
# 1. Install the CLI, pinned to the release we researched
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.16.5

# verify
specify --version
specify self check          # read-only: is a newer release available?

# 2. Initialize IN PLACE, into this existing non-empty repo, for Claude Code.
#    --here      : use the current directory instead of creating a new one
#    --force     : allow init into a non-empty directory
#    --non-interactive : never hang on an arrow-key picker (required under an agent harness)
cd /Users/m5air/source/orca-plugin-tts
specify init --here --force --non-interactive --integration claude --script sh

# Optional: install the commands as Claude Code *skills* rather than slash-command files
# specify init --here --force --non-interactive --integration claude \
#     --integration-options="--skills"

# 3. Verify by effect, not by presence — the commands must actually be registered
ls .claude/skills/ | grep speckit          # expect 10 speckit.* entries
test -f .specify/memory/constitution.md && echo "constitution scaffold present"
ls .specify/templates/                     # expect the 5 templates

# 4. Commit the scaffold BEFORE running any command that overwrites it
git add .specify .claude specs && git commit -m "Bootstrap Spec Kit v0.16.5 scaffold"
```

Ephemeral alternative if we do not want a persistent tool install (note: `specify self upgrade` will refuse under `uvx`):

```bash
uvx --from git+https://github.com/github/spec-kit.git@v0.16.5 specify init \
    --here --force --non-interactive --integration claude --script sh
```

Then, in Claude Code, in order:

```text
/speckit.constitution   Principles for an ORCA TTS plugin: test-first is non-negotiable;
                        the plugin must never block or degrade the host ORCA session;
                        TTS engines are swappable behind one interface — no vendor lock-in;
                        every user-visible latency has a stated budget; complexity requires
                        written justification.

/speckit.specify        Speak the user's current text selection aloud in ORCA on a hotkey,
                        with a second press stopping playback. Tests are required — use TDD
                        ordering. [full description here]

/speckit.clarify
/speckit.plan           Python ORCA plugin; pluggable TTS backend; ...
/speckit.tasks
/speckit.analyze
/speckit.implement
```

**Prerequisites** (README): Linux/macOS/Windows · Python 3.11+ · `uv` (or pipx) · Git · a supported agent CLI. All satisfied here except the `specify` install itself.

## Sources

All read at `github/spec-kit` commit `abfc66b670c81b9758f1f47f18f7fea0f48686cf` (main branch, 2026-08-20), latest release tag `v0.16.5` (2026-08-19), MIT licensed.

- Repository — <https://github.com/github/spec-kit>
- `README.md` — get-started sequence, command tables, Core Philosophy, extensions/presets/bundles, prerequisites
- `spec-driven.md` — the constitutional foundation, Articles I–IX, "The Compound Effect"
- `templates/spec-template.md` — spec template, verbatim above
- `templates/plan-template.md` — plan template, verbatim above
- `templates/tasks-template.md` — tasks template, structure above
- `templates/constitution-template.md` — constitution template, verbatim above
- `templates/checklist-template.md` — checklist template, verbatim above
- `templates/commands/specify.md` — feature-dir resolution, `[NEEDS CLARIFICATION]` limit of 3, built-in quality checklist, 3-iteration validation loop
- `templates/commands/plan.md` — Phase 0 / Phase 1 outputs, constitution loading
- `templates/commands/tasks.md` — "Tests are OPTIONAL", required checklist task format, task organization rules
- `templates/commands/analyze.md` — read-only constraint, "Constitution Authority", must run after `tasks`
- `templates/commands/clarify.md` — up to 5 targeted questions, answers encoded back into the spec
- `templates/commands/constitution.md` — writes/overwrites `.specify/memory/constitution.md`, Sync Impact Report
- `src/specify_cli/integrations/claude/__init__.py` — Claude Code integration: `.claude/skills`, `$ARGUMENTS`, `/SKILL.md`, argument hints, no forked-context commands
- `tests/integrations/test_integration_base_markdown.py` (`_expected_files`) — the complete, authoritative file inventory `specify init` produces
- `src/specify_cli/shared_infra.py` — managed `.specify/.gitignore` content and rationale
- Docs site — <https://github.github.io/spec-kit/>
- Local environment check — `which specify` → not found; `uvx` → `/Users/m5air/.local/bin/uvx` (2026-08-20)
