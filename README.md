## ArtifactGraph

A lightweight framework for building **declarative, data‑driven task pipelines** on top of the [A2A protocol](https://github.com/a2a-protocol).  
It is designed to make step‑wise executions **clear, reproducible and resumable**, which is a natural fit for LLM‑powered agents.

---

### ✨ Features

- **Typed boundary** – every _Builder_ declares **explicit input / output schemas**,
  making data‑flow & responsibility attribution crystal‑clear.
- **Automatic planning** – execution order is inferred from the **artifact dependency graph**;
  you only describe _what_ you need, not _how_ to get there.
- **Fault tolerance** – failed steps can be **resumed or retried** without re‑running the entire pipeline.

---

## Installation

```bash
npm install ryukez/a2a-artifact-graph
```

---

## Quick Start

Below is a condensed version of `src/samples/math_agent.ts` that demonstrates the three key steps:

1. **Define Artifacts**
2. **Define Builders** (that transform those artifacts)
3. **Run** the `ArtifactGraph`

```ts
import { schema, TaskContext } from "a2a-sdk-ryukez";
import {
  ArtifactGraph,
  defineBuilder,
  UniqueArtifact,
} from "a2a-artifact-graph";

// 1. ────────────────────────────────────
// Define strongly‑typed artifacts
class NumberArtifact {
  constructor(public readonly artifact: schema.Artifact) {}
  value() {
    return this.artifact.parts[0].data.value as number;
  }
  static from(n: number): NumberArtifact {
    return new NumberArtifact({
      type: "data",
      parts: [{ type: "data", data: { value: n } }],
    } as schema.Artifact);
  }
}

class Step1Artifact extends UniqueArtifact<"step1"> {
  number = new NumberArtifact(this.artifact);
}
class Step2Artifact extends UniqueArtifact<"step2"> {
  number = new NumberArtifact(this.artifact);
}
class Step3Artifact extends UniqueArtifact<"step3"> {
  number = new NumberArtifact(this.artifact);
}

type Artifacts = [Step1Artifact, Step2Artifact, Step3Artifact];

// 2. ────────────────────────────────────
// Define builders that transform artifacts
const step1 = defineBuilder<Artifacts>()({
  name: "Step 1",
  inputs: () => [] as const,
  outputs: () => ["step1"] as const,
  async *build({ history }) {
    const n = parseFloat(history![0].parts[0].text);
    yield new Step1Artifact(NumberArtifact.from(n + 1).artifact);
  },
});

const step2 = defineBuilder<Artifacts>()({
  name: "Step 2",
  inputs: () => ["step1"] as const,
  outputs: () => ["step2"] as const,
  async *build({ inputs }) {
    yield new Step2Artifact(
      NumberArtifact.from(inputs.step1.number.value() * 2).artifact
    );
  },
});

const step3 = defineBuilder<Artifacts>()({
  name: "Step 3",
  inputs: () => ["step2"] as const,
  outputs: () => ["step3"] as const,
  async *build({ inputs }) {
    yield new Step3Artifact(
      NumberArtifact.from(inputs.step2.number.value() + 10).artifact
    );
  },
});

// 3. ────────────────────────────────────
// Assemble the graph and execute
export async function* mathAgent({ task, history }: TaskContext) {
  const graph = new ArtifactGraph<Artifacts>(
    {
      step1: (a) => new Step1Artifact(a),
      step2: (a) => new Step2Artifact(a),
      step3: (a) => new Step3Artifact(a),
    },
    [step1, step2, step3]
  );

  // Execution order is automatically planned: step1 ➜ step2 ➜ step3
  for await (const update of graph.run({ task, history })) {
    yield update; // Stream updates back to the caller
  }
}
```

---

## API Overview

| Concept           | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| **Artifact**      | Immutable piece of data flowing through the graph.            |
| **Builder**       | Async generator that transforms input artifacts into outputs. |
| **ArtifactGraph** | Orchestrates builders, resolves dependencies & executes.      |

### Resuming after a failure

`ArtifactGraph.run()` yields progress updates, allowing you to persist state.  
In case of an error simply restart with the same history – already produced artifacts will be reused and only the failed sub‑graph will be executed again.

---

## License

[MIT](LICENSE)
