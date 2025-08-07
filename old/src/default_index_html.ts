import * as fs from 'node:fs';
import { dirname, fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";

const __dirname = dirname(fromFileUrl(import.meta.url));
export const DEFAULT_INDEX_HTML = fs.readFileSync(__dirname + '/default_index.html', 'utf-8');
