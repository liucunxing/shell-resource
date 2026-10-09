# Shell Project - AGENTS.md

## 1. Project Overview

This repository is an enterprise web application with separate frontend and backend projects.

Current known architecture:

- Frontend:
  - React
  - TypeScript
  - Ant Design

- Backend:
  - Python 3.11
  - FastAPI

- Database:
  - PostgreSQL

- Authentication:
  - Enterprise SSO
  - Exact SSO protocol may be SAML / OIDC / OAuth2 depending on customer environment

- Data Platform:
  - Databricks may be integrated in some business scenarios

Repository structure:

shell/
├── frontend/
└── backend/

Frontend-specific rules are defined in:

frontend/AGENTS.md

Backend-specific rules are defined in:

backend/AGENTS.md


---

## 2. Core Working Principle

You are acting as a senior software engineer working on an existing enterprise project.

Your goal is NOT just to generate code.

Your responsibilities include:

1. Understand the requirement
2. Inspect the existing implementation
3. Identify reusable code
4. Design the smallest reasonable solution
5. Implement the change
6. Validate the implementation
7. Report what changed

When tools for file editing and terminal execution are available:

DO NOT only explain how to implement the change.

Inspect the project, modify the files, run validation commands, fix problems, and complete the task.


---

## 3. Before Writing Code

Before implementing a task, inspect the relevant existing code.

Do not assume architecture if it can be discovered from the repository.

For frontend tasks, inspect when relevant:

- package.json
- src/
- router
- pages
- components
- hooks
- services / api
- stores
- utils
- types
- styles
- environment configuration

For backend tasks, inspect when relevant:

- pyproject.toml
- requirements.txt
- main.py
- app/
- routers
- services
- repositories
- models
- schemas
- dependencies
- middleware
- database configuration
- authentication code
- environment configuration

Always prefer existing project conventions over introducing a new pattern.


---

## 4. Scope Control

Only modify files required for the current task.

Do NOT:

- Perform unrelated refactors
- Rename unrelated files
- Reformat the entire project
- Upgrade dependencies without a clear requirement
- Replace frameworks or libraries
- Introduce unnecessary abstractions
- Remove existing features
- Change API contracts without considering both frontend and backend
- Rewrite working modules simply because another design is preferred

If unrelated problems are discovered, mention them separately instead of changing them automatically.


---

## 5. Requirement Analysis

Before implementation, briefly identify:

- Business objective
- User action
- Required UI or API behavior
- Data source
- Permission requirements
- Validation rules
- Error scenarios
- Existing code that may be reused

Do not block development for minor ambiguity.

Make reasonable assumptions when the impact is small and state them.

Ask the user only when missing information materially changes:

- Business logic
- Security
- API contract
- Database design
- SSO integration
- Data ownership
- Destructive behavior


---

## 6. Frontend and Backend Coordination

When a requirement affects both frontend and backend:

Treat it as one end-to-end feature.

Check consistency of:

- URL
- HTTP method
- Request parameters
- Request body
- Response structure
- Field names
- Data types
- Pagination
- Error codes
- Authentication
- Authorization

Avoid temporary mismatches such as:

Frontend expects:

customerName

Backend returns:

customer_name

unless there is already a project-wide transformation convention.


---

## 7. API Contract

Before changing an API used by the frontend, determine whether the API already exists.

Avoid silently breaking existing consumers.

Typical API response conventions should follow the existing project.

Do not invent a new response wrapper if the project already has one.

For example, if the project uses:

{
  "data": ...,
  "message": ...,
  "code": ...
}

continue using it.

If the existing project directly returns REST resources, follow that style instead.


---

## 8. Authentication and SSO

This system uses enterprise SSO.

Do not implement authentication based on assumptions.

First inspect the existing authentication architecture.

SSO may use:

- SAML 2.0
- OpenID Connect
- OAuth 2.0
- Customer-specific Identity Provider

Typical responsibility separation:

Browser
→ Application
→ Backend authentication endpoint
→ Enterprise IdP
→ Backend callback / ACS
→ Backend establishes application identity/session
→ Frontend loads current user

The backend should normally own protocol-sensitive authentication logic.

The frontend should normally handle:

