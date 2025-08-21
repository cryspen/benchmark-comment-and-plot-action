/**
 * @fileoverview Deno script to generate a benchmark comparison report in Markdown.
 *
 * This script reads a JSON file containing historical benchmark data from stdin,
 * compares the two most recent entries (baseline vs. current), and outputs a
 * Markdown-formatted report to stdout. The report contains tables that are
 * grouped based on specified properties.
 *
 * @usage
 * ```
 * # Cat the data file and pipe it to the Deno script with arguments
 * cat benchmark_history.json | deno run --allow-read generate_report.ts \
 * --name="ML-KEM Benchmark" \
 * --schema="category,keySize,name,platform,api,os" \
 * --groupBy="os,keySize"
 * ```
 */

import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts";
import { readAll } from "https://deno.land/std@0.224.0/io/read_all.ts";

// --- Type Definitions for Benchmark Data ---

interface BenchResult {
  name: string;
  value: number;
  unit: string;
  range: string;
  [key: string]: any; // Allows for dynamic properties like os, keySize, etc.
}

interface HistoryEntry {
  commit: {
    id: string;
    url: string;
    message: string;
  };
  date: number;
  bigger_is_better: boolean;
  benches: BenchResult[];
}

interface BenchmarkData {
  entries: Record<string, HistoryEntry[]>;
}

type ComparisonStatus = "changed" | "new" | "removed";

interface CombinedResult extends BenchResult {
  baselineValue?: number;
  currentValue?: number;
  status: ComparisonStatus;
}

// --- Main Execution Logic ---

async function main() {
  const args = parse(Deno.args, {
    string: ["name", "schema", "groupBy"],
  });

  if (!args.name) {
    console.error("Error: The --name argument is required.");
    Deno.exit(1);
  }

  const schemaKeys = args.schema.split(",").map((k: string) => k.trim());
  const groupByKeys = args.groupBy.split(",").map((k: string) => k.trim())
    .filter(
      Boolean,
    );

  // 1. Read and Parse JSON from stdin
  const stdinContent = await readAll(Deno.stdin);
  const jsonText = new TextDecoder().decode(stdinContent);
  const data: BenchmarkData = JSON.parse(jsonText);

  // 2. Extract Baseline and Current Entries
  const history = data.entries[args.name];
  if (!history || history.length < 2) {
    console.log(
      `## ⚠️ No Comparison Available for ${args.name}\n\nNot enough data to compare. At least two benchmark runs are required.`,
    );
    Deno.exit(0);
  }

  // 3. Find and aggregate data for the last two unique commits.
  let currentCommitId: string | null = null;
  let baselineCommitId: string | null = null;

  // Find the two most recent unique commit hashes by iterating backwards.
  for (let i = history.length - 1; i >= 0; i--) {
    const commitId = history[i].commit.id;
    if (!currentCommitId) {
      currentCommitId = commitId;
      continue;
    }
    if (commitId !== currentCommitId) {
      baselineCommitId = commitId;
      break; // Found both commits, we can stop.
    }
  }

  if (!baselineCommitId) {
    console.log(
      `## ⚠️ No Comparison Available for ${args.name}\n\nNot enough data to compare. At least two different commits with benchmark data are required.`,
    );
    Deno.exit(0);
  }

  // Create aggregated entries for the baseline and current commits.
  const findFirstEntryForCommit = (commitId: string) =>
    history.find((e) => e.commit.id === commitId)!;

  const aggregatedCurrentEntry: HistoryEntry = {
    ...findFirstEntryForCommit(currentCommitId!),
    benches: [], // We will fill this by aggregating
  };
  const aggregatedBaselineEntry: HistoryEntry = {
    ...findFirstEntryForCommit(baselineCommitId),
    benches: [], // We will fill this by aggregating
  };

  for (const entry of history) {
    if (entry.commit.id === currentCommitId) {
      aggregatedCurrentEntry.benches.push(...entry.benches);
    } else if (entry.commit.id === baselineCommitId) {
      aggregatedBaselineEntry.benches.push(...entry.benches);
    }
  }

  // 3. Process and Compare Benchmarks
  const combinedResults = compareBenches(
    aggregatedBaselineEntry,
    aggregatedCurrentEntry,
    schemaKeys,
  );

  // 4. Group Results for Table Generation
  const groupedResults = groupResults(combinedResults, groupByKeys);

  // 5. Generate and Print Markdown Report
  const markdownReport = generateMarkdown(
    args.name,
    aggregatedBaselineEntry,
    aggregatedCurrentEntry,
    groupedResults,
    schemaKeys,
    groupByKeys,
  );
  console.log(markdownReport);
}

/**
 * Compares benches from a baseline and a current entry.
 * @returns An array of combined results with comparison data.
 */
