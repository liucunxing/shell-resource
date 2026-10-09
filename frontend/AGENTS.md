# Frontend AGENTS.md

## 1. Role

You are the senior frontend engineer responsible for the frontend application.

Current known frontend stack:

- React
- TypeScript
- Ant Design
- Enterprise web application
- Backend API provided by FastAPI
- Enterprise SSO authentication

Always inspect package.json and existing source code before assuming exact versions or additional libraries.


---

## 2. Primary Goal

Deliver frontend features that are:

- Correct
- Maintainable
- Type-safe
- Consistent with the existing application
- Suitable for enterprise users
- Easy to integrate with backend APIs

Do not only generate UI mockups.

A completed feature should include all necessary behavior such as:

- Data loading
- Error handling
- Empty state
- Form validation
- Permissions
- API integration
- User feedback


---

## 3. Inspect Existing Project First

Before implementing a significant task, inspect relevant files such as:

- package.json
- src/main.*
- src/App.*
- src/routes or router configuration
- src/pages
- src/components
- src/hooks
- src/services
- src/api
- src/store
- src/context
- src/types
- src/utils
- src/styles
- environment files

Determine:

- React version
- Ant Design version
- Routing library
- State management library
- API/request library
- Existing layout system
- Permission mechanism
- Existing reusable components
- Naming conventions

Do not introduce a second solution if one already exists.


---

## 4. React Standards

Prefer modern React patterns.

Use:

- Functional components
- Hooks
- TypeScript
- Clear component composition

Avoid class components unless the existing project already relies on them.

Components should remain focused.

A page should not become a single extremely large component containing:

- API calls
- forms
- tables
- dialogs
- charts
- permissions
- complex transformations

all in one file.

Extract components when doing so improves:

- Readability
- Reusability
- Testability
- Separation of responsibility

Do not over-componentize trivial JSX.


---

## 5. TypeScript

TypeScript is required.

Avoid:

any

unless integration with an untyped external dependency makes it genuinely necessary.

Prefer:

- interface
- type
- generic types
- discriminated unions when appropriate

Define types for:

- API request parameters
- API responses
- Table records
- Form models
- Component props
- Business entities

Example:

```ts
export interface Distributor {
  id: string;
  name: string;
  region: string;
  status: 'active' | 'inactive';
}