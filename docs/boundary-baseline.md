# ContextFence Boundary Baseline

The ContextFence CLI remains Apache-2.0 open source. A **ContextFence Boundary Baseline** is optional fixed-scope implementation help for teams that need to turn a real RAG permission model into an executable release control.

## Outcome

In one to two weeks, the engagement turns the boundaries that matter most into a small, reviewable CI suite. The team keeps the contracts, canaries, reports, and workflow after the engagement ends.

## Typical scope

1. Map the testable identity × source boundaries, high-risk access changes, and the retrieval/citation evidence the target exposes.
2. Create disposable identities and synthetic canaries; no production credentials or customer content are needed for the initial work.
3. Build an initial 20–40 deterministic allow and deny checks using the public ContextFence contract format.
4. Reproduce the relevant cache, ACL, retrieval, chunking, or citation failure modes in a safe environment.
5. Add a reviewed CI or scheduled staging gate and hand over JSON, JUnit, SARIF, or HTML evidence.
6. Run a remediation and handover session with the engineers responsible for the target.

## Deliverables

- an identity × source boundary map;
- a versioned ContextFence contract and synthetic fixture/canary plan;
- a CI pull request or equivalent runner configuration;
- an evidence-backed findings and remediation summary; and
- an engineer walkthrough for extending the suite as identities and sources change.

The work is a test and implementation engagement, not a security certification, penetration-test authorization, or guarantee that every access path is safe. Live checks are run only against systems the customer owns or is explicitly authorized to test.

## Hosted design partners

Run history, private runners, connector workflows, evidence retention, alerts, and enterprise identity controls are a future hosted direction. There is no hosted ContextFence control plane being sold as available today. Teams that can help shape that direction may discuss a design-partner engagement.

## Enquire safely

Use the [Devector contact form](https://www.devector.io/contact) or email [dev@devector.io](mailto:dev@devector.io?subject=ContextFence%20Boundary%20Baseline). Describe the target architecture and source systems at a high level; do not send credentials, confidential prompts, raw target responses, or customer data through an enquiry form.
