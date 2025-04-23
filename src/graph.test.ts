import { sortBuilders, findUnreachableArtifacts } from "./graph";
import { ArtifactBuilder } from "./artifact_graph";

// Helper to create dummy builders without caring about generic params
const createBuilder = (
  name: string,
  inputs: readonly string[],
  outputs: readonly string[]
): ArtifactBuilder<any, any> & { name: string } => {
  return {
    name,
    inputs: () => inputs as any,
    outputs: () => outputs as any,
    // Dummy async generator – never yields
    build: async function* () {
      /* no‑op */
    },
  } as any;
};

describe("sortBuilders", () => {
  it("orders builders respecting dependencies (example from doc string)", () => {
    /*
      Builder1: (A, B, C) -> E
      Builder2: () -> A, B
      Builder3: (A) -> C, D
      Builder4: (B) -> F

      Expected groups: [[Builder2], [Builder3, Builder4], [Builder1]]
    */
    const builder1 = createBuilder("builder1", ["A", "B", "C"], ["E"]);
    const builder2 = createBuilder("builder2", [], ["A", "B"]);
    const builder3 = createBuilder("builder3", ["A"], ["C", "D"]);
    const builder4 = createBuilder("builder4", ["B"], ["F"]);

    const groups = sortBuilders([builder1, builder2, builder3, builder4]);

    // First group should only contain builder2
    expect(groups[0]).toEqual([builder2]);

    // Second group should contain builder3 and builder4 (order inside group not important)
    expect(groups[1].length).toBe(2);
    expect(new Set(groups[1])).toEqual(new Set([builder3, builder4]));

    // Final group should only contain builder1
    expect(groups[2]).toEqual([builder1]);
  });

  it("groups independent builders in the same batch", () => {
    const builderA = createBuilder("A", [], ["A"]);
    const builderB = createBuilder("B", [], ["B"]);
    const builderC = createBuilder("C", ["A", "B"], ["C"]);

    const groups = sortBuilders([builderA, builderB, builderC]);

    expect(groups[0].length).toBe(2);
    expect(new Set(groups[0])).toEqual(new Set([builderA, builderB]));
    expect(groups[1]).toEqual([builderC]);
  });

  it("throws when cyclic dependencies are present", () => {
    const builderX = createBuilder("X", ["Y"], ["X"]);
    const builderY = createBuilder("Y", ["X"], ["Y"]);

    expect(() => sortBuilders([builderX, builderY])).toThrow(
      "Cyclic dependency detected among builders"
    );
  });

  it("throws on duplicate outputs", () => {
    const builder1 = createBuilder("B1", [], ["A"]);
    const builder2 = createBuilder("B2", [], ["A"]); // duplicate output "A"

    expect(() => sortBuilders([builder1, builder2])).toThrow(
      /Duplicate builders detected/
    );
  });

  it("orders builders in a complex dependency graph", () => {
    const b1 = createBuilder("b1", [], ["A"]);
    const b2 = createBuilder("b2", ["A"], ["B"]);
    const b3 = createBuilder("b3", ["A", "B"], ["C"]);
    const b4 = createBuilder("b4", ["A", "B"], ["D"]);
    const b5 = createBuilder("b5", ["D"], ["E"]);
    const b6 = createBuilder("b6", ["E"], ["F"]);
    const b7 = createBuilder("b7", ["A"], ["G"]);
    const b8 = createBuilder("b8", ["A", "B", "D", "G"], ["H"]);
    const b9 = createBuilder("b9", ["B", "G", "H"], ["I"]);
    const b10 = createBuilder("b10", ["A", "D", "I"], ["J"]);

    const groups = sortBuilders([b1, b2, b3, b4, b5, b6, b7, b8, b9, b10]);

    // Expected grouping by dependency layers
    const expected = [[b1], [b2, b7], [b3, b4], [b5, b8], [b6, b9], [b10]];

    expect(groups.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(groups[i]).toEqual(expected[i]);
    }
  });
});

/* -------------------------------------------------- */
/*            Tests for findUnreachableArtifacts       */
/* -------------------------------------------------- */

describe("findUnreachableArtifacts", () => {
  /* Helper to create dummy builder (re‑use createBuilder above) */

  it("returns empty array when all artifacts are reachable", () => {
    const b1 = createBuilder("B1", [], ["A"]); // produces A
    const b2 = createBuilder("B2", ["A"], ["B"]); // produces B from A

    const unreachable = findUnreachableArtifacts([b1, b2]);
    expect(unreachable).toEqual([]);
  });

  it("returns list of unreachable artifacts when they exist", () => {
    const b1 = createBuilder("B1", ["X"], ["Y"]); // needs X (missing) -> Y

    const unreachable = findUnreachableArtifacts([b1]);

    // order is not guaranteed
    expect(new Set(unreachable)).toEqual(new Set(["X", "Y"]));
  });

  it("handles more complex dependency chains", () => {
    // Chain: B1 () -> A ; B2 (A) -> B ; B3 (B, Z) -> C   (Z missing)
    const b1 = createBuilder("B1", [], ["A"]);
    const b2 = createBuilder("B2", ["A"], ["B"]);
    const b3 = createBuilder("B3", ["B", "Z"], ["C"]);

    const unreachable = findUnreachableArtifacts([b1, b2, b3]);

    expect(new Set(unreachable)).toEqual(new Set(["Z", "C"]));
  });
});
