# Load Balancers

## Answered Questions

- [Calculate Theoretical TPS for a Service Behind a Load Balancer](./calculate_tps_for_example_service.generated.md): How many concurrent requests from different clients can a service at `example.com` serve if each read request takes 500 ms and each request reaches a single SQL database? Assume a load balancer, downstream app servers, and calculate theoretical maximum TPS.
- [How Load Balancers Handle Millions of Connections](./how_load_balancers_handle_millions_of_connections.generated.md): How does a load balancer handle millions of connections at the same time? Can a single load balancer do this? There is a single origin like `example.com` but to handle millions of connections it has to distribute the connections. What is the "it"? Is it a single entity? Many servers acting like load balancers? How does the server-side select which load balancer handles the request?
