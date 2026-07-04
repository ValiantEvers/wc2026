// =============================================================================
// data.js — World Cup 2026 Simulator: pure static data, ZERO logic.
//
// Sources (do not re-fetch — see repo BRIEF.md / DATA-VERIFIED.md):
//   - Elo + world rank: DATA-VERIFIED.md §2 (eloratings.net, live 30 May 2026).
//     This supersedes BRIEF.md §5.5's stale 19 Jan 2026 top-20 snapshot.
//   - Groups + full group calendar: BRIEF.md §5.2.
//   - Knockout structure / R32 slot logic / venues: BRIEF.md §5.3–5.4.
//   - Home advantage: DATA-VERIFIED.md §3 (+100 Elo, host at a venue in its own country).
//
// Match team references use FIFA/Elo codes (see TEAMS). The engine resolves
// codes -> team objects; keeping this file as plain literals preserves the
// "data layer has no logic" contract.
// =============================================================================

// eloratings.net fixed home-advantage adjustment (DATA-VERIFIED.md §3).
export const HOME_ADVANTAGE = 100;

// Host team code -> the venueCountry string that counts as "home" for that host.
// A host gets +HOME_ADVANTAGE only when the match venueCountry equals its value here.
export const HOST_COUNTRIES = {
  USA: 'USA',
  CAN: 'Canada',
  MEX: 'Mexico',
};

