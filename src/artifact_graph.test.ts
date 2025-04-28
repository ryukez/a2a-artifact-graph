import { ArtifactGraph, UniqueArtifact } from "./artifact_graph";
import { schema, TaskYieldUpdate } from "@ryukez/a2a-sdk";
import { dataArtifact, tuplePartsArtifact } from "./artifact";
import { z } from "zod";

/* -------------------------------------------------- */
/*                Artifact Definitions                 */
/* -------------------------------------------------- */
class Step1Artifact extends UniqueArtifact<"step1"> {
  constructor(a: schema.Artifact) {
    super("step1", a);
  }
}
class Step2Artifact extends UniqueArtifact<"step2"> {
  constructor(a: schema.Artifact) {
    super("step2", a);
  }
}

/* -------------------------------------------------- */
/*                     Helpers                        */
/* -------------------------------------------------- */
const emptyTask = (): schema.Task => ({
  id: "t1",
  status: { state: "submitted" },
});

const drain = async (gen: AsyncGenerator<any>) => {
  for await (const _ of gen) {
    /* discard */
  }
};

/* -------------------------------------------------- */
/*                    Builders                        */
/* -------------------------------------------------- */
const step1Builder = {
  inputs: () => [] as const,
  outputs: () => ["step1"] as const,
  build: async function* () {
    // Progress notification (any format is OK, actual type is defined by SDK)
    const progress = { note: "building‑step1" } as unknown as TaskYieldUpdate;
    yield progress;
    yield new Step1Artifact({
      parts: [{ type: "data", data: { result: 1 } }],
    });
  },
};

const step2Builder = {
  inputs: () => ["step1"] as const,
  outputs: () => ["step2"] as const,
  build: async function* (ctx: any) {
    expect(ctx.inputs.step1).toBeInstanceOf(Step1Artifact);
    const val = (ctx.inputs.step1.artifact.parts[0] as any).data
      .result as number;
    yield new Step2Artifact({
      parts: [{ type: "data", data: { result: val + 1 } }],
    });
  },
};

/* -------------------------------------------------- */
/*                  Graph Generator                   */
/* -------------------------------------------------- */
const createGraph = (builders: any[]) =>
  new ArtifactGraph(
    {
      step1: (a: schema.Artifact) => new Step1Artifact(a),
      step2: (a: schema.Artifact) => new Step2Artifact(a),
    },
    builders
  );

