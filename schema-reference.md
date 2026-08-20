# Multi-tenant support-ticket system — full schema reference

Organized by category. Each table notes whether it's **MVP** (build first, this is what makes the project demo-able and interview-defensible) or **Stretch** (adds depth if you have time left, good talking points but not required to ship). Don't build everything before you start applying — MVP alone is a strong project.

---

## 1. Core tenancy & identity

### `tenants` — MVP
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | string | Company/org name |
| subdomain | string, unique | e.g. `acme` → acme.yourapp.com |
| plan | enum: `free`, `pro`, `enterprise` | Drives feature gating |
| status | enum: `active`, `suspended`, `trial` | Suspended tenants blocked at the guard level |
| created_at / updated_at | timestamp | |

### `users` — MVP
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK → tenants | |
| email | string, unique per tenant | |
| password_hash | string | bcrypt/argon2 |
| full_name | string | |
| role | enum: `owner`, `agent`, `customer` | Drives RBAC guards. Admin is a separate table, not a role value — see below |
| avatar_url | string, nullable | |
| is_active | boolean | Soft-disable instead of deleting |
| last_login_at | timestamp, nullable | |
| created_at / updated_at | timestamp | |

### `admins` — MVP
Separate entity from `users` — not a value of `users.role`. Admins authenticate
through their own login endpoint and manage tenant settings, users, and
categories. They are not part of the ticket-handling flow (creating,
assigning, or commenting on tickets stays with `users` roles owner/agent/
customer).

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK → tenants | |
| email | string, unique per tenant | |
| password_hash | string | bcrypt/argon2 |
| full_name | string | |
| avatar_url | string, nullable | |
| is_active | boolean | |
| last_login_at | timestamp, nullable | |
| created_at / updated_at | timestamp | |

### `teams` — Stretch
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| name | string | e.g. "Billing support" |
| description | string, nullable | |
| created_at | timestamp | |

### `team_members` — Stretch (join table)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| team_id | uuid FK → teams | |
| user_id | uuid FK → users | |

### `invitations` — Stretch
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| email | string | |
| role | enum (same as users.role) | |
| invited_by | uuid FK → users | |
| token | string, unique | |
| expires_at | timestamp | |
| accepted_at | timestamp, nullable | |
| created_at | timestamp | |

---

## 2. Ticketing core

### `categories` — MVP
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| name | string | |
| description | string, nullable | |
| created_at | timestamp | |

### `tickets` — MVP
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| category_id | uuid FK, nullable | |
| team_id | uuid FK, nullable | Stretch field, safe to include now |
| created_by | uuid FK → users | The customer who raised it |
| assigned_to | uuid FK → users, nullable | Must be role agent/admin |
| subject | string | |
| description | text | |
| status | enum: `open`, `in_progress`, `on_hold`, `resolved`, `closed` | |
| priority | enum: `low`, `medium`, `high`, `urgent` | |
| channel | enum: `web`, `email`, `chat`, `api` | Stretch — set default `web` for MVP |
| due_at | timestamp, nullable | |
| resolved_at | timestamp, nullable | |
| closed_at | timestamp, nullable | |
| created_at / updated_at | timestamp | |

### `comments` — MVP
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| ticket_id | uuid FK | |
| user_id | uuid FK | |
| body | text | |
| is_internal_note | boolean | Internal notes hidden from customer role — good RBAC talking point |
| created_at / updated_at | timestamp | |

### `attachments` — Stretch
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| ticket_id | uuid FK, nullable | |
| comment_id | uuid FK, nullable | Either ticket_id or comment_id set, not both |
| uploaded_by | uuid FK → users | |
| file_url | string | S3/Cloudinary URL |
| file_name | string | |
| file_size | integer | bytes |
| mime_type | string | |
| created_at | timestamp | |

### `tags` — Stretch
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| name | string | |
| color | string | hex code |

### `ticket_tags` — Stretch (join table)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| ticket_id | uuid FK | |
| tag_id | uuid FK | |

### `ticket_status_history` — Stretch
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| ticket_id | uuid FK | |
| changed_by | uuid FK → users | |
| old_status | enum (ticket status) | |
| new_status | enum (ticket status) | |
| changed_at | timestamp | |

Good talking point: this table alone demonstrates event-sourcing-lite thinking, which interviewers like.

---

## 3. Quality & SLAs — Stretch

### `sla_policies`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| name | string | |
| priority | enum (ticket priority) | Which priority this policy applies to |
| first_response_time_minutes | integer | |
| resolution_time_minutes | integer | |
| created_at | timestamp | |

### `sla_breaches`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| ticket_id | uuid FK | |
| sla_policy_id | uuid FK | |
| breach_type | enum: `first_response`, `resolution` | |
| breached_at | timestamp | |

### `customer_satisfaction_ratings`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| ticket_id | uuid FK, unique | One rating per ticket |
| rating | integer, 1-5 | |
| feedback | text, nullable | |
| submitted_at | timestamp | |

### `canned_responses`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| title | string | |
| body | text | |
| created_by | uuid FK → users | |
| created_at | timestamp | |

---

## 4. Notifications & audit — Stretch

### `notifications`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| user_id | uuid FK | Recipient |
| type | string | e.g. `ticket_assigned`, `new_comment` |
| payload | json | Flexible data for the notification |
| is_read | boolean | |
| created_at | timestamp | |

Good fit for a BullMQ background job — worth building even if you skip other stretch tables, since it's the "impressive piece" from the earlier plan.

### `audit_logs`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| user_id | uuid FK, nullable | Null for system actions |
| action | string | e.g. `ticket.status_changed` |
| entity_type | string | e.g. `ticket` |
| entity_id | uuid | |
| metadata | json | Before/after values |
| created_at | timestamp | |

---

## 5. Extensibility & billing — Stretch (skip unless you have real time to spare)

### `webhooks`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| url | string | |
| event_type | string | e.g. `ticket.created` |
| secret | string | For HMAC signature verification |
| is_active | boolean | |
| created_at | timestamp | |

### `integrations`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| provider | enum: `slack`, `email`, `api` | |
| config | json | Provider-specific settings |
| is_active | boolean | |
| created_at | timestamp | |

### `subscriptions`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK, unique | |
| plan | enum (same as tenants.plan) | |
| status | enum: `active`, `past_due`, `canceled` | |
| stripe_customer_id | string, nullable | |
| stripe_subscription_id | string, nullable | |
| current_period_end | timestamp, nullable | |
| created_at | timestamp | |

### `knowledge_base_articles`
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| category_id | uuid FK, nullable | |
| title | string | |
| body | text | |
| is_published | boolean | |
| created_by | uuid FK → users | |
| created_at / updated_at | timestamp | |

---

## Recommended build order

1. **MVP (weeks 1-3)**: tenants, users, categories, tickets, comments — auth, RBAC, and tenant isolation all get proven here.
2. **One standout stretch feature (week 4)**: pick `ticket_status_history` + `notifications` together — status changes trigger a queued notification job. This is the single best "impressive piece" for the time it costs.
3. **Everything else**: mention in your README as "designed but not implemented" with the schema included — interviewers respect a documented roadmap more than half-finished features.

Every `tenant_id`-bearing table above must be covered by your scoped-repository / Prisma middleware layer from the isolation design — that's the one piece of discipline that has to be consistent across all of them, MVP or not.