// -----------------------------------------------------------------------------
// 48 teams. Fields: name, code, confederation, group, elo, isHost.
// `worldRank` (DATA-VERIFIED.md §2) is also carried because the third-place
// ranking rule (BRIEF.md §5.4) uses world rank as a tiebreaker.
// isHost: true for USA, Canada, Mexico only.
// -----------------------------------------------------------------------------
export const TEAMS = [
  // Group A
  { name: 'Mexico',                 code: 'MEX', confederation: 'CONCACAF', group: 'A', elo: 1860, worldRank: 20, isHost: true },
  { name: 'South Africa',           code: 'RSA', confederation: 'CAF',      group: 'A', elo: 1524, worldRank: 79, isHost: false },
  { name: 'Korea Republic',         code: 'KOR', confederation: 'AFC',      group: 'A', elo: 1752, worldRank: 32, isHost: false },
  { name: 'Czechia',                code: 'CZE', confederation: 'UEFA',     group: 'A', elo: 1726, worldRank: 40, isHost: false },
  // Group B
  { name: 'Canada',                 code: 'CAN', confederation: 'CONCACAF', group: 'B', elo: 1784, worldRank: 25, isHost: true },
  { name: 'Bosnia and Herzegovina', code: 'BIH', confederation: 'UEFA',     group: 'B', elo: 1594, worldRank: 66, isHost: false },
  { name: 'Qatar',                  code: 'QAT', confederation: 'AFC',      group: 'B', elo: 1425, worldRank: 95, isHost: false },
  { name: 'Switzerland',            code: 'SUI', confederation: 'UEFA',     group: 'B', elo: 1889, worldRank: 16, isHost: false },
  // Group C
  { name: 'Brazil',                 code: 'BRA', confederation: 'CONMEBOL', group: 'C', elo: 1984, worldRank: 5,  isHost: false },
  { name: 'Morocco',                code: 'MAR', confederation: 'CAF',      group: 'C', elo: 1821, worldRank: 24, isHost: false },
  { name: 'Haiti',                  code: 'HAI', confederation: 'CONCACAF', group: 'C', elo: 1532, worldRank: 77, isHost: false },
  { name: 'Scotland',              code: 'SCO', confederation: 'UEFA',     group: 'C', elo: 1767, worldRank: 29, isHost: false },
  // Group D
  { name: 'United States',          code: 'USA', confederation: 'CONCACAF', group: 'D', elo: 1721, worldRank: 41, isHost: true },
  { name: 'Paraguay',               code: 'PAR', confederation: 'CONMEBOL', group: 'D', elo: 1833, worldRank: 22, isHost: false },
  { name: 'Australia',              code: 'AUS', confederation: 'AFC',      group: 'D', elo: 1783, worldRank: 26, isHost: false },
  { name: 'Türkiye',                code: 'TUR', confederation: 'UEFA',     group: 'D', elo: 1902, worldRank: 14, isHost: false },
  // Group E
  { name: 'Germany',                code: 'GER', confederation: 'UEFA',     group: 'E', elo: 1923, worldRank: 11, isHost: false },
  { name: 'Curaçao',                code: 'CUW', confederation: 'CONCACAF', group: 'E', elo: 1436, worldRank: 90, isHost: false },
  { name: 'Ivory Coast',            code: 'CIV', confederation: 'CAF',      group: 'E', elo: 1676, worldRank: 52, isHost: false },
  { name: 'Ecuador',                code: 'ECU', confederation: 'CONMEBOL', group: 'E', elo: 1933, worldRank: 9,  isHost: false },
  // Group F
  { name: 'Netherlands',            code: 'NED', confederation: 'UEFA',     group: 'F', elo: 1961, worldRank: 8,  isHost: false },
  { name: 'Japan',                  code: 'JPN', confederation: 'AFC',      group: 'F', elo: 1904, worldRank: 13, isHost: false },
  { name: 'Sweden',                 code: 'SWE', confederation: 'UEFA',     group: 'F', elo: 1719, worldRank: 43, isHost: false },
  { name: 'Tunisia',                code: 'TUN', confederation: 'CAF',      group: 'F', elo: 1636, worldRank: 58, isHost: false },
  // Group G
  { name: 'Belgium',                code: 'BEL', confederation: 'UEFA',     group: 'G', elo: 1867, worldRank: 19, isHost: false },
  { name: 'Egypt',                  code: 'EGY', confederation: 'CAF',      group: 'G', elo: 1689, worldRank: 51, isHost: false },
  { name: 'Iran',                   code: 'IRN', confederation: 'AFC',      group: 'G', elo: 1760, worldRank: 31, isHost: false },
  { name: 'New Zealand',            code: 'NZL', confederation: 'OFC',      group: 'G', elo: 1585, worldRank: 68, isHost: false },
  // Group H
  { name: 'Spain',                  code: 'ESP', confederation: 'UEFA',     group: 'H', elo: 2165, worldRank: 1,  isHost: false },
  { name: 'Cape Verde',             code: 'CPV', confederation: 'CAF',      group: 'H', elo: 1549, worldRank: 72, isHost: false },
  { name: 'Saudi Arabia',           code: 'KSA', confederation: 'AFC',      group: 'H', elo: 1568, worldRank: 71, isHost: false },
  { name: 'Uruguay',                code: 'URU', confederation: 'CONMEBOL', group: 'H', elo: 1892, worldRank: 15, isHost: false },
  // Group I
  { name: 'France',                 code: 'FRA', confederation: 'UEFA',     group: 'I', elo: 2081, worldRank: 3,  isHost: false },
  { name: 'Senegal',                code: 'SEN', confederation: 'CAF',      group: 'I', elo: 1878, worldRank: 17, isHost: false },
  { name: 'Iraq',                   code: 'IRQ', confederation: 'AFC',      group: 'I', elo: 1607, worldRank: 63, isHost: false },
  { name: 'Norway',                 code: 'NOR', confederation: 'UEFA',     group: 'I', elo: 1912, worldRank: 12, isHost: false },
  // Group J
  { name: 'Argentina',              code: 'ARG', confederation: 'CONMEBOL', group: 'J', elo: 2113, worldRank: 2,  isHost: false },
  { name: 'Algeria',                code: 'ALG', confederation: 'CAF',      group: 'J', elo: 1743, worldRank: 35, isHost: false },
  { name: 'Austria',                code: 'AUT', confederation: 'UEFA',     group: 'J', elo: 1827, worldRank: 23, isHost: false },
  { name: 'Jordan',                 code: 'JOR', confederation: 'AFC',      group: 'J', elo: 1690, worldRank: 50, isHost: false },
  // Group K
  { name: 'Portugal',               code: 'POR', confederation: 'UEFA',     group: 'K', elo: 1984, worldRank: 5,  isHost: false },
  { name: 'DR Congo',               code: 'COD', confederation: 'CAF',      group: 'K', elo: 1655, worldRank: 54, isHost: false },
  { name: 'Uzbekistan',             code: 'UZB', confederation: 'AFC',      group: 'K', elo: 1727, worldRank: 38, isHost: false },
  { name: 'Colombia',               code: 'COL', confederation: 'CONMEBOL', group: 'K', elo: 1975, worldRank: 7,  isHost: false },
  // Group L
  { name: 'England',                code: 'ENG', confederation: 'UEFA',     group: 'L', elo: 2020, worldRank: 4,  isHost: false },
  { name: 'Croatia',                code: 'CRO', confederation: 'UEFA',     group: 'L', elo: 1930, worldRank: 10, isHost: false },
  { name: 'Ghana',                  code: 'GHA', confederation: 'CAF',      group: 'L', elo: 1503, worldRank: 82, isHost: false },
  { name: 'Panama',                 code: 'PAN', confederation: 'CONCACAF', group: 'L', elo: 1737, worldRank: 36, isHost: false },
];

