import { schema } from "@ryukez/a2a-sdk";
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
        parts: [{ type: "data", data: schema.parse(input.data) }],
        ...input,
      });
    }
  };
}

/**
 * Dynamically generates an Artifact class that holds a tuple type `parts`.
 *
 * @example
 *   const TextImageArtifact = tuplePartsArtifact("textImage", ["text", "image"]);
 *
 *   const art = TextImageArtifact.fromParts({
 *     parts: [
 *       { type: "text", text: "hello" },
 *       { type: "image", url: "https://…" },
 *     ]
 *   });
 *
 *   const [text, image] = art.parts();   // Type safe!
 */
type PartByType = {
  text: schema.TextPart;
  file: schema.FilePart;
  data: schema.DataPart;
};

/* Helper type to convert a tuple of part types to a tuple of parts */
type PartsFromTypes<T extends readonly (keyof PartByType)[]> = {
  [K in keyof T]: PartByType[T[K]];
};

interface TuplePartsArtifactInstance<
  ID extends string,
  Parts extends readonly schema.Part[]
> {
  readonly id: ID;
  readonly artifact: schema.Artifact;
  parts(): Parts;
}

interface TuplePartsArtifactClassStatic<
  ID extends string,
  Parts extends readonly schema.Part[]
> {
  /* Can be instantiated with new */
  new (artifact: schema.Artifact): TuplePartsArtifactInstance<ID, Parts>;

  /* Static members */
  readonly id: ID;
  fromParts(
    input: { parts: Parts } & Omit<schema.Artifact, "parts">
  ): TuplePartsArtifactInstance<ID, Parts>;
}

type TuplePartsArtifactMakeClass<
  ID extends string,
  P extends readonly schema.Part[]
> = TuplePartsArtifactClassStatic<ID, P>;

/*─────────────────────────────────────────────*
 |  Overload Declarations                    |
 *─────────────────────────────────────────────*/

/**
 * A. **Pattern with `Parts` given as type parameter**
 *    ```ts
 *    const Foo = tuplePartsArtifact("foo")<
 *      readonly [schema.TextPart, schema.FilePart]
 *    >();
 *    ```
 */
export function tuplePartsArtifact<const ID extends string>(
  id: ID
): <Parts extends readonly schema.Part[]>() => TuplePartsArtifactMakeClass<
  ID,
  Parts
>;

/**
 * B. **Pattern to infer `Parts` from tag literals**
 *    ```ts
 *    const Foo = tuplePartsArtifact("foo", ["text", "file"] as const);
 *    // parts(): readonly [schema.TextPart, schema.FilePart]
 *    ```
 */
export function tuplePartsArtifact<
  const ID extends string,
  const Types extends readonly (keyof PartByType)[]
>(id: ID, types: Types): TuplePartsArtifactMakeClass<ID, PartsFromTypes<Types>>;

/*─────────────────────────────────────────────*
 |  Single Runtime Implementation (for overload resolution) |
 *─────────────────────────────────────────────*/
export function tuplePartsArtifact(
  id: string,
  types?: readonly (keyof PartByType)[]
) {
  class ArtifactCls extends UniqueArtifact<typeof id> {
    static readonly id = id as string;

    constructor(artifact: schema.Artifact) {
      /* Delegate id and artifact to UniqueArtifact constructor */
      super(id as any, artifact);
    }

    /**
     * Returns parts with proper typing. The actual tuple type is preserved via generics
     * in the surrounding factory function.
     */
    parts(): unknown {
      return this.artifact.parts as unknown;
    }

    /**
     * Factory: validates nothing but preserves types, mirroring dataArtifact.fromData()
     */
    static fromParts(
      input: { parts: readonly schema.Part[] } & Omit<schema.Artifact, "parts">
    ) {
      const art: schema.Artifact = {
        ...input,
        parts: input.parts as schema.Part[],
      };
      return new this(art);
    }
  }

  if (types === undefined) {
    return function <
      Parts extends readonly schema.Part[]
    >(): TuplePartsArtifactMakeClass<typeof id, Parts> {
      return ArtifactCls as unknown as TuplePartsArtifactMakeClass<
        typeof id,
        Parts
      >;
    };
  }

  return ArtifactCls as unknown as TuplePartsArtifactMakeClass<
    typeof id,
    PartsFromTypes<typeof types>
  >;
}
