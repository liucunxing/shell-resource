#!/usr/bin/env node
/**
 * Export the final V19 browser runtime, including every inline override.
 * This never opens application configuration or connects to a database.
 *
 * node backend/scripts/export_v19_prototype.cjs \
 *   --source /path/Distributor_Resource_Studio_HiFi_V19.html \
 *   --playwright-module /path/node_modules/playwright \
 *   --browser /path/to/msedge
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { parseArgs } = require('node:util');

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    output: { type: 'string' },
    'playwright-module': { type: 'string' },
    browser: { type: 'string' },
  },
});
const workspace = path.resolve(__dirname, '../../../..');
const source = path.resolve(values.source || path.join(workspace,
  '迭代需求/Distributor_Resource_Studio_HiFi_V19.html'));
const output = path.resolve(values.output || path.join(__dirname,
  '../tests/fixtures/v19_prototype_demo.json'));
const playwrightModule = values['playwright-module'] || path.join(workspace,
  'outputs/v19-engineering-20261114/browser/node_modules/playwright');
const browserExecutable = values.browser ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  const sourceHash = sha256(source);
  const { chromium } = require(playwrightModule);
  const browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
  try {
    // A new browser context has no prior localStorage or user-edited prototype state.
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    // The prototype is a standalone local artifact. No external data is allowed.
    await context.route(/^https?:\/\//, (route) => route.abort());
    await page.goto(pathToFileURL(source).href, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof enterDemo === 'function' &&
      typeof db === 'object' && !!window.V19HistoryMetadata);
    const initialDatabase = await page.evaluate(() => JSON.parse(JSON.stringify(db)));
    const extracted = await page.evaluate(() => {
      enterDemo();
      const plain = (value) => JSON.parse(JSON.stringify(value));
      return {
        seed: plain(SEED),
        dealers: plain(SEED.dealers),
        db: plain(db),
        runtime: plain(st),
        historySnapshot: plain(window.V19HistoryMetadata.getSnapshot()),
        historyYears: plain(window.V19HistoryMetadata.years()),
        thresholds: plain(typeof T_ === 'function' ? T_() : HDEF),
        reserveReasons: plain(db.org.reserveReasons),
        userHistoryAccess: db.users.map((user) => ({
          id: user.id,
          roles: typeof rolesOf === 'function' ? plain(rolesOf(user)) : [user.role],
          department: window.V19UserHistory.departmentOf(user),
          access: window.V19UserHistory.accessSource(user, user.role),
        })),
      };
    });
    if (pageErrors.length) throw new Error('Prototype page errors: ' + pageErrors.join('; '));
    if (!extracted.runtime.demo) throw new Error('Final enterDemo() did not enter sandbox');
    if (sha256(source) !== sourceHash) throw new Error('Source changed during extraction');
    const dealerIds = new Set(extracted.dealers.map((dealer) => dealer.id));
    if (dealerIds.size !== extracted.dealers.length) throw new Error('Duplicate source dealer IDs');
    const sum = (numbers) => numbers.reduce((total, number) => total + number, 0);
    for (const [key, row] of Object.entries(extracted.db.submissions)) {
      const allocated = sum(Object.values(row.amounts || {}));
      const reserved = sum((row.reserves || []).map((reserve) => reserve.amount));
      if (allocated + reserved !== row.budget) throw new Error('Unbalanced submission: ' + key);
    }
    for (const [id, record] of Object.entries(extracted.historySnapshot.records)) {
      if (!dealerIds.has(id)) throw new Error('Unknown history dealer: ' + id);
      for (const [period, history] of Object.entries(record.history)) {
        if (history.investment === null) continue;
        const expenses = sum(['ice', 'mrd', 'spa', 'capex'].map((field) => history[field]));
        if (expenses !== history.investment) throw new Error('History expense mismatch: ' + id + '/' + period);
      }
    }
    const versions = extracted.db.versions.map((version) => {
      const catalogIds = new Set(version.catalog.map((item) => item.id));
      if (catalogIds.size !== version.catalog.length) throw new Error('Duplicate catalog IDs');
      for (const [kind, rows] of Object.entries({
        drafts: extracted.db.drafts, submissions: extracted.db.submissions,
      })) {
        for (const [key, row] of Object.entries(rows)) {
          if (!key.startsWith(version.id + '|')) continue;
          if (!catalogIds.has(key.split('|')[1])) throw new Error('Unknown project: ' + key);
          for (const id of [...(row.selected || []), ...Object.keys(row.amounts || {})]) {
            if (!dealerIds.has(id)) throw new Error('Unknown dealer in ' + kind + ': ' + id);
          }
        }
      }
      const prefix = version.id + '|';
      const submissions = Object.entries(extracted.db.submissions)
        .filter(([key]) => key.startsWith(prefix)).map(([, row]) => row);
      return {
        versionId: version.id,
        planningYear: 2027,
        projects: version.catalog.length,
        enabledProjects: version.catalog.filter((item) => item.enabled).length,
        drafts: Object.keys(extracted.db.drafts).filter((key) => key.startsWith(prefix)).length,
        submissions: submissions.length,
        enabledBudgetCny: sum(version.catalog.filter((item) => item.enabled).map((item) => item.budget)),
        unsubmittedInitiativeIds: version.catalog.filter((item) => item.enabled &&
          !extracted.db.submissions[prefix + item.id]).map((item) => item.id),
        confirmedSubmissions: submissions.filter((row) => row.departmentConfirmation &&
          row.departmentConfirmation.revision === row.revision && !row.requiresResubmission).length,
      };
    });
    const fixture = {
      metadata: {
        schemaVersion: 1,
        kind: 'prototype-demo',
        localOnly: true,
        containsRemoteDatabaseData: false,
        sourceFile: path.basename(source),
        sourceSha256: sourceHash,
        scenario: 'fresh browser context; final enterDemo(); no manual edits or confirmations',
        sourceSnapshotDates: extracted.historySnapshot.manifest.datasets,
        dealerScope: 'global prototype pool; dealer records do not carry a sector',
        planningYearByVersion: Object.fromEntries(versions.map((v) => [v.versionId, v.planningYear])),
        projectKey: 'versionId|initiativeId',
        units: {
          planningAmountRaw: 'CNY',
          planningAmountDisplay: '10000 CNY',
          historicalAmountRaw: 'USD',
          historicalAmountDisplay: '1000 USD (K$)',
          volumeRaw: 'KL',
          contractVolumeRaw: 'KL',
          yieldDefinition: 'historical C3 / historical investment, dimensionless; not C3 / volume',
          evidence: 'Final prototype help/labels; kd(n)=fmt(n/1000,1); planning values use wan(n)=fmt(n/10000).',
        },
        identityNote: 'All users/accounts are prototype examples, not verified identities. Local fixture authentication must use synthetic example.test accounts.',
        snapshotNote: 'Dates and October coverage come from the embedded prototype manifest; they do not describe the remote PG source.',
        auditTimestampNote: 'db.audit timestamps are generated by the prototype at browser runtime; they are not historical business snapshot dates.',
        workflowNote: 'Workflow state is exported exactly as initialized by the prototype. No confirmations or dates were invented.',
        summaries: { dealers: extracted.dealers.length, users: extracted.db.users.length, versions },
      },
      ...extracted,
      initialDatabase,
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({
      output, sourceSha256: sourceHash, databaseKeys: Object.keys(fixture.db),
      ...fixture.metadata.summaries,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
