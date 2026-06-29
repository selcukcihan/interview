# Container and Linux Primitives


## Question

What is a container, precisely, and what Linux primitives make containers possible?

## 2026-06-05

### Clue

The key idea: a container is not a small virtual machine. It is a normal process on the host, but the kernel gives it a restricted view of the world.

That restricted view is built mainly from:

- namespaces: what the process can see,
- cgroups: what resources the process can use,
- filesystem isolation: what root filesystem the process sees,
- capabilities/seccomp/LSM policies: what privileged actions the process can perform.

### Why It Works

From the host's perspective, a container process is just a process:

```text
host pid 48123 = nginx running in a container
```

From inside the container, that same process may appear as:

```text
container pid 1 = nginx
```

Both views are true because the process is in a PID namespace. The host sees the global process table; the container sees a scoped process table.

### Core Primitives

#### Namespaces

Namespaces isolate what a process can see.

Common container namespaces:

- PID namespace: separate process tree.
- Network namespace: separate interfaces, routes, ports, firewall rules.
- Mount namespace: separate filesystem mount view.
- UTS namespace: separate hostname/domain name.
- IPC namespace: separate shared memory/message queues.
- User namespace: map users inside the container to different users outside.
- Cgroup namespace: scoped view of cgroup hierarchy.

#### Cgroups

Cgroups limit and account for resource usage.

They answer questions like:

- How much memory can this container use?
- How much CPU can it get?
- How much I/O can it perform?
- How many processes can it create?

If a container exceeds memory limits, the kernel may kill processes in that cgroup.

#### Filesystem View

A container usually gets its own root filesystem assembled from image layers plus a writable layer.

The process thinks:

```text
/ = my container filesystem
```

But the host knows this is just a mounted filesystem view, often using overlay filesystems.

#### Capabilities, Seccomp, and LSMs

Root inside a container should not mean unlimited root on the host.

Hardening tools:

- Capabilities split root privileges into smaller pieces.
- Seccomp filters which syscalls are allowed.
- AppArmor/SELinux restrict what processes can access or do.

### What Docker Adds

Docker packages and automates these primitives:

1. Pull image layers.
2. Create writable layer.
3. Set up namespaces.
4. Apply cgroups.
5. Configure mounts.
6. Configure networking.
7. Apply security profile.
8. Start the container process.

Docker is not the magic isolation mechanism by itself. The Linux kernel provides the isolation primitives; Docker orchestrates them.

### Interview Sentence

> A container is a regular host process started with a constrained and isolated view of the system. Namespaces isolate what it can see, cgroups limit what it can consume, the container filesystem gives it its own root view, and capabilities/seccomp/LSM policies reduce what privileged operations it can perform. Docker packages those kernel primitives into a usable image and runtime workflow.

### Follow-Up Angles

- Containers share the host kernel; VMs have their own guest kernel.
- Isolation is not absolute; containers are weaker security boundaries than VMs by default.
- A container image is not a running container. It is a filesystem/template plus metadata.
- PID 1 inside the container may be just another process ID on the host.
- Container networking is usually a separate network namespace connected to the host through veth/bridge/NAT or an orchestrator CNI plugin.

### Follow-Up: Namespaces vs Cgroups

The short distinction:

```text
namespaces = what the process can see
cgroups    = what the process can consume
```

They are complementary, but they solve different problems.

#### Namespaces Change the View

Namespaces make a process see a scoped version of a global system resource.

Examples:

- PID namespace: the process sees its own process tree.
- Network namespace: the process sees its own interfaces, routes, and ports.
- Mount namespace: the process sees its own filesystem mount layout.
- UTS namespace: the process sees its own hostname.

Example:

```text
inside container:
  ps aux
  PID 1 nginx

on host:
  ps aux
  PID 48123 nginx
```

The namespace did not limit CPU or memory. It changed the process's view of process IDs.

#### Cgroups Enforce Limits and Accounting

Cgroups do not usually hide the world. They track and limit resource usage for a group of processes.

Examples:

- memory max: this container can use up to 512 MB.
- CPU quota: this container can use up to 0.5 CPU.
- pids max: this container can create at most 200 processes.
- I/O weight/limits: this container gets constrained disk access.

Example:

```text
container tries to allocate 2 GB
cgroup memory.max = 512 MB
kernel kills or rejects once limit is exceeded
```

The cgroup did not make memory "look different." It enforced a resource budget.

#### Why They Can Feel Similar

They both shape the container's reality:

- A namespace says: "You only see these processes/network interfaces/mounts."
- A cgroup says: "You may only use this much CPU/memory/I/O/process count."

So both are part of isolation, but one is visibility isolation and the other is resource isolation.

#### One Without the Other

Namespace without cgroup:

```text
process sees isolated PIDs and network,
but can still consume unlimited host CPU/memory
```

Cgroup without namespace:

```text
process sees the normal host process/network view,
but is limited to 512 MB memory and 0.5 CPU
```

Real containers use both.

#### Interview Sentence

> Namespaces and cgroups both contribute to containers, but they control different dimensions. Namespaces isolate names and views, such as PIDs, mounts, network interfaces, and hostnames. Cgroups account for and limit resource consumption, such as CPU, memory, I/O, and process count. Namespaces answer "what can this process see?", while cgroups answer "how much can this process use?"
