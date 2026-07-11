# Synthetic fixture documents

These documents support a simple boundary demonstration:

| Document | Classification | Expected identities | Canary |
| --- | --- | --- | --- |
| `shared-company-handbook.md` | Internal shared | Newsroom, Finance | `CF_SHARED_LIME_4P9D` |
| `finance-acquisition-plan.md` | Finance restricted | Finance only | `CF_FINANCE_MANGO_7Q2K` |

Canaries are deliberately conspicuous, non-secret strings. An unauthorized response containing a canary proves that protected content reached an observable surface, while the absence of a canary proves only that the declared probe did not observe it.

If you seed these fixtures into a test RAG system:

1. Use a disposable index and synthetic test identities.
2. Record the source IDs your adapter will expose.
3. Confirm the positive-control probe can retrieve its allowed document.
4. Confirm denied probes inspect retrieved sources and citations as well as answer text.
5. Delete the fixture documents, chunks, embeddings, cache entries, and reports after the test.

Do not copy real secrets into canaries. Do not use a production index unless the complete test is explicitly authorized.
