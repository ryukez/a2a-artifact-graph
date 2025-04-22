import { schema, TaskYieldUpdate } from "a2a-sdk-ryukez";
import { sortBuilders } from "./sort_builders";

export class UniqueArtifact<ID extends string = any> {
  constructor(public id: ID, public artifact: schema.Artifact) {}
}

type ArtifactRecord<All extends readonly UniqueArtifact[]> = {
  [A in All[number] as A["id"]]: A;
};

export interface ArtifactBuilder<
  All extends readonly UniqueArtifact[],
  I extends readonly (keyof ArtifactRecord<All>)[] = any,
  O extends readonly (keyof ArtifactRecord<All>)[] = any
> {
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
    private readonly artifacts: {
      [K in Artifacts[number] as K["id"]]: (artifact: schema.Artifact) => K;
    },
    private readonly builders: ArtifactBuilder<Artifacts, any>[]
  ) {}

  async *run(
    task: schema.Task,
    history?: schema.Message[]
  ): AsyncGenerator<TaskYieldUpdate, schema.Task | void, unknown> {
    const artifacts = Object.create(null) as {
      [K in Artifacts[number] as K["id"]]: K;
    };

    for (const artifact of task.artifacts ?? []) {
      const id = (artifact.metadata ?? {})[
        "artifactGraph.id"
      ] as keyof typeof artifacts;
      if (!id) continue;

      artifacts[id] = this.artifacts[id](artifact);
    }

    for (const builders of sortBuilders(this.builders)) {
      // TODO: parallelize builders
      for (const builder of builders) {
        // Skip if all outputs are already calculated
        const outputs = builder.outputs() as (keyof typeof artifacts)[];
        if (outputs.every((o) => artifacts[o])) {
          continue;
        }

        const keys = builder.inputs() as (keyof typeof artifacts)[];
        const inputs = {} as Pick<typeof artifacts, (typeof keys)[number]>;
        for (const k of keys) {
          if (!artifacts[k]) {
            throw new Error(`Artifact ${k} is not found`);
          }
          inputs[k] = artifacts[k];
        }

        for await (const update of builder.build({
          task,
          history,
          inputs,
        })) {
          if (isUniqueArtifact(update)) {
            update.artifact.metadata = {
              ...update.artifact.metadata,
              "artifactGraph.id": update.id,
            };
            artifacts[update.id as keyof typeof artifacts] = update as any;
            yield update.artifact;
          } else {
            yield update;
          }
        }
      }
    }
  }
}
