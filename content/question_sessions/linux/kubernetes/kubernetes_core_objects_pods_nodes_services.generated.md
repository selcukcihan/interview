# Kubernetes Core Objects, Pods, Nodes, Services, Resources, and Rollouts


## Question

What is a Pod, what is a Node, can multiple apps run on one Kubernetes cluster, how do they share resources, and how do we update applications receiving live traffic?

## 2026-06-16

### Clue

The key idea: Kubernetes is a desired-state scheduler and reconciler for containerized workloads.

You do not usually say:

```text
run this container on this exact machine forever
```

You say:

```text
I want 5 healthy copies of this app, with these CPU/memory needs, reachable through this stable service name.
```

Kubernetes keeps trying to make reality match that desired state.

## The Main Objects

### Cluster

A Kubernetes cluster is the whole system:

```text
control plane + worker nodes
```

The control plane stores desired state and makes decisions. Worker nodes run application workloads.

### Node

A Node is a machine in the cluster.

It can be:

- a VM,
- a physical server,
- a cloud instance.

Each worker node usually runs:

- `kubelet`: node agent,
- container runtime: usually `containerd` or `CRI-O`,
- networking components,
- Pods.

Mental model:

```text
Node = machine capacity
```

It contributes CPU, memory, disk, and network capacity to the cluster.

### Pod

A Pod is the smallest schedulable unit in Kubernetes.

It usually contains one application container:

```text
Pod
  container: api
```

But it can contain multiple tightly coupled containers:

```text
Pod
  container: api
  container: log-sidecar
```

Containers in the same Pod share:

- network namespace,
- IP address,
- ports,
- often volumes.

That means containers in the same Pod can talk over:

```text
localhost
```

Mental model:

```text
Pod = one deployable runtime unit
```

Not:

```text
Pod = entire application
```

An app is often many Pods managed by higher-level objects.

### Deployment

A Deployment manages replicated stateless Pods.

Example:

```text
Deployment: api
replicas: 5
image: api:v2
```

Kubernetes tries to keep 5 matching Pods running.

If one Pod dies, a controller creates another.

### ReplicaSet

A ReplicaSet ensures a number of matching Pods exist.

Deployments create/manage ReplicaSets during rollouts.

Usually users think in terms of Deployments, not ReplicaSets directly.

### Service

Pods are temporary. They can be created, destroyed, replaced, and assigned new IPs.

A Service gives a stable network identity in front of matching Pods.

Example:

```text
Service: api
  selects Pods with app=api
  sends traffic to healthy api Pods
```

Other apps call:

```text
http://api
```

not:

```text
http://pod-ip-1
```

Mental model:

```text
Deployment = keeps Pods running
Service    = gives stable access to Pods
```

### Namespace

A Kubernetes namespace is a logical partition inside a cluster.

Teams/apps/environments may be separated like:

```text
namespace: payments
namespace: search
namespace: staging
namespace: monitoring
```

Namespaces help organize and apply policies/quotas, but they are not as strong as separate clusters.

## Can Multiple Apps Run on One Cluster?

Yes. This is one of the main points of Kubernetes.

Example:

```text
Cluster
  namespace: payments
    deployment: payments-api
    deployment: payments-worker
    service: payments-api

  namespace: search
    deployment: search-api
    deployment: indexer
    service: search-api

  namespace: monitoring
    deployment: prometheus
    deployment: grafana
```

They share the same cluster infrastructure, but Kubernetes can separate and control them with:

- namespaces,
- labels/selectors,
- resource requests/limits,
- quotas,
- network policies,
- RBAC,
- node pools,
- taints/tolerations,
- affinity/anti-affinity.

## How Do Apps Share Resources?

Nodes provide finite capacity:

```text
node-1: 8 CPU, 32 GB RAM
node-2: 8 CPU, 32 GB RAM
node-3: 8 CPU, 32 GB RAM
```

Pods ask for resources.

Example:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

### Requests

Requests are used for scheduling.

If a Pod requests:

```text
500m CPU and 512Mi memory
```

the scheduler looks for a node with that much unallocated requested capacity.

Mental model:

```text
request = please reserve enough room for me
```

