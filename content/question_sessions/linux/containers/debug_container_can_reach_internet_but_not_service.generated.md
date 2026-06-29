# Debug Container Can Reach Internet But Not Another Service


## Question

How would you debug a container that can reach the internet but cannot reach another service?

## 2026-06-16

### Clue

The key idea: internet access proves outbound routing/NAT works. It does not prove service discovery, network membership, service binding, port publishing, firewall rules, or application listen address are correct.

So do not stop at:

```bash
curl https://google.com
```

That only tells you the container can get out.

### Debugging Flow

Work from name resolution to packet path to application behavior.

#### 1. Identify the Target Shape

First clarify what "another service" means:

```text
same Docker Compose network?
another container on same host?
host machine service?
Kubernetes Service?
external private service?
database in another VPC/subnet?
```

The expected address changes depending on that answer.

#### 2. Check DNS or Service Discovery

From inside the container:

```bash
getent hosts service-name
nslookup service-name
```

If DNS fails, it may be:

- wrong service name,
- containers not on the same Docker network,
- Docker Compose project/network mismatch,
- Kubernetes namespace issue,
- CoreDNS/service discovery issue.

In Docker Compose, service-to-service traffic usually uses the Compose service name:

```bash
curl http://api:3000
```

not:

```bash
curl http://localhost:3000
```

Inside a container, `localhost` means the same container, not another container and not the host.

#### 3. Check Basic Reachability

If the name resolves, check whether the port is reachable:

```bash
nc -vz service-name 3000
curl -v http://service-name:3000/health
```

If DNS works but connection fails:

- target service may not be listening,
- target is listening only on `127.0.0.1`,
- wrong port,
- network policy/firewall blocks it,
- containers are on different networks,
- service is bound to host network only,
- Kubernetes Service selector has no endpoints.

#### 4. Check What the Target Service Is Listening On

Inside the target container or host:

```bash
ss -lntp
```

Bad for container-to-container access:

```text
127.0.0.1:3000
```

Better:

```text
0.0.0.0:3000
```

If a service binds to `127.0.0.1`, it only accepts connections from inside its own network namespace.

This is a common container bug:

```text
app listens on localhost inside container
other containers cannot reach it
```

#### 5. Check Docker Network Membership

On the host:

```bash
docker network ls
docker network inspect <network>
docker inspect <container>
```

Confirm both containers are attached to the same user-defined bridge network.

Default bridge networking has weaker built-in service discovery than user-defined bridge networks. In Compose, services are usually placed on a project network and can resolve each other by service name.

#### 6. Check Port Publishing Assumptions

This is often confused:

```bash
docker run -p 8080:3000 app
```

means:

```text
host:8080 -> container:3000
```

It is for host-to-container access, not required for container-to-container access on the same Docker network.

For container-to-container traffic, use:

```text
target_container_name:container_port
```

not the host-published port unless intentionally routing through the host.

#### 7. If Reaching a Host Service

Inside a container, `localhost` is the container itself. To reach the host:

- Docker Desktop often supports `host.docker.internal`.
- Linux Docker may need the bridge gateway IP, often something like `172.17.0.1`, or explicit host gateway configuration.

Example:

```bash
curl http://host.docker.internal:3000
```

or:

```bash
ip route
```

Look for the default gateway.

#### 8. Kubernetes Version of the Same Debugging

For Kubernetes:

```bash
kubectl get svc
kubectl get endpoints <service>
kubectl describe svc <service>
kubectl get networkpolicy
kubectl exec -it <pod> -- sh
```

Check:

- service DNS name,
- namespace,
- selector matches pods,
- endpoints exist,
- container is listening on the expected port,
- targetPort vs port mismatch,
- NetworkPolicy blocks traffic,
- readiness probe excludes endpoints.

### The Most Common Root Causes

- Using `localhost` when the target is another container.
- Target service binds to `127.0.0.1` instead of `0.0.0.0`.
- Containers are not on the same Docker network.
- Wrong port: host-published port vs container port.
- DNS/service name is wrong.
- Kubernetes Service has no endpoints.
- Firewall, security group, or NetworkPolicy blocks east-west traffic.
- App is up enough to accept internet egress but target dependency is not ready.

### Interview Sentence

> If a container can reach the internet but not another service, I separate outbound connectivity from service-to-service connectivity. I would check DNS/service discovery, confirm the containers or pods share the expected network, verify the target service is listening on `0.0.0.0` and the correct container port, avoid confusing `localhost` or host-published ports with container-to-container addressing, and then inspect firewall, Docker network, or Kubernetes Service/Endpoint/NetworkPolicy configuration.

### Follow-Up Angles

