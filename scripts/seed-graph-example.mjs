/**
 * Seeds an example graph board — a reading knowledge base on systems thinking,
 * which is the kind of thing a graph is for: no layout to author, just entities
 * and the relationships between them.
 *
 * It exercises the whole graph world: a drawn layer with labelled edges, a
 * derived layer that falls out of [[…]] mentions in the notes, ghosts for
 * things mentioned but never written, five tag groups, all three statuses,
 * orphans, and one entity that drills into a sub-map.
 *
 *   SEED_PASS=… node scripts/seed-graph-example.mjs        # against http://localhost:3000
 *   API=http://host:3000/api SEED_PASS=… node scripts/…    # against anywhere else
 */
import { call, signIn } from './lib/client.mjs';

await signIn();


const board = await call('POST', '/boards', {
  name: 'Systems & Complexity',
  boardType: 'graph',
});
const B = board.id;
console.log('graph:', B);

/**
 * Entities carry no position: the graph world seats un-laid-out nodes itself
 * from a seed derived from the board id, so the picture is the same every time
 * without anyone hand-placing 34 dots.
 */
const ENTITIES = [
  // ---------------------------------------------------------------- concepts
  ['Feedback Loop', 'concept', 'built', '--node-sky',
    'The unit of behaviour. Reinforcing loops compound, balancing loops resist.',
    `Every system story is a loop story. A **reinforcing** loop takes its own output as
input and grows or collapses; a **balancing** loop pushes back toward a target.

Almost nothing interesting is a single loop. [[Emergence]] is what you get when
several of them run at different speeds — the fast one looks like the cause and
the slow one turns out to be.

Read the notation before the theory: [[Causal Loop Diagram]].`],

  ['Emergence', 'concept', 'built', '--node-sky',
    'Behaviour of the whole that no part exhibits alone.',
    `The property is real but has no address. You cannot point at the neuron that is
conscious or the trader who is the market.

Two consequences worth keeping:

1. Decomposing the system destroys the thing you were studying.
2. Fixing a part rarely fixes the whole — see [[Leverage Point]].

[[Herbert Simon]] argued the useful move is to find the near-decomposable seams,
not to pretend there are none.`],

  ['Stock and Flow', 'concept', 'built', '--node-sky',
    'The accumulation, and the rate that fills or drains it.',
    `Stocks are what a system remembers. Flows are what it is doing right now.

People reliably read flows and ignore stocks — the reason a falling *rate* of
emissions still reads as progress while the *stock* keeps rising. [[Jay Forrester]]
built an entire discipline on making the distinction unavoidable.

The bathtub is the whole lesson: the level is the integral of the tap.`],

  ['Leverage Point', 'concept', 'built', '--node-mint',
    'Where a small shift changes everything — usually not where people push.',
    `[[Donella Meadows]] ranked twelve of them, weakest to strongest. Everyone pushes
on the weak end (parameters, subsidies, taxes) because it is legible and
fundable. The strong end — goals, paradigms, the power to transcend paradigms —
is where the change actually lives, and it is nobody's job.

Her warning is the point: leverage points are frequently counterintuitive, and
people push them in the wrong direction with great confidence.`],

  ['Tipping Point', 'concept', 'documented', '--node-sky',
    'Where a balancing regime hands over to a reinforcing one.',
    `Not a threshold in the quantity — a change in which loop is dominant. Before it,
[[Feedback Loop]] structure resists; after, the same structure accelerates.

The uncomfortable part is that the system looks *most* stable just before, because
the balancing loop is working hardest right up to the moment it stops.`],

  ['Path Dependence', 'concept', 'documented', '--node-lilac',
    'History is a live input, not a footnote.',
    `Small early accidents get locked in by increasing returns. QWERTY, track gauges,
the width of a rocket booster.

This is what makes [[Network Effect]] markets so hard to reverse: by the time the
better option exists, the worse one is load-bearing.`],

  ['Resilience', 'concept', 'documented', '--node-mint',
    'The size of the shock a system can absorb and still be itself.',
    `Not the same as efficiency — usually its opposite. Slack, redundancy and
diversity all read as waste on a spreadsheet and are the entire reason the system
survives a bad year.

Optimising a system to a single objective is how you get [[2008 Credit Crisis]]:
every buffer converted into yield, and then no buffers.

Related but not identical: [[Antifragility]].`],

  ['Antifragility', 'concept', 'documented', '--node-peach',
    'Gains from disorder, rather than merely surviving it.',
    `[[Nassim Taleb]]'s distinction: fragile breaks under volatility, robust endures it,
antifragile *improves* because of it. Muscle, immune systems, and anything with
optionality.

Whether it is a genuinely new category or an energetic restatement of
[[Resilience]] is worth arguing about — but the asymmetry it names is real.`],

  ['Requisite Variety', 'concept', 'documented', '--node-aqua',
    'Only variety can absorb variety.',
    `[[Ross Ashby]]'s law. A controller needs at least as many distinguishable states as
the disturbance it is regulating, or it cannot compensate.

The practical reading: a regulator simpler than the thing it regulates will fail,
and no amount of effort substitutes for the missing variety. Most compliance
regimes are this failure with a budget.`],

  ['Network Effect', 'concept', 'documented', '--node-lilac',
    'Value rising with the number of participants.',
    `A [[Feedback Loop]] wearing a business model. Each user makes the product better
for the next, which is why these markets tip rather than converge.

The same structure carries contagion as happily as it carries value — see
[[2008 Credit Crisis]], where the connections that made funding cheap in good
weather are exactly what transmitted the failure.`],

  ['Bullwhip Effect', 'concept', 'documented', '--node-lemon',
    'Small demand wobbles amplifying up a supply chain.',
    `Each tier orders against its own delayed, distorted picture of demand, adds a
safety margin, and passes the noise upstream with gain. Four tiers is enough to
turn a 5% blip into a shutdown.

Delay plus local optimisation is the whole mechanism. [[Toyota Production System]]
attacks it by shortening the delay rather than forecasting harder.`],

  ['Tragedy of the Commons', 'concept', 'built', '--node-blush',
    'A shared stock drained by individually rational actors.',
    `The classic framing says the only exits are privatisation or the state.
[[Elinor Ostrom]] went and looked at real commons and found a third: users writing,
monitoring and enforcing their own rules — durably, for centuries.

Where the third path is absent, the first framing holds. [[Cod Fishery Collapse]]
and [[Aral Sea]] are what that looks like at scale.`],

  // ---------------------------------------------------------------- thinkers
  ['Donella Meadows', 'thinker', 'built', '--node-mint',
    'Systems ecologist. Wrote the clearest thing on the subject.',
    `Lead author on *Limits to Growth*, then spent decades translating systems work
out of the modelling literature and into language a policymaker could act on.

[[Thinking in Systems]] was assembled from her drafts after her death in 2001.
Her essay on [[Leverage Point]]s is still the most-cited thing in the field.`],

  ['Jay Forrester', 'thinker', 'documented', '--node-mint',
    'Founded system dynamics at MIT.',
    `Came from servomechanisms and magnetic core memory, then turned control theory on
corporations, cities and the world economy.

Gave the field [[Stock and Flow]] as its primitives and the simulation habit that
goes with them. His industrial dynamics work is where [[Bullwhip Effect]] was first
modelled rather than merely complained about.`],

  ['Herbert Simon', 'thinker', 'documented', '--node-mint',
    'Bounded rationality, satisficing, near-decomposability.',
    `The argument that agents optimise within the limits of what they can compute and
know — which makes the *structure* of the system the dominant variable, not the
cleverness of the people inside it.

His parable of the two watchmakers is the tidiest thing ever written about why
[[Emergence]] favours hierarchy.`],

  ['Elinor Ostrom', 'thinker', 'built', '--node-mint',
    'Showed the commons is governable. Nobel, 2009.',
    `Field-first: irrigation in Nepal, forests in Bhutan, fisheries in Turkey. Out of
it came eight design principles for durable common-pool governance.

[[Governing the Commons]] is the argument. Its target is the assumption that
[[Tragedy of the Commons]] is a law rather than an outcome.`],

  ['Ross Ashby', 'thinker', 'sketched', '--node-mint',
    'Cybernetician. Stated the law of requisite variety.',
    `*An Introduction to Cybernetics*, 1956. Still the cleanest statement of what a
regulator has to be able to do.

Belongs to the [[Cybernetics]] lineage that systems thinking largely absorbed and
then stopped citing.`],

  ['Nassim Taleb', 'thinker', 'sketched', '--node-mint',
    'Options trader turned essayist on tail risk.',
    `Abrasive, repetitive, and right about the thing that matters: we systematically
misprice the tails and then act surprised.

[[Antifragile]] is the constructive half of the argument.`],

  // ------------------------------------------------------------------- books
  ['Thinking in Systems', 'book', 'built', '--node-lemon',
    'Meadows, 2008. The one to hand someone first.',
    `Two hundred pages, no equations, and it will change how you read a news story.

The chapter on system traps — drift to low performance, escalation, policy
resistance — is worth the price on its own. Ends with the [[Leverage Point]]
hierarchy.`],

  ['The Fifth Discipline', 'book', 'documented', '--node-lemon',
    'Senge, 1990. Systems thinking as organisational practice.',
    `Where most managers first met [[Causal Loop Diagram]]s and the beer game.

Uneven — the archetypes chapter is excellent, the learning-organisation material
has aged into consultancy boilerplate. Take the first half.`],

  ['Governing the Commons', 'book', 'documented', '--node-lemon',
    'Ostrom, 1990. Evidence against an assumption.',
    `Case after case of communities managing shared resources without either
privatisation or an enforcing state, plus the conditions under which it holds.

Dry, and the dryness is the point: it is an empirical answer to a thought
experiment.`],

  ['Seeing Like a State', 'book', 'documented', '--node-lemon',
    'Scott, 1998. What legibility destroys.',
    `Not framed as systems work but it is the best case study in the genre: states
simplify what they cannot see, and the simplification removes the local knowledge
that made the system function.

Scientific forestry, collectivisation, Brasília. The failures rhyme with
[[Requisite Variety]] — a regulator too simple for what it regulates.`],

  ['Antifragile', 'book', 'sketched', '--node-lemon',
    'Taleb, 2012. The constructive half of the tail-risk argument.',
    `Argues for convexity: arrange things so volatility is on your side, and stop
forecasting.

Long. The idea arrives early and is then defended at length. See
[[Antifragility]].`],

  // ------------------------------------------------------------------- cases
  ['Cod Fishery Collapse', 'case', 'built', '--node-blush',
    'Newfoundland, 1992. A 500-year fishery gone in a decade.',
    `Stock assessments measured catch per unit effort, which sonar and factory
freezers kept flat while the biomass fell out from under it. The instrument said
"stable" until the fish were gone.

Textbook [[Tragedy of the Commons]] with a measurement failure on top: the
[[Stock and Flow]] distinction ignored, then a moratorium that put 30,000 people
out of work. The stock has not recovered.`],

  ['Kaibab Deer Irruption', 'case', 'documented', '--node-blush',
    'Arizona, 1920s. Predators removed, herd boomed, range collapsed.',
    `Remove the balancing loop and the reinforcing one runs unopposed. The herd
overshot the range, ate the seedlings, and then starved below where it started.

Whether the numbers were as dramatic as the textbooks claim is contested. The
[[Feedback Loop]] lesson survives the argument.`],

  ['Toyota Production System', 'case', 'built', '--node-mint',
    'Pull, not push. Shorten the delay instead of forecasting it.',
    `Kanban replaces the forecast with a signal from the next station down, which
collapses the delay that generates [[Bullwhip Effect]].

Andon — anyone can stop the line — is the striking part: a balancing loop with
its authority pushed all the way to where the information is. That is a
[[Leverage Point]] in the strong sense, and it is why the tooling copies never
worked.`],

  ['2008 Credit Crisis', 'case', 'documented', '--node-blush',
    'Every buffer converted into yield.',
    `Individually prudent positions, collectively catastrophic: the same hedges held
by everyone, so the hedge became the transmission mechanism.

[[Network Effect]] on the funding side, no [[Resilience]] anywhere, and models
calibrated on a period that happened to contain no correlated failure.`],

  ['Aral Sea', 'case', 'documented', '--node-blush',
    'A sea drained for cotton, in plain sight, over thirty years.',
    `Irrigation diverted the two feeding rivers. The [[Stock and Flow]] arithmetic was
never in doubt and the outcome was never in doubt; the decision structure simply
had nobody in it who was accountable for the stock.

A [[Tragedy of the Commons]] where the commons was drained by plan rather than by
scramble.`],

  // ----------------------------------------------------------------- methods
  ['Causal Loop Diagram', 'method', 'built', '--node-aqua',
    'Nodes, signed arrows, and a mark on each loop.',
    `Cheap, fast, and the fastest way to find out that two people who agreed in the
meeting have different systems in their heads.

Notation for [[Feedback Loop]] structure. It shows you the loops; it will not tell
you what the system does over time — for that you need a [[Stock-Flow Model]].`],

  ['Stock-Flow Model', 'method', 'documented', '--node-aqua',
    'Simulate it, because loops are not intuitable.',
    `Once there are two loops and a delay, nobody can predict the behaviour by
inspection — reliably, including the people who built the model.

Turns [[Stock and Flow]] structure into behaviour over time. The value is mostly
in being forced to state the rates out loud.`],

  ['Scenario Planning', 'method', 'documented', '--node-aqua',
    'Several futures, held at once, none of them a forecast.',
    `Shell's version: build a handful of internally coherent worlds, then look for the
decisions that survive all of them.

The output is not the scenarios. It is that the organisation has already thought
about the world it is now in.

Where it earns its keep is [[Second-Order Effects]] — the consequence of the
consequence, which no single-forecast process ever gets to.`],

  ['Premortem', 'method', 'built', '--node-aqua',
    'It is eighteen months on and this failed. Why?',
    `Klein's trick. Prospective hindsight — assuming the outcome rather than
estimating it — surfaces markedly more concrete risks than "what could go wrong",
and it makes dissent socially free.

Ten minutes. Cheapest thing on this graph. A poor relation of
[[Scenario Planning]] and worth more per minute.`],

  ['Red Teaming', 'method', 'sketched', '--node-aqua',
    'Someone paid to break the plan.',
    `Only works when the red team is genuinely outside the reporting line of the plan's
author, which is why most of them do not work.

Structurally this is [[Requisite Variety]]: buy variety you do not have.`],

  // ----------------------------------------------------- orphans, on purpose
  ['Reading Queue', 'method', 'sketched', '--node-slate',
    'Unsorted. Nothing links here yet.',
    `Ashby's *Design for a Brain*. Bateson. The Sante Fe lecture notes. Holling on
adaptive cycles.

Nothing points at this and it points at nothing — which is what the orphans
toggle is for.`],

  ['Open Questions', 'method', 'sketched', '--node-slate',
    'Things this graph cannot answer yet.',
    `Is [[Antifragility]] a category or a restatement? Where does the commons work
stop scaling? Is there a way to detect a [[Tipping Point]] from inside the system,
before it is a memoir?`],
];

