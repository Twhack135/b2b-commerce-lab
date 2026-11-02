# ADR 0002: Identity and authorization principles

Status: accepted (Sprint 11)

## Decision

Two different questions are answered by two different mechanisms:

| Question | Mechanism | Header | Status |
| -------- | --------- | ------ | ------ |
| Is the caller the shop server? | **Service key** (`SHOP_SERVICE_KEY`) | `X-Shop-Service-Key` | implemented |
| Which person acts, and for which customer? | **User session** (ADR 0003) | separate, not `X-Shop-Service-Key` | future |
| May this person do this for this B2B unit? | **Authorization in the ERP** (ADR 0004) | – | future |

Principles:

1. **A service key never authorizes customer data.** It only proves that a
   request comes from the shop server. Every customer endpoint will require
   a valid user session and an authorization check in addition.
2. The service key is not sent as `Authorization: Bearer`; that header is
   not read by the service check, so the two cannot be mixed up.
3. **Deny by default:** without a valid key `/shop/v1` answers 401; without
   a configured key 503 (fail closed, ADR 0006).
4. Business context is derived on the server, never taken from the client:
   Sold-to, Bill-to and Payer come from the B2B unit, the sales area from the
   unit, the pricing date is the server's date, the Ship-to must be one of the
   unit's Ship-tos. The client only chooses among options the server offered.
5. Foreign or unknown objects answer **404**, never 403, so that their
   existence is not revealed.
6. Error answers name no reasons that help an attacker (which check failed,
   whether a key was configured, stack traces).

## Current state (Sprint 11)

Service key check only (`ShopServiceGuard`, constant-time comparison of
SHA-256 digests). There are no users, logins or sessions. The shop shows no
sign-in, so nothing looks like working access control.

## Future

Users, sessions and unit authorization (ADR 0003, 0004). An external
identity provider (OIDC, e.g. SAP Cloud Identity Services) can replace the
local login later without changing the authorization rules.
