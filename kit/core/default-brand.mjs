// The brand a story gets when the user names none: the planner's sample
// story, the beat director and the camera planner all use it. Plain ESM, no
// imports. docs/VIDEO_TELLS_RFC.md lists cyan on near-black as a generated
// look, so the default is a warm graphite ground with one vermilion hue
// (accent is its lighter tint). Text contrast on bg (WCAG): paper 15.3,
// primary 6.3, accent 10.1; ink on a primary fill 6.3.
export const DEFAULT_BRAND = Object.freeze({
  colors: Object.freeze({ bg: '#191714', primary: '#ff6b3d', accent: '#ffb08a', ink: '#191714', paper: '#f2ede4' }),
  fonts: Object.freeze({ display: 'anton', body: 'manrope', meta: 'jetbrains-mono' })
});