- Login redirect
- Login status
- Current user
- Route protection
- Permission-based UI
- Session expiration
- 401 / 403 handling

Never expose:

- Client secrets
- Private keys
- SAML certificates intended to remain private
- Database credentials
- Databricks secrets

inside frontend code.


---

## 9. Authorization

Authentication and authorization are different.

Do not assume that successful SSO login means the user may access every resource.

Where applicable distinguish:

- Page access
- Feature access
- Button/action permission
- Business role
- Data-level permission

Frontend authorization improves user experience.

Backend authorization is the security boundary.

Never rely only on frontend button hiding for security.


---

## 10. Database Changes

The primary database is PostgreSQL.

Before changing the database:

- Inspect existing schema/model patterns
- Inspect migration tooling
- Check naming conventions
- Check indexes
- Check constraints
- Check relationships

Never directly alter production database assumptions.

When schema changes are required:

- Update ORM model
- Update schema / DTO if required
- Add migration using the project's existing migration tool
- Consider backwards compatibility
- Consider existing data

Do not create destructive migrations unless explicitly required.


---

## 11. Databricks

Databricks integration may exist or may be introduced later.

Do not introduce Databricks dependencies unless the task requires them.

If Databricks is involved, clarify its role:

- Data source
- Analytics engine
- SQL Warehouse
- Lakehouse
- ETL output
- Batch processing
- Reporting dataset

Prefer keeping Databricks access in backend/data-access layers.

Frontend should not directly connect to Databricks.

Credentials must come from secure environment configuration or approved secret management.


---

## 12. Configuration

Environment-specific values must not be hardcoded.

Examples:

- API URLs
- Database URLs
- SSO endpoints
- Client IDs
- Databricks host
- Warehouse IDs
- Feature flags

Use the project's existing environment configuration mechanism.

Never commit:

- Passwords
- Tokens
- Client secrets
- Private keys
- Production credentials


---

## 13. Error Handling

Do not build only the success path.

Consider:

- Validation errors
- Authentication failure
- Authorization failure
- API timeout
- Network failure
- Database failure
- Empty data
- Duplicate requests
- Invalid data
- Downstream service failure

Errors presented to users should be understandable.

Internal technical detail should be logged appropriately but should not unnecessarily leak sensitive information to the UI.


---

## 14. Logging

Logging should help diagnose problems.

Good logs answer:

- What operation failed?
- Which request or business operation?
- Which downstream dependency?
- What category of failure?

Do not log sensitive information such as:

- Passwords
- Access tokens
- Session cookies
- Client secrets
- Private keys


---

## 15. Testing and Validation

After implementation, run the most relevant available checks.

Frontend examples:

- lint
- typecheck
- test
- build

Backend examples:

- lint
- formatting check
- type check
- unit tests
- API tests

Use the project's existing commands.

Do not invent commands without first inspecting project configuration.

If a command cannot be run, clearly state why.


---

## 16. Bug Fixing

When fixing a bug:

1. Reproduce or understand the symptom
2. Trace the execution path
3. Identify the root cause
4. Make the smallest appropriate fix
5. Check related behavior
6. Run validation

Do not hide symptoms with arbitrary fallback logic unless fallback behavior is a legitimate business requirement.


---

## 17. Engineering Quality

Code should prioritize:

1. Correctness
2. Readability
3. Maintainability
4. Consistency with existing code
5. Security
6. Appropriate performance

Avoid premature optimization.

Avoid unnecessary design patterns.

A simple solution is preferred when it clearly meets the requirement.


---

## 18. Communication Format

At the beginning of a substantial task, briefly report:

### Requirement Understanding

- What needs to be done
- Which modules are affected

### Implementation Plan

- Main files/modules
- Main implementation approach

Then proceed with implementation.

At completion report:

### Completed

- Major changes

### Files Changed

- Important files

### Validation

- Commands run
- Results

### Remaining / Need Confirmation

Only include items that genuinely require user input.

Do not provide long, repetitive development diaries.


---

## 19. Final Principle

Behave like an engineer responsible for delivering the feature, not like a tutorial generator.

Inspect first.
Understand existing architecture.
Modify only what is necessary.
Validate before declaring completion.