// -----------------------------------------------------------------------------
// 12 groups A–L, seeding positions 1–4 (BRIEF.md §5.2). Codes in seed order.
// -----------------------------------------------------------------------------
export const GROUPS = {
  A: ['MEX', 'RSA', 'KOR', 'CZE'],
  B: ['CAN', 'BIH', 'QAT', 'SUI'],
  C: ['BRA', 'MAR', 'HAI', 'SCO'],
  D: ['USA', 'PAR', 'AUS', 'TUR'],
  E: ['GER', 'CUW', 'CIV', 'ECU'],
  F: ['NED', 'JPN', 'SWE', 'TUN'],
  G: ['BEL', 'EGY', 'IRN', 'NZL'],
  H: ['ESP', 'CPV', 'KSA', 'URU'],
  I: ['FRA', 'SEN', 'IRQ', 'NOR'],
  J: ['ARG', 'ALG', 'AUT', 'JOR'],
  K: ['POR', 'COD', 'UZB', 'COL'],
  L: ['ENG', 'CRO', 'GHA', 'PAN'],
};

export const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// -----------------------------------------------------------------------------
// Full group-stage calendar (BRIEF.md §5.2). 72 matches, 6 per group.
// `a`/`b` are team codes (a = first-listed side). `venueCountry` drives home
// advantage and is one of 'USA' | 'Canada' | 'Mexico'.
// Times are Eastern, kept verbatim as display strings (engine ignores them).
// -----------------------------------------------------------------------------
export const GROUP_MATCHES = [
  // GROUP A
  { group: 'A', date: 'Thu Jun 11', kickoff: '3pm',  a: 'MEX', b: 'RSA', stadium: 'Estadio Azteca (Mexico City)',          venueCountry: 'Mexico' },
  { group: 'A', date: 'Thu Jun 11', kickoff: '10pm', a: 'KOR', b: 'CZE', stadium: 'Estadio Akron (Guadalajara)',           venueCountry: 'Mexico' },
  { group: 'A', date: 'Thu Jun 18', kickoff: '12pm', a: 'CZE', b: 'RSA', stadium: 'Mercedes-Benz Stadium (Atlanta)',       venueCountry: 'USA' },
  { group: 'A', date: 'Thu Jun 18', kickoff: '9pm',  a: 'MEX', b: 'KOR', stadium: 'Estadio Akron (Guadalajara)',           venueCountry: 'Mexico' },
  { group: 'A', date: 'Wed Jun 24', kickoff: '9pm',  a: 'CZE', b: 'MEX', stadium: 'Estadio Azteca (Mexico City)',          venueCountry: 'Mexico' },
  { group: 'A', date: 'Wed Jun 24', kickoff: '9pm',  a: 'RSA', b: 'KOR', stadium: 'Estadio BBVA (Monterrey)',              venueCountry: 'Mexico' },

  // GROUP B
  { group: 'B', date: 'Fri Jun 12', kickoff: '3pm',  a: 'CAN', b: 'BIH', stadium: 'BMO Field (Toronto)',                   venueCountry: 'Canada' },
  { group: 'B', date: 'Sat Jun 13', kickoff: '3pm',  a: 'QAT', b: 'SUI', stadium: "Levi's Stadium (Santa Clara)",         venueCountry: 'USA' },
  { group: 'B', date: 'Thu Jun 18', kickoff: '3pm',  a: 'SUI', b: 'BIH', stadium: 'SoFi Stadium (Inglewood)',             venueCountry: 'USA' },
  { group: 'B', date: 'Thu Jun 18', kickoff: '6pm',  a: 'CAN', b: 'QAT', stadium: 'BC Place (Vancouver)',                  venueCountry: 'Canada' },
  { group: 'B', date: 'Wed Jun 24', kickoff: '3pm',  a: 'SUI', b: 'CAN', stadium: 'BC Place (Vancouver)',                  venueCountry: 'Canada' },
  { group: 'B', date: 'Wed Jun 24', kickoff: '3pm',  a: 'BIH', b: 'QAT', stadium: 'Lumen Field (Seattle)',                 venueCountry: 'USA' },

  // GROUP C
  { group: 'C', date: 'Sat Jun 13', kickoff: '6pm',    a: 'BRA', b: 'MAR', stadium: 'MetLife Stadium (East Rutherford, NJ)', venueCountry: 'USA' },
  { group: 'C', date: 'Sat Jun 13', kickoff: '9pm',    a: 'HAI', b: 'SCO', stadium: 'Gillette Stadium (Foxboro, MA)',        venueCountry: 'USA' },
  { group: 'C', date: 'Fri Jun 19', kickoff: '6pm',    a: 'SCO', b: 'MAR', stadium: 'Gillette Stadium (Foxboro, MA)',        venueCountry: 'USA' },
  { group: 'C', date: 'Fri Jun 19', kickoff: '8:30pm', a: 'BRA', b: 'HAI', stadium: 'Lincoln Financial Field (Philadelphia)', venueCountry: 'USA' },
  { group: 'C', date: 'Wed Jun 24', kickoff: '6pm',    a: 'SCO', b: 'BRA', stadium: 'Hard Rock Stadium (Miami)',             venueCountry: 'USA' },
  { group: 'C', date: 'Wed Jun 24', kickoff: '6pm',    a: 'MAR', b: 'HAI', stadium: 'Mercedes-Benz Stadium (Atlanta)',       venueCountry: 'USA' },

  // GROUP D
  { group: 'D', date: 'Fri Jun 12', kickoff: '9pm',  a: 'USA', b: 'PAR', stadium: 'SoFi Stadium (Inglewood)',             venueCountry: 'USA' },
  { group: 'D', date: 'Sat Jun 13', kickoff: '12am', a: 'AUS', b: 'TUR', stadium: 'BC Place (Vancouver)',                  venueCountry: 'Canada' },
  { group: 'D', date: 'Fri Jun 19', kickoff: '3pm',  a: 'USA', b: 'AUS', stadium: 'Lumen Field (Seattle)',                 venueCountry: 'USA' },
  { group: 'D', date: 'Fri Jun 19', kickoff: '11pm', a: 'TUR', b: 'PAR', stadium: "Levi's Stadium (Santa Clara)",         venueCountry: 'USA' },
  { group: 'D', date: 'Thu Jun 25', kickoff: '10pm', a: 'TUR', b: 'USA', stadium: 'SoFi Stadium (Inglewood)',             venueCountry: 'USA' },
  { group: 'D', date: 'Thu Jun 25', kickoff: '10pm', a: 'PAR', b: 'AUS', stadium: "Levi's Stadium (Santa Clara)",         venueCountry: 'USA' },

  // GROUP E
  { group: 'E', date: 'Sun Jun 14', kickoff: '1pm', a: 'GER', b: 'CUW', stadium: 'NRG Stadium (Houston)',                 venueCountry: 'USA' },
  { group: 'E', date: 'Sun Jun 14', kickoff: '7pm', a: 'CIV', b: 'ECU', stadium: 'Lincoln Financial Field (Philadelphia)', venueCountry: 'USA' },
  { group: 'E', date: 'Sat Jun 20', kickoff: '4pm', a: 'GER', b: 'CIV', stadium: 'BMO Field (Toronto)',                   venueCountry: 'Canada' },
  { group: 'E', date: 'Sat Jun 20', kickoff: '8pm', a: 'ECU', b: 'CUW', stadium: 'Arrowhead Stadium (Kansas City)',       venueCountry: 'USA' },
  { group: 'E', date: 'Thu Jun 25', kickoff: '4pm', a: 'CUW', b: 'CIV', stadium: 'Lincoln Financial Field (Philadelphia)', venueCountry: 'USA' },
  { group: 'E', date: 'Thu Jun 25', kickoff: '4pm', a: 'ECU', b: 'GER', stadium: 'MetLife Stadium (East Rutherford, NJ)', venueCountry: 'USA' },

  // GROUP F
  { group: 'F', date: 'Sun Jun 14', kickoff: '4pm',  a: 'NED', b: 'JPN', stadium: 'AT&T Stadium (Arlington, TX)',         venueCountry: 'USA' },
  { group: 'F', date: 'Sun Jun 14', kickoff: '10pm', a: 'SWE', b: 'TUN', stadium: 'Estadio BBVA (Monterrey)',             venueCountry: 'Mexico' },
  { group: 'F', date: 'Sat Jun 20', kickoff: '1pm',  a: 'NED', b: 'SWE', stadium: 'NRG Stadium (Houston)',                venueCountry: 'USA' },
  { group: 'F', date: 'Sat Jun 20', kickoff: '12am', a: 'TUN', b: 'JPN', stadium: 'Estadio BBVA (Monterrey)',             venueCountry: 'Mexico' },
  { group: 'F', date: 'Thu Jun 25', kickoff: '7pm',  a: 'JPN', b: 'SWE', stadium: 'AT&T Stadium (Arlington, TX)',         venueCountry: 'USA' },
  { group: 'F', date: 'Thu Jun 25', kickoff: '7pm',  a: 'TUN', b: 'NED', stadium: 'Arrowhead Stadium (Kansas City)',      venueCountry: 'USA' },

  // GROUP G
  { group: 'G', date: 'Mon Jun 15', kickoff: '3pm',  a: 'BEL', b: 'EGY', stadium: 'Lumen Field (Seattle)',                venueCountry: 'USA' },
  { group: 'G', date: 'Mon Jun 15', kickoff: '9pm',  a: 'IRN', b: 'NZL', stadium: 'SoFi Stadium (Inglewood)',            venueCountry: 'USA' },
  { group: 'G', date: 'Sun Jun 21', kickoff: '3pm',  a: 'BEL', b: 'IRN', stadium: 'SoFi Stadium (Inglewood)',            venueCountry: 'USA' },
  { group: 'G', date: 'Sun Jun 21', kickoff: '9pm',  a: 'NZL', b: 'EGY', stadium: 'BC Place (Vancouver)',                 venueCountry: 'Canada' },
  { group: 'G', date: 'Fri Jun 26', kickoff: '11pm', a: 'EGY', b: 'IRN', stadium: 'Lumen Field (Seattle)',                venueCountry: 'USA' },
  { group: 'G', date: 'Fri Jun 26', kickoff: '11pm', a: 'NZL', b: 'BEL', stadium: 'BC Place (Vancouver)',                 venueCountry: 'Canada' },

  // GROUP H
  { group: 'H', date: 'Mon Jun 15', kickoff: '12pm', a: 'ESP', b: 'CPV', stadium: 'Mercedes-Benz Stadium (Atlanta)',      venueCountry: 'USA' },
  { group: 'H', date: 'Mon Jun 15', kickoff: '6pm',  a: 'KSA', b: 'URU', stadium: 'Hard Rock Stadium (Miami)',            venueCountry: 'USA' },
  { group: 'H', date: 'Sun Jun 21', kickoff: '12pm', a: 'ESP', b: 'KSA', stadium: 'Mercedes-Benz Stadium (Atlanta)',      venueCountry: 'USA' },
  { group: 'H', date: 'Sun Jun 21', kickoff: '6pm',  a: 'URU', b: 'CPV', stadium: 'Hard Rock Stadium (Miami)',            venueCountry: 'USA' },
  { group: 'H', date: 'Fri Jun 26', kickoff: '8pm',  a: 'CPV', b: 'KSA', stadium: 'NRG Stadium (Houston)',                venueCountry: 'USA' },
  { group: 'H', date: 'Fri Jun 26', kickoff: '8pm',  a: 'URU', b: 'ESP', stadium: 'Estadio Akron (Guadalajara)',          venueCountry: 'Mexico' },

  // GROUP I
  { group: 'I', date: 'Tue Jun 16', kickoff: '3pm', a: 'FRA', b: 'SEN', stadium: 'MetLife Stadium (East Rutherford, NJ)', venueCountry: 'USA' },
  { group: 'I', date: 'Tue Jun 16', kickoff: '6pm', a: 'IRQ', b: 'NOR', stadium: 'Gillette Stadium (Foxborough, MA)',     venueCountry: 'USA' },
  { group: 'I', date: 'Mon Jun 22', kickoff: '5pm', a: 'FRA', b: 'IRQ', stadium: 'Lincoln Financial Field (Philadelphia)', venueCountry: 'USA' },
  { group: 'I', date: 'Mon Jun 22', kickoff: '8pm', a: 'NOR', b: 'SEN', stadium: 'MetLife Stadium (East Rutherford, NJ)', venueCountry: 'USA' },
  { group: 'I', date: 'Fri Jun 26', kickoff: '3pm', a: 'NOR', b: 'FRA', stadium: 'Gillette Stadium (Foxborough, MA)',     venueCountry: 'USA' },
  { group: 'I', date: 'Fri Jun 26', kickoff: '3pm', a: 'SEN', b: 'IRQ', stadium: 'BMO Field (Toronto)',                   venueCountry: 'Canada' },

  // GROUP J
  { group: 'J', date: 'Tue Jun 16', kickoff: '9pm',  a: 'ARG', b: 'ALG', stadium: 'Arrowhead Stadium (Kansas City)',      venueCountry: 'USA' },
  { group: 'J', date: 'Tue Jun 16', kickoff: '12am', a: 'AUT', b: 'JOR', stadium: "Levi's Stadium (Santa Clara)",         venueCountry: 'USA' },
  { group: 'J', date: 'Mon Jun 22', kickoff: '1pm',  a: 'ARG', b: 'AUT', stadium: 'AT&T Stadium (Arlington, TX)',         venueCountry: 'USA' },
  { group: 'J', date: 'Mon Jun 22', kickoff: '11pm', a: 'JOR', b: 'ALG', stadium: "Levi's Stadium (Santa Clara)",         venueCountry: 'USA' },
  { group: 'J', date: 'Sat Jun 27', kickoff: '10pm', a: 'JOR', b: 'ARG', stadium: 'AT&T Stadium (Arlington, TX)',         venueCountry: 'USA' },
  { group: 'J', date: 'Sat Jun 27', kickoff: '10pm', a: 'ALG', b: 'AUT', stadium: 'Arrowhead Stadium (Kansas City)',      venueCountry: 'USA' },

  // GROUP K
  { group: 'K', date: 'Fri Jun 17', kickoff: '1pm',    a: 'POR', b: 'COD', stadium: 'NRG Stadium (Houston)',              venueCountry: 'USA' },
  { group: 'K', date: 'Fri Jun 17', kickoff: '10pm',   a: 'UZB', b: 'COL', stadium: 'Estadio Azteca (Mexico City)',       venueCountry: 'Mexico' },
  { group: 'K', date: 'Tue Jun 23', kickoff: '1pm',    a: 'POR', b: 'UZB', stadium: 'NRG Stadium (Houston)',              venueCountry: 'USA' },
  { group: 'K', date: 'Tue Jun 23', kickoff: '10pm',   a: 'COL', b: 'COD', stadium: 'Estadio Akron (Guadalajara)',        venueCountry: 'Mexico' },
  { group: 'K', date: 'Sat Jun 27', kickoff: '7:30pm', a: 'COL', b: 'POR', stadium: 'Hard Rock Stadium (Miami)',          venueCountry: 'USA' },
  { group: 'K', date: 'Sat Jun 27', kickoff: '7:30pm', a: 'COD', b: 'UZB', stadium: 'Mercedes-Benz Stadium (Atlanta)',    venueCountry: 'USA' },

  // GROUP L
  { group: 'L', date: 'Fri Jun 17', kickoff: '4pm', a: 'ENG', b: 'CRO', stadium: 'AT&T Stadium (Arlington, TX)',          venueCountry: 'USA' },
  { group: 'L', date: 'Fri Jun 17', kickoff: '7pm', a: 'GHA', b: 'PAN', stadium: 'BMO Field (Toronto)',                   venueCountry: 'Canada' },
  { group: 'L', date: 'Tue Jun 23', kickoff: '4pm', a: 'ENG', b: 'GHA', stadium: 'Gillette Stadium (Foxborough, MA)',     venueCountry: 'USA' },
  { group: 'L', date: 'Tue Jun 23', kickoff: '7pm', a: 'PAN', b: 'CRO', stadium: 'BMO Field (Toronto)',                   venueCountry: 'Canada' },
  { group: 'L', date: 'Sat Jun 27', kickoff: '5pm', a: 'PAN', b: 'ENG', stadium: 'MetLife Stadium (East Rutherford, NJ)', venueCountry: 'USA' },
  { group: 'L', date: 'Sat Jun 27', kickoff: '5pm', a: 'CRO', b: 'GHA', stadium: 'Lincoln Financial Field (Philadelphia)', venueCountry: 'USA' },
];

