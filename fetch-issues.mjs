import { execFileSync } from 'node:child_process';
const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n', encoding: 'utf8' });
const token = out.split('\n').find(l => l.startsWith('password=')).slice(9);
const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
const res = await fetch('https://api.github.com/repos/ATEMall/can-log-analyzer/issues?state=all&per_page=100', { headers: H });
const issues = await res.json();
for (const i of issues) {
  console.log(`\n=== #${i.number} [${i.state}] ${i.title}`);
  console.log(`updated: ${i.updated_at}`);
  const c = await fetch(`https://api.github.com/repos/ATEMall/can-log-analyzer/issues/${i.number}/comments?per_page=100`, { headers: H });
  const comments = await c.json();
  for (const cm of (Array.isArray(comments) ? comments : [])) {
    console.log(`--- comment ${cm.created_at} by ${cm.user?.login}:`);
    console.log(cm.body);
  }
}
