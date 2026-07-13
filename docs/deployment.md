# Demo deployment

The hosted application is the synthetic browser lab. It contains no target adapter, server-side state, credential store, or multi-user control plane. Use the CLI for real boundary tests.

## GitHub Pages

`.github/workflows/pages.yml` deploys `dist/web` after every push to `main`. The workflow supplies Vite with the repository base `/contextfence/`, so hashed application assets and public metadata resolve correctly on project Pages.

One-time setup:

1. Open repository **Settings → Pages**.
2. Choose **GitHub Actions** as the source.
3. Run **Deploy demo to GitHub Pages** or push to `main`.
4. Verify the environment URL and the browser console at `https://devectorio.github.io/contextfence/`.

No Pages secret is required. The deployment job receives only `pages: write` and `id-token: write`; the build job uses public source and locked dependencies.

## Container

Build the same static application locally:

```bash
docker build -t contextfence:local .
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  -p 8080:8080 \
  contextfence:local
```

Open [http://localhost:8080](http://localhost:8080). The image runs an unprivileged nginx process on port `8080`, includes a health check, emits security headers, disables server tokens, caches versioned static assets, and keeps `index.html` revalidatable.

For a subpath deployment, pass the public base at build time:

```bash
docker build \
  --build-arg VITE_BASE=/contextfence/ \
  --build-arg VITE_SITE_URL=https://example.com/contextfence/ \
  -t contextfence:subpath .
```

The GHCR workflow is configured to publish multi-architecture images from `main` and semantic-version tags. The first versioned image does not exist until the npm bootstrap and `v0.1.0` tag are complete; build from source in the meantime:

```bash
docker build -t contextfence:local .
docker run --rm -p 8080:8080 contextfence:local
```

After the first release, consume a versioned image rather than `main`:

```bash
docker pull ghcr.io/devectorio/contextfence:0.1.0
docker run --rm -p 8080:8080 ghcr.io/devectorio/contextfence:0.1.0
```

GHCR packages are private on first creation in some repository configurations. Make the package public after the first successful push and link it to the repository.

## Runtime posture

The demo image requires no writeable application filesystem, database, environment variables, outbound API key, or mounted credentials. If a platform injects service-account credentials by default, disable them.

Recommended controls:

- Run as the image's non-root user and drop all Linux capabilities.
- Keep the root filesystem read-only and mount only a small `/tmp` tmpfs for nginx runtime files.
- Expose the container through a TLS-terminating ingress.
- Deny outbound traffic; the demo's Manrope and DM Mono font files are self-hosted in the bundle.
- Consume immutable release tags or digests, not `main`.
- Retain the image SBOM and provenance with the deployment record.

The content-security policy permits application assets, styles, and fonts from the same origin only. If the font strategy changes, update and verify `docker/nginx.conf` rather than weakening the policy broadly.

## Custom domain

For a root custom domain such as `contextfence.devector.io`, build with `VITE_BASE=/` and `VITE_SITE_URL=https://contextfence.devector.io/`. The site URL controls canonical and social-preview metadata and must include the public path. Add the domain through Pages or the hosting platform and enforce HTTPS. A custom-domain Pages deployment should also add and commit the platform's `CNAME` file under `public/`; do that only after DNS ownership is decided.
