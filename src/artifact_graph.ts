import { schema, TaskYieldUpdate } from "@ryukez/a2a-sdk";
import { sortBuilders, findUnreachableArtifacts } from "./graph";

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

/**
 * Helper to create a type-safe ArtifactCondition with full type inference.
 */
export const defineCondition =
  <All extends readonly UniqueArtifact[]>() =>
  <
    I extends readonly (keyof ArtifactRecord<All>)[],
    O extends readonly (keyof ArtifactRecord<All>)[]
  >(
    cfg: ArtifactCondition<All, I, O>
  ) =>
    cfg;

export type ArtifactCondition<
  All extends readonly UniqueArtifact[],
  I extends readonly (keyof ArtifactRecord<All>)[] = any,
  O extends readonly (keyof ArtifactRecord<All>)[] = any
> = {
  inputs: I;
  if: (context: { inputs: Pick<ArtifactRecord<All>, I[number]> }) => boolean;
  then: O;
};

export class ArtifactGraph<Artifacts extends readonly UniqueArtifact[]> {
  constructor(
    private readonly artifactFactories: ArtifactFactories<Artifacts>,
    private readonly builders: ArtifactBuilder<Artifacts, any, any>[],
    private readonly conditions: ArtifactCondition<Artifacts, any, any>[] = []
  ) {
    const unreachable = findUnreachableArtifacts(builders);
    if (unreachable.length > 0) {
      throw new Error(`Unreachable artifact(s): ${unreachable.join(", ")}`);
    }
  }

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
        // Skip builder if its outputs are already calculated
        if (skippedBuildersSet.has(builder.name)) {
          if (verbose) {
            yield {
              state: "working",
              message: {
                role: "agent",
                parts: [
                  {
                    type: "text",
                    text: `${builder.name} skipped because its outputs are already calculated`,
                  },
                ],
              },
            };
          }
          continue;
        }

        const inputKeys = builder.inputs() as (keyof typeof artifacts)[];
        const outputKeys = builder.outputs() as (keyof typeof artifacts)[];

        /** ---- Evaluate relevant conditions ---- */
        const relevantConditions = this.conditions.filter((cond) => {
          const condOutputs = cond.then as readonly string[];
          return (
            (inputKeys as readonly string[]).some((id) =>
              condOutputs.includes(id)
            ) ||
            (outputKeys as readonly string[]).some((id) =>
              condOutputs.includes(id)
            )
          );
        });

        let conditionsPassed = true;
        for (const cond of relevantConditions) {
          const required = cond.inputs as (keyof typeof artifacts)[];
          const condInputs = {} as any;
          for (const r of required) {
            if (!artifacts[r]) {
              throw new Error(
                `${builder.name}: Condition requires artifact ${String(
                  r
                )} which is missing`
              );
            }
            condInputs[r] = artifacts[r];
          }

          if (!cond.if(condInputs)) {
            conditionsPassed = false;
            break;
          }
        }

        if (!conditionsPassed) {
          if (verbose) {
            yield {
              state: "working",
              message: {
                role: "agent",
                parts: [
                  {
                    type: "text",
                    text: `${builder.name} skipped because condition(s) not satisfied`,
                  },
                ],
              },
            };
          }
          continue; // skip builder execution
        }

        /** Collect required inputs */
        const inputs = {} as Pick<typeof artifacts, (typeof inputKeys)[number]>;
        for (const k of inputKeys) {
          if (!artifacts[k]) {
            throw new Error(
              `${builder.name}: Artifact ${String(k)} is not found`
            );
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

    if (verbose) {
      // Calculate artifacts summary
      const calculatedArtifacts: (keyof typeof artifacts)[] = [];
      const missingArtifacts: (keyof typeof artifacts)[] = [];
      for (const key of Object.keys(
        this.artifactFactories
      ) as (keyof typeof artifacts)[]) {
        if (artifacts[key] || skippedBuildersSet.has(key)) {
          calculatedArtifacts.push(key);
        } else {
          missingArtifacts.push(key);
        }
      }

      yield {
        state: "working",
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: `Artifacts summary:
  ✅ Calculated: ${calculatedArtifacts.join(", ")}
  ❌ Missing: ${missingArtifacts.join(", ")}
              `,
            },
          ],
        },
      };
    }
  }
}
