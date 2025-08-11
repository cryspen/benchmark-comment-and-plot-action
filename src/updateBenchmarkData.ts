#!/usr/bin/env -S deno run -R

import { promises as fs } from "node:fs";

function abort(msg: string, code = 1) {
  console.error(msg);
  Deno.exit(code);
}

interface GitHubUser {
  email?: string;
  name?: string;
  username?: string;
}

interface Commit {
  author: GitHubUser;
  committer: GitHubUser;
  id: string;
  message: string;
  timestamp: string;
  url: string;
}

interface BenchmarkResult {
  value: number;
  range?: string;
  unit: string;
  extra?: string;
  os: string;

  // from Metadata
  [key: string]: any;
}

type BenchmarkSuites = { [name: string]: Benchmark[] };

interface DataJson {
  lastUpdate: number;
  repoUrl: string;
  entries: BenchmarkSuites;
  groupBy: { [name: string]: string[] };
  schema: { [name: string]: string[] };
}

interface Benchmark {
  commit: Commit;
  date: number;
  bigger_is_better: boolean;
  benches: BenchmarkResult[];
}

function parseSchema(schema?: string): string[] {
  const defaultSchema = [
    "name",
    "platform",
    "os",
    "keySize",
    "api",
    "category",
  ];
  if (schema === undefined) {
    return defaultSchema;
  }

  const keys = schema.split(",");
  if (keys.length === 1 && keys[0] === "") {
    return defaultSchema;
  }

  return keys;
}

function parseGroupBy(groupBy?: string): string[] {
  if (groupBy === undefined) {
    return ["os"];
  }

  const keys = groupBy.split(",");

  if (keys.length === 1 && keys[0] === "") {
    return ["os"];
  }

  return keys;
}

async function parseJsonFile<T>(filePath: string): Promise<T> {
  const bytes = await fs.readFile(filePath, "utf8");
  return JSON.parse(bytes);
}

async function loadBenchmarkResult(
  commit: Commit,
  bigger_is_better: boolean,
  filePath: string,
  schema: string[],
): Promise<Benchmark> {
  const benches: BenchmarkResult[] = await parseJsonFile(filePath);

  benches.forEach((result: BenchmarkResult) => {
    schema.forEach((key) => {
      if (!Object.keys(result).includes(key)) {
        result[key] = undefined;
      }
      if (!result["range"]) {
        result["range"] = undefined;
      }
      if (!result["extra"]) {
        result["extra"] = undefined;
      }
    });
  });

  return {
    benches,
    commit,
    bigger_is_better,
    date: Date.now(),
  };
}

interface Metadata {
  committer: string;
  timestamp: string;
  repo: string;
  repo_owner: string;
  prNumber: number;
  prTitle: string;
  commitHash: string;
  commitHashShort: string;
  commitMessage: string;
  commitMesasgeFirst: string;
  commitUrl: string;
  commitTimestamp: string;
}

function addBenchmarkToDataJson(
  groupBy: string[],
  schema: string[],
  benchName: string,
  bench: Benchmark,
  data: DataJson,
  maxItems: number | null,
): Benchmark | null {
  let prevBench: Benchmark | null = null;
  data.lastUpdate = Date.now();
  if (!data.groupBy) {
    data.groupBy = {};
  }
  if (!data.schema) {
    data.schema = {};
  }
  data.groupBy[benchName] = groupBy;
  data.schema[benchName] = schema;

  // Add benchmark result
  if (data.entries[benchName] === undefined) {
    data.entries[benchName] = [bench];
    console.debug(
      `No suite was found for benchmark '${benchName}' in existing data. Created`,
    );
  } else {
    const suites = data.entries[benchName];
    for (const e of suites.slice().reverse()) {
      if (e.commit.id !== bench.commit.id) {
        prevBench = e;
        break;
      }
    }
    suites.push(bench);

    if (maxItems !== null && suites.length > maxItems) {
      suites.splice(0, suites.length - maxItems);
      console.debug(
        `Number of data items for '${benchName}' was truncated to ${maxItems} due to max-items-in-charts`,
      );
    }
  }

  return prevBench;
}

if (Deno.args.length != 7) {
  abort(
    "Usage: script <name> <schema> <group-by> <bigger-is-better> <metadata.json> <baseline-data.json> <new-benchdata.json>",
  );
}

const [
  name,
  schema_raw,
  groupBy_raw,
  bigger_is_better_raw,
  metadata_path,
  baseline_path,
  benchdata_path,
] = Deno.args;

let bigger_is_better = true;
if (bigger_is_better_raw == "true") {
  bigger_is_better = true;
} else if (bigger_is_better_raw == "false") {
  bigger_is_better = false;
} else {
  abort('argument `bigger-is-better` must be "true" or "false".');
}

const schema = parseSchema(schema_raw);
const groupBy = parseGroupBy(groupBy_raw);
const metadata: Metadata = await parseJsonFile(metadata_path);
const commit: Commit = {
  author: { name: metadata.committer, username: metadata.committer },
  committer: { name: metadata.committer, username: metadata.committer },
  id: metadata.commitHash,
  message: metadata.commitMessage,
  url: metadata.commitUrl,
  timestamp: metadata.commitTimestamp,
};
const bench = await loadBenchmarkResult(
  commit,
  bigger_is_better,
  benchdata_path,
  schema,
);
const data: DataJson = await parseJsonFile(baseline_path);

addBenchmarkToDataJson(groupBy, schema, name, bench, data, null);

const encoder = new TextEncoder();
const jsonBytes = encoder.encode(JSON.stringify(data));

let n = 0;
while (n < jsonBytes.length) {
  n += await Deno.stdout.write(jsonBytes.slice(n));
}
