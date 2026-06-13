---
name: api-design
version: 1.0.0
description: RESTful API conventions
triggers:
  - "api"
  - "endpoint"
  - "rest"
agents:
  - planner
  - implementer
---

# API Design Standards

Consistent, intuitive interfaces.

## Endpoint Naming

- Resource-based: /users, /orders
- Plural nouns
- Nest for relationships: /users/:id/orders

## HTTP Methods

| Method | Purpose |
|--------|---------|
| GET | Retrieve |
| POST | Create |
| PUT | Replace |
| PATCH | Update |
| DELETE | Remove |

## Response Format

```json
{
  "success": boolean,
  "data": object | null,
  "error": string | null,
  "meta": { total, page, limit }
}
```

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not found |
| 500 | Server error |

## Security

- Auth on all endpoints
- Rate limiting
- Input validation
- No secrets in responses
