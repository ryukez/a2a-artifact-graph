import { schema, TaskContext, TaskYieldUpdate } from "a2a-sdk-ryukez";
import {
  ArtifactGraph,
  defineBuilder,
  UniqueArtifact,
} from "../artifact_graph";
import assert from "assert";

class NumberArtifact {
  constructor(public readonly artifact: schema.Artifact) {}

  parsed(): number {
    if (this.artifact.parts[0].type !== "data") {
      throw new Error("Invalid artifact");
    }
    return this.artifact.parts[0].data.value as number;
  }

  static from(
    input: { number: number } & Omit<schema.Artifact, "parts">
  ): NumberArtifact {
    return new NumberArtifact({
      ...input,
      parts: [{ type: "data", data: { value: input.number } }],
    });
  }
}

class Step1Artifact extends UniqueArtifact<"step1"> {
  public readonly number: NumberArtifact;

  constructor(artifact: schema.Artifact) {
    super("step1", artifact);
    this.number = new NumberArtifact(artifact);
  }
}

class Step2Artifact extends UniqueArtifact<"step2"> {
  public readonly number: NumberArtifact;

  constructor(artifact: schema.Artifact) {
    super("step2", artifact);
    this.number = new NumberArtifact(artifact);
  }
}

class Step3Artifact extends UniqueArtifact<"step3"> {
  public readonly number: NumberArtifact;

  constructor(artifact: schema.Artifact) {
    super("step3", artifact);
    this.number = new NumberArtifact(artifact);
  }
}

type Artifacts = [Step1Artifact, Step2Artifact, Step3Artifact];

const step1Builder = defineBuilder<Artifacts>()({
  name: "Step 1",
  inputs: () => [] as const,
  outputs: () => ["step1"] as const,
  async *build({ history }) {
    assert(history && history[0].parts[0].type === "text");
    const input = parseFloat(history[0].parts[0].text);

    if (Math.random() < 0.8) {
      throw new Error("Randomly failed in step1");
    }

    yield new Step1Artifact(
      NumberArtifact.from({ number: input + 1 }).artifact
    );
  },
});

const step2Builder = defineBuilder<Artifacts>()({
  name: "Step 2",
  inputs: () => ["step1"] as const,
  outputs: () => ["step2"] as const,
  async *build({ inputs }) {
    if (Math.random() < 0.8) {
      throw new Error("Randomly failed in step2");
    }

    yield new Step2Artifact(
      NumberArtifact.from({ number: inputs.step1.number.parsed() * 2 }).artifact
    );
  },
});

const step3Builder = defineBuilder<Artifacts>()({
  name: "Step 3",
  inputs: () => ["step2"] as const,
  outputs: () => ["step3"] as const,
  async *build({ inputs }) {
    if (Math.random() < 0.8) {
      throw new Error("Randomly failed in step3");
    }

    yield new Step3Artifact(
      NumberArtifact.from({
        number: inputs.step2.number.parsed() + 10,
      }).artifact
    );
  },
});

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

export const mathAgentCard: schema.AgentCard = {
  name: "Math Agent",
  description:
    "Performs multiple-step calculations, returning errors 80% of the time",
  url: "http://localhost:41241",
  version: "0.0.1",
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  authentication: null,
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  skills: [
    {
      id: "multi_step_calculation",
      name: "Multi-step Calculation",
      description:
        "Performs multiple-step calculations, returning errors 80% of the time",
      tags: ["math", "calculation", "error"],
      examples: ["5", "10"],
    },
  ],
};