### Limits

Limits are enforcement ceilings.

Mental model:

```text
limit = do not let me exceed this much
```

CPU over limit usually means throttling.

Memory over limit can mean the container is killed with OOMKilled.

### Noisy Neighbors

Multiple apps share nodes, so Kubernetes uses requests/limits and policies to reduce noisy-neighbor problems.

If app A has no limit and consumes too much CPU/memory, it can hurt app B on the same node.

That is why production clusters usually set:

- requests,
- limits,
- namespace quotas,
- priority classes,
- separate node pools for special workloads.

### Scheduler

The scheduler chooses which node a Pod should run on.

It considers:

- requested CPU/memory,
- node capacity,
- labels,
- taints/tolerations,
- affinity/anti-affinity,
- topology spread,
- volume constraints.

Simplified:

```text
Pod needs 1 CPU and 1Gi memory
scheduler finds a suitable node
kubelet on that node starts the Pod
```

## Updating Applications Receiving Live Traffic

For stateless applications, the usual mechanism is a rolling update through a Deployment.

Initial state:

```text
Deployment api, replicas=4, image=api:v1

Pods:
  api-v1-a
  api-v1-b
  api-v1-c
  api-v1-d

Service api sends traffic to all ready Pods
```

Update desired state:

```text
image: api:v2
```

Kubernetes gradually creates new Pods and removes old Pods.

Example:

```text
start api-v2-a
wait until ready
send some traffic to api-v2-a
terminate api-v1-a
start api-v2-b
wait until ready
terminate api-v1-b
...
```

The Service only sends traffic to Pods that are Ready.

### Readiness Probe

A readiness probe tells Kubernetes:

```text
is this Pod ready to receive traffic?
```

If not ready, it should not be included in Service endpoints.

This is critical for live traffic updates.

### Liveness Probe

A liveness probe tells Kubernetes:

```text
is this container stuck and should it be restarted?
```

Do not confuse readiness and liveness.

Readiness controls traffic. Liveness controls restart.

### Rolling Update Controls

Deployments have settings like:

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

Meaning:

- `maxUnavailable: 0`: keep all desired replicas available during update.
- `maxSurge: 1`: allow one extra Pod temporarily during rollout.

### Graceful Shutdown

When an old Pod is being removed:

1. Kubernetes marks it terminating.
2. It is removed from Service endpoints.
3. It receives `SIGTERM`.
4. App should stop accepting new work and finish in-flight requests.
5. After grace period, Kubernetes sends `SIGKILL` if it is still running.

Apps receiving live traffic should handle:

- `SIGTERM`,
- connection draining,
- readiness going false before shutdown,
- in-flight requests,
- database migrations/backward compatibility.

## What Happens During a Request?

Simplified internal flow:

```text
client
  -> Service api
    -> ready Pod api-v2-a or api-v1-c
      -> container process
```

The client does not need to know Pod IPs.

During rollout, Service endpoints change:

```text
before: api-v1-a, api-v1-b, api-v1-c, api-v1-d
during: api-v1-b, api-v1-c, api-v1-d, api-v2-a
after:  api-v2-a, api-v2-b, api-v2-c, api-v2-d
```

## Interview Sentence

> A Kubernetes cluster is made of control-plane components and worker Nodes. A Node is a machine that contributes compute capacity. A Pod is the smallest schedulable unit and usually wraps one application container, though it can contain sidecars that share the Pod network namespace. Multiple apps can run on the same cluster, separated by namespaces, labels, RBAC, quotas, network policies, and resource requests/limits. Deployments manage replicated Pods, Services provide stable traffic routing to ready Pods, and rolling updates replace old Pods with new ones gradually while readiness probes and graceful shutdown protect live traffic.

## Follow-Up Angles

- Pods are ephemeral; Services provide stable access.
- Requests are for scheduling; limits are for enforcement.
- Namespaces are organizational/policy boundaries, not hard multi-tenant isolation by themselves.
- Stateful apps need extra care: StatefulSets, persistent volumes, ordered rollout, backups, schema compatibility.
- Zero-downtime rollout requires app-level compatibility, not just Kubernetes settings.
