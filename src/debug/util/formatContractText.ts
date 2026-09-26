import { ContractSectionName } from "../types/types";

/**
 * Format type objects or strings into clean human-readable type annotations.
 * Handles primitive types, vec, option, map, tuple, bytes_n, udt, result, etc.
 */
export function formatSpecType(typeObj: unknown): string {
  if (!typeObj) return "unknown";
  if (typeof typeObj === "string") {
    switch (typeObj) {
      case "U32":
        return "u32";
      case "U64":
        return "u64";
      case "U128":
        return "u128";
      case "U256":
        return "u256";
      case "I32":
        return "i32";
      case "I64":
        return "i64";
      case "I128":
        return "i128";
      case "I256":
        return "i256";
      case "ScString":
      case "String":
        return "String";
      case "ScSymbol":
      case "Symbol":
        return "Symbol";
      case "DataUrl":
        return "bytes";
      case "Bool":
        return "bool";
      case "Address":
        return "Address";
      case "Void":
        return "()";
      default:
        return typeObj;
    }
  }

  if (typeof typeObj === "object" && typeObj !== null) {
    const obj = typeObj as Record<string, any>;
    if (obj.vec) return `Vec<${formatSpecType(obj.vec.element_type)}>`;
    if (obj.option) return `Option<${formatSpecType(obj.option.value_type)}>`;
    if (obj.map)
      return `Map<${formatSpecType(obj.map.key_type)}, ${formatSpecType(obj.map.val_type)}>`;
    if (obj.tuple) {
      const types = Array.isArray(obj.tuple.type_list)
        ? obj.tuple.type_list.map(formatSpecType).join(", ")
        : "";
      return `(${types})`;
    }
    if (obj.bytes_n) return `BytesN<${obj.bytes_n.n}>`;
    if (obj.udt) return obj.udt.name || "UDT";
    if (obj.result) {
      return `Result<${formatSpecType(obj.result.ok_type)}, ${formatSpecType(obj.result.error_type)}>`;
    }
  }

  return String(typeObj);
}

/**
 * Main formatter function converting XDR JSON string or object into clean, human-readable text.
 */
export function formatXdrJsonToText(
  sectionName: ContractSectionName,
  input: string | Record<string, any>,
): string {
  let parsed: any;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      return input;
    }
  } else {
    parsed = input;
  }

  if (!parsed || typeof parsed !== "object") {
    return String(input);
  }

  switch (sectionName) {
    case "contractmetav0":
      return formatMetaEntry(parsed);
    case "contractenvmetav0":
      return formatEnvMetaEntry(parsed);
    case "contractspecv0":
      return formatSpecEntry(parsed);
    default:
      return formatGenericObject(parsed, sectionName);
  }
}

function formatMetaEntry(parsed: any): string {
  const lines: string[] = ["[Contract Metadata]"];
  const entry = parsed.sc_meta_v0 || parsed.meta_v0 || parsed;

  if (entry && typeof entry === "object") {
    if (entry.key !== undefined && entry.val !== undefined) {
      lines.push(`Key: ${entry.key}`);
      lines.push(`Value: ${entry.val}`);
    } else {
      for (const [k, v] of Object.entries(entry)) {
        lines.push(`${k}: ${v}`);
      }
    }
  } else {
    lines.push(String(parsed));
  }

  return lines.join("\n");
}

function formatEnvMetaEntry(parsed: any): string {
  const lines: string[] = ["[Environment Metadata]"];
  const entry =
    parsed.sc_env_meta_kind_interface_version ||
    parsed.env_meta_kind_interface_version ||
    parsed;

  if (entry && typeof entry === "object") {
    if (entry.interface_version !== undefined) {
      lines.push(`Interface Version: ${entry.interface_version}`);
    }
    if (entry.protocol_version !== undefined) {
      lines.push(`Protocol Version: ${entry.protocol_version}`);
    }
    for (const [k, v] of Object.entries(entry)) {
      if (k !== "interface_version" && k !== "protocol_version") {
        lines.push(`${k}: ${v}`);
      }
    }
  } else {
    lines.push(String(parsed));
  }

  return lines.join("\n");
}

