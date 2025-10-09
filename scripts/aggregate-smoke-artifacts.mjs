import fs from 'fs/promises';
import path from 'path';

const ARTIFACTS_DIR = path.resolve(process.cwd(), '.smoke-artifacts');

async function findResultFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const candidate = path.join(p, 'result.json');
      try {
        await fs.access(candidate);
        files.push(candidate);
      } catch (err) {
        // skip
      }
    }
  }
  return files;
}

function summarizeDiag(diag) {
  const counts = diag.counts || {};
  const metrics = diag.metrics || {};
  const session = Array.isArray(diag.session) && diag.session[0] ? diag.session[0] : null;

  // count hello_world template errors in templateReopen samples
  let helloWorldErrors = 0;
  let templatesSuccess = 0;
  const templateReopen = (diag.samples && diag.samples.templateReopen) || [];
  for (const t of templateReopen) {
    if (t.templateName === 'hello_world' && t.status && String(t.status).toUpperCase() === 'ERROR') helloWorldErrors++;
    if (t.status && String(t.status).toUpperCase() === 'READ') templatesSuccess++;
  }

  // presence of NOOP/INTERACTIVE_DISABLED
  const noop = counts.noop || 0;
  const interactiveDisabled = counts.interactiveDisabled || 0;

  return {
    counts,
    metrics,
    helloWorldErrors,
    templatesSuccess,
    noop,
    interactiveDisabled,
    session: session ? { role: session.role, state: session.state, code: session.code } : null,
    loginPrompt: counts.loginPrompt || 0,
  };
}

async function main() {
  try {
    const files = await findResultFiles(ARTIFACTS_DIR);
    const summary = { generatedAt: new Date().toISOString(), artifacts: {}, totals: { files: files.length } };

    for (const f of files) {
      try {
        const raw = await fs.readFile(f, 'utf8');
        const parsed = JSON.parse(raw);
        const diag = parsed.diag || parsed;
        const base = path.basename(path.dirname(f));
        summary.artifacts[base] = summarizeDiag(diag);
      } catch (err) {
        summary.artifacts[path.basename(path.dirname(f))] = { error: String(err) };
      }
    }

    // compute a small matrix
    const matrix = {};
    for (const [k, v] of Object.entries(summary.artifacts)) {
      if (v && v.counts) {
        matrix[k] = {
          interactiveBlocked: (v.interactiveDisabled || v.noop) > 0,
          helloWorldErrors: v.helloWorldErrors,
          templatesSuccess: v.templatesSuccess,
          sessionState: v.session ? v.session.state : null,
          loginPromptCount: v.loginPrompt,
          aiDispatch24h: v.metrics.aiDispatchCount24h || 0,
          oocInfo24h: v.metrics.oocInfoCount24h || 0,
        };
      } else {
        matrix[k] = { error: v && v.error ? v.error : 'missing diag' };
      }
    }

    summary.matrix = matrix;

    const outPath = path.join(ARTIFACTS_DIR, 'summary.json');
    await fs.writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log('Wrote summary to', outPath);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
