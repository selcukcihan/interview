# Keyset Pagination


## Question

What is keyset pagination?

## 2026-06-17

### Clue

Offset pagination says:

```text
skip N rows, then give me the next page
```

Keyset pagination says:

```text
continue after the last row I saw
```

### Offset Pagination

Example:

```sql
SELECT id, name, created_at
FROM products
ORDER BY created_at DESC
OFFSET 100000
LIMIT 50;
```

Problem: the database may still need to walk through or sort the first 100,000 rows before returning 50.

Deep pages get expensive.

### Keyset Pagination

First page:

```sql
SELECT id, name, created_at
FROM products
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Suppose the last row in the page is:

```text
created_at = 2026-06-17T10:00:00Z
id = 123
```

Next page:

```sql
SELECT id, name, created_at
FROM products
WHERE (created_at, id) < ('2026-06-17T10:00:00Z', 123)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Useful index:

```sql
CREATE INDEX ON products (created_at DESC, id DESC);
```

### Why Include `id`?

`created_at` may not be unique.

If many rows have the same timestamp, pagination can skip or duplicate rows unless the order is deterministic.

Adding `id` gives a stable tie-breaker:

```text
ORDER BY created_at DESC, id DESC
```

### Tradeoffs

Keyset pagination is good for:

- infinite scroll,
- feeds,
- timelines,
- product listings,
- large tables.

It is less convenient for:

- jumping directly to page 500,
- showing exact total page counts,
- arbitrary sorting by many columns.

### Interview Sentence

> Keyset pagination avoids deep offset scans by using the last seen sort key as the cursor. Instead of `OFFSET 100000 LIMIT 50`, it asks for rows after the last `(created_at, id)` from the previous page. With a matching index, the database can continue from a known position rather than scanning and discarding many rows.