function compareBenches(
  baselineEntry: HistoryEntry,
  currentEntry: HistoryEntry,
  schemaKeys: string[],
): CombinedResult[] {
  const keyFields = schemaKeys.filter((k) =>
    k !== "value" && k !== "unit" && k !== "range"
  );

  const createBenchMap = (entry: HistoryEntry) => {
    const map = new Map<string, BenchResult>();
    for (const bench of entry.benches) {
      const key = generateCompositeKey(bench, keyFields);
      map.set(key, bench);
    }
    return map;
  };

  const baselineMap = createBenchMap(baselineEntry);
  const currentMap = createBenchMap(currentEntry);

  const allKeys = new Set([...baselineMap.keys(), ...currentMap.keys()]);
  const combinedResults: CombinedResult[] = [];

  for (const key of allKeys) {
    const baselineBench = baselineMap.get(key);
    const currentBench = currentMap.get(key);

    const representativeBench = currentBench || baselineBench!;
    const status: ComparisonStatus = currentBench
      ? (baselineBench ? "changed" : "new")
      : "removed";

    combinedResults.push({
      ...representativeBench,
      baselineValue: baselineBench?.value,
      currentValue: currentBench?.value,
      status,
    });
  }
  return combinedResults;
}

/**
 * Groups combined results based on the groupBy keys.
 * @returns A map where keys are group identifiers and values are arrays of results.
 */
function groupResults(
  results: CombinedResult[],
  groupByKeys: string[],
): Map<string, CombinedResult[]> {
  const groupedResults = new Map<string, CombinedResult[]>();
  if (groupByKeys.length === 0) {
    groupedResults.set("all", results);
    return groupedResults;
  }

  for (const result of results) {
    const groupKey = generateCompositeKey(result, groupByKeys);
    if (!groupedResults.has(groupKey)) {
      groupedResults.set(groupKey, []);
    }
    groupedResults.get(groupKey)!.push(result);
  }
  return groupedResults;
}

/**
 * Generates the final Markdown report string.
 */
function generateMarkdown(
  benchmarkName: string,
  baselineEntry: HistoryEntry,
  currentEntry: HistoryEntry,
  groupedResults: Map<string, CombinedResult[]>,
  schemaKeys: string[],
  groupByKeys: string[],
): string {
  let md = "";
  // Ensure 'name' is the first column if it's in the schema
  const tableColumns = [...schemaKeys];
  const nameIndex = tableColumns.indexOf("name");
  if (nameIndex > 0) {
    const [nameCol] = tableColumns.splice(nameIndex, 1);
    tableColumns.unshift(nameCol);
  }
  const headerRow = [...tableColumns, "Baseline", "Current", "Change"];

  for (const [groupKey, results] of groupedResults.entries()) {
    if (groupByKeys.length > 0) {
      const groupProps = groupByKeys.map((key) =>
        `**${key}**: \`${results[0][key]}\``
      ).join(", ");
      md += `### ${groupProps}\n\n`;
    }

    md += `| ${headerRow.join(" | ")} |\n`;
    md += `|${headerRow.map(() => "---").join("|")}|\n`;

    for (const res of results) {
      const rowValues = tableColumns.map((key) => `\`${res[key] ?? "N/A"}\``);
      const unit = res.unit?.split("/")[0] || "";

      rowValues.push(
        res.baselineValue
          ? `${res.baselineValue.toLocaleString()} ${unit}`
          : "N/A",
      );
      rowValues.push(
        res.currentValue
          ? `${res.currentValue.toLocaleString()} ${unit}`
          : "N/A",
      );

      let changeText = "N/A";
      if (res.status === "changed" && res.baselineValue && res.currentValue) {
        const improvement = calculateImprovement(
          res.baselineValue,
          res.currentValue,
          currentEntry.bigger_is_better,
        );
        changeText = formatImprovement(improvement);
      } else if (res.status === "new") {
        changeText = "**New** ✨";
      } else if (res.status === "removed") {
        changeText = "**Removed** 🗑️";
      }
      rowValues.push(changeText);

      md += `| ${rowValues.join(" | ")} |\n`;
    }
    md += "\n";
  }

  return md;
}

// --- Helper Functions ---

/**
 * Generates a consistent composite key from a benchmark object and a list of keys.
 */
function generateCompositeKey(bench: BenchResult, keys: string[]): string {
  return keys.map((key) => bench[key] ?? "").join("|");
}

/**
 * Calculates the percentage of improvement.
 * A positive result always indicates an improvement.
 */
function calculateImprovement(
  oldValue: number,
  newValue: number,
  biggerIsBetter: boolean,
): number {
  if (oldValue === 0) {
    return newValue > 0 ? Infinity : 0;
  }
  const change = ((newValue - oldValue) / oldValue) * 100;
  return biggerIsBetter ? change : -change;
}

/**
 * Formats the improvement percentage with a sign, precision, and an emoji.
 */
function formatImprovement(improvement: number): string {
  if (!isFinite(improvement)) {
    return "N/A";
  }
  const sign = improvement > 0 ? "+" : "";
  // Use a threshold (e.g., 2%) to avoid flagging negligible changes
  const emoji = improvement > 2 ? "✅" : improvement < -2 ? "❌" : "➖";
  return `**${sign}${improvement.toFixed(2)}%** ${emoji}`;
}

// --- Run the script ---
if (import.meta.main) {
  main();
}
