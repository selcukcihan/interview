# Kubernetes Relation to Docker


## Question

Is Kubernetes related to Docker?

## 2026-06-16

### Clue

Yes, but Kubernetes is not "Docker for many machines."

Docker is mainly a tool/platform for building images and running containers. Kubernetes is an orchestration system for running containers across a cluster of machines.

### The Relationship

Docker popularized the container workflow:

```text
Dockerfile -> image -> container
```

Kubernetes uses the same basic artifact:

```text
container image
```

But Kubernetes adds cluster-level management:

```text
which machine should run this container?
how many replicas should exist?
what if one dies?
how do services discover each other?
how do we roll out a new version?
how do we expose it to the network?
how do we attach config, secrets, and storage?
```

### Docker vs Kubernetes

Docker local mental model:

```bash
docker run nginx
```

You are asking one machine to run one container.

Kubernetes mental model:

```yaml
run 5 replicas of this application image
keep them healthy
spread them across nodes
give them stable service discovery
roll updates safely
```

You are describing desired state for a cluster.

### Does Kubernetes Use Docker?

Historically, many Kubernetes clusters used Docker as the container runtime on each node.

Modern Kubernetes does not require Docker as the runtime. It uses the Container Runtime Interface, or CRI, to talk to runtimes such as:

- containerd,
- CRI-O.

Docker itself uses `containerd` underneath, but Kubernetes can talk to `containerd` directly.

So the modern view:

```text
Docker: still common for building images and local development
Kubernetes: runs images on a cluster using CRI-compatible runtimes
```

### Important Objects

Kubernetes does not run a bare container directly as its main user-facing unit. It runs Pods.

```text
Pod
  container A
  container B, optional sidecar
```

A Pod is the smallest schedulable unit in Kubernetes. Containers in the same Pod share some namespaces, especially network namespace, so they can talk over `localhost`.

### Interview Sentence

> Kubernetes is related to Docker because both are part of the container ecosystem and both work with container images. Docker is commonly used to build and run containers locally, while Kubernetes orchestrates containers across a cluster: scheduling them onto nodes, restarting them, scaling them, networking them, and rolling out updates. Modern Kubernetes does not require Docker as the runtime; it talks to CRI-compatible runtimes like containerd or CRI-O.

### Follow-Up Angles

- Docker Compose coordinates containers on one machine; Kubernetes coordinates workloads across a cluster.
- Kubernetes desired state is reconciled continuously by controllers.
- A Kubernetes Pod is not the same thing as a Docker container.
- Docker images and OCI images are portable artifacts Kubernetes can run.
- Kubernetes networking, service discovery, config/secrets, storage, and rollout behavior are the main value beyond simply starting containers.

### Follow-Up: Kubernetes Without Docker, Containerd, and Runtime Choices

The core idea:

```text
Kubernetes does not need the Docker CLI or Docker daemon to run containers.
It needs a container runtime that speaks Kubernetes' runtime API.
```

On each Kubernetes node, the important component is `kubelet`.

`kubelet` is the node agent. It receives instructions like:

```text
run this Pod
pull this image
restart this container
report container status
```

But `kubelet` does not directly implement all low-level container mechanics itself. It talks to a container runtime through CRI, the Container Runtime Interface.

The modern stack often looks like this:

```text
Kubernetes control plane
  -> kubelet on node
    -> CRI API
      -> containerd
        -> OCI runtime, usually runc
          -> Linux kernel namespaces/cgroups/mounts
```

#### What Is Containerd?

`containerd` is a lower-level container runtime daemon.

It handles things like:

- pulling images,
- storing image layers,
- creating containers,
- starting/stopping containers,
- managing container lifecycle,
- exposing runtime APIs to higher-level tools,
- delegating actual container creation to OCI runtimes like `runc`.

Docker uses `containerd` internally:

```text
docker CLI
  -> Docker daemon
    -> containerd
      -> runc
        -> Linux kernel
```

Kubernetes can skip the Docker-specific layer:

```text
kubelet
  -> containerd
    -> runc
      -> Linux kernel
```

That is why Kubernetes no longer needs Docker as a runtime.

#### Why Remove Docker From the Middle?

Docker is a full developer/user platform:

- CLI,
- image build workflow,
- local container UX,
- Docker-specific API,
- networking defaults,
- volumes,
- Compose integration,
- developer ergonomics.

Kubernetes nodes do not need all of that. They need a runtime that can reliably run Pods and containers according to Kubernetes' expectations.

Using CRI-compatible runtimes gives Kubernetes a cleaner, standard interface.

#### Is Containerd the Only Choice?

No.

Common Kubernetes runtime choices include:

- `containerd`: very common default in managed Kubernetes distributions.
- `CRI-O`: Kubernetes-focused runtime built around OCI containers.

There are also sandboxed or VM-backed runtime options for stronger isolation:

- Kata Containers,
- gVisor,
- Firecracker-based systems in some platforms.

These are often integrated through runtime classes or compatible runtime layers depending on the cluster.

#### What Is `runc` Then?

