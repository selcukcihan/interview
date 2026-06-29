# Linux Mount Points


## Question

What is mounting in Linux, and what is a mount point?

## 2026-06-16

### Clue

The key idea: Linux has one unified filesystem tree, and mounting attaches another filesystem into that tree at a chosen directory.

```text
/                  root filesystem
/home              directory
/mnt/data          mount point
```

If you mount a disk filesystem at `/mnt/data`, then accessing `/mnt/data` shows the mounted filesystem's contents.

### Why It Works

Unlike Windows-style drive letters such as `C:\` and `D:\`, Unix systems expose files through one tree rooted at `/`.

Mounting says:

> Take this filesystem/device/source and make it appear at this directory path.

Example:

```bash
mount /dev/sdb1 /mnt/data
```

After that:

```text
/mnt/data
```

is no longer just an ordinary empty directory view. It is the entry point into the filesystem stored on `/dev/sdb1`.

### What Can Be Mounted?

Not only physical disks.

Common examples:

- disk partitions such as `/dev/sdb1`,
- USB drives,
- network filesystems like NFS,
- pseudo-filesystems like `/proc` and `/sys`,
- tmpfs in memory,
- bind mounts from one host path to another,
- overlay filesystems used by containers.

### Mount Point

A mount point is the directory where a filesystem is attached.

Example:

```text
source: /dev/sdb1
target: /mnt/data
```

`/mnt/data` is the mount point.

If the directory already had files before mounting, those files are hidden while the mount is active. They are not deleted; they are just covered by the mounted filesystem.

### Bind Mount

A bind mount attaches an existing directory somewhere else in the tree.

Example:

```bash
mount --bind /var/app/config /container/config
```

Now `/container/config` shows the same underlying files as `/var/app/config`.

This is close to what Docker bind mounts do:

```bash
docker run -v /host/path:/container/path image
```

The container sees `/container/path`, but the data is actually coming from `/host/path`.

### Mount Namespace

Mounts are also why containers need mount namespaces.

Without a separate mount namespace, changing mounts for a container could affect the host's mount view.

With a mount namespace:

```text
host sees one mount tree
container sees its own mount tree
```

That lets a container believe `/` is its own root filesystem even though the host knows it is an assembled filesystem view from image layers and mounts.

### Interview Sentence

> Mounting is attaching a filesystem or filesystem-like source into Linux's single directory tree at a chosen directory called a mount point. The mounted source then appears at that path. Containers rely heavily on mounts and mount namespaces to give each container its own root filesystem view, attach volumes, bind host directories, and expose pseudo-filesystems like `/proc`.

### Follow-Up Angles

- Mounting does not copy data; it changes where a filesystem is visible.
- A mount can hide files that already existed under the target directory.
- `/proc`, `/sys`, and `/dev` are filesystem views into kernel/device information, not ordinary disk folders.
- Docker volumes and bind mounts are runtime mounts, not image layers.
- Overlay filesystems let containers combine read-only image layers with a writable top layer.
