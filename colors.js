// =============================================================================
// colors.js — per-team broadcast palette. PURE ADDITIVE DATA, zero logic.
//
// Not consumed by engine.js and not part of the engine's data contract — this
// is a UI-only concern (ui.js reads it to tint rows/cards). Each entry is the
// team's primary + secondary kit/flag colour, keyed by FIFA/Elo code (see
// data.js TEAMS). Used as accents only; data text always sits on the dark
// panel for contrast, so these never need to be individually legible.
//
// Where a nation's real second colour is white, white is kept — it reads as a
// crisp thin accent on the dark base.
// =============================================================================

export const TEAM_COLORS = {
  // Group A
  MEX: { primary: '#0B6E4F', secondary: '#E03A3E' }, // green / red
  RSA: { primary: '#007A4D', secondary: '#FFB915' }, // green / gold
  KOR: { primary: '#C8102E', secondary: '#0047A0' }, // red / blue
  CZE: { primary: '#D7141A', secondary: '#11457E' }, // red / blue
  // Group B
  CAN: { primary: '#FF1A1A', secondary: '#FFFFFF' }, // red / white
  BIH: { primary: '#1F4FA0', secondary: '#FFD100' }, // blue / yellow
  QAT: { primary: '#8A1538', secondary: '#FFFFFF' }, // maroon / white
  SUI: { primary: '#E1241B', secondary: '#FFFFFF' }, // red / white
  // Group C
  BRA: { primary: '#FFDF00', secondary: '#1CA64C' }, // yellow / green
  MAR: { primary: '#C1272D', secondary: '#0B7A3B' }, // red / green
  HAI: { primary: '#1B3FB0', secondary: '#D21034' }, // blue / red
  SCO: { primary: '#0061B0', secondary: '#FFFFFF' }, // navy-blue / white
  // Group D
  USA: { primary: '#1E3A8A', secondary: '#D7282F' }, // navy / red
  PAR: { primary: '#D52B1E', secondary: '#1B4F9C' }, // red / blue
  AUS: { primary: '#0A8A43', secondary: '#FFCD00' }, // green / gold
  TUR: { primary: '#E30A17', secondary: '#FFFFFF' }, // red / white
  // Group E
  GER: { primary: '#EDEDED', secondary: '#FFCE00' }, // white kit / gold
  CUW: { primary: '#00247D', secondary: '#FFD100' }, // blue / yellow
  CIV: { primary: '#FF8200', secondary: '#0A9E60' }, // orange / green
  ECU: { primary: '#FFD100', secondary: '#0072CE' }, // yellow / blue
  // Group F
  NED: { primary: '#EC6500', secondary: '#FFFFFF' }, // orange / white
  JPN: { primary: '#15317E', secondary: '#FFFFFF' }, // samurai blue / white
  SWE: { primary: '#FFCD00', secondary: '#1B6CB0' }, // yellow / blue
  TUN: { primary: '#E70013', secondary: '#FFFFFF' }, // red / white
  // Group G
  BEL: { primary: '#E30613', secondary: '#FFD800' }, // red / gold
  EGY: { primary: '#CE1126', secondary: '#FFFFFF' }, // red / white
  IRN: { primary: '#1F9E45', secondary: '#DA0000' }, // green / red
  NZL: { primary: '#E6E6E6', secondary: '#7E8285' }, // white / silver
  // Group H
  ESP: { primary: '#C60B1E', secondary: '#FFC400' }, // red / gold
  CPV: { primary: '#1B3A93', secondary: '#CF2027' }, // blue / red
  KSA: { primary: '#0A6C35', secondary: '#FFFFFF' }, // green / white
  URU: { primary: '#4E9BD6', secondary: '#001489' }, // celeste / navy
  // Group I
  FRA: { primary: '#1A3A8F', secondary: '#ED2939' }, // blue / red
  SEN: { primary: '#0A853F', secondary: '#FDEF42' }, // green / yellow
  IRQ: { primary: '#1F8A4C', secondary: '#FFFFFF' }, // green / white
  NOR: { primary: '#BA0C2F', secondary: '#00205B' }, // red / navy
  // Group J
  ARG: { primary: '#75AADB', secondary: '#F6B40E' }, // sky blue / sun-gold
  ALG: { primary: '#0A6233', secondary: '#D21034' }, // green / red
  AUT: { primary: '#ED2939', secondary: '#FFFFFF' }, // red / white
  JOR: { primary: '#0A7A3D', secondary: '#CE1126' }, // green / red
  // Group K
  POR: { primary: '#C8102E', secondary: '#0A6600' }, // red / green
  COD: { primary: '#0099B5', secondary: '#F7D618' }, // sky blue / yellow
  UZB: { primary: '#1EB53A', secondary: '#0099B5' }, // green / blue
  COL: { primary: '#FCD116', secondary: '#1B3A93' }, // yellow / blue
  // Group L
  ENG: { primary: '#EDEDED', secondary: '#CE1124' }, // white kit / red cross
  CRO: { primary: '#D10000', secondary: '#1D4F91' }, // red / blue
  GHA: { primary: '#0A6B3F', secondary: '#FCD116' }, // green / gold
  PAN: { primary: '#DA121A', secondary: '#005293' }, // red / blue
};
