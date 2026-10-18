/**
 * Dot sizing, shared by the renderer and the simulation (v1.5 §3.1). The sim
 * needs the drawn radius for collision, the node needs it to draw — so the rule
 * lives in one place rather than being guessed twice.
 */

export const MIN_DOT = 8;
export const MAX_DOT = 28;

/**
 * Degree counts connections, so it is compared against the busiest entity on
 * this board rather than an absolute scale — a small graph should still show
 * hubs. Square root because area, not diameter, is what the eye reads.
 */
export function dotSize(degree: number, maxDegree: number): number {
  if (maxDegree <= 0) return MIN_DOT;
  const share = Math.sqrt(Math.min(degree, maxDegree) / maxDegree);
  return Math.round(MIN_DOT + (MAX_DOT - MIN_DOT) * share);
}
