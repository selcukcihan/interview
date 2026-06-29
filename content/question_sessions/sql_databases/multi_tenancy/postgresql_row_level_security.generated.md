# PostgreSQL Row-Level Security for Multi-Tenancy


## Question

How can PostgreSQL enforce tenant isolation using Row-Level Security?

## What RLS Does

PostgreSQL Row-Level Security, or RLS, lets the database decide which rows a database role may see or modify. It acts in addition to ordinary table privileges.

Without RLS, the application must remember the tenant predicate:

```sql
SELECT *
FROM projects
WHERE tenant_id = 42;
```

With RLS, even this query is restricted:

```sql
SELECT * FROM projects;
```

Conceptually, PostgreSQL applies the policy as though the query included:

```sql
WHERE tenant_id = current_tenant
```

## Concrete Shared-Table Setup

```sql
CREATE TABLE projects (
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    PRIMARY KEY (tenant_id, project_id)
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

CREATE POLICY projects_tenant_isolation
ON projects
FOR ALL
TO app_user
USING (
    tenant_id = current_setting('app.tenant_id')::uuid
)
WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
);
```

`USING` controls which existing rows are visible to `SELECT`, `UPDATE`, and `DELETE`. `WITH CHECK` controls which new row values may be created by `INSERT` or `UPDATE`.

Therefore, tenant 42 cannot insert a row labelled as tenant 99:

```sql
INSERT INTO projects (tenant_id, project_id, name)
VALUES ('99999999-9999-4999-8999-999999999999', gen_random_uuid(), 'Stolen project');
```

The policy rejects it rather than trusting the application's SQL.

## Where the Tenant ID Comes From

The application must authenticate the request and derive the tenant from trusted server-side data, not blindly accept a tenant ID supplied by the client.

For each request that uses the database:

```sql
BEGIN;

SELECT set_config(
    'app.tenant_id',
    '42424242-4242-4242-8242-424242424242',
    true
);

SELECT * FROM projects;

COMMIT;
```

The third argument `true` makes the custom setting transaction-local. It is automatically discarded at transaction end.

```text
HTTP request
  -> authenticate user
  -> resolve user's tenant
  -> borrow pooled DB connection
  -> BEGIN
  -> set transaction-local tenant context
  -> execute queries under RLS
  -> COMMIT/ROLLBACK
  -> return connection to pool
```

Using transaction-local context is important because pooled connections are reused by unrelated requests. A session-level setting that is not reliably reset could let the next request inherit the previous tenant's identity.

## Alternative: One PostgreSQL Role per Tenant

Policies can use `current_user` instead:

```sql
CREATE POLICY tenant_policy ON projects
USING (tenant_name = current_user)
WITH CHECK (tenant_name = current_user);
```

The application then changes or connects as the tenant-specific database role. This can provide a direct security identity but becomes operationally cumbersome with thousands of tenants and interacts poorly with connection pooling. A shared, unprivileged application role plus transaction-local tenant context is often easier for SaaS applications.

## Roles That Bypass RLS

RLS is not enforced against every role:

- superusers bypass RLS;
- roles granted `BYPASSRLS` bypass it;
- table owners normally bypass it;
- `FORCE ROW LEVEL SECURITY` makes the table owner subject to policies in normal operation.

The application should therefore connect using a dedicated non-owner role without `SUPERUSER` or `BYPASSRLS`. Migration and administration roles should be separate.

If RLS is enabled but no applicable policy exists, PostgreSQL uses default deny for normal row access. RLS does not replace ordinary `GRANT` permissions; both layers must allow the operation.

## What RLS Does Not Solve

RLS is defense in depth, not a complete multi-tenancy architecture. It does not by itself provide:

- fair CPU, memory, I/O, or connection usage between tenants;
- per-tenant backup and restore;
- separate encryption keys;
- independent scaling or failure domains;
- automatic tenant-aware uniqueness unless constraints include `tenant_id`;
- protection when the application uses an RLS-bypassing role.

Constraints can also reveal limited information across tenants. For example, a globally unique email constraint may reveal that an unseen value already exists. Tenant-scoped uniqueness should normally include `tenant_id`:

```sql
UNIQUE (tenant_id, email)
```

## Operational Rules

- Put `tenant_id` in primary keys, foreign keys, unique constraints, and useful index prefixes.
- Use a non-owner application role that cannot bypass RLS.
- Set tenant context locally inside every transaction.
- Fail closed when tenant context is missing.
- Test `SELECT`, `INSERT`, `UPDATE`, and `DELETE`, including attempts to change `tenant_id`.
- Test pooled-connection reuse between two different tenants.
- Keep policy expressions simple where possible; complex subqueries add cost and security complexity.
- Give background jobs, support tools, migrations, and backups explicit role designs.

## Interview Sentence

> PostgreSQL RLS enforces tenant predicates in the database rather than relying on every application query to include `tenant_id`. I would use shared tables with tenant-aware keys, enable and force RLS, connect through a non-owner role without `BYPASSRLS`, and set a trusted tenant ID as transaction-local context whenever a pooled connection is borrowed. `USING` restricts visible existing rows, while `WITH CHECK` prevents inserts or updates from assigning rows to another tenant. RLS prevents many accidental data leaks, but it does not solve noisy neighbors, tenant-specific backup, or physical isolation.

## Source

- [PostgreSQL: Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [PostgreSQL: CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)
