import { execSync } from 'node:child_process';

export interface PrInfo {
  number: number;
  title: string;
  branch: string;
  url: string;
  state: string;
  createdAt: string;
}

export interface CiStatus {
  prNumber: number;
  state: 'pending' | 'success' | 'failure' | 'error' | 'unknown';
  checks: { name: string; status: string; conclusion: string }[];
}

const SEO_BRANCH_PREFIX = 'seo-fix/';
const MAX_OPEN_SEO_PRS = 3;
const STALE_DAYS = 7;
const SEO_LABELS = ['seo', 'auto-fix'];

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8' }).trim();
}

function gh(cmd: string, cwd: string): string {
  return execSync(`gh ${cmd}`, { cwd, encoding: 'utf-8' }).trim();
}

export function listOpenSeoPrs(cwd: string): PrInfo[] {
  try {
    const output = gh(
      `pr list --state open --search "head:${SEO_BRANCH_PREFIX}" --json number,title,headRefName,url,state,createdAt`,
      cwd
    );
    const prs = JSON.parse(output || '[]');
    return prs.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      branch: pr.headRefName,
      url: pr.url,
      state: pr.state,
      createdAt: pr.createdAt,
    }));
  } catch {
    return [];
  }
}

export function listOpenSeoBranches(cwd: string): string[] {
  try {
    const output = git(`branch -r --list "origin/${SEO_BRANCH_PREFIX}*"`, cwd);
    return output
      .split('\n')
      .map((b) => b.trim().replace('origin/', ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function canCreatePr(cwd: string): boolean {
  const openPrs = listOpenSeoPrs(cwd);
  return openPrs.length < MAX_OPEN_SEO_PRS;
}

export function createBranch(cwd: string, issueType: string, slug: string): string {
  const branchName = `${SEO_BRANCH_PREFIX}${issueType}-${slug}-${Date.now()}`;
  git('checkout -b ' + branchName, cwd);
  return branchName;
}

export function commitAndPush(
  cwd: string,
  branchName: string,
  message: string,
  files: string[]
): void {
  for (const file of files) {
    git(`add "${file}"`, cwd);
  }
  // Never push to main
  const currentBranch = git('rev-parse --abbrev-ref HEAD', cwd);
  if (currentBranch === 'main' || currentBranch === 'master') {
    throw new Error('Safety: refusing to push to main/master');
  }
  git(`commit -m "${message}\n\nCo-Authored-By: Paperclip <noreply@paperclip.ing>"`, cwd);
  git(`push -u origin ${branchName}`, cwd);
}

export function openPr(
  cwd: string,
  title: string,
  body: string,
  branchName: string
): string {
  // Create PR with SEO labels — never auto-merge
  const labelArgs = SEO_LABELS.map((l) => `--label "${l}"`).join(' ');
  const url = gh(
    `pr create --title "${title}" --body "${body}" --head "${branchName}" ${labelArgs}`,
    cwd
  );
  return url;
}

export function getCiStatus(cwd: string, prNumber: number): CiStatus {
  try {
    const output = gh(
      `pr checks ${prNumber} --json name,state,conclusion --jq '.'`,
      cwd
    );
    const checks = JSON.parse(output || '[]');

    const mapped = checks.map((c: any) => ({
      name: c.name,
      status: c.state,
      conclusion: c.conclusion || '',
    }));

    let overallState: CiStatus['state'] = 'unknown';
    if (mapped.length > 0) {
      const allSuccess = mapped.every((c: any) => c.conclusion === 'SUCCESS' || c.conclusion === 'success');
      const anyFailure = mapped.some((c: any) => c.conclusion === 'FAILURE' || c.conclusion === 'failure');
      const anyPending = mapped.some((c: any) => c.status === 'PENDING' || c.status === 'pending' || !c.conclusion);

      if (allSuccess) overallState = 'success';
      else if (anyFailure) overallState = 'failure';
      else if (anyPending) overallState = 'pending';
      else overallState = 'error';
    }

    return { prNumber, state: overallState, checks: mapped };
  } catch {
    return { prNumber, state: 'unknown', checks: [] };
  }
}

export function closeStalePrs(cwd: string): { closed: PrInfo[]; errors: string[] } {
  const openPrs = listOpenSeoPrs(cwd);
  const now = Date.now();
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;
  const closed: PrInfo[] = [];
  const errors: string[] = [];

  for (const pr of openPrs) {
    const age = now - new Date(pr.createdAt).getTime();
    if (age > staleMs) {
      try {
        gh(
          `pr close ${pr.number} --comment "Auto-closed: SEO PR stale for >${STALE_DAYS} days with no merge. Re-open if still needed."`,
          cwd
        );
        closed.push(pr);
      } catch (err: any) {
        errors.push(`Failed to close PR #${pr.number}: ${err.message}`);
      }
    }
  }

  return { closed, errors };
}

export function returnToMainBranch(cwd: string): void {
  try {
    git('checkout main', cwd);
  } catch {
    git('checkout master', cwd);
  }
}
