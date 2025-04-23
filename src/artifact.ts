import { schema } from "a2a-sdk-ryukez";
import { UniqueArtifact } from "./artifact_graph";
import { z } from "zod";

/**
 * Dynamically generates an Artifact class that holds data with a specific schema.
 *
 * @example
 *   const UserArtifact = dataArtifact("user", z.object({
 *     name: z.string(),
 *     age: z.number(),
 *   }));
 *
 *   const art = UserArtifact.fromData({
 *     data: { name: "John", age: 30 },
 *   });
 *
 *   const user = art.parsed();   // Type safe!
 */
export function dataArtifact<const ID extends string, S extends z.Schema>(
  id: ID,
  schema: S
) {
  return class ArtifactClass extends UniqueArtifact<ID> {
    static readonly schema = schema;

    constructor(artifact: schema.Artifact) {
      super(id, artifact);
    }

    /** Returns the parsed data according to the schema */
    parsed(): z.infer<S> {
      const part = this.artifact.parts[0];
      if (part?.type !== "data") {
        throw new Error(`Artifact ${id} has no data part`);
      }
      return schema.parse(part.data);
    }

    /**
     * Factory method. Creates a new artifact from the given data.
     * The data is validated against the schema.
     */
    static fromData(
      input: { data: z.infer<S> } & Omit<schema.Artifact, "parts">
    ) {
      return new this({
        parts: [{ type: "data", data: input.data }],
        ...input,
      });
    }
  };
}

/**
 * Dynamically generates an Artifact class that holds a tuple type `parts`.
 *
 * @example
 *   const TextImageArtifact = tuplePartsArtifact("textImage");
 *
 *   const art = TextImageArtifact.fromParts({
 *     parts: [
 *       { type: "text", text: "hello" },
 *       { type: "image", url: "https://…" },
 *     ] as const,           // ← Automatically infers tuple type from here
 *   });
 *
 *   const [text, image] = art.parts();   // Type safe!
 */
export function tuplePartsArtifact<const ID extends string>(id: ID) {
  return class ArtifactClass<
    T extends readonly schema.Part[]
  > extends UniqueArtifact<ID> {
    static readonly id = id;

    constructor(artifact: schema.Artifact) {
      super(id, artifact);
    }

    /** Returns the tuple type of parts */
    parts(): T {
      return this.artifact.parts as unknown as T;
    }

    /**
     * Factory method. Creates a new artifact from the given parts.
     * The parts are validated against the schema.
     */
    static fromParts<P extends readonly schema.Part[]>(
      input: { parts: P } & Omit<schema.Artifact, "parts">
    ) {
      const artifact = {
        ...input,
        parts: input.parts as unknown as schema.Part[],
      };

      return new this(artifact);
    }
  };
}
