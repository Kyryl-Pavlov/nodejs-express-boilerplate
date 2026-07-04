import { Kind, print, type ValueNode } from "graphql";
import { GraphQLScalarType } from "graphql";

// Hand-rolled equivalent of graphql-type-json's GraphQLJSON. Avoiding the extra
// dependency sidesteps a Vitest/Vite dual-module-instance hazard: that package ships
// separate CJS ("main") and ESM ("module") builds, and Vite's SSR resolver can end up
// loading its `graphql` import through a different path than the rest of the app,
// producing two distinct `graphql` module instances ("from another module or realm"
// errors) — constructing the scalar directly from the same `graphql` import as
// everything else avoids that split entirely.
function parseLiteral(
  ast: ValueNode,
  variables?: Record<string, unknown> | null,
): unknown {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number.parseFloat(ast.value);
    case Kind.OBJECT: {
      const value: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;
      for (const field of ast.fields) {
        value[field.name.value] = parseLiteral(field.value, variables);
      }
      return value;
    }
    case Kind.LIST:
      return ast.values.map((node) => parseLiteral(node, variables));
    case Kind.NULL:
      return null;
    case Kind.VARIABLE:
      return variables?.[ast.name.value];
    default:
      throw new TypeError(`JSON cannot represent value: ${print(ast)}`);
  }
}

export const GraphQLJSON = new GraphQLScalarType({
  name: "JSON",
  description: "The `JSON` scalar type represents arbitrary JSON values.",
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral,
});
