/**
 * Seeds an example board that exercises every Cartographer feature.
 * Everything goes through the public API — the server owns all writes.
 *
 *   SEED_PASS=… node scripts/seed-example.mjs              # against http://localhost:3000
 *   API=http://host:3000/api SEED_PASS=… node scripts/…    # against anywhere else
 */
import { call, signIn } from './lib/client.mjs';

await signIn();


// ---------------------------------------------------------------- parent board
const board = await call('POST', '/boards', { name: 'Signup & Onboarding' });
const B = board.id;
console.log('board:', B);

const node = async (title, position) =>
  (await call('POST', `/boards/${B}/nodes`, { title, position })).id;

// Acquisition (chips)
const adClick = await node('Ad click', { x: 120, y: 258 });
const seo = await node('SEO', { x: 120, y: 316 });
const referral = await node('Referral link', { x: 120, y: 374 });

// The spine of the flow
const landing = await node('Landing Page', { x: 470, y: 286 });
const signupForm = await node('Signup Form', { x: 780, y: 214 });
const verified = await node('Email verified?', { x: 780, y: 344 });
const welcome = await node('Welcome Email', { x: 780, y: 486 });
const wizard = await node('Setup Wizard', { x: 1264, y: 214 });
const importData = await node('Import data', { x: 1264, y: 358 });
const inviteTeam = await node('Invite team', { x: 1264, y: 416 });
const churn = await node('Churn risk', { x: 806, y: 648 });

// ------------------------------------------------------------------ sub-board
const child = await call('POST', '/boards', {
  name: 'Setup Wizard Steps',
  parentBoard: B,
  parentNode: wizard,
});
const C = child.id;
const cNode = async (title, position) =>
  (await call('POST', `/boards/${C}/nodes`, { title, position })).id;

const chooseTemplate = await cNode('Choose template', { x: 160, y: 180 });
const connectSource = await cNode('Connect source', { x: 460, y: 180 });
const firstRun = await cNode('First run', { x: 760, y: 180 });

await call('PUT', `/boards/${C}/graph`, {
  nodes: [
    {
      id: chooseTemplate,
      title: 'Choose template',
      position: { x: 160, y: 180 },
      size: { width: 200, height: 84 },
      shape: 'rounded',
      status: 'built',
      color: '--node-mint',
    },
    {
      id: connectSource,
      title: 'Connect source',
      position: { x: 460, y: 180 },
      size: { width: 200, height: 84 },
      shape: 'rounded',
      status: 'documented',
    },
    {
      id: firstRun,
      title: 'First run',
      position: { x: 760, y: 180 },
      size: { width: 200, height: 64 },
      shape: 'pill',
      status: 'sketched',
    },
  ],
  edges: [
    { id: 'e-c1', source: chooseTemplate, target: connectSource },
    { id: 'e-c2', source: connectSource, target: firstRun, label: 'ready' },
  ],
  frames: [],
  texts: [
    { id: 'text-c1', text: 'Three steps, then the workspace is live', position: { x: 160, y: 110 }, size: 'md' },
  ],
  viewport: { x: 60, y: 40, zoom: 0.9 },
});

await call('PUT', `/boards/${C}/nodes/${chooseTemplate}/body`, {
  body: 'Six starter templates. The choice seeds the workspace and is not reversible in v1.\n',
});
await call('PUT', `/boards/${C}/nodes/${connectSource}/body`, {
  body: 'OAuth to the data source. Falls back to CSV upload when the provider is unsupported.\n',
});

// ------------------------------------------------------------- parent graph
const chip = (id, title, position, status = 'sketched', frameId) => ({
  id,
  title,
  position,
  size: { width: 184, height: 76 },
  shape: 'rect',
  status,
  variant: 'chip',
  frameId,
});

const card = (id, title, position, opts = {}) => ({
  id,
  title,
  position,
  size: opts.size ?? { width: 200, height: 84 },
  shape: opts.shape ?? 'rect',
  status: opts.status ?? 'sketched',
  color: opts.color,
  frameId: opts.frameId,
});

