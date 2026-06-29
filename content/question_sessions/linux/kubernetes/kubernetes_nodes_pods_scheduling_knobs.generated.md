# Kubernetes Nodes, Pods, Scheduling, and Scaling Knobs


Split from [kubernetes_core_concepts_pods_nodes_resources_rollouts.generated.md](./kubernetes_core_concepts_pods_nodes_resources_rollouts.generated.md).

## Nodes vs Pods

The clean relationship:

```text
Nodes provide capacity.
Pods consume capacity.
The scheduler places Pods onto Nodes.
```

A Node is a machine:

```text
node-a: 8 CPU, 32Gi memory
node-b: 8 CPU, 32Gi memory
node-c: 8 CPU, 32Gi memory
```

A Pod asks for resources:

```text
payments-api Pod:
  requests 600m CPU, 640Mi memory
```

Kubernetes can place many Pods on one Node as long as the Node has enough available requested capacity and satisfies placement rules.

Example:

```text
node-a capacity: 8 CPU, 32Gi memory

Pod 1 requests: 600m CPU, 640Mi
Pod 2 requests: 600m CPU, 640Mi
Pod 3 requests: 600m CPU, 640Mi
...
```

There is no fixed rule like:

```text
1 Node = 1 Pod
```

or:

```text
1 Node = 10 Pods
```

The number depends on:

- node size,
- Pod resource requests,
- system DaemonSet overhead,
- kubelet max Pod setting,
- networking/IP limits,
- storage constraints,
- placement rules,
- failure isolation goals.

### Knob 1: Deployment Replica Count

This controls desired Pod count for an app.

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 4
```

This means:

```text
Kubernetes should keep 4 Pods for this Deployment running.
```

If one dies, Kubernetes creates a replacement.

### Knob 2: Resource Requests and Limits

Requests affect scheduling.

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

If requests are too high, fewer Pods fit per Node.

If requests are too low, the scheduler may pack too many Pods onto a Node, causing runtime contention.

Mental model:

```text
replicas controls how many Pods you want
requests control where those Pods can fit
limits control how much they can burst or exceed
```

### Knob 3: Horizontal Pod Autoscaler

HPA changes the number of Pods based on metrics.

Example:

```text
min replicas: 4
max replicas: 20
target CPU: 60%
```

If traffic rises, HPA may increase:

```text
4 Pods -> 8 Pods -> 15 Pods
```

If traffic falls, it scales down.

This changes Pod count, not Node count directly.

### Knob 4: Cluster Autoscaler / Node Autoscaling

If HPA asks for more Pods but there is no room on existing Nodes, Pods become Pending.

Cluster autoscaler can then add Nodes.

Flow:

```text
traffic increases
HPA increases replicas
new Pods cannot fit
Pods stay Pending
cluster autoscaler adds worker Node
scheduler places Pending Pods
```

This changes Node count.

In managed Kubernetes, this usually means scaling a node group/node pool.

### Knob 5: Node Pools

Node pools let different workloads use different machine types.

Example:

```text
general-pool:
  normal web/API workloads

memory-pool:
  memory-heavy workloads

gpu-pool:
  ML workloads

spot-pool:
  cheaper interruptible workloads
```

You use labels, taints/tolerations, and affinity to guide Pods to the right pool.

### Knob 6: Node Selectors and Affinity

These control where Pods are allowed or preferred to run.

Example:

```yaml
nodeSelector:
  workload: payments