// -----------------------------------------------------------------------------
// Knockout structure.
//
// Slot encoding (resolved by the engine against group results):
//   { slot: 'W', group: 'A' } -> winner of group A
//   { slot: 'R', group: 'B' } -> runner-up of group B
//   { slot: 'T' }             -> a qualifying third-placer
//
// R32 matchups + venues are official (BRIEF.md §5.3). Which third fills a 'T'
// slot is decided entirely by the engine's assignThirdPlaces() (rank-and-assign,
// keyed by the match's group winner) — that is also where the "no same-group
// rematch" rule is enforced (a third never faces its own group's winner).
//
// Group winners receiving a third-placer: A, B, D, E, G, I, K, L (8 of them).
// Group winners facing runners-up: C, F, H, J. (BRIEF.md §5.4)
// -----------------------------------------------------------------------------
// FIFA match numbers 73–88 (regulations / Wikipedia knockout article), ordered
// by match number. Matchups + venues are official (BRIEF.md §5.3). The 8 'T'
// slots are filled by the engine's rank-and-assign logic, keyed by each match's
// group winner. Each entry's matchup is unchanged from the brief — only the id
// is now the FIFA match number, so the R16+ tree can reference winners by number.
export const KNOCKOUT_R32 = [
  { id: 'M73', date: 'Sun Jun 28', kickoff: '3pm',    a: { slot: 'R', group: 'A' }, b: { slot: 'R', group: 'B' }, stadium: 'SoFi Stadium (Inglewood)',             venueCountry: 'USA' },
  { id: 'M74', date: 'Mon Jun 29', kickoff: '4:30pm', a: { slot: 'W', group: 'E' }, b: { slot: 'T' }, stadium: 'Gillette Stadium (Boston)',  venueCountry: 'USA' },
  { id: 'M75', date: 'Mon Jun 29', kickoff: '9pm',    a: { slot: 'W', group: 'F' }, b: { slot: 'R', group: 'C' }, stadium: 'Estadio BBVA (Monterrey)',            venueCountry: 'Mexico' },
  { id: 'M76', date: 'Mon Jun 29', kickoff: '1pm',    a: { slot: 'W', group: 'C' }, b: { slot: 'R', group: 'F' }, stadium: 'NRG Stadium (Houston)',               venueCountry: 'USA' },
  { id: 'M77', date: 'Tue Jun 30', kickoff: '5pm',    a: { slot: 'W', group: 'I' }, b: { slot: 'T' }, stadium: 'MetLife Stadium (East Rutherford, NJ)', venueCountry: 'USA' },
  { id: 'M78', date: 'Tue Jun 30', kickoff: '1pm',    a: { slot: 'R', group: 'E' }, b: { slot: 'R', group: 'I' }, stadium: 'AT&T Stadium (Dallas)',               venueCountry: 'USA' },
  { id: 'M79', date: 'Tue Jun 30', kickoff: '9pm',    a: { slot: 'W', group: 'A' }, b: { slot: 'T' }, stadium: 'Estadio Azteca (Mexico City)', venueCountry: 'Mexico' },
  { id: 'M80', date: 'Wed Jul 1',  kickoff: '12pm',   a: { slot: 'W', group: 'L' }, b: { slot: 'T' }, stadium: 'Mercedes-Benz Stadium (Atlanta)', venueCountry: 'USA' },
  { id: 'M81', date: 'Wed Jul 1',  kickoff: '8pm',    a: { slot: 'W', group: 'D' }, b: { slot: 'T' }, stadium: "Levi's Stadium (SF Bay)", venueCountry: 'USA' },
  { id: 'M82', date: 'Wed Jul 1',  kickoff: '4pm',    a: { slot: 'W', group: 'G' }, b: { slot: 'T' }, stadium: 'Lumen Field (Seattle)',   venueCountry: 'USA' },
  { id: 'M83', date: 'Thu Jul 2',  kickoff: '7pm',    a: { slot: 'R', group: 'K' }, b: { slot: 'R', group: 'L' }, stadium: 'BMO Field (Toronto)',                 venueCountry: 'Canada' },
  { id: 'M84', date: 'Thu Jul 2',  kickoff: '3pm',    a: { slot: 'W', group: 'H' }, b: { slot: 'R', group: 'J' }, stadium: 'SoFi Stadium (Inglewood)',            venueCountry: 'USA' },
  { id: 'M85', date: 'Thu Jul 2',  kickoff: '11pm',   a: { slot: 'W', group: 'B' }, b: { slot: 'T' }, stadium: 'BC Place (Vancouver)',  venueCountry: 'Canada' },
  { id: 'M86', date: 'Fri Jul 3',  kickoff: '6pm',    a: { slot: 'W', group: 'J' }, b: { slot: 'R', group: 'H' }, stadium: 'Hard Rock Stadium (Miami)',           venueCountry: 'USA' },
  { id: 'M87', date: 'Fri Jul 3',  kickoff: '9:30pm', a: { slot: 'W', group: 'K' }, b: { slot: 'T' }, stadium: 'Arrowhead Stadium (Kansas City)', venueCountry: 'USA' },
  { id: 'M88', date: 'Fri Jul 3',  kickoff: '2pm',    a: { slot: 'R', group: 'D' }, b: { slot: 'R', group: 'G' }, stadium: 'AT&T Stadium (Dallas)',               venueCountry: 'USA' },
];