`runc` is an OCI runtime. It is closer to the final low-level step.

Simplified:

```text
containerd manages lifecycle and images
runc creates the actual Linux container process
kernel enforces namespaces/cgroups/mounts/security
```

`runc` reads an OCI runtime spec bundle and performs the low-level setup needed to start the process in the configured namespaces, cgroups, mounts, and security context.

#### Important Distinction

These are different layers:

```text
Docker: developer platform and UX
containerd / CRI-O: container runtime used by systems like Kubernetes
runc: low-level OCI runtime that starts containers
Linux kernel: actual isolation/resource primitives
```

#### Interview Sentence

> Kubernetes does not require Docker because kubelet talks to container runtimes through CRI. Docker used to sit in that path, but Kubernetes can now talk directly to runtimes like containerd or CRI-O. Containerd manages images and container lifecycle and delegates the final low-level container creation to an OCI runtime like runc, which uses Linux namespaces, cgroups, mounts, and security settings to start the process.

### Follow-Up: Runtime Acronym Map

The clean stack:

```text
Kubernetes control plane
  tells
kubelet
  talks CRI to
containerd or CRI-O
  uses OCI runtime
runc
  asks
Linux kernel
  to create isolated processes with namespaces/cgroups/mounts
```

#### Kubernetes Control Plane

The cluster brain.

It stores desired state and makes decisions like:

```text
this Deployment should have 5 replicas
this Pod should run on node-3
this old Pod should be replaced
```

It does not directly call `runc` on every machine. It tells node agents what should happen.

#### Kubelet

`kubelet` runs on every Kubernetes node.

It is the node agent.

It asks:

```text
What Pods should run on this node?
Are they running?
Are they healthy?
Do I need to start, stop, or restart containers?
```

`kubelet` does not itself implement all container runtime details. It talks to a container runtime through CRI.

#### CRI

CRI means Container Runtime Interface.

It is Kubernetes' standard API for talking to container runtimes.

Think:

```text
kubelet speaks CRI
container runtime implements CRI
```

CRI lets Kubernetes avoid hard-coding itself to Docker.

Through CRI, kubelet can ask for operations like:

- pull image,
- create Pod sandbox,
- create container,
- start container,
- stop container,
- get logs/status.

#### Container Runtime

A container runtime is the software that actually manages containers on a node.

Common choices:

- `containerd`,
- `CRI-O`.

This layer deals with images, container lifecycle, and calling lower-level runtimes.

#### Containerd

`containerd` is a general-purpose container runtime daemon.

It can:

- pull images,
- store image layers,
- create containers,
- start/stop containers,
- manage snapshots/filesystems,
- call OCI runtimes like `runc`.

Docker uses `containerd` internally, but Kubernetes can use `containerd` without Docker.

#### CRI-O

`CRI-O` is another container runtime.

It was built specifically for Kubernetes CRI and OCI containers.

The name hints at its purpose:

```text
CRI + OCI = CRI-O
```

It is not Docker. It is an alternative runtime implementation that kubelet can talk to through CRI.

#### OCI

OCI means Open Container Initiative.

It defines standards so container tools can interoperate.

Two important ideas:

- OCI image spec: what a container image format looks like.
- OCI runtime spec: how to describe and run a container process.

This is why an image built with Docker can usually be run by Kubernetes using containerd or CRI-O.

The artifact is standardized enough that the runtime does not need Docker specifically.

#### runc

`runc` is a low-level OCI runtime.

It is close to the moment where a container process is actually created.

It reads an OCI runtime bundle/config and sets up:

- namespaces,
- cgroups,
- mounts,
- capabilities,
- seccomp,
- environment,
- process args.

Then it starts the process.

If `containerd` is the manager, `runc` is the low-level executor.

#### Linux Kernel

The kernel provides the actual primitives:

- namespaces,
- cgroups,
- mounts,
- networking,
- capabilities,
- seccomp,
- process scheduling,
- memory accounting.

Everything above is orchestration, APIs, and lifecycle management around these kernel features.

#### Docker

Docker is still useful, but it is a different layer:

```text
Dockerfile
docker build
docker run
Docker Desktop
Docker Compose
developer workflow
```

Docker also uses `containerd` and `runc` underneath. But Kubernetes no longer needs the Docker daemon in the node runtime path.

#### One-Screen Summary

```text
Kubernetes = cluster orchestration
kubelet = node agent
CRI = kubelet-to-runtime API
containerd = common runtime daemon
CRI-O = Kubernetes-focused runtime daemon
OCI = container standards
runc = low-level OCI runtime
Linux kernel = actual isolation/resource enforcement
Docker = developer platform that also uses containerd/runc
```

Interview sentence:

> Kubelet is the Kubernetes node agent. It uses CRI, the Container Runtime Interface, to talk to a runtime such as containerd or CRI-O. Those runtimes manage images and container lifecycle and then call an OCI runtime like runc. OCI is the standard for image and runtime behavior, while runc is the low-level tool that asks the Linux kernel to start the isolated process with namespaces, cgroups, mounts, and security settings.

