# ArtifactGraph: Revamped Condition-Evaluation Logic

## 📝 Overview

This PR extends the `conditions` feature of `ArtifactGraph`.
Before **every** builder is run, we now evaluate **all** conditions whose `then` list contains **any** of the builder's `inputs` or `outputs`.
The builder is executed only when **all** those conditions return `true`.

If any artifact listed in `condition.inputs` is missing at evaluation time, an error is thrown immediately.
This makes artifact skipping more deterministic and allows complex dependency graphs to be controlled via conditions with confidence.

---

## 🔄 Key Changes

| Type        | File                         | Description                                                                                                                                       |
| ----------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✨ Feature  | `src/artifact_graph.ts`      | Re-implemented the timing & mechanics of condition evaluation. Added verbose logs. Throws when required `condition.inputs` artifacts are missing. |
| 🛠️ Refactor | `src/artifact_graph.ts`      | Removed obsolete `skippedArtifacts` logic and simplified the control flow.                                                                        |
| 📚 Docs     | `README.md`                  | Added a dedicated "Conditional execution" section and updated feature list.                                                                       |
| 🧪 Tests    | `src/artifact_graph.test.ts` | Added tests ensuring builders are skipped when conditions are false and executed when true.                                                       |
| 🧪 Test Fix | `src/graph.test.ts`          | Aligned the example by fixing `Builder3` outputs.                                                                                                 |

---

## ✅ How to Verify

```bash
# Install dependencies (skip if already installed)
npm install

# Run the full test suite
npm test
```

Expected output:

```
PASS src/graph.test.ts
PASS src/artifact_graph.test.ts

Test Suites: 2 passed, 2 total
Tests:       20 passed, 20 total
```

---

## 🔍 Impact

- Affects the behavior of `ArtifactGraph.run()` directly.
- No breaking changes for code that does **not** use `conditions`.
- When conditions are used, a missing artifact in `condition.inputs` will now cause an explicit error instead of silent skipping.

---

## 🗒️ Notes

- Conditions are evaluated just-in-time before a builder would run. Further performance optimizations (e.g., caching) can be tackled separately.

Thank you for reviewing! 🙏