- Internet access usually proves default route and NAT, not internal service discovery.
- `localhost` is always relative to the current network namespace.
- Binding to `127.0.0.1` inside a container makes the service private to that container namespace.
- Docker Compose service names are usually the simplest service discovery path.
- In Kubernetes, a Service without endpoints is a routing object pointing at nothing.

### Concrete Example: Two Containers on One Docker Network

Assume this setup:

```text
host machine
  Docker network: app_net
    container: web
      runs frontend or caller
    container: api
      runs HTTP service on port 3000
```

Both containers are running at the same time and attached to the same Docker network:

```bash
docker network create app_net

docker run -d \
  --name api \
  --network app_net \
  my-api-image

docker run -it \
  --name web \
  --network app_net \
  my-web-image \
  sh
```

Inside `web`, the right way to call `api` is usually:

```bash
curl http://api:3000/health
```

Why `api` works: on a user-defined Docker network, Docker provides internal DNS. The container name `api` resolves to the `api` container's IP on `app_net`.

Conceptually:

```text
web container
  curl http://api:3000
       |
       | Docker DNS resolves "api"
       v
  api container IP on app_net, port 3000
```

#### Why `localhost` Is Wrong Here

If you run this inside `web`:

```bash
curl http://localhost:3000
```

you are asking:

```text
connect to port 3000 inside the web container itself
```

You are not asking for the `api` container.

Each container has its own network namespace, so each container has its own `localhost`.

```text
inside web:
  localhost = web container

inside api:
  localhost = api container

on host:
  localhost = host machine
```

This is the most common mental-model mistake.

#### Why Internet Works But API Fails

Inside `web`:

```bash
curl https://example.com
```

can work because Docker gives the container:

- a default route,
- DNS for public names,
- NAT through the host to the internet.

But this does not prove that `web` can reach `api`.

That separate path needs:

- `web` and `api` on the same Docker network,
- Docker DNS resolving `api`,
- `api` listening on the expected port,
- `api` listening on `0.0.0.0`, not only `127.0.0.1`,
- no firewall or Docker network policy blocking traffic.

#### Failure Mode 1: Containers Are on Different Networks

Example:

```text
web is on frontend_net
api is on backend_net
```

Then this from `web` may fail:

```bash
curl http://api:3000
```

because `web` cannot resolve or route to `api`.

Check:

```bash
docker inspect web
docker inspect api
```

or:

```bash
docker network inspect app_net
```

Both containers should appear in the same network's container list.

#### Failure Mode 2: API Listens Only on `127.0.0.1`

Inside `api`, suppose the app starts like this:

```text
listening on 127.0.0.1:3000
```

Then only processes inside the `api` container can connect to it through that loopback interface.

From `web`, this fails:

```bash
curl http://api:3000
```

because `web` is coming from outside the `api` container's loopback interface.

The API should listen on:

```text
0.0.0.0:3000
```

That means "listen on all interfaces in this network namespace", including the interface connected to the Docker network.

#### Failure Mode 3: Host Port vs Container Port Confusion

Suppose `api` is started with:

```bash
docker run -d \
  --name api \
  --network app_net \
  -p 8080:3000 \
  my-api-image
```

This means:

```text
host port 8080 -> api container port 3000
```

From the host, this works:

```bash
curl http://localhost:8080
```

But from `web`, the normal container-to-container call is still:

```bash
curl http://api:3000
```

not:

```bash
curl http://api:8080
```

The `8080` is the host-side published port. The `api` container is still listening on `3000`.

#### Docker Compose Version

With Compose:

```yaml
services:
  web:
    image: my-web-image
    depends_on:
      - api

  api:
    image: my-api-image
    ports:
      - "8080:3000"
```

Compose automatically creates a project network. Both `web` and `api` join it by default.

From `web`, call:

```bash
curl http://api:3000
```

From the host browser, call:

```text
http://localhost:8080
```

Those are intentionally different addresses because they are from different network perspectives.

#### Simple Debug Walkthrough

Inside `web`:

```bash
getent hosts api
```

If this fails, Docker DNS/network membership is wrong.

Then:

```bash
nc -vz api 3000
```

If this fails, DNS may be fine but the port is unreachable.

Inside `api`:

```bash
ss -lntp
```

Look for:

```text
0.0.0.0:3000
```

If you see:

```text
127.0.0.1:3000
```

the service is only listening inside its own container.

#### The Short Mental Model

```text
host localhost != web localhost != api localhost

web -> api:3000       container-to-container
host -> localhost:8080 host-to-container through published port
```

Interview sentence:

> In a two-container Docker setup, internet access only proves the caller container has outbound NAT. To reach another container, both containers usually need to share a user-defined Docker network, the caller should use the target container or Compose service name, and the target service must listen on the container port on `0.0.0.0`. I would avoid using `localhost` unless I really mean the same container, and I would not confuse host-published ports with container-to-container ports.
