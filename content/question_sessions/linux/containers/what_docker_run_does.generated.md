# What Docker Does When Running a Container


## Question

What is Docker actually doing when you run `docker run`?

## 2026-06-16

### Clue

The key idea: Docker is a coordinator. It turns an image plus runtime options into one or more isolated Linux processes.

Docker is not the kernel feature. Docker asks lower-level components and the Linux kernel to assemble:

- a filesystem view,
- namespaces,
- cgroups,
- mounts,
- networking,
- security policy,
- and the initial process.

### Why It Works

A command like this:

```bash
docker run -p 8080:80 -v data:/data nginx
```

roughly means:

> Create a container from the `nginx` image, give it an isolated filesystem and process/network view, constrain it with resource/security settings, connect its network namespace to the host, publish host port `8080` to container port `80`, mount the `data` volume at `/data`, and start the image's configured process.

### Concrete Flow

Simplified lifecycle:

1. Docker CLI sends the request to the Docker daemon.
2. Docker resolves the image name and pulls missing image layers.
3. Docker prepares the container filesystem from read-only image layers plus a writable layer.
4. Docker creates or configures mounts and volumes.
5. Docker sets up namespaces: PID, network, mount, IPC, UTS, and optionally user namespace.
6. Docker configures cgroups for CPU, memory, pids, and I/O limits.
7. Docker configures networking, usually with a network namespace, veth pair, bridge, NAT, and port publishing.
8. Docker applies security settings such as Linux capabilities, seccomp, and AppArmor/SELinux profiles.
9. Docker delegates to lower-level runtime components, commonly `containerd` and `runc`, to create and start the container process.
10. The container's main process starts as PID 1 inside the container.

### Mental Model

From inside:

```text
I am PID 1
I have my own hostname
I have my own filesystem root
I have my own network interface
```

From the host:

```text
this is a normal process
it has a host PID
it belongs to cgroups
it is attached to namespaces
its filesystem is mounted from image layers plus writable layer
```

### Docker vs Runtime Components

Docker provides the user-facing workflow:

- image build/pull,
- CLI/API,
- container lifecycle,
- logs,
- volumes,
- networks,
- port publishing.

Lower-level components do much of the execution:

- `containerd`: manages container lifecycle and images at a lower level.
- `runc`: creates the actual Linux container according to the OCI runtime spec.
- Linux kernel: provides namespaces, cgroups, mounts, networking, and security enforcement.

### Interview Sentence

> When I run `docker run`, Docker is taking an image and runtime configuration and turning it into an isolated host process. It prepares the layered filesystem, sets up namespaces for process/network/mount isolation, applies cgroups for resource limits, configures mounts and networking, applies security profiles, and then uses lower-level runtimes like containerd/runc to start the container's main process.

### Follow-Up Angles

- The image is not running; a container is a running instance of an image with runtime state.
- A container's PID 1 is special for signal handling and child process reaping.
- `-p 8080:80` does not make the container bind host port `8080`; Docker configures host-side forwarding/NAT to the container's network namespace.
- `-v` and bind mounts are runtime filesystem attachments, not baked image layers.
- Docker Desktop on macOS/Windows runs Linux containers inside a Linux VM, because Linux containers need a Linux kernel.
