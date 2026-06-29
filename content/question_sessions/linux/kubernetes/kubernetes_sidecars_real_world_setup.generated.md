# Kubernetes Sidecars and Real-World Setup


Split from [kubernetes_core_concepts_pods_nodes_resources_rollouts.generated.md](./kubernetes_core_concepts_pods_nodes_resources_rollouts.generated.md).

## Sidecar Concept

The key idea: a sidecar is a helper container that runs in the same Pod as the main application container.

```text
Pod
  main container: payments-api
  sidecar: envoy-proxy
```

They are scheduled together, start together, and die together as one Pod unit.

Containers in the same Pod share:

- the same Pod IP,
- the same network namespace,
- `localhost`,
- optionally shared volumes.

So the app can talk to the sidecar through:

```text
localhost:15001
```

and the sidecar can talk to the app through:

```text
localhost:8080
```

### Why Use a Sidecar?

Use a sidecar when a helper concern should be tightly attached to the app instance, but you do not want that logic inside the app process.

Common examples:

- service mesh proxy, such as Envoy/Istio sidecar,
- log shipper,
- metrics exporter,
- config reloader,
- TLS certificate refresher,
- local caching proxy,
- database proxy,
- file synchronization helper.

### Sidecar vs Separate Service

Use a sidecar when the helper is per-Pod and tightly coupled to one app instance.

Use a separate Deployment/Service when the helper is shared independently by many apps.

Example:

```text
sidecar:
  one Envoy proxy per payments-api Pod

separate service:
  one Redis Deployment used by many apps
```

The sidecar scales with the app because every replica gets its own helper.

## Concrete Real-World Setup

Imagine an e-commerce company running a payments API.

The cluster has:

```text
namespace: payments

Deployment: payments-api
Service: payments-api
Ingress: api.company.com/payments
ConfigMap: payments-api-config
Secret: payments-api-secrets
HorizontalPodAutoscaler: payments-api-hpa
```

### Nodes

The cluster has worker nodes:

```text
node-a: 8 CPU, 32 GB RAM
node-b: 8 CPU, 32 GB RAM
node-c: 8 CPU, 32 GB RAM
```

Kubernetes schedules Pods onto these nodes.

### Deployment

The Deployment says:

```text
Run 4 replicas of payments-api.
Each replica is a Pod.
Use image payments-api:v42.
Roll out changes gradually.
```

Conceptually:

```text
Deployment: payments-api
  Pod payments-api-1 on node-a
  Pod payments-api-2 on node-b
  Pod payments-api-3 on node-c
  Pod payments-api-4 on node-a
```

### Pod Shape

Each Pod contains multiple containers:

```text
Pod: payments-api-1
  container: app
    image: payments-api:v42
    listens on localhost/pod-ip port 8080

  container: envoy-sidecar
    image: envoy
    handles mTLS, retries, telemetry, traffic policy

  container: metrics-exporter
    image: app-metrics-exporter
    exposes metrics for Prometheus
```

The Pod has one IP, for example:

```text
10.2.4.17
```

All containers in that Pod share that IP and can talk on `localhost`.

Inside the Pod:

```text
app -> localhost:15001 -> envoy sidecar -> network
envoy sidecar -> localhost:8080 -> app
metrics exporter -> localhost:8080/metrics -> app metrics endpoint
```

### Service

Pods are disposable, so clients do not call Pod IPs directly.

The Service gives a stable name:

```text
Service: payments-api
  selects Pods with label app=payments-api
  forwards to port 8080 on ready Pods
```

Other services call:

```text
http://payments-api.payments.svc.cluster.local
```

or usually just:

```text
http://payments-api
```

from the same namespace.

### Ingress

External users come through an Ingress or load balancer:

```text
client
  -> api.company.com/payments
    -> Ingress controller
      -> Service payments-api
        -> ready payments-api Pod
```

The Ingress handles external HTTP routing. The Service handles stable internal routing to Pods.

### ConfigMap and Secret

The app gets non-sensitive config from a ConfigMap:

```text
PAYMENT_PROVIDER_URL
FEATURE_FLAG_X
LOG_LEVEL
```

It gets sensitive config from a Secret:

```text
DATABASE_PASSWORD
STRIPE_API_KEY
JWT_SIGNING_KEY
```

These are injected as environment variables or mounted files.

### Resource Sharing

Each app container has requests/limits:

```yaml
app:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"

envoy-sidecar:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "512Mi"
```

Important: sidecars consume resources too. A Pod's total request is the sum of its containers' requests.

So if the app asks for `500m` CPU and Envoy asks for `100m`, the scheduler must place a Pod requiring at least `600m` CPU.

### Rolling Update With Live Traffic

Current state:

```text
4 Pods running payments-api:v42
Service routes only to Ready Pods
```

New release:

```text
payments-api:v43
```

Kubernetes rollout:

1. Create one new `v43` Pod.
2. Wait for readiness probe to pass.
3. Add new Pod to Service endpoints.
4. Stop sending new traffic to one old `v42` Pod.
5. Send `SIGTERM` to old Pod.
6. App drains in-flight requests.
7. Repeat until all Pods are `v43`.

During rollout:

```text
Service endpoints:
  v42, v42, v42, v43
  v42, v42, v43, v43
  v42, v43, v43, v43
  v43, v43, v43, v43
```

If a new Pod fails readiness, Kubernetes should not send traffic to it.

### How Sidecars Affect Rollouts

A Pod is Ready only when its readiness conditions pass.

If the app is healthy but the sidecar is broken, the Pod may not be useful.

Common sidecar rollout concerns:

- sidecar must start before app traffic flows,
- app must shut down gracefully with sidecar still available,
- sidecar resource limits must be sized correctly,
- sidecar version upgrades can affect all app traffic,
- debugging includes both app logs and sidecar logs.

### Concrete Mental Model

```text
Cluster
  Namespace: payments
    Deployment: payments-api
      ReplicaSet: payments-api-v43
        Pod: payments-api-abc
          container: app
          container: envoy-sidecar
          container: metrics-exporter
        Pod: payments-api-def
          container: app
          container: envoy-sidecar
          container: metrics-exporter
    Service: payments-api
      routes to Ready Pods
    Ingress:
      api.company.com/payments -> Service payments-api
```

### Interview Sentence

> A sidecar is a helper container that runs in the same Pod as the main app and shares the Pod network namespace and often volumes. It is useful for per-instance concerns like service mesh proxying, log shipping, metrics, certificate refresh, or config reloads. In a real setup, a `payments-api` Deployment might run four Pods, each containing the app container plus an Envoy sidecar and metrics exporter. A Service gives stable routing to ready Pods, an Ingress exposes the app externally, ConfigMaps and Secrets inject configuration, and rolling updates replace Pods gradually while readiness probes and graceful shutdown protect live traffic.
