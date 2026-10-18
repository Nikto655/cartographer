/**
 * Two overlapping normal distributions — the app mark. Wide and low-shouldered
 * rather than spiky, so it still reads at 20px. Paths are sampled Gaussians
 * (μ 12 / σ 5.4 behind, μ 19 / σ 4.6 in front) over a baseline at y=25.
 *
 * The Cartographer logo is a trademark, which the AGPL does not license. A fork
 * that is shared or hosted replaces this mark and public/favicon.svg; see
 * TRADEMARKS.md.
 */
const BACK =
  'M 1 25 L 1 23.05 L 1.62 22.55 L 2.25 21.96 L 2.88 21.28 L 3.5 20.51 L 4.12 19.65 L 4.75 18.71 ' +
  'L 5.38 17.7 L 6 16.64 L 6.62 15.56 L 7.25 14.47 L 7.88 13.42 L 8.5 12.44 L 9.12 11.55 ' +
  'L 9.75 10.79 L 10.38 10.19 L 11 9.76 L 11.62 9.54 L 12.25 9.52 L 12.88 9.7 L 13.5 10.09 ' +
  'L 14.12 10.65 L 14.75 11.39 L 15.38 12.25 L 16 13.22 L 16.62 14.26 L 17.25 15.34 L 17.88 16.42 ' +
  'L 18.5 17.49 L 19.12 18.51 L 19.75 19.47 L 20.38 20.34 L 21 21.14 L 21.62 21.83 L 22.25 22.44 ' +
  'L 22.88 22.96 L 23.5 23.39 L 24.12 23.75 L 24.75 24.05 L 25.38 24.28 L 26 24.46 L 26.62 24.6 ' +
  'L 27.25 24.71 L 27.88 24.79 L 28.5 24.85 L 29.12 24.9 L 29.75 24.93 L 30.38 24.95 L 31 24.97 L 31 25 Z';

const FRONT =
  'M 1 25 L 1 24.99 L 1.62 24.98 L 2.25 24.97 L 2.88 24.96 L 3.5 24.93 L 4.12 24.9 L 4.75 24.84 ' +
  'L 5.38 24.76 L 6 24.64 L 6.62 24.48 L 7.25 24.25 L 7.88 23.95 L 8.5 23.56 L 9.12 23.05 ' +
  'L 9.75 22.42 L 10.38 21.64 L 11 20.7 L 11.62 19.61 L 12.25 18.36 L 12.88 16.96 L 13.5 15.46 ' +
  'L 14.12 13.88 L 14.75 12.27 L 15.38 10.71 L 16 9.24 L 16.62 7.93 L 17.25 6.86 L 17.88 6.07 ' +
  'L 18.5 5.61 L 19.12 5.51 L 19.75 5.76 L 20.38 6.35 L 21 7.26 L 21.62 8.43 L 22.25 9.81 ' +
  'L 22.88 11.32 L 23.5 12.92 L 24.12 14.52 L 24.75 16.07 L 25.38 17.54 L 26 18.87 L 26.62 20.06 ' +
  'L 27.25 21.1 L 27.88 21.97 L 28.5 22.69 L 29.12 23.27 L 29.75 23.73 L 30.38 24.08 L 31 24.35 L 31 25 Z';

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      className="cg-logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Cartographer"
    >
      {/* Back curve: deep indigo. Front: the interaction blue, laid over it so
          the overlap reads as a third, darker band — as in the reference. */}
      <path d={BACK} fill="var(--logo-back)" />
      <path d={FRONT} fill="var(--logo-front)" fillOpacity="0.86" />
      <line
        x1="1"
        y1="25.5"
        x2="31"
        y2="25.5"
        stroke="var(--logo-base)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
