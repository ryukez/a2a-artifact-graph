## @ryukez/a2a-artifact-graph

A lightweight framework for building **declarative, data‑driven task pipelines** on top of the [A2A protocol](https://github.com/a2a-protocol).  
It is designed to make step‑wise executions **clear, reproducible and resumable**, which is a natural fit for LLM‑powered agents.

---

### ✨ Features

- **Typed boundary** – every _Builder_ declares **explicit input / output schemas**,
  making data‑flow & responsibility attribution crystal‑clear.
- **Ergonomic artifact helpers** – Define type‑safe artifacts in one line with `dataArtifact()` and `tuplePartsArtifact()`.
- **Automatic planning** – execution order is inferred from the **artifact dependency graph**;
  you only describe _what_ you need, not _how_ to get there.
- **Fault tolerance** – failed steps can be **resumed or retried** without re‑running the entire pipeline.

---

## Installation

```bash
npm install @ryukez/a2a-artifact-graph
```

---

## Quick Start

Below is a condensed version of `src/samples/math_agent.ts` that demonstrates the three key steps:

1. **Define Artifacts**
2. **Define Builders** (that transform those artifacts)
3. **Run** the `ArtifactGraph`

```ts
import { schema, TaskContext, TaskYieldUpdate } from "a2a-sdk-ryukez";
import {
  ArtifactGraph,
  defineBuilder,
  dataArtifact,
  tuplePartsArtifact,
} from "@ryukez/a2a-artifact-graph";
import { z } from "zod";

/* 1. ── Define artifacts ────────────────────────────── */
const Step1Artifact = dataArtifact("step1", z.object({ value: z.number() }));

const Step2Artifact = dataArtifact("step2", z.object({ value: z.number() }));

const Step3Artifact = tuplePartsArtifact("step3", ["text"]);

type Artifacts = readonly [
  InstanceType<typeof Step1Artifact>,
  InstanceType<typeof Step2Artifact>,
  InstanceType<typeof Step3Artifact>
];

/* 2. ── Define builders ─────────────────────────────── */
const step1Builder = defineBuilder<Artifacts>()({
  name: "Step 1",
  inputs: () => [] as const,
  outputs: () => ["step1"] as const,
  async *build({ history }) {
    const input = parseFloat(history![0].parts[0].text);
    yield Step1Artifact.fromData({ data: { value: input + 1 } });
  },
});

const step2Builder = defineBuilder<Artifacts>()({
  name: "Step 2",
  inputs: () => ["step1"] as const,
  outputs: () => ["step2"] as const,
  async *build({ inputs }) {
    yield Step2Artifact.fromData({
      data: { value: inputs.step1.parsed().value * 2 },
    });
  },
});

const step3Builder = defineBuilder<Artifacts>()({
  name: "Step 3",
  inputs: () => ["step2"] as const,
  outputs: () => ["step3"] as const,
  async *build({ inputs }) {
    yield Step3Artifact.fromParts({
      parts: [
        {
          type: "text",
          text: `${inputs.step2.parsed().value}`,
        },
      ],
    });
  },
});

/* 3. ── Assemble & run ──────────────────────────────── */
export async function* mathAgent({
  task,
  history,
}: TaskContext): AsyncGenerator<TaskYieldUpdate, schema.Task | void, unknown> {
  const graph = new ArtifactGraph<Artifacts>(
    {
      step1: (artifact) => new Step1Artifact(artifact),
      step2: (artifact) => new Step2Artifact(artifact),
      step3: (artifact) => new Step3Artifact(artifact),
    },
    [step1Builder, step2Builder, step3Builder]
  );

  for await (const update of graph.run({ task, history, verbose: true })) {
    yield update;
  }
}
```

---

## API Overview

| Concept                               | Description                                                   |
| ------------------------------------- | ------------------------------------------------------------- |
| **Artifact**                          | Immutable piece of data flowing through the graph.            |
| **Builder**                           | Async generator that transforms input artifacts into outputs. |
| **ArtifactGraph**                     | Orchestrates builders, resolves dependencies & executes.      |
| **dataArtifact / tuplePartsArtifact** | Utility functions to declare type‑safe artifacts in one line. |

### Resuming after a failure

`ArtifactGraph.run()` yields progress updates, allowing you to persist state.  
In case of an error simply restart with the same history – already produced artifacts will be reused and only the failed sub‑graph will be executed again.

---

## License

[MIT](LICENSE)