function formatSpecEntry(parsed: any): string {
  const fnEntry =
    parsed.sc_spec_entry_function_v0 || parsed.function_v0 || parsed.function;
  if (fnEntry) {
    return formatFunctionSpec(fnEntry);
  }

  const structEntry =
    parsed.sc_spec_entry_udt_struct_v0 ||
    parsed.udt_struct_v0 ||
    parsed.struct;
  if (structEntry) {
    return formatStructSpec(structEntry);
  }

  const unionEntry =
    parsed.sc_spec_entry_udt_union_v0 || parsed.udt_union_v0 || parsed.union;
  if (unionEntry) {
    return formatUnionSpec(unionEntry);
  }

  const enumEntry =
    parsed.sc_spec_entry_udt_enum_v0 || parsed.udt_enum_v0 || parsed.enum;
  if (enumEntry) {
    return formatEnumSpec(enumEntry);
  }

  const errorEnumEntry =
    parsed.sc_spec_entry_udt_error_enum_v0 ||
    parsed.udt_error_enum_v0 ||
    parsed.error_enum;
  if (errorEnumEntry) {
    return formatEnumSpec(errorEnumEntry, "Error Enum");
  }

  return formatGenericObject(parsed, "Spec Entry");
}

function formatFunctionSpec(fn: any): string {
  const lines: string[] = ["[Function Spec]"];
  if (fn.name) lines.push(`Name: ${fn.name}`);
  if (fn.doc) lines.push(`Doc: ${fn.doc}`);

  if (Array.isArray(fn.inputs) && fn.inputs.length > 0) {
    lines.push("Inputs:");
    for (const input of fn.inputs) {
      const typeStr = formatSpecType(input.type);
      const docStr = input.doc ? ` (${input.doc})` : "";
      lines.push(`  - ${input.name}: ${typeStr}${docStr}`);
    }
  } else {
    lines.push("Inputs: None");
  }

  if (Array.isArray(fn.outputs) && fn.outputs.length > 0) {
    lines.push("Outputs:");
    for (const output of fn.outputs) {
      lines.push(`  - ${formatSpecType(output)}`);
    }
  } else if (fn.outputs) {
    lines.push(`Outputs:\n  - ${formatSpecType(fn.outputs)}`);
  } else {
    lines.push("Outputs: None");
  }

  return lines.join("\n");
}

function formatStructSpec(struct: any): string {
  const lines: string[] = ["[Struct Spec]"];
  if (struct.name) lines.push(`Name: ${struct.name}`);
  if (struct.doc) lines.push(`Doc: ${struct.doc}`);

  if (Array.isArray(struct.fields) && struct.fields.length > 0) {
    lines.push("Fields:");
    for (const field of struct.fields) {
      const typeStr = formatSpecType(field.type);
      const docStr = field.doc ? ` (${field.doc})` : "";
      lines.push(`  - ${field.name}: ${typeStr}${docStr}`);
    }
  } else {
    lines.push("Fields: None");
  }

  return lines.join("\n");
}

function formatUnionSpec(union: any): string {
  const lines: string[] = ["[Union Spec]"];
  if (union.name) lines.push(`Name: ${union.name}`);
  if (union.doc) lines.push(`Doc: ${union.doc}`);

  if (Array.isArray(union.cases) && union.cases.length > 0) {
    lines.push("Cases:");
    for (const c of union.cases) {
      const caseName = c.name || c.tag || String(c);
      const typeStr = c.type ? `: ${formatSpecType(c.type)}` : "";
      const docStr = c.doc ? ` (${c.doc})` : "";
      lines.push(`  - ${caseName}${typeStr}${docStr}`);
    }
  }

  return lines.join("\n");
}

function formatEnumSpec(enumObj: any, title = "Enum"): string {
  const lines: string[] = [`[${title} Spec]`];
  if (enumObj.name) lines.push(`Name: ${enumObj.name}`);
  if (enumObj.doc) lines.push(`Doc: ${enumObj.doc}`);

  if (Array.isArray(enumObj.cases) && enumObj.cases.length > 0) {
    lines.push("Cases:");
    for (const c of enumObj.cases) {
      const caseName = c.name || c.tag || String(c);
      const valStr = c.value !== undefined ? ` = ${c.value}` : "";
      const docStr = c.doc ? ` (${c.doc})` : "";
      lines.push(`  - ${caseName}${valStr}${docStr}`);
    }
  }

  return lines.join("\n");
}

function formatGenericObject(obj: any, label: string): string {
  const lines: string[] = [`[${label}]`];
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "object" && v !== null) {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  return lines.join("\n");
}
