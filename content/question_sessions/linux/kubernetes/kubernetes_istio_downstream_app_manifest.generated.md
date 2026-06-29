# Kubernetes Istio Downstream App Manifest Example


Split from [kubernetes_core_concepts_pods_nodes_resources_rollouts.generated.md](./kubernetes_core_concepts_pods_nodes_resources_rollouts.generated.md).

### Adding a Downstream App and Istio

This extends the example:

```text
external client
  -> Istio ingress gateway
    -> payments-api
      -> orders-api
```

Istio sidecars are injected into Pods in the `payments` namespace. The app containers still make normal HTTP calls, but traffic is intercepted by Envoy sidecars.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments
  labels:
    istio-injection: enabled # Ask Istio to inject Envoy sidecars into Pods here.
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: payments
spec:
  replicas: 3 # Three Pods for the downstream service.
  selector:
    matchLabels:
      app: orders-api
      version: v1
  template:
    metadata:
      labels:
        app: orders-api # Service and Istio policies select this app.
        version: v1 # Istio can route by version/subset.
    spec:
      containers:
        - name: app
          image: registry.example.com/orders-api:v1 # Downstream app image.
          ports:
            - containerPort: 8080 # App listens inside the Pod.
          readinessProbe:
            httpGet:
              path: /ready # Only Ready Pods receive traffic.
              port: 8080
          resources:
            requests:
              cpu: 300m
              memory: 256Mi
            limits:
              cpu: "1"
              memory: 512Mi
---
apiVersion: v1
kind: Service
metadata:
  name: orders-api
  namespace: payments
spec:
  selector:
    app: orders-api # Stable name points to orders-api Pods.
  ports:
    - name: http # Istio uses named ports/protocol hints.
      port: 80 # Other services call orders-api:80.
      targetPort: 8080 # Container receives traffic on 8080.
---
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: payments-gateway
  namespace: payments
spec:
  selector:
    istio: ingressgateway # Use the Istio ingress gateway Pods.
  servers:
    - port:
        number: 80
        name: http
        protocol: HTTP
      hosts:
        - api.example.com # External hostname accepted by the gateway.
---
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: payments-api
  namespace: payments
spec:
  hosts:
    - api.example.com # Match external host.
  gateways:
    - payments-gateway # Attach to the Gateway above.
  http:
    - match:
        - uri:
            prefix: /payments # External path.
      route:
        - destination:
            host: payments-api.payments.svc.cluster.local # Kubernetes Service.
            port:
              number: 80
---
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: orders-api
  namespace: payments
spec:
  hosts:
    - orders-api.payments.svc.cluster.local # Internal service host.
  http:
    - route:
        - destination:
            host: orders-api.payments.svc.cluster.local
            subset: v1 # Send to DestinationRule subset v1.
            port:
              number: 80
      retries:
        attempts: 2 # Envoy retries failed calls.
        perTryTimeout: 200ms # Each retry has a short timeout.
      timeout: 1s # Overall timeout for calls to orders-api.
---
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: orders-api
  namespace: payments
spec:
  host: orders-api.payments.svc.cluster.local
  trafficPolicy:
    tls:
      mode: ISTIO_MUTUAL # Use mesh-managed mutual TLS.
  subsets:
    - name: v1
      labels:
        version: v1 # Subset maps to Pods with version=v1.
---
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: orders-api-only-from-payments-api
  namespace: payments
spec:
  selector:
    matchLabels:
      app: orders-api # Policy protects orders-api Pods.
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
              - cluster.local/ns/payments/sa/default # Caller identity allowed by mTLS.
      to:
        - operation:
            methods: ["GET", "POST"]
            paths: ["/orders", "/orders/*"] # Only allow these API paths.
```

The service-mesh flow:

```text
client
  -> Istio ingress gateway
    -> payments-api Service
      -> payments-api Pod
        -> payments-api container
        -> payments-api Envoy sidecar
          -> orders-api Envoy sidecar
            -> orders-api container
```

What Istio adds here:

- `Gateway`: accepts external traffic for `api.example.com`.
- `VirtualService` for `payments-api`: routes `/payments` to the Kubernetes Service.
- `VirtualService` for `orders-api`: adds timeout/retry policy for internal calls.
- `DestinationRule`: defines subsets and enables mesh-managed mTLS.
- `AuthorizationPolicy`: restricts who can call `orders-api`.

In real production, the authorization identity would usually use dedicated ServiceAccounts, for example `payments-api`, not the default ServiceAccount.
