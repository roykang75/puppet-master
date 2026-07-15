# Claude Code Guidelines

## Complexity
- File must not exceed 1000 LOC
- Function must not exceed 150 LOC (soft — review when crossed; JSX/route handlers naturally inflate; threshold was 100 → 150 after R17 audit showed most JSX components cluster at 110-160)
- Cyclomatic complexity <= 10 (hard — primary quality gate)
- Nesting depth <= 3 (hard — use early returns and guard clauses)
- Maximum 5 parameters per function (use parameter objects for more)

## Architecture
- No cyclic dependencies
- Enforce strict layer boundaries — upper layers may only call the layer directly below
- Cross-cutting concerns (logging, auth, metrics) must go through dedicated middleware/interceptors, not scattered inline
- Separate interface from implementation — except for single-use code where abstraction adds no value
- One responsibility per module (Single Responsibility Principle)
- Depend on abstractions, not concretions (Dependency Inversion) — skip for single-use or trivial components
- Components must communicate through defined interfaces, not by reaching into internals
- Avoid God objects — no single class/module owning more than one domain concept
- Infrastructure details (DB schema, API contracts, file formats) must be isolated behind adapters
- Configuration must be externalized — no environment-specific logic hardcoded in business logic
- Feature flags must be managed centrally, not scattered across the codebase
- Prefer Open/Closed principle — extend behavior through new code, not by modifying existing code

## Domain-Driven Design

### Strategic Design
- Identify and define Bounded Contexts explicitly
- Define a Context Map to document relationships between Bounded Contexts
- Avoid sharing domain models across Bounded Contexts — use separate models per context
- Establish an Ubiquitous Language per Bounded Context — use it consistently in code, tests, and docs
- Event-driven communication between Bounded Contexts (avoid direct cross-domain calls)

### Tactical Design
- Identify Aggregates and enforce invariants within Aggregate boundaries
- Access Aggregates only through the Aggregate Root — never reference internal entities directly
- Keep Aggregates small — large Aggregates cause contention and performance issues
- Use Value Objects for concepts with no identity (Money, Address, DateRange)
- Prefer Value Objects over primitives for domain concepts (avoid Primitive Obsession)

### Domain Model
- Domain logic must live in the domain layer — not in services, controllers, or repositories
- Domain layer must not depend on infrastructure
- Avoid Anemic Domain Model — entities must contain behavior, not just data
- Domain events must represent something that happened in the past (e.g. `OrderPlaced`, `PaymentFailed`)
- Domain events must be immutable

### Repository
- One Repository per Aggregate Root — not per entity
- Repository interface must be defined in the domain layer, implementation in infrastructure

### Application Layer
- Application services orchestrate use cases — they must not contain domain logic
- One use case per application service method

## Testing
- All public methods require tests
- Bug fixes must include regression tests
- Test names must describe behavior, not implementation (`should return empty list when input is null`, not `test_null`)
- Aim for >= 80% code coverage on business logic
- Unit tests must not depend on external systems (DB, network, file system)

## Code Style
- Prefer composition over inheritance
- Avoid magic numbers — use named constants
- Prefer immutable objects
- Use meaningful names: variables (noun), functions (verb), booleans (`is`, `has`, `can` prefix)
- Remove dead code that YOUR changes introduced — for pre-existing dead code, mention it but do not delete

## Error Handling
- Never silently swallow exceptions for realistic scenarios — do not add error handling for impossible cases
- Always log with sufficient context (what failed, where, why)
- Distinguish recoverable vs unrecoverable errors explicitly
- Return typed errors instead of raw exceptions where possible

## Security
- Never hardcode credentials, tokens, or secrets
- Sanitize and validate all external inputs
- Do not log sensitive data (PII, tokens, passwords)

## Dependencies
- Do not introduce new external dependencies without confirmation
- Prefer stdlib over third-party for simple utilities
- Pin versions when adding new packages
- Regularly audit and update dependencies for security patches

## Task Scope
- Do not refactor code outside the task scope
- Do not add features not explicitly requested
- Ask before modifying shared utilities or interfaces

## Confirmation Checkpoints
- Before deleting files, confirm with user
- Before changing public API signatures, confirm with user
- List planned changes before executing on tasks with 3+ file modifications

## Git / Change Hygiene
- One logical change per commit
- Do not mix refactor and feature in the same change
- Leave TODO comments with ticket/issue references, not bare TODOs

## Communication Style
- When uncertain about intent, ask before implementing
- Summarize what was changed and why after completing a task
- Flag assumptions made during implementation