# N+1 Query Problem


## Question

What is the N+1 query problem?

## 2026-06-17

### Clue

N+1 means:

```text
1 query to fetch a list
then N more queries to fetch related data for each item
```

Each query may look harmless, but together they create many database round trips.

### Example

First query:

```sql
SELECT id, name
FROM products
WHERE category_id = 10
LIMIT 50;
```

Then application code loops:

```text
for each product:
  SELECT AVG(rating)
  FROM reviews
  WHERE product_id = ?
```

For 50 products:

```text
1 product query + 50 review queries = 51 queries
```

If the page grows to 500 products:

```text
501 queries
```

### Why It Hurts

N+1 causes:

- many network round trips,
- repeated query parsing/planning/execution,
- high database CPU,
- connection pool pressure,
- endpoint latency that grows with result size.

### Fixes

Batch query:

```sql
SELECT product_id, AVG(rating)
FROM reviews
WHERE product_id IN (1, 2, 3, ...)
GROUP BY product_id;
```

Join:

```sql
SELECT p.id, p.name, AVG(r.rating)
FROM products p
LEFT JOIN reviews r ON r.product_id = p.id
WHERE p.category_id = 10
GROUP BY p.id, p.name
LIMIT 50;
```

Precomputed summary:

```text
product_rating_summary
  product_id
  average_rating
  review_count
```

### ORM Version

N+1 often appears with ORMs.

Example:

```text
products = Product.where(category_id: 10)
for product in products:
  print(product.reviews.average_rating)
```

The code looks simple, but the ORM may lazily fetch reviews one product at a time.

Fix with eager loading, batching, joins, or explicit read models.

### Interview Sentence

> The N+1 problem happens when an endpoint does one query to load N parent records, then performs one additional query per record to load related data. It creates excessive database round trips and query volume. I would fix it by batching related reads, using joins or eager loading where appropriate, or precomputing summaries for hot paths.
