import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

/** Inline relative TypeScript dependencies for native browser audio diagnostics. */
export async function browserModule(path: string): Promise<string> {
	let source = ts.transpileModule(await readFile(path, 'utf8'), {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
	}).outputText;
	for (const match of [...source.matchAll(/from ['"](\.\/[^'"]+)['"]/g)]) {
		const dependency = await browserModule(resolve(dirname(path), `${match[1]}.ts`));
		source = source.replace(match[0], `from 'data:text/javascript;base64,${Buffer.from(dependency).toString('base64')}'`);
	}
	return source;
}
