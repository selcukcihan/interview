# Kubernetes Service Mesh Proxying


Split from [kubernetes_core_concepts_pods_nodes_resources_rollouts.generated.md](./kubernetes_core_concepts_pods_nodes_resources_rollouts.generated.md).

## Service Mesh Proxying

The key idea: a service mesh moves service-to-service networking concerns out of application code and into proxies.

Without a service mesh:

```text
payments-api -> orders-api
```

The `payments-api` code or its HTTP client may need to handle:

- retries,
- timeouts,
- TLS,
- authentication between services,
- metrics,
- tracing,
- traffic splitting,
- circuit breaking.

With a service mesh:

```text
payments-api container
  -> local proxy sidecar
    -> network
      -> remote proxy sidecar
        -> orders-api container
```

The application still thinks it is calling `orders-api`, but much of the networking policy is handled by the proxies.

### Concrete Example

Pod A:

```text
Pod: payments-api
  container: payments-api
  sidecar: envoy-proxy
```

Pod B:

```text
Pod: orders-api
  container: orders-api
  sidecar: envoy-proxy
```

When `payments-api` calls `orders-api`:

```text
payments-api
  -> localhost / redirected outbound traffic
  -> payments Envoy sidecar
  -> encrypted mTLS connection
  -> orders Envoy sidecar
  -> orders-api
```

The sidecars can enforce policies such as:

```text
payments-api is allowed to call orders-api
payments-api is not allowed to call admin-api
use mTLS for service-to-service traffic
retry failed calls up to 2 times
send 5% of traffic to orders-api:v2
emit latency/error metrics
attach distributed tracing headers
```

### Data Plane vs Control Plane

Service meshes usually have two parts.

Data plane:

```text
the proxies that sit next to workloads and handle traffic
```

Example:

```text
Envoy sidecars
```

Control plane:

```text
the system that configures those proxies
```

Examples:

```text
Istio control plane
Linkerd control plane
Consul service mesh
```

The control plane does not carry every application request. It distributes configuration and policy to the proxies.

### Why Use It?

Service mesh is useful when service-to-service communication becomes hard to manage consistently.

Common benefits:

- automatic mutual TLS between services,
- consistent retries/timeouts,
- traffic splitting for canary releases,
- service-level authorization policies,
- metrics without changing every app,
- distributed tracing support,
- circuit breaking / outlier detection,
- safer communication in a large microservice system.

### Costs and Tradeoffs

Service mesh is not free.

Costs:

- more operational complexity,
- more moving parts,
- proxy CPU/memory overhead,
- debugging becomes more layered,
- misconfigured retries can amplify traffic,
- sidecar lifecycle and startup/shutdown order matter.

For a small system, a service mesh may be overkill. For a large microservice platform, it can centralize important network behavior.

### Sidecar vs Sidecarless Mesh

Classic service meshes often use sidecars:

```text
one proxy per application Pod
```

Some newer approaches use node-level proxies or sidecarless designs. The core idea is the same: service-to-service traffic is mediated by infrastructure-controlled proxies rather than every app implementing all networking policy itself.

### Interview Sentence

> Service mesh proxying means service-to-service traffic is routed through infrastructure-managed proxies, often sidecars like Envoy running in each Pod. The app still makes normal network calls, but the proxy layer handles cross-cutting concerns like mTLS, retries, timeouts, traffic splitting, authorization, metrics, and tracing. The data plane is the proxies carrying traffic; the control plane configures those proxies. It is powerful for large microservice systems but adds operational complexity and resource overhead.
