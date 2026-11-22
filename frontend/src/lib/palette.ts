/**
 * Colours. HEAT is the landing page's pastel ramp, used for decoration (pixel strips, tile tabs). KIND_COLOR is
 * the same hues in deeper tones, used for data (numerals, bars and charts) so they read clearly on the light tiles.
 */
export const HEAT = ['#8593ea', '#a98ae6', '#e88bb3', '#f5a07a', '#f6d08a'] as const

export const KIND_COLOR = {
  followers: '#6d4fc9',
  following: '#4559d6',
  mutuals: '#c98a0b',
  'not-following-back': '#e0622f',
  fans: '#d0407f',
  unavailable: '#7a7a7a'
} as const

/** The tallest column in a chart: near-black, so the peak stands out from any series colour. */
export const PEAK_COLOR = '#2a2a2a'

export type KindColorKey = keyof typeof KIND_COLOR