// -----------------------------------------------------------------------------
// Bracket beyond R32: R16 -> QF -> SF -> 3rd place -> Final.
//
// OFFICIAL FIXED TREE — FIFA match numbers 73–104 (tournament regulations /
// Wikipedia knockout article). The cross-bracket pairings are fixed and
// RESULT-INDEPENDENT. R16 winners CROSS (they do NOT pair sequentially); this
// is exactly what preserves the "top seeds in opposite halves" guarantee.
// Numbering: R32 = M73–M88, R16 = M89–M96, QF = M97–M100, SF = M101–M102,
// 3rd-place = match 103 (id 'THIRD'), final = match 104 (id 'FINAL'). THIRD and
// FINAL keep their names because the engine reads those two by name; every other
// match is keyed by its FIFA number.
//
// Half structure (sanity): SF M101 is fed by the winners of groups E, I, F, H,
// D, G; SF M102 by C, A, L, J, B, K. So Spain(H)+France(I) land in the M101 half
// and Argentina(J)+England(L) in the M102 half — #1/#2 split, #3/#4 split.
//
// Each slot: { from: <matchId>, take: 'winner' | 'loser' }. Match 103 takes the
// LOSERS of the two semifinals (so the engine must retain SF losers — it does).
//
// To swap in a different official source later, edit only this block — the engine
// is unaffected (same contract as the 495-row third-place table).
//
// NOTE: the bracket TREE is exact. R16/QF/SF venues come from the brief's venue
// pools (BRIEF.md §5.3); the exact match->venue assignment within a round is not
// published, so those stadium/date fields are best-effort display values.
// -----------------------------------------------------------------------------
export const KNOCKOUT_ROUNDS = [
  {
    round: 'R16',
    matches: [
      { id: 'M89', date: 'Sat Jul 4', a: { from: 'M74', take: 'winner' }, b: { from: 'M77', take: 'winner' }, stadium: 'NRG Stadium (Houston)',                 venueCountry: 'USA' },
      { id: 'M90', date: 'Sat Jul 4', a: { from: 'M73', take: 'winner' }, b: { from: 'M75', take: 'winner' }, stadium: 'Lincoln Financial Field (Philadelphia)', venueCountry: 'USA' },
      { id: 'M91', date: 'Sun Jul 5', a: { from: 'M76', take: 'winner' }, b: { from: 'M78', take: 'winner' }, stadium: 'MetLife Stadium (East Rutherford, NJ)',  venueCountry: 'USA' },
      { id: 'M92', date: 'Sun Jul 5', a: { from: 'M79', take: 'winner' }, b: { from: 'M80', take: 'winner' }, stadium: 'Estadio Azteca (Mexico City)',           venueCountry: 'Mexico' },
      { id: 'M93', date: 'Mon Jul 6', a: { from: 'M83', take: 'winner' }, b: { from: 'M84', take: 'winner' }, stadium: 'AT&T Stadium (Dallas)',                  venueCountry: 'USA' },
      { id: 'M94', date: 'Mon Jul 6', a: { from: 'M81', take: 'winner' }, b: { from: 'M82', take: 'winner' }, stadium: 'Lumen Field (Seattle)',                  venueCountry: 'USA' },
      { id: 'M95', date: 'Tue Jul 7', a: { from: 'M86', take: 'winner' }, b: { from: 'M88', take: 'winner' }, stadium: 'Mercedes-Benz Stadium (Atlanta)',        venueCountry: 'USA' },
      { id: 'M96', date: 'Tue Jul 7', a: { from: 'M85', take: 'winner' }, b: { from: 'M87', take: 'winner' }, stadium: 'BC Place (Vancouver)',                   venueCountry: 'Canada' },
    ],
  },
  {
    round: 'QF',
    matches: [
      { id: 'M97',  date: 'Thu Jul 9',  a: { from: 'M89', take: 'winner' }, b: { from: 'M90', take: 'winner' }, stadium: 'Gillette Stadium (Boston)',       venueCountry: 'USA' },
      { id: 'M98',  date: 'Fri Jul 10', a: { from: 'M93', take: 'winner' }, b: { from: 'M94', take: 'winner' }, stadium: 'SoFi Stadium (Inglewood)',        venueCountry: 'USA' },
      { id: 'M99',  date: 'Sat Jul 11', a: { from: 'M91', take: 'winner' }, b: { from: 'M92', take: 'winner' }, stadium: 'Hard Rock Stadium (Miami)',       venueCountry: 'USA' },
      { id: 'M100', date: 'Sat Jul 11', a: { from: 'M95', take: 'winner' }, b: { from: 'M96', take: 'winner' }, stadium: 'Arrowhead Stadium (Kansas City)', venueCountry: 'USA' },
    ],
  },
  {
    round: 'SF',
    matches: [
      { id: 'M101', date: 'Tue Jul 14', a: { from: 'M97', take: 'winner' }, b: { from: 'M98',  take: 'winner' }, stadium: 'AT&T Stadium (Dallas)',           venueCountry: 'USA' },
      { id: 'M102', date: 'Wed Jul 15', a: { from: 'M99', take: 'winner' }, b: { from: 'M100', take: 'winner' }, stadium: 'Mercedes-Benz Stadium (Atlanta)', venueCountry: 'USA' },
    ],
  },
  {
    round: 'THIRD',
    matches: [
      // FIFA match 103 — losers of the two semifinals.
      { id: 'THIRD', date: 'Sat Jul 18', kickoff: '5pm', a: { from: 'M101', take: 'loser' }, b: { from: 'M102', take: 'loser' }, stadium: 'Hard Rock Stadium (Miami)', venueCountry: 'USA' },
    ],
  },
  {
    round: 'FINAL',
    matches: [
      // FIFA match 104 — winners of the two semifinals.
      { id: 'FINAL', date: 'Sun Jul 19', kickoff: '3pm', a: { from: 'M101', take: 'winner' }, b: { from: 'M102', take: 'winner' }, stadium: 'MetLife Stadium (East Rutherford, NJ)', venueCountry: 'USA' },
    ],
  },
];

// Target mean total goals per match (BRIEF.md §4 / build spec). Used by the
// engine's calibration; exported so tests can assert against the same constant.
export const TARGET_MEAN_TOTAL_GOALS = 2.7;
