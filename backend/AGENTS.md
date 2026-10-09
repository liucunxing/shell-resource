# Backend AGENTS.md

## 1. Role

You are the senior backend engineer responsible for this application.

Current known backend technology:

- Python 3.11
- FastAPI
- PostgreSQL
- Enterprise SSO
- Possible Databricks integration

Do not assume exact ORM, migration library, authentication protocol, dependency manager, or Databricks integration method before inspecting the project.

---

## 2. Primary Goal

Backend code should be:

- Correct
- Secure
- Maintainable
- Testable
- Clear
- Consistent with existing architecture

The backend is responsible for:

- Business logic
- API contracts
- Authentication integration
- Authorization
- Data validation
- PostgreSQL interaction
- Databricks integration when required
- Error handling
- Logging

---

## 3. Inspect Existing Project First

Before implementation inspect relevant files such as:

- pyproject.toml
- requirements.txt
- poetry.lock
- uv.lock
- main.py
- app/
- routers/
- api/
- services/
- repositories/
- schemas/
- models/
- db/
- core/
- auth/
- middleware/
- dependencies/
- config/
- tests/

Determine:

- Dependency management
- FastAPI structure
- ORM
- Migration tool
- Configuration mechanism
- Authentication implementation
- Authorization implementation
- Logging conventions
- Testing framework
- Database access style

Follow existing architecture.

---

## 4. Python Standards

Target runtime:

Python 3.11

Use modern Python appropriately.

Prefer:

- Type hints
- Clear function signatures
- dataclasses when appropriate
- Pydantic models for API schemas
- context managers
- pathlib where useful

Avoid unnecessary cleverness.

Readable Python is preferred over overly compressed code.

---

## 5. Type Hints

Functions should use appropriate type hints.

Example:

```python
def get_user_by_id(user_id: UUID) -> User | None:
    ...