# Architecture Decision Records

Decisions about the customer shop and its security, taken in Sprint 11.
Each record separates what is **implemented** from what is **decided for
later sprints**; nothing in the "future" sections exists yet.

| ADR | Decision | Status |
| --- | -------- | ------ |
| [0001](0001-shop-bff-and-erp-shop-api.md) | Dedicated shop BFF and ERP shop API boundary | Accepted |
| [0002](0002-identity-and-authorization-principles.md) | Identity and authorization principles | Accepted |
| [0003](0003-sessions-and-password-hashing.md) | Server-side sessions and password hashing | Implemented (Sprint 12B) |
| [0004](0004-customer-and-unit-authorization.md) | Customer and B2B unit authorization | Data model (12A), session checks (12B), unit selection (12C) |
| [0005](0005-internal-and-customer-api-contracts.md) | Internal versus customer-facing API contracts | Accepted |
| [0006](0006-local-development-security.md) | Local development security and deployment restrictions | Accepted |
| [0007](0007-local-shop-user-administration.md) | Local shop user administration and unit selection | Implemented (Sprint 12C) |

Decided direction for later sprints (not implemented): [docs/roadmap.md](../roadmap.md).