const id = {};
for (const [title] of ENTITIES) {
  id[title] = (await call('POST', `/boards/${B}/nodes`, { title, position: { x: 0, y: 0 } })).id;
}

for (const [title, tag, status, , description] of ENTITIES) {
  await call('PATCH', `/boards/${B}/nodes/${id[title]}`, { status, tags: [tag], description });
}

// --------------------------------------------------------------- sub-map
// One entity drills into a map — the ring around its dot — because twelve
// ranked leverage points are a list, and a list wants a map, not a graph.
const child = await call('POST', '/boards', {
  name: 'Twelve Leverage Points',
  boardType: 'map',
  parentBoard: B,
  parentNode: id['Leverage Point'],
});
const C = child.id;
const POINTS = [
  ['12 · Constants & parameters', 'Numbers. Subsidies, taxes, standards.', 'built'],
  ['10 · Stock sizes & buffers', 'Slack relative to the flows.', 'built'],
  ['8 · Balancing loop strength', 'Relative to the impact it corrects.', 'documented'],
  ['7 · Reinforcing loop gain', 'Driving growth — slow it, do not add to it.', 'documented'],
  ['6 · Information flows', 'Who gets to know what, and when.', 'documented'],
  ['4 · Self-organisation', 'The power to add, change and evolve structure.', 'sketched'],
  ['3 · Goals', 'What the system is actually for.', 'sketched'],
  ['2 · Paradigms', 'The shared assumption the goals come from.', 'sketched'],
];
const pointNodes = [];
for (const [title, , status] of POINTS) {
  pointNodes.push({ id: (await call('POST', `/boards/${C}/nodes`, { title, position: { x: 0, y: 0 } })).id, status });
}
await call('PUT', `/boards/${C}/graph`, {
  nodes: POINTS.map(([title, , status], i) => ({
    id: pointNodes[i].id,
    title,
    position: { x: 200, y: 160 + i * 92 },
    size: { width: 320, height: 72 },
    shape: 'rounded',
    status,
    color: i < 3 ? '--node-slate' : i < 6 ? '--node-lemon' : '--node-mint',
  })),
  edges: [],
  frames: [],
  texts: [
    { id: 'text-lp-1', text: 'Weakest first. Everyone pushes the top of this list.', position: { x: 200, y: 90 }, size: 'md' },
    { id: 'text-lp-2', text: 'Meadows, "Leverage Points: Places to Intervene in a System", 1999', position: { x: 200, y: 900 }, size: 'sm' },
  ],
  viewport: { x: 120, y: 20, zoom: 0.72 },
});
for (let i = 0; i < POINTS.length; i += 1) {
  await call('PUT', `/boards/${C}/nodes/${pointNodes[i].id}/body`, { body: `${POINTS[i][1]}\n` });
}