```

This says:

```text
only place this Pod on Nodes labeled workload=payments
```

Affinity can express softer or more complex preferences, such as:

```text
prefer spreading across zones
prefer not running two replicas on the same node
```

### Knob 7: Taints and Tolerations

Taints repel Pods from Nodes unless the Pod tolerates the taint.

Example:

```text
gpu node has taint: dedicated=gpu:NoSchedule
```

Only Pods with matching toleration can run there.

This prevents ordinary apps from accidentally landing on special Nodes.

### Knob 8: Topology Spread and Anti-Affinity

These control failure distribution.

You may want replicas spread like:

```text
Pod 1 -> node-a / zone-1
Pod 2 -> node-b / zone-2
Pod 3 -> node-c / zone-3
```

instead of all replicas on one Node.

This protects against one Node or zone failure taking down all replicas.

### Knob 9: PodDisruptionBudget

A PodDisruptionBudget controls voluntary disruptions.

Example:

```text
payments-api must keep at least 3 Pods available
```

During node drain or maintenance, Kubernetes should not evict too many Pods at once.

This does not choose Pod count by itself, but protects availability while Nodes are being changed.

### Concrete Example

Suppose:

```text
3 Nodes
each Node = 4 CPU, 8Gi memory
```

`payments-api` Deployment:

```text
replicas = 6
each Pod requests = 500m CPU, 512Mi memory
```

Total requested:

```text
6 * 500m = 3 CPU
6 * 512Mi = 3Gi memory
```

That can fit easily across 3 Nodes.

Now traffic increases and HPA scales to 30 Pods:

```text
30 * 500m = 15 CPU
30 * 512Mi = 15Gi memory
```

The cluster has:

```text
3 Nodes * 4 CPU = 12 CPU total
```

Not enough CPU request capacity. Some Pods stay Pending. Cluster autoscaler adds another Node or more Nodes if configured.

### The Mental Model

```text
replicas/HPA decide how many Pods should exist
requests decide how much capacity each Pod reserves
scheduler decides which Node each Pod lands on
cluster autoscaler decides whether more Nodes are needed
node pools decide what kind of Nodes are available
affinity/taints/topology rules decide placement constraints
```

### Interview Sentence

> Nodes and Pods are related through capacity and scheduling. Nodes provide CPU, memory, network, and storage capacity; Pods request some of that capacity; the scheduler places Pods onto Nodes that can satisfy those requests and placement rules. Kubernetes gives separate knobs for app scale with replicas and HPA, resource fit with requests and limits, infrastructure scale with cluster autoscaler and node pools, and placement/availability with affinity, taints/tolerations, topology spread, and PodDisruptionBudgets.

## Do Pods Know They Are on the Same Node?

Usually, application Pods should not depend on this.

Kubernetes wants workloads to be movable:

```text
Pod can be killed
Pod can be recreated
Pod can land on another Node
Node can disappear
Deployment can reschedule replicas elsewhere
```

So the default design is:

```text
communicate through Services, not by assuming physical co-location
```

### What Pods Can Know

A Pod can be told which Node it is running on through the Downward API:

```yaml
env:
  - name: NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
```

Then the app can see:

```text
NODE_NAME=node-a
```

But just knowing the node name does not automatically give special communication behavior.

### Same Node Does Not Mean Same Pod Network

Two Pods on the same Node still have separate network namespaces.

Example:

```text
node-a
  Pod api-1      IP 10.2.1.10
  Pod worker-1   IP 10.2.1.11
```

They do not share `localhost`.

Inside `api-1`:

```text
localhost = api-1 Pod
```

Inside `worker-1`:

```text
localhost = worker-1 Pod
```

If they communicate, they usually still use Pod IPs or, better, a Kubernetes Service.

### What Can Be Faster on the Same Node?

Traffic between Pods on the same Node may avoid leaving the machine, depending on the CNI/network plugin.

So it can be lower latency than cross-node traffic.

But application code normally should not assume that, because Kubernetes may reschedule either Pod later.

### When Co-Location Is Intentional

Kubernetes gives placement knobs when locality matters.

#### Pod Affinity

Pod affinity can say:

```text
try to place this Pod near Pods with label app=cache
```

or strictly:

```text
only place this Pod on a Node that already has matching Pods
```

#### Pod Anti-Affinity

Anti-affinity says the opposite:

```text
do not place all replicas on the same Node
```

This is common for availability.

Example:

```text
api replica 1 -> node-a
api replica 2 -> node-b
api replica 3 -> node-c
```

#### Topology Spread Constraints

These spread Pods across Nodes, zones, or other topology domains.

This protects against one Node or zone failure.

#### DaemonSet

A DaemonSet runs one Pod per Node.

Useful for node-local agents:

- log collector,
- metrics agent,
- CNI/network agent,
- storage agent.

Then application Pods may talk to a node-local agent, but this is an intentional design.

#### Node-Local Caches

Sometimes systems intentionally use node-local components:

```text
node-local DNS cache
node-local log agent
node-local proxy
node-local storage/cache
```

In those cases, the platform exposes a stable way to reach the local agent. The app should not simply scan "what other Pods are on my physical machine" and depend on that.

### Sidecar Is the Stronger Co-Location Guarantee

If two processes truly must always be co-located, put them in the same Pod.

```text
Pod
  app container
  sidecar container
```

Same Pod gives stronger guarantees:

- scheduled together,
- share lifecycle,
- share network namespace,
- can use `localhost`,
- can share volumes.

Same Node is weaker:

```text
two Pods may be on same Node today
one may move tomorrow
they do not share localhost
their lifecycles are separate
```

### Interview Sentence

> Pods can know which Node they are on through Kubernetes metadata, but well-designed applications usually should not rely on accidental co-location. Two Pods on the same Node still have separate network namespaces and do not share localhost. If locality matters, Kubernetes provides explicit placement tools like affinity, anti-affinity, topology spread, DaemonSets, and node-local services. If two containers must always be co-located and communicate over localhost or shared volumes, they should usually be in the same Pod as a sidecar pattern.
