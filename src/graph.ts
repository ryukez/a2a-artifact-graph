import { ArtifactBuilder, UniqueArtifact } from "./artifact_graph";

// Sort builders so that required inputs should be calculated before the builder itself.
// Returns a list of builder groups, where each group is a list of builders that can be executed in parallel, and the following group should be executed after the previous group.
// Example:
//   Builder1: (A, B, C) -> E
//   Builder2: () -> A, B
//   Builder3: (A) -> C, D
//   Builder4: (B) -> F
//
// Expected output: [[Builder2], [Builder3, Builder4], [Builder1]]
export const sortBuilders = <All extends readonly UniqueArtifact[]>(
  builders: ArtifactBuilder<All, any>[]
): ArtifactBuilder<All, any>[][] => {
  const remaining = [...builders];

  // Map each artifact id to the builder that creates it
  const outputToBuilder = new Map<string, ArtifactBuilder<All, any>>();
  for (const builder of remaining) {
    const outs = builder.outputs() as readonly string[];
    for (const o of outs) {
      if (outputToBuilder.has(o)) {
        throw new Error(`Duplicate builders detected for artifact "${o}"`);
      }
      outputToBuilder.set(o, builder);
    }
  }

  // Build dependency sets: for each builder, which other builders must run before it
  const deps = new Map<
    ArtifactBuilder<All, any>,
    Set<ArtifactBuilder<All, any>>
  >();
  for (const builder of remaining) {
    const req = new Set<ArtifactBuilder<All, any>>();
    const ins = builder.inputs() as readonly string[];
    for (const i of ins) {
      const depBuilder = outputToBuilder.get(i);
      // A builder cannot depend on itself
      if (depBuilder && depBuilder !== builder) {
        req.add(depBuilder);
      }
    }
    deps.set(builder, req);
  }

  const result: ArtifactBuilder<All, any>[][] = [];

  // Kahn style topological grouping
  while (deps.size > 0) {
    // Builders whose dependencies are all satisfied
    const ready: ArtifactBuilder<All, any>[] = [];
    for (const [b, d] of deps) {
      if (d.size === 0) {
        ready.push(b);
      }
    }

    if (ready.length === 0) {
      throw new Error("Cyclic dependency detected among builders");
    }

    // Preserve original order by sorting 'ready' according to original 'builders' array index
    ready.sort((a, b) => remaining.indexOf(a) - remaining.indexOf(b));

    result.push(ready);

    // Remove ready builders and update dependencies
    for (const done of ready) {
      deps.delete(done);
      // For other builders, remove this dependency
      for (const s of deps.values()) {
        s.delete(done);
      }
    }
  }

  return result;
};

// Calculate reachable artifacts starting from builders that require no inputs.
export const findUnreachableArtifacts = <All extends readonly UniqueArtifact[]>(
  builders: ArtifactBuilder<All, any>[]
): string[] => {
  // Collect all inputs & outputs for later comparison
  const allOutputs = new Set<string>();
  const allInputs = new Set<string>();
  for (const b of builders) {
    for (const o of b.outputs() as readonly string[]) allOutputs.add(String(o));
    for (const i of b.inputs() as readonly string[]) allInputs.add(String(i));
  }

  // Kahn‑like reachability analysis: start from builders with no inputs.
  const reachable = new Set<string>();
  const remaining = new Set(builders);

  let advanced = true;
  while (advanced) {
    advanced = false;
    for (const b of Array.from(remaining)) {
      const ins = b.inputs() as readonly string[];
      if (ins.every((i) => reachable.has(i))) {
        // This builder can be executed; mark its outputs as reachable.
        for (const o of b.outputs() as readonly string[])
          reachable.add(String(o));
        remaining.delete(b);
        advanced = true;
      }
    }
  }

  // Reachable set now contains artifacts producible from empty input set.
  // Any artifact that appears as an output or required input but is not reachable is unreachable.
  const universe = new Set<string>([...allOutputs, ...allInputs]);
  const unreachable: string[] = [];
  for (const id of universe) {
    if (!reachable.has(id)) {
      unreachable.push(id);
    }
  }
  return unreachable;
};
