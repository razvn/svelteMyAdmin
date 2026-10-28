/**
 * Text export plugins, ready for the registry: `[csv, excel, json, xml, yaml, texytext, mediawiki,
 * latex, phparray, htmlword, codegen]`.
 */
import type { ExportPlugin } from '../types.ts';
import codegen from './codegen.ts';
import csv from './csv.ts';
import excel from './excel.ts';
import htmlword from './htmlword.ts';
import json from './json.ts';
import latex from './latex.ts';
import mediawiki from './mediawiki.ts';
import phparray from './phparray.ts';
import texytext from './texytext.ts';
import xml from './xml.ts';
import yaml from './yaml.ts';

export const textPlugins: ExportPlugin[] = [
	csv,
	excel,
	json,
	xml,
	yaml,
	texytext,
	mediawiki,
	latex,
	phparray,
	htmlword,
	codegen
];
