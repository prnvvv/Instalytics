/** The landing page's heat ramp, coolest first, and the colour each kind of account carries across the app. */
export const HEAT = ['#8593ea', '#a98ae6', '#e88bb3', '#f5a07a', '#f6d08a'] as const

export const KIND_COLOR = {
  followers: '#a98ae6',
  following: '#8593ea',
  mutuals: '#f6d08a',
  'not-following-back': '#f5a07a',
  fans: '#e88bb3',
  unavailable: '#b5b5b5'
} as const

export type KindColorKey = keyof typeof KIND_COLOR