### Follow-Up: Where Does the Kubernetes Control Plane Run?

The control plane does not run on every worker node.

The common mental model:

```text
control-plane nodes:
  API server
  scheduler
  controller manager
  etcd

worker nodes:
  kubelet
  container runtime
  kube-proxy / networking pieces
  application Pods
```

Every node runs `kubelet`, but not every node runs the control plane.

#### Self-Managed Cluster

In a self-managed Kubernetes cluster, you usually have one or more special nodes called control-plane nodes.

```text
control-plane-1
control-plane-2
control-plane-3

worker-1
worker-2
worker-3
```

The control-plane nodes run the cluster brain:

- `kube-apiserver`: the front door/API for the cluster.
- `etcd`: the strongly consistent database storing cluster state.
- `kube-scheduler`: decides which node a Pod should run on.
- `kube-controller-manager`: runs controllers that reconcile desired state.

In production, there are often multiple control-plane nodes for high availability.

#### Managed Kubernetes

In managed Kubernetes, such as EKS, GKE, or AKS, the cloud provider usually runs the control plane for you.

From your perspective:

```text
you manage worker nodes / node pools
provider manages the control plane
```

So it can feel like the control plane runs "outside" your nodes. It still runs somewhere, but not on nodes you normally SSH into or schedule application Pods onto.

#### Can Control Plane and Worker Be the Same Machine?

Yes, especially in local or small clusters.

Examples:

- `minikube`,
- `kind`,
- single-node Kubernetes,
- small lab clusters.

In those cases, the same machine may run both:

```text
control plane components
worker components
application Pods
```

Production clusters usually separate them or use managed control planes.

#### Can You Run Apps on Control-Plane Nodes?

Technically yes, but control-plane nodes are often tainted so normal application Pods do not run there.

That protects the cluster brain from noisy application workloads.

#### Interview Sentence

> The Kubernetes control plane usually runs on dedicated control-plane nodes, or in managed Kubernetes it is run by the provider outside the worker nodes I manage. Every node runs kubelet, but only control-plane nodes run components like the API server, scheduler, controller manager, and etcd. Small local clusters may run control plane and worker components on the same machine, but production setups usually separate them or use a managed control plane.

### Follow-Up: Control Plane Node Count vs Worker Node Count

There is usually no fixed ratio like:

```text
1 control-plane node per 10 worker nodes
```

Control-plane nodes and worker nodes scale for different reasons.

```text
control-plane nodes = availability, quorum, API/control capacity
worker nodes        = application CPU, memory, storage, network capacity
```

#### Typical Control Plane Counts

Common setups:

```text
1 control-plane node
  local/dev/test/small non-HA cluster

3 control-plane nodes
  common production HA baseline

5 control-plane nodes
  larger or stricter HA clusters
```

Odd numbers matter because `etcd` uses quorum. With 3 `etcd` members, the cluster can tolerate 1 member failure. With 5, it can tolerate 2.

```text
3 etcd members -> need 2 for quorum
5 etcd members -> need 3 for quorum
```

Adding too many control-plane/etcd nodes is not automatically better, because consensus has coordination overhead.

#### Worker Nodes Scale Differently

Workers are based on workload demand:

- how many Pods,
- CPU/memory requirements,
- availability zones,
- failure isolation,
- autoscaling strategy,
- GPU/storage/network needs,
- cost.

You might have:

```text
3 control-plane nodes
20 worker nodes
```

or:

```text
3 control-plane nodes
300 worker nodes
```

The ratio is not the main design rule.

#### Managed Kubernetes

In managed Kubernetes, users often do not choose control-plane node count directly.

For EKS/GKE/AKS-style services, the provider runs and scales the control plane behind the scenes. You usually choose:

- worker node pools,
- machine sizes,
- autoscaling settings,
- zones/regions,
- Kubernetes version,
- maybe control-plane availability tier depending on provider.

So in managed Kubernetes, users mostly tune worker capacity, not the exact number of API server or `etcd` nodes.

#### Self-Managed Kubernetes

In self-managed clusters, operators do choose control-plane topology.

They decide:

- 1 vs 3 vs 5 control-plane nodes,
- whether `etcd` is stacked on control-plane nodes or external,
- machine size for API server/scheduler/controller/etcd,
- zones/failure domains,
- backup/restore strategy for `etcd`.

#### When Would You Increase Control Plane Capacity?

Not because one more worker was added. You increase or resize the control plane when you see control-plane bottlenecks:

- API server latency,
- high request volume from controllers/operators/CI,
- many Pods/nodes causing large watch traffic,
- slow scheduling,
- etcd disk latency,
- etcd database growth,
- control-plane CPU/memory pressure.

#### Interview Sentence

> I would not think of control-plane nodes as a fixed ratio to worker nodes. Control-plane sizing is mostly about high availability, etcd quorum, and API/control-loop capacity; worker sizing is about application workload capacity. A common production baseline is three control-plane nodes for HA, while workers scale independently through node pools and autoscaling. In managed Kubernetes, the provider usually handles the control-plane topology, and users mainly tune worker node pools.
