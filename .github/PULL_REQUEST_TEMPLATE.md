## What this changes

<!-- Explain the boundary, failure mode, or workflow this pull request addresses. -->

## Evidence

<!-- Show why the observed source IDs, chunks, citations, cache provenance, or canaries prove the verdict. Use only synthetic or explicitly authorized data. -->

## Verification

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] I added or updated a regression test where behavior changed.
- [ ] I tested both the violating and remediated path where applicable.

## Safety and compatibility

- [ ] No credentials, confidential prompts, customer data, or sensitive report artifacts are included.
- [ ] Logs and reports minimize or redact sensitive evidence.
- [ ] Contract/schema compatibility impact is documented, or there is none.
- [ ] The change keeps vendor-specific behavior behind an adapter, or is vendor-neutral.
- [ ] User-facing and release-facing changes are included in `CHANGELOG.md`.

## Screenshots or artifacts

<!-- Optional. Redact artifacts before attaching them. -->
