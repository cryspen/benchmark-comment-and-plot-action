import { readAll } from "https://deno.land/std@0.224.0/io/read_all.ts";

function abort(msg: string, code = 1) {
  console.error(msg);
  Deno.exit(code);
}

/**
 * A generic data row object.
 * The keys are column names and values can be strings or numbers.
 */
type DataRow = Record<string, string | number>;

/**
 * Groups an array of data rows based on a set of keys.
 * @param data - The array of data objects to group.
 * @param keys - The array of keys to group by.
 * @returns A Map where each key is a unique identifier for a group and
 * the value is an array of rows belonging to that group.
 */
function groupData(data: DataRow[], keys: string[]): Map<string, DataRow[]> {
  const groups = new Map<string, DataRow[]>();

  for (const row of data) {
    // Create a unique key for the group by concatenating the values of the groupBy keys.
    const groupKey = keys.map((key) => row[key]).join("::");

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(row);
  }

  return groups;
}

/**
 * Generates a Markdown report from grouped data.
 * @param groups - A map of grouped data rows.
 * @param schema - The list of columns for the table.
 * @param groupByKeys - The keys used for grouping, to create the header.
 * @returns A string containing the full Markdown report.
 */
function generateMarkdownReport(
  groups: Map<string, DataRow[]>,
  schema: string[],
  groupByKeys: string[],
): string {
  const reportParts: string[] = [];

  // Ensure the 'name' column is always first, if it exists in the schema.
  const orderedSchema = ["name", ...schema.filter((col) => col !== "name")];

  for (const rows of groups.values()) {
    // All rows in a group are guaranteed to have the same values for the groupBy keys.
    // We can use the first row to generate the group header.
    const firstRow = rows[0];

    // Create a descriptive header for the table partition.
    // e.g., ## **os**: ubuntu-latest_32, **keySize**: 512
    const groupHeaderText = groupByKeys
      .map((key) => `**${key}**: \`${firstRow[key]}\``)
      .join(", ");
    reportParts.push(`### ${groupHeaderText}`);

    // Create the Markdown table header.
    const tableHeader = `| ${orderedSchema.join(" | ")} |`;
    const tableSeparator = `| ${orderedSchema.map(() => "---").join(" | ")} |`;
    reportParts.push(tableHeader, tableSeparator);

    // Create a row in the table for each item in the group.
    for (const row of rows) {
      const rowValues = orderedSchema.map((col) => row[col] ?? "N/A");
      reportParts.push(`| ${rowValues.join(" | ")} |`);
    }

    // Add a horizontal rule to separate the sections.
    reportParts.push("\n---");
  }

  return reportParts.join("\n");
}

/**
 * Main function to run the program.
 */
async function main() {
  // 1. Parse arguments
  if (Deno.args.length != 2) {
    abort("expected args <schema> and <groupBy>");
  }
  const schemaKeys = Deno.args[0].split(",");
  const groupByKeys = Deno.args[1].split(",");

  // these cols are added implicitly
  schemaKeys.push("value");
  schemaKeys.push("range");
  schemaKeys.push("unit");

  // 2. Read all content from standard input.
  const stdinContent = await readAll(Deno.stdin);
  const jsonInput: DataRow[] = JSON.parse(
    new TextDecoder().decode(stdinContent),
  );

  // 3. Group the data based on the groupBy keys.
  const groupedData = groupData(jsonInput, groupByKeys);

  // 4. Generate the final Markdown report.
  const markdownOutput = generateMarkdownReport(
    groupedData,
    schemaKeys,
    groupByKeys,
  );

  // 5. Print the report to standard output.
  console.log(markdownOutput);
}

// Run the main function.
main();
