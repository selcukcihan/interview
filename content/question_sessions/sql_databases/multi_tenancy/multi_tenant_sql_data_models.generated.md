# Multi-Tenant SQL Data Models


## Question

How would you model multi-tenant data in a SQL database, and what are the tradeoffs between shared tables, schema-per-tenant, and database-per-tenant?

## Shared Tables

All tenants use the same tables, and every tenant-owned row carries a `tenant_id`.

```sql
CREATE TABLE projects (
    tenant_id bigint NOT NULL,
    project_id bigint NOT NULL,
    name text NOT NULL,
    PRIMARY KEY (tenant_id, project_id)
);
```

```text
projects
  tenant 10, project 1
  tenant 10, project 2
  tenant 42, project 1
```

Advantages:

- operationally simple;
- efficient for many small tenants;
- one schema migration updates everyone;
- connections and infrastructure can be shared.

Risks:

- a missing tenant predicate can expose another tenant's data;
- large tenants can create noisy-neighbor problems;
- per-tenant backup and restore are difficult;
- indexes and large tables contain every tenant's data.

Queries and indexes usually begin with `tenant_id`:

```sql
SELECT *
FROM projects
WHERE tenant_id = 42 AND project_id = 1;
```

The database should enforce tenant-aware keys and relationships, rather than relying only on application conventions.

## Schema per Tenant

Each tenant receives a separate schema inside the same database cluster.

```text
tenant_10.projects
tenant_42.projects
```

Advantages:

- stronger logical separation;
- fewer accidental cross-tenant queries;
- some tenant-specific customization is possible.

Risks:

- migrations must run across many schemas;
- thousands of schemas and tables increase catalog and operational overhead;
- connection search paths and schema routing must be correct;
- tenants still share the same database server resources and failure domain.

## Database per Tenant

Each tenant receives a separate logical database or database cluster.

```text
tenant 10 -> database A
tenant 42 -> database B
```

Advantages:

- strongest isolation of the three models;
- independent scaling, backup, restore, and maintenance;
- useful for compliance, data residency, and large enterprise tenants.

Risks:

- provisioning and migrations are harder;
- connection pools can multiply across databases;
- fleet-wide reporting requires querying many databases;
- many small databases can be expensive and operationally burdensome.

## Hybrid Model

Many systems use a hybrid design:

```text
many small tenants -> shared database
large tenant A     -> dedicated database
regulated tenant B -> dedicated regional database
```

A tenant directory maps each `tenant_id` to its current database or shard. This allows tenants to move as their size or isolation requirements change, but migrations require careful routing and data-copy procedures.

## Choosing a Model

Use shared tables when tenant count is high, most tenants are small, and operational simplicity matters. Use separate databases when isolation, independent scaling, restore, compliance, or data residency justify the cost. Schema-per-tenant sits between them but often inherits shared-cluster limits while creating substantial schema-management work.

The choice is not only about security. It changes:

- indexing and constraints;
- connection pooling;
- migrations;
- backup and restore;
- analytics;
- sharding;
- failure blast radius;
- cost per tenant.

## Interview Sentence

> I would begin with the tenant's isolation, scale, compliance, backup, and operational requirements. Shared tables with `tenant_id` are usually the simplest model for many small tenants, but tenant identity must be part of queries, indexes, uniqueness constraints, and foreign keys, ideally with database-level enforcement such as row-level security. Database-per-tenant provides stronger isolation and independent operations at higher cost. A practical large SaaS system often uses a hybrid model: shared storage for most tenants and dedicated databases or shards for unusually large or regulated tenants.
