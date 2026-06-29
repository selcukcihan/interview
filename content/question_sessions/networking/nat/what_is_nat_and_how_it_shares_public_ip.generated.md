# What NAT Is and How It Shares a Public IP


## Question

What is NAT, what problem does it solve, and how does it allow many private machines to share one public IP?

## 2026-06-16

### Clue

The key idea: NAT is address/port rewriting plus a memory table.

Private machines use private IPs that are not routable on the public internet. A NAT device rewrites outgoing packets so they appear to come from its public IP, then remembers how to map the return traffic back to the original private machine.

### The Problem NAT Solves

Imagine a home network:

```text
laptop  192.168.1.10
phone   192.168.1.11
tablet  192.168.1.12
router  public IP 203.0.113.5
```

The private IPs:

```text
192.168.x.x
10.x.x.x
172.16.x.x - 172.31.x.x
```

are not meant to be routed across the public internet.

If the laptop sends a packet directly with source:

```text
192.168.1.10
```

an internet server cannot send a reply back to that address across the global internet. Many networks use the same private ranges.

NAT solves this by making the packet appear to come from the router's public IP.

### Concrete Packet Flow

Laptop wants to call:

```text
93.184.216.34:443
```

Original packet:

```text
source      192.168.1.10:51544
destination 93.184.216.34:443
```

The router/NAT rewrites it:

```text
source      203.0.113.5:62001
destination 93.184.216.34:443
```

And stores a translation table entry:

```text
203.0.113.5:62001 -> 192.168.1.10:51544
```

When the internet server replies:

```text
source      93.184.216.34:443
destination 203.0.113.5:62001
```

the NAT device checks its table and rewrites the destination:

```text
source      93.184.216.34:443
destination 192.168.1.10:51544
```

Now the laptop gets the response.

### Why Ports Matter

Many private machines can share one public IP because NAT usually rewrites source ports too.

Example:

```text
laptop 192.168.1.10:51544 -> public 203.0.113.5:62001
phone  192.168.1.11:51544 -> public 203.0.113.5:62002
tablet 192.168.1.12:51544 -> public 203.0.113.5:62003
```

Same public IP, different public-side ports.

That public IP plus port is enough for the NAT device to know where return traffic should go.

This is often called PAT, port address translation, or NAT overload.

### Why Inbound Is Different

NAT works easily for outbound connections because the private machine starts the conversation, so the NAT device can create a translation table entry.

Unsolicited inbound traffic has no existing table entry:

```text
internet -> 203.0.113.5:9999
```

The NAT device asks:

```text
Which private machine should receive this?
```

If there is no port forwarding or explicit rule, it drops the packet.

That is why private machines can often reach the internet, but the internet cannot directly initiate arbitrary connections to them.

### Docker Connection

Docker bridge networking uses a similar idea.

Container:

```text
container IP 172.18.0.2
host public/private IP 192.168.1.50
```

When the container accesses the internet, the host rewrites the packet source from:

```text
172.18.0.2:random_port
```

to:

```text
192.168.1.50:translated_port
```

The outside world sees the host, not the container's private bridge IP.

### Interview Sentence

> NAT lets private machines use non-public addresses internally while sharing one public address externally. For outbound traffic, the NAT device rewrites the source IP and often the source port to its public address, stores a translation entry, and uses that entry to rewrite return traffic back to the original private IP and port. The key is address/port rewriting plus a temporary connection mapping table.

### Follow-Up Angles

- NAT is not the same as routing. Routing decides where packets go; NAT changes packet addresses or ports.
- NAT enables private address reuse but can hide original client identity.
- NAT has limits: port exhaustion, idle timeouts, broken inbound reachability, and harder debugging.
- Port forwarding is a static or configured destination NAT rule for inbound traffic.
- Cloud NAT gateways let private subnet instances reach the internet without giving each instance a public IP.

### Follow-Up: Home Wireless Cable Modem

Usually, yes.

A typical home "wireless cable modem" is often several devices combined:

```text
cable modem
router
NAT device
Wi-Fi access point
DHCP server
DNS forwarder
basic firewall
```

Your laptop might get a private IP:

```text
192.168.0.23
```

Your phone might get:

```text
192.168.0.24
```

But your ISP gives the modem/router one public-facing address, for example:

```text
203.0.113.5
```

When your laptop connects to a website, the router rewrites:

```text
192.168.0.23:51544 -> 203.0.113.5:62001
```

and remembers that mapping so the response can be sent back to your laptop.

#### Router Mode vs Bridge Mode

If the device is in normal router mode, it probably does NAT.

If it is in bridge mode, it may only act as a modem and pass the public IP through to another router. In that setup, the separate router usually does NAT instead.

#### How to Tell

On your laptop, check your local IP address.

If it looks like one of these:

```text
192.168.x.x
10.x.x.x
172.16.x.x - 172.31.x.x
```

then you are behind a private network, and some device between you and the internet is doing NAT.

If your router's WAN/public IP is also private, then your ISP may be using carrier-grade NAT, meaning there is another NAT layer upstream.

### Follow-Up: What Software Does a Home Router Run for NAT?

A home modem/router is a small embedded computer.

It has:

```text
CPU
RAM
flash storage
network chips
Wi-Fi radio
firmware / operating system
```

The software is usually called firmware. Many consumer routers run embedded Linux, though some run vendor-specific embedded operating systems or real-time OS variants.

On a Linux-based router, NAT is commonly implemented by the Linux kernel's packet forwarding and firewall/NAT subsystem:

```text
old/common stack: iptables + netfilter
newer stack: nftables + netfilter
```

The kernel handles the fast packet path:

1. Receive packet from LAN.
2. Check routing/firewall/NAT rules.
3. Rewrite source IP/port for outbound NAT.
4. Store connection tracking state.
5. Forward packet to WAN.
6. Rewrite return packets back to the private LAN address.

The router also runs user-space services, often things like:

- DHCP server: gives your laptop `192.168.68.104`.
- DNS forwarder/cache: forwards DNS queries to ISP/public DNS.
- Web admin UI: router settings page.
- Wi-Fi management services.
- Firewall rule management.
- UPnP/NAT-PMP/PCP: optional automatic port mapping.

Important distinction:

```text
kernel: forwards packets, applies NAT/firewall rules, tracks connections
user-space services: configure rules, serve admin UI, provide DHCP/DNS/Wi-Fi management
```

Some routers also have hardware acceleration or specialized network chips. In those cases, the first packets may establish the NAT/connection-tracking state in software, and then later packets in the same flow may be accelerated by hardware.

Interview sentence:

> A home router is an embedded computer, often running Linux-based firmware. NAT is usually performed in the kernel packet path using netfilter through iptables or nftables rules, with connection tracking remembering private-to-public mappings. User-space router services configure those rules and provide DHCP, DNS forwarding, Wi-Fi management, firewall settings, and the admin UI.
