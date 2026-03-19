import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateTypeScript } from '../pipeline/validator.js';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('TypeScript validator', () => {
  it('should pass valid TypeScript code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autofix-test-'));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true, skipLibCheck: true }
    }));

    const result = validateTypeScript(
      'const x: number = 42;\nexport { x };\n',
      dir,
    );

    rmSync(dir, { recursive: true });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('should reject code with type errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autofix-test-'));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true, skipLibCheck: true }
    }));

    const result = validateTypeScript(
      'const x: number = "not a number";\n',
      dir,
    );

    rmSync(dir, { recursive: true });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('should clean up temp files after validation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'autofix-test-'));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true, skipLibCheck: true }
    }));

    validateTypeScript('const x = 1;\n', dir, '_test_cleanup.ts');

    const exists = existsSync(join(dir, '_test_cleanup.ts'));

    rmSync(dir, { recursive: true });
    assert.equal(exists, false, 'Temp file should be cleaned up');
  });
});