/* ================================================== */
/*                     TEST SUITE                     */
/* ================================================== */
describe("ArtifactGraph.run (with real schema import)", () => {
  /* ---------- Artifact Generation & Metadata ---------- */
  it("yields artifacts with artifactGraph.id metadata", async () => {
    const graph = createGraph([step1Builder]);
    const outs: schema.Artifact[] = [];
    for await (const o of graph.run({ task: emptyTask() })) {
      if ("parts" in o) {
        outs.push(o);
      }
    }

    const art = outs.find((a) => a.metadata?.["artifactGraph.id"] === "step1");
    expect(art).toBeDefined();
  });

  /* ---------- TaskYieldUpdate Pass-through ---------- */
  it("passes through TaskYieldUpdate objects unchanged", async () => {
    const graph = createGraph([step1Builder]);
    const gotten: any[] = [];
    for await (const o of graph.run({ task: emptyTask() })) {
      gotten.push(o);
    }

    expect(gotten[0]).toHaveProperty("note", "building‑step1");
    // Second item is the generated artifact
    expect((gotten[1] as schema.Artifact).metadata?.["artifactGraph.id"]).toBe(
      "step1"
    );
  });

  /* ---------- Builder Dependency Resolution ---------- */
  it("runs builders respecting dependencies", async () => {
    const graph = createGraph([step1Builder, step2Builder]);
    const ids: string[] = [];

    for await (const u of graph.run({ task: emptyTask() })) {
      if ("parts" in u) {
        const id = (u as schema.Artifact).metadata?.["artifactGraph.id"];
        if (id) ids.push(id as string);
      }
    }
    expect(ids).toEqual(["step1", "step2"]);
  });

  /* ---------- Builder Skip Logic ---------- */
  it("skips builder when all its outputs already exist", async () => {
    const pre: schema.Artifact = {
      parts: [{ type: "text", text: "dummy" }],
      metadata: { "artifactGraph.id": "step1" },
    };

    const spy = jest.fn(step1Builder.build);
    const graph = createGraph([{ ...step1Builder, build: spy }]);

    await drain(graph.run({ task: { ...emptyTask(), artifacts: [pre] } }));
    expect(spy).not.toHaveBeenCalled();
  });

  /* ---------- Unreachable Artifact Detection ---------- */
  it("throws at construction when some artifacts are unreachable", () => {
    expect(() => createGraph([step2Builder])).toThrow(
      /Unreachable artifact\(s\):/ // message should list unreachable ids
    );
  });

  /* ---------- Task/History Pass-through ---------- */
  it("passes task & history through to builder.build()", async () => {
    const hist: schema.Message[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
    ];

    const spyGen = jest.fn(async function* (ctx: any) {
      expect(ctx.task.id).toBe("t1");
      expect(ctx.history).toBe(hist);
      yield new Step1Artifact({ parts: [] });
    });

    const graph = createGraph([
      {
        inputs: () => [] as const,
        outputs: () => ["step1"] as const,
        build: spyGen,
      },
    ]);

    await drain(graph.run({ task: emptyTask(), history: hist }));
    expect(spyGen).toHaveBeenCalledTimes(1);
  });

  /* ---------- Partial Output Execution ---------- */
  it("executes builder when only some outputs pre‑exist", async () => {
    const complexBuilder = {
      inputs: () => [] as const,
      outputs: () => ["step1", "step2"] as const,
      build: jest.fn(async function* () {
        yield new Step2Artifact({ parts: [] });
      }),
    };

    const pre: schema.Artifact = {
      parts: [{ type: "text", text: "dummy" }],
      metadata: { "artifactGraph.id": "step1" },
    };

    const graph = createGraph([complexBuilder]);
    await drain(graph.run({ task: { ...emptyTask(), artifacts: [pre] } }));
    expect(complexBuilder.build).toHaveBeenCalled();
  });

  /* ---------- Condition-based Skip Logic ---------- */
  describe("conditions", () => {
    it("skips builder when condition is not satisfied", async () => {
      /* Condition: only run step2 when step1 result === 2 */
      const condition = {
        inputs: ["step1"] as const,
        if: (ins: any) => {
          const val = (ins.step1.artifact.parts[0] as any).data.result;
          return val === 2;
        },
        then: ["step2"] as const,
      } as const;

      const step2Spy = jest.fn(step2Builder.build);

      const graph = new ArtifactGraph(
        {
          step1: (a: schema.Artifact) => new Step1Artifact(a),
          step2: (a: schema.Artifact) => new Step2Artifact(a),
        },
        [
          { ...step1Builder, name: "step1" },
          { ...step2Builder, name: "step2", build: step2Spy },
        ],
        [condition]
      );

      const yieldedIds: string[] = [];
      for await (const o of graph.run({ task: emptyTask() })) {
        if ("parts" in o) {
          yieldedIds.push((o.metadata as any)["artifactGraph.id"]);
        }
      }

      expect(step2Spy).not.toHaveBeenCalled();
      expect(yieldedIds).toEqual(["step1"]);
    });

    it("executes builder when condition is satisfied", async () => {
      /* Modified step1 builder that yields result = 2 */
      const step1BuilderPass = {
        name: "step1",
        inputs: () => [] as const,
        outputs: () => ["step1"] as const,
        build: async function* () {
          yield new Step1Artifact({
            parts: [{ type: "data", data: { result: 2 } }],
          });
        },
      };

      const condition = {
        inputs: ["step1"] as const,
        if: (ins: any) => {
          const val = (ins.step1.artifact.parts[0] as any).data.result;
          return val === 2;
        },
        then: ["step2"] as const,
      } as const;

      const step2Spy = jest.fn(step2Builder.build);

      const graph = new ArtifactGraph(
        {
          step1: (a: schema.Artifact) => new Step1Artifact(a),
          step2: (a: schema.Artifact) => new Step2Artifact(a),
        },
        [
          { ...step1BuilderPass, name: "step1" },
          { ...step2Builder, name: "step2", build: step2Spy },
        ],
        [condition]
      );

      const yieldedIds: string[] = [];
      for await (const o of graph.run({ task: emptyTask() })) {
        if ("parts" in o) {
          yieldedIds.push((o.metadata as any)["artifactGraph.id"]);
        }
      }

      expect(step2Spy).toHaveBeenCalledTimes(1);
      expect(yieldedIds).toEqual(["step1", "step2"]);
    });
  });
});

/* ================================================== */
/*   tuplePartsArtifact & dataArtifact      */
/* ================================================== */
describe("ArtifactGraph with tuplePartsArtifact & dataArtifact", () => {
  /* ---------- Definitions ---------- */
  const UserArtifact = dataArtifact("user", z.object({ name: z.string() }));
  const TextDataArtifact = tuplePartsArtifact("textData", [
    "text",
    "data",
  ] as const);

  /* ---------- Builders ---------- */
  const userBuilder = {
    name: "userBuilder",
    inputs: () => [] as const,
    outputs: () => ["user"] as const,
    build: async function* () {
      yield new UserArtifact({
        parts: [{ type: "data", data: { name: "Alice" } }],
      });
    },
  };

  const textDataBuilder = {
    name: "textDataBuilder",
    inputs: () => [] as const,
    outputs: () => ["textData"] as const,
    build: async function* () {
      yield new TextDataArtifact({
        parts: [
          { type: "text", text: "Hello" },
          { type: "data", data: { url: "https://example.com/img.png" } },
        ],
      });
    },
  };

  /* ---------- Graph ---------- */
  const graph = new ArtifactGraph(
    {
      user: (a: schema.Artifact) => new UserArtifact(a),
      textData: (a: schema.Artifact) => new TextDataArtifact(a),
    },
    [userBuilder, textDataBuilder]
  );

  it("assigns artifactGraph.id metadata for artifacts from tuplePartsArtifact & dataArtifact", async () => {
    const outs: schema.Artifact[] = [];

    for await (const o of graph.run({ task: emptyTask() })) {
      if ("parts" in o) outs.push(o);
    }

    const userMeta = outs.find(
      (a) => a.metadata?.["artifactGraph.id"] === "user"
    );
    const textDataMeta = outs.find(
      (a) => a.metadata?.["artifactGraph.id"] === "textData"
    );

    expect(userMeta).toBeDefined();
    expect(textDataMeta).toBeDefined();
  });

  it("dataArtifact class instances are UniqueArtifact", () => {
    const art = new UserArtifact({ parts: [] });
    expect(art).toBeInstanceOf(UniqueArtifact);
  });

  it("tuplePartsArtifact class instances are UniqueArtifact", () => {
    const art = new TextDataArtifact({ parts: [] });
    expect(art).toBeInstanceOf(UniqueArtifact);
  });
});