// ------------------------------------------------------------- drawn layer
// Deliberate, labelled relationships — claims someone decided to make, as
// opposed to the derived layer, which is just what the prose happens to say.
const E = (source, target, label) => ({
  id: `edge-${source}-${target}`.replace(/[^a-z0-9-]/gi, ''),
  source: id[source],
  target: id[target],
  label,
});

const board2 = await call('GET', `/boards/${B}`);
await call('PUT', `/boards/${B}/graph`, {
  nodes: board2.nodes.map((n) => ({
    ...n,
    color: ENTITIES.find(([t]) => t === n.title)?.[3],
  })),
  edges: [
    E('Donella Meadows', 'Thinking in Systems', 'wrote'),
    E('Donella Meadows', 'Leverage Point', 'ranked'),
    E('Elinor Ostrom', 'Governing the Commons', 'wrote'),
    E('Nassim Taleb', 'Antifragile', 'wrote'),
    E('Jay Forrester', 'Stock and Flow', 'formalised'),
    E('Ross Ashby', 'Requisite Variety', 'stated'),
    E('Herbert Simon', 'Emergence', 'near-decomposability'),

    E('Feedback Loop', 'Tipping Point', 'dominance flips'),
    E('Feedback Loop', 'Bullwhip Effect', 'amplifies'),
    E('Stock and Flow', 'Feedback Loop', 'accumulates'),
    E('Network Effect', 'Path Dependence', 'locks in'),
    E('Resilience', 'Antifragility', 'contrast'),

    E('Tragedy of the Commons', 'Cod Fishery Collapse', 'played out in'),
    E('Tragedy of the Commons', 'Aral Sea', 'played out in'),
    E('Kaibab Deer Irruption', 'Feedback Loop', 'loop removed'),
    E('Bullwhip Effect', 'Toyota Production System', 'countered by'),
    E('Network Effect', '2008 Credit Crisis', 'transmitted'),
    E('Resilience', '2008 Credit Crisis', 'absent in'),

    E('Causal Loop Diagram', 'Feedback Loop', 'notation for'),
    E('Stock-Flow Model', 'Stock and Flow', 'simulates'),
    E('Causal Loop Diagram', 'Stock-Flow Model', 'precedes'),
    E('Premortem', 'Scenario Planning', 'cheap relation of'),
    E('Red Teaming', 'Requisite Variety', 'buys variety'),
    E('Seeing Like a State', 'Requisite Variety', 'failure mode of'),
    E('The Fifth Discipline', 'Causal Loop Diagram', 'popularised'),
    E('Governing the Commons', 'Tragedy of the Commons', 'answers'),
    E('Thinking in Systems', 'Leverage Point', 'closes with'),
  ],
});

// --------------------------------------------------------- derived layer
// Bodies last: every [[…]] in this prose becomes a derived edge, and the two
// titles nothing answers to — Cybernetics, Second-Order Effects — become ghosts.
for (const [title, , , , , body] of ENTITIES) {
  await call('PUT', `/boards/${B}/nodes/${id[title]}/body`, { body: `${body}\n` });
}

const state = await call('GET', `/boards/${B}`);
const ghosts = new Set(state.links.filter((l) => !l.targetId).map((l) => l.targetTitle));
console.log(`${state.nodes.length} entities · ${state.edges.length} drawn · ${state.links.length} mentions`);
console.log(`ghosts: ${[...ghosts].join(', ')}`);
console.log(`sub-map: ${C}`);
