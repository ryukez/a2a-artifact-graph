import { schema, TaskContext, TaskYieldUpdate } from "@ryukez/a2a-sdk";
import {
  ArtifactGraph,
  UniqueArtifact,
  defineBuilder,
  defineCondition,
} from "../artifact_graph";
import assert from "assert";
import { dataArtifact, tuplePartsArtifact } from "../artifact";
import { z } from "zod";

const Step1Artifact = dataArtifact(
  "step1",
  z.object({
    value: z.number(),
  })
);

const Step2Artifact = dataArtifact(
  "step2",
  z.object({
    value: z.number(),
  })
);

const Step3Artifact = tuplePartsArtifact("step3", ["text"]);

const Step4Artifact = dataArtifact(
  "step4",
  z.object({
    value: z.number(),
  })
);

type Artifacts = readonly [
  InstanceType<typeof Step1Artifact>,
  InstanceType<typeof Step2Artifact>,
  InstanceType<typeof Step3Artifact>,
  InstanceType<typeof Step4Artifact>
];

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

    yield Step1Artifact.fromData({
      data: {
        value: input + 1,
      },
    });
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

    yield Step2Artifact.fromData({
      data: {
        value: inputs.step1.parsed().value * 2,
      },
    });
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

    yield Step3Artifact.fromParts({
      parts: [{ type: "text", text: `${inputs.step2.parsed().value}` }],
    });
  },
});

const step4Builder = defineBuilder<Artifacts>()({
  name: "Step 4",
  inputs: () => ["step2"] as const,
  outputs: () => ["step4"] as const,
  async *build({ inputs }) {
    yield Step4Artifact.fromData({
      data: {
        value: inputs.step2.parsed().value * 2,
      },
    });
  },
});

export async function* mathAgent({
  task,
  history,
}: TaskContext): AsyncGenerator<TaskYieldUpdate, schema.Task | void, unknown> {
  const graph = new ArtifactGraph<Artifacts>(
    {
      step1: (artifact: schema.Artifact) => new Step1Artifact(artifact),
      step2: (artifact: schema.Artifact) => new Step2Artifact(artifact),
      step3: (artifact: schema.Artifact) => new Step3Artifact(artifact),
      step4: (artifact: schema.Artifact) => new Step4Artifact(artifact),
    },
    [step1Builder, step2Builder, step3Builder, step4Builder],
    [
      defineCondition<Artifacts>()({
        inputs: ["step1"] as const,
        if: ({ inputs }) => inputs.step1.parsed().value > 10,
        then: ["step4"] as const,
      }),
    ]
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
