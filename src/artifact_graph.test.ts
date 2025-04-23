import { ArtifactGraph, UniqueArtifact } from "./artifact_graph";
import { schema, TaskYieldUpdate } from "a2a-sdk-ryukez";

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
});
