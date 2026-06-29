# Kubernetes Payments API Manifest Example


Split from [kubernetes_core_concepts_pods_nodes_resources_rollouts.generated.md](./kubernetes_core_concepts_pods_nodes_resources_rollouts.generated.md).

## Compact Real-World Manifest Example

This example models a small `payments-api` service:

- `Namespace`: isolates the app area.
- `ConfigMap`: non-secret app config.
- `Secret`: sensitive config.
- `Deployment`: runs replicated Pods.
- `Service`: stable internal address for Pods.
- `Ingress`: external HTTP entry point.
- `HorizontalPodAutoscaler`: scales Pod count.
- `PodDisruptionBudget`: protects availability during voluntary disruptions.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: payments-api-config
  namespace: payments
data:
  LOG_LEVEL: info
  ORDERS_API_URL: http://orders-api.orders.svc.cluster.local
---
apiVersion: v1
kind: Secret
metadata:
  name: payments-api-secrets
  namespace: payments
type: Opaque
stringData:
  DATABASE_URL: postgres://payments:example@postgres.payments.svc.cluster.local:5432/payments
  STRIPE_API_KEY: replace-me
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  namespace: payments
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: payments-api
  template:
    metadata:
      labels:
        app: payments-api
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: app
          image: registry.example.com/payments-api:v42
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: payments-api-config
            - secretRef:
                name: payments-api-secrets
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            periodSeconds: 10
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: "1"
              memory: 1Gi
        - name: metrics-sidecar
          image: registry.example.com/metrics-exporter:v3
          ports:
            - containerPort: 9090
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 256Mi
---
apiVersion: v1
kind: Service
metadata:
  name: payments-api
  namespace: payments
spec:
  selector:
    app: payments-api
  ports:
    - name: http
      port: 80
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: payments-api
  namespace: payments
spec:
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /payments
            pathType: Prefix
            backend:
              service:
                name: payments-api
                port:
                  number: 80
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payments-api
  namespace: payments
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payments-api
  minReplicas: 4
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payments-api
  namespace: payments
spec:
  minAvailable: 3
  selector:
    matchLabels:
      app: payments-api
```

The core flow:

```text
client
  -> Ingress api.example.com/payments
    -> Service payments-api:80
      -> ready Pod with label app=payments-api
        -> app container on port 8080
```

### Inline-Annotated Manifest

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments # Logical area for all payments resources.
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: payments-api-config
  namespace: payments
data:
  LOG_LEVEL: info # Non-secret config.
  ORDERS_API_URL: http://orders-api.orders.svc.cluster.local # Internal service DNS.
---
apiVersion: v1
kind: Secret
metadata:
  name: payments-api-secrets
  namespace: payments
type: Opaque
stringData:
  DATABASE_URL: postgres://payments:example@postgres.payments.svc.cluster.local:5432/payments # Sensitive config.
  STRIPE_API_KEY: replace-me # Secret value; normally injected securely.
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
  namespace: payments
spec:
  replicas: 4 # Desired number of Pods.
  strategy:
    type: RollingUpdate # Replace Pods gradually during deploys.
    rollingUpdate:
      maxUnavailable: 0 # Keep desired capacity available.
      maxSurge: 1 # Allow one extra Pod temporarily.
  selector:
    matchLabels:
      app: payments-api # Deployment manages Pods with this label.
  template: # Template used to create each Pod.
    metadata:
      labels:
        app: payments-api # Service uses this label to find Pods.
    spec:
      terminationGracePeriodSeconds: 30 # Time for graceful shutdown after SIGTERM.
      containers:
        - name: app
          image: registry.example.com/payments-api:v42 # App version to run.
          ports:
            - containerPort: 8080 # Port the app listens on inside the Pod.
          envFrom:
            - configMapRef:
                name: payments-api-config # Load non-secret env vars.
            - secretRef:
                name: payments-api-secrets # Load secret env vars.
          readinessProbe:
            httpGet:
              path: /ready # Must pass before receiving traffic.
              port: 8080
          livenessProbe:
            httpGet:
              path: /health # If this fails, Kubernetes restarts the container.
              port: 8080
          resources:
            requests:
              cpu: 500m # Scheduling reservation: half a CPU.
              memory: 512Mi # Scheduling reservation: 512 MiB.
            limits:
              cpu: "1" # Runtime ceiling: one CPU.
              memory: 1Gi # Runtime ceiling: 1 GiB.
        - name: metrics-sidecar
          image: registry.example.com/metrics-exporter:v3 # Helper container in same Pod.
          ports:
            - containerPort: 9090 # Metrics endpoint.
---
apiVersion: v1
kind: Service
metadata:
  name: payments-api
  namespace: payments
spec:
  selector:
    app: payments-api # Routes to ready Pods with this label.
  ports:
    - port: 80 # Stable Service port.
      targetPort: 8080 # Actual app container port.
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: payments-api
  namespace: payments
spec:
  rules:
    - host: api.example.com # Public hostname.
      http:
        paths:
          - path: /payments # URL path prefix.
            pathType: Prefix
            backend:
              service:
                name: payments-api # Send traffic to this Service.
                port:
                  number: 80 # Service port, not container port.
```
