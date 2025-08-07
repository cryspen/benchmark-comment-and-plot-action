#!/usr/bin/env -S deno run -R

import { promises as fs } from 'node:fs';

interface Commit {
    author: GitHubUser;
    committer: GitHubUser;
    distinct?: unknown; // Unused
    id: string;
    message: string;
    timestamp?: string;
    tree_id?: unknown; // Unused
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

interface Listing {
  branches: string[];
  prs: string[];
}

interface Benchmark {
  commit: Commit;
  date: number;
  bigger_is_better: boolean;
  benches: BenchmarkResult[];
}

const DEFAULT_DATA_JSON = {
  lastUpdate: 0,
  repoUrl: "",
  entries: {},
  groupBy: {},
  schema: {},
};

const DEFAULT_LISTING = {
  branches: [],
  prs: [],
};

function abort(msg: string, code=1){
  console.error(msg);
  Deno.exit(code);
}

function parseSchema(schema?: string): string[] {
  const defaultSchema = ['name', 'platform', 'os', 'keySize', 'api', 'category'];
  if (schema === undefined) {
    return defaultSchema;
  }

  const keys = schema.split(',');
  if (keys.length === 1 && keys[0] === '') {
    return defaultSchema;
  }

  return keys;
}

function parseGroupBy(groupBy?: string): string[] {
    if (groupBy === undefined) {
        return ['os'];
    }

    const keys = groupBy.split(',');

    if (keys.length === 1 && keys[0] === '') {
        return ['os'];
    }

    return keys;
}

async function parseJsonFile(filePath: string) : Object {
  const bytes = await fs.readFile(filePath, 'utf8');
  return JSON.parse(benchdata_bytes) ;
}

async function loadBenchmarkResult(filePath: string, schema: string[]): BenchmarkResult[]{
  const benchdata = parseJsonFile(filePath);

  benchdata.forEach((result: BenchmarkResult) => {
      schema.forEach((key) => {
          if (!Object.keys(result).includes(key)) {
              result[key] = undefined;
          }
          if (!result['range']) {
              result['range'] = undefined;
          }
          if (!result['extra']) {
              result['extra'] = undefined;
          }
      });
  });

  return benchdata
}

function addBenchmarkToDataJson(
  groupBy: string[],
  schema: string[],
  benchName: string,
  bench: Benchmark,
  data: DataJson,
  maxItems: number | null,
): Benchmark | null {
  const repoMetadata = getCurrentRepoMetadata();
  const htmlUrl = repoMetadata.html_url ?? "";

  let prevBench: Benchmark | null = null;
  data.lastUpdate = Date.now();
  if (!data.groupBy) {
    data.groupBy = {};
  }
  if (!data.schema) {
    data.schema = {};
  }
  data.groupBy[benchName] = groupBy;
  data.repoUrl = htmlUrl;
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

if (Deno.args.length != 5) {
  abort("Usage: script <name> <schema> <group-by> <metadata.json> <baseline-data.json> <new-benchdata.json>");
}

const [name, schema, groupBy, metadata_path, baseline_path, benchdata_path] = Deno.args;

let schema = parseSchema(schema);
let groupBy = parseSchema(groupBy);
let bench = loadBenchmarkResult(benchdata_path, schema);
const data: DataJson  = parseJsonFile(baseline_path);
const metadata  = parseJsonFile(metadata_path);

addBenchmarkToDataJson(groupBy, schema, name, bench, data);

const encoder = new TextEncoder();
const jsonBytes =  encoder.encode(JSON.stringify(data));

let n = 0;

while (n < jsonBytes.length) {
  n += await Deno.stdout.write(jsonBytes.slice(n));
}