await call('PUT', `/boards/${B}/graph`, {
  nodes: [
    chip(adClick, 'Ad click', { x: 120, y: 258 }, 'built', 'frame-acquisition'),
    chip(seo, 'SEO', { x: 120, y: 316 }, 'documented', 'frame-acquisition'),
    chip(referral, 'Referral link', { x: 120, y: 374 }, 'sketched', 'frame-acquisition'),

    card(landing, 'Landing Page', { x: 470, y: 286 }, {
      shape: 'rounded',
      status: 'built',
      color: '--node-peach',
      size: { width: 210, height: 116 },
    }),

    card(signupForm, 'Signup Form', { x: 780, y: 214 }, {
      status: 'built',
      size: { width: 210, height: 116 },
      frameId: 'frame-signup',
    }),
    card(verified, 'Email verified?', { x: 780, y: 344 }, {
      shape: 'diamond',
      status: 'documented',
      size: { width: 200, height: 110 },
      frameId: 'frame-signup',
    }),
    card(welcome, 'Welcome Email', { x: 780, y: 486 }, {
      shape: 'pill',
      status: 'documented',
      color: '--node-lilac',
      size: { width: 200, height: 64 },
      frameId: 'frame-signup',
    }),

    card(wizard, 'Setup Wizard', { x: 1264, y: 214 }, {
      shape: 'rounded',
      status: 'documented',
      size: { width: 210, height: 116 },
      frameId: 'frame-onboarding',
    }),
    chip(importData, 'Import data', { x: 1264, y: 358 }, 'sketched', 'frame-onboarding'),
    chip(inviteTeam, 'Invite team', { x: 1264, y: 416 }, 'sketched', 'frame-onboarding'),

    card(churn, 'Churn risk', { x: 806, y: 648 }, {
      shape: 'ellipse',
      status: 'sketched',
      color: '--node-blush',
      size: { width: 190, height: 120 },
    }),
  ],
  edges: [
    { id: 'e1', source: adClick, target: landing },
    { id: 'e2', source: seo, target: landing },
    { id: 'e3', source: referral, target: landing, label: 'utm' },
    { id: 'e4', source: landing, target: signupForm, label: 'CTA' },
    { id: 'e5', source: signupForm, target: verified },
    { id: 'e6', source: verified, target: welcome, label: 'yes' },
    { id: 'e7', source: verified, target: churn, label: 'no', style: 'dashed' },
    { id: 'e8', source: welcome, target: wizard },
    { id: 'e9', source: wizard, target: importData },
    { id: 'e10', source: wizard, target: inviteTeam },
  ],
  frames: [
    {
      id: 'frame-acquisition',
      title: 'Acquisition',
      position: { x: 80, y: 180 },
      size: { width: 320, height: 280 },
      color: '--node-sky',
    },
    {
      id: 'frame-signup',
      title: 'Signup',
      position: { x: 740, y: 150 },
      size: { width: 300, height: 430 },
      color: '--node-mint',
    },
    {
      id: 'frame-onboarding',
      title: 'Onboarding',
      position: { x: 1224, y: 150 },
      size: { width: 300, height: 340 },
      color: '--node-lemon',
    },
  ],
  texts: [
    { id: 'text-title', text: 'Signup & Onboarding', position: { x: 80, y: 60 }, size: 'lg' },
    {
      id: 'text-sub',
      text: 'Every node opens into its own markdown file',
      position: { x: 82, y: 108 },
      size: 'sm',
    },
    { id: 'text-branch', text: 'dashed = tentative', position: { x: 600, y: 640 }, size: 'md' },
    { id: 'text-drill', text: '▣ opens a sub-map', position: { x: 1224, y: 512 }, size: 'sm' },
  ],
  viewport: { x: 24, y: 12, zoom: 0.62 },
});

// ------------------------------------------------------------------- content
const body = (id, text) => call('PUT', `/boards/${B}/nodes/${id}/body`, { body: text });
const data = (id, payload) => call('PUT', `/boards/${B}/nodes/${id}/data`, payload);
const patch = (id, payload) => call('PATCH', `/boards/${B}/nodes/${id}`, payload);

await body(
  landing,
  `The single entry point for every paid and organic source.

- Above the fold: one promise, one button.
- UTM parameters are captured here and carried through signup.

> If this page changes, the ad copy changes with it.
`,
);
await data(landing, {
  version: 2,
  snippets: [
    {
      id: 's-landing-out',
      label: 'captured',
      lang: 'json',
      code: `{\n  "utm": "Record<string, string>",\n  "variant": "'a' | 'b'"\n}`,
    },
  ],
  outSnippetId: 's-landing-out',
});
await patch(landing, {
  tags: ['marketing'],
  description: 'One promise, one button. Every paid and organic source lands here.',
});

await body(
  signupForm,
  `Email + password, or SSO. No credit card.

Validation runs client-side first, then again on the server — the client copy is a
courtesy, not a gate.
`,
);
await data(signupForm, {
  version: 2,
  snippets: [
    {
      id: 's-signup-out',
      label: 'session payload',
      lang: 'json',
      code: `{\n  "email": "string",\n  "plan": "'free' | 'pro'",\n  "userId": "string"\n}`,
    },
    {
      id: 's-signup-validate',
      label: 'validate',
      lang: 'ts',
      code: `export function validateSignup(input: SignupInput): Result {
  if (!isEmail(input.email)) return err('email');
  if (input.password.length < 12) return err('password_too_short');
  return ok(input);
}`,
    },
  ],
  outSnippetId: 's-signup-out',
});
await patch(signupForm, {
  tags: ['auth', 'core'],
  description: 'Email, password or SSO. No credit card at this step.',
});

await body(
  verified,
  `The one branch in the flow.

Verified addresses continue to the welcome email. Unverified ones sit in a holding
state for 72 hours — that path is still a sketch.
`,
);

await body(welcome, 'Transactional, not marketing. One link: continue setup.\n');
await data(welcome, {
  version: 2,
  snippets: [
    { id: 's-welcome-out', label: 'link token', lang: 'json', code: `{\n  "token": "string"\n}` },
  ],
  outSnippetId: 's-welcome-out',
});

await body(
  wizard,
  `Three steps, expanded into its own map.

Open it from the Sub-maps tab in the node panel.
`,
);
await data(wizard, {
  version: 2,
  snippets: [
    { id: 's-wizard-out', label: 'workspace', lang: 'json', code: `{\n  "workspaceId": "string"\n}` },
    {
      id: 's-wizard-state',
      label: 'wizard state',
      lang: 'ts',
      code: `type Step = 'template' | 'source' | 'first-run';`,
    },
  ],
  outSnippetId: 's-wizard-out',
});
await patch(wizard, {
  tags: ['core'],
  description: 'Three steps to a live workspace — expanded into its own map.',
});

await body(adClick, 'Paid social and search. Highest volume, lowest intent.\n');
await body(seo, 'Long-tail comparison pages. Slow, compounding, cheapest per signup.\n');
await body(importData, 'CSV or a live connection. Optional, but activation doubles when it happens.\n');

// `Churn risk`, `Referral link` and `Invite team` stay empty on purpose:
// they render hollow, which is the coverage cue.

await call('POST', `/boards/${B}/snapshots`);

console.log('done:', B, '· sub-board:', C);
