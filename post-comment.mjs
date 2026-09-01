// Post a comment to a GitHub issue using git credential auth.
// Usage: node post-comment.mjs <issue-number> <body-file>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [, , issue, bodyFile] = process.argv;
if (!issue || !bodyFile) {
  console.error('Usage: node post-comment.mjs <issue-number> <body-file>');
  process.exit(1);
}
const body = fs.readFileSync(bodyFile, 'utf8');

const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n', encoding: 'utf8' });
const token = out.split('\n').find(l => l.startsWith('password=')).slice(9);
const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };

const res = await fetch(`https://api.github.com/repos/ATEMall/can-log-analyzer/issues/${issue}/comments`, {
  method: 'POST', headers: H, body: JSON.stringify({ body })
});
const data = await res.json();
if (!res.ok) {
  console.error(`POST failed (${res.status}):`, JSON.stringify(data).slice(0, 500));
  process.exit(1);
}
console.log(`Posted comment on #${issue}: ${data.html_url}`);
