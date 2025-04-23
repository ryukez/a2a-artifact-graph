import { schema, TaskYieldUpdate } from "a2a-sdk-ryukez";
import { sortBuilders } from "./sort_builders";

export class UniqueArtifact<ID extends string = any> {
  constructor(public id: ID, public artifact: schema.Artifact) {}
}

type ArtifactRecord<All extends readonly UniqueArtifact[]> = {
  [A in All[number] as A["id"] & string]: A;
};

export type ArtifactFactories<All extends readonly UniqueArtifact[]> = {
  [K in All[number] as K["id"] & string]: (artifact: schema.Artifact) => K;
};

export interface ArtifactBuilder<
  All extends readonly UniqueArtifact[],
  I extends readonly (keyof ArtifactRecord<All>)[] = any,
  O extends readonly (keyof ArtifactRecord<All>)[] = any
> {
  name: string;

  inputs(): I;
  outputs(): O;

  build(context: {
    task: schema.Task;
    history?: schema.Message[];
    inputs: Pick<ArtifactRecord<All>, I[number]>;
  }): AsyncGenerator<
    TaskYieldUpdate | ArtifactRecord<All>[O[number]],
    schema.Task | void,
    unknown
  >;
}

export const defineBuilder =
  <All extends readonly UniqueArtifact[]>() =>
  <
    I extends readonly (keyof ArtifactRecord<All>)[],
    O extends readonly (keyof ArtifactRecord<All>)[]
  >(
    cfg: ArtifactBuilder<All, I, O>
  ) =>
    cfg;

const isUniqueArtifact = (v: unknown): v is UniqueArtifact =>
  v instanceof UniqueArtifact;

export class ArtifactGraph<Artifacts extends readonly UniqueArtifact[]> {
  constructor(
    private readonly artifactFactories: ArtifactFactories<Artifacts>,
    private readonly builders: ArtifactBuilder<Artifacts, any>[]
  ) {}

  async *run(input: {
    task: schema.Task;
    history?: schema.Message[];
    verbose?: boolean;
  }): AsyncGenerator<
    TaskYieldUpdate | schema.Artifact,
    schema.Task | void,
    unknown
  > {
    const { task, history, verbose = false } = input;

    /* Map */
    const artifacts = Object.create(null) as ArtifactRecord<Artifacts>;

    /* Load existing artifacts */
    for (const artifact of task.artifacts ?? []) {
      const id = (artifact.metadata ?? {})[
        "artifactGraph.id"
      ] as keyof typeof artifacts;
      if (!id) continue;
      artifacts[id] = this.artifactFactories[id](artifact);
    }

    /* Skip builders that already have all outputs */
    const skippedBuilders = this.builders.filter((b) =>
      (b.outputs() as (keyof typeof artifacts)[]).every((o) => artifacts[o])
    );

    /* Determine execution order */
    const sortedBuilders = sortBuilders(
      this.builders.filter((b) => !skippedBuilders.includes(b))
    );

    /* Notify execution plan (optional) */
    if (verbose) {
      yield {
        state: "working",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: `
Following builders will be skipped, because results are already calculated:
${skippedBuilders.map((b) => b.name).join(", ")}

Execution plan:
${sortedBuilders
  .map((g) => "[" + g.map((b) => b.name).join(", ") + "]")
  .join(" -> ")}
            `,
            },
          ],
        },
      };
    }

    const skippedBuildersSet = new Set(skippedBuilders.map((b) => b.name));

    /* ── Execution loop ── */
    for (const builders of sortedBuilders) {
      for (const builder of builders) {
        if (skippedBuildersSet.has(builder.name)) continue;

        /** Collect required inputs */
        const keys = builder.inputs() as (keyof typeof artifacts)[];
        const inputs = {} as Pick<typeof artifacts, (typeof keys)[number]>;
        for (const k of keys) {
          if (!artifacts[k]) {
            throw new Error(`Artifact ${String(k)} is not found`);
          }
          inputs[k] = artifacts[k];
        }

        /** Execute builder and process yielded values */
        for await (const update of builder.build({ task, history, inputs })) {
          if (isUniqueArtifact(update)) {
            /* Embed id in metadata */
            update.artifact.metadata = {
              ...update.artifact.metadata,
              "artifactGraph.id": update.id,
            };
            artifacts[update.id as keyof typeof artifacts] = update as any;

            /* Pass schema.Artifact to the caller */
            yield update.artifact;
          } else {
            yield update;
          }
        }
      }
    }
  }
}
