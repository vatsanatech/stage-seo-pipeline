import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

function resolveTscBin(): string {
  // Resolve the tsc binary from this package's own typescript installation
  const require = createRequire(import.meta.url);
  const tscPath = require.resolve('typescript/bin/tsc');
  return `node ${tscPath}`;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a TypeScript code fix by writing it to a temp file and running tsc --noEmit.
 * Uses --project flag with absolute path so tsc works regardless of cwd.
 */
export function validateTypeScript(
  code: string,
  projectDir: string,
  fileName: string = '_autofix_temp.ts'
): ValidationResult {
  const absProjectDir = resolve(projectDir);
  const filePath = join(absProjectDir, fileName);
  const tsconfigPath = join(absProjectDir, 'tsconfig.json');

  try {
    writeFileSync(filePath, code, 'utf-8');

    const tsc = resolveTscBin();
    execSync(`${tsc} --noEmit --pretty false --project "${tsconfigPath}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { valid: true, errors: [] };
  } catch (err: any) {
    const stderr = err.stderr?.toString() || '';
    const stdout = err.stdout?.toString() || '';
    const output = stderr || stdout;

    const errors = output
      .split('\n')
      .filter((line: string) => line.includes(fileName))
      .map((line: string) => line.trim())
      .filter(Boolean);

    return { valid: false, errors: errors.length ? errors : [output.trim()] };
  } finally {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}

/**
 * Validates an in-place file edit by running tsc --noEmit on the project.
 */
export function validateProject(projectDir: string): ValidationResult {
  const absProjectDir = resolve(projectDir);
  const tsconfigPath = join(absProjectDir, 'tsconfig.json');

  try {
    const tsc = resolveTscBin();
    execSync(`${tsc} --noEmit --pretty false --project "${tsconfigPath}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { valid: true, errors: [] };
  } catch (err: any) {
    const stderr = err.stderr?.toString() || '';
    const stdout = err.stdout?.toString() || '';
    const output = stderr || stdout;

    const errors = output
      .split('\n')
      .filter((line: string) => line.trim().length > 0);

    return { valid: false, errors };
  }
}
