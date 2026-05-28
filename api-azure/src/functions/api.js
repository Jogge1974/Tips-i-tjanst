const { app } = require('@azure/functions');
const mysql = require('mysql2/promise');
const fetch = require('node-fetch');

// Database config
// Set DB_NAME in Azure Function App > Settings > Environment variables
// PROD: 'liveidrott_se_db' | TEST: 'liveidrott_se_db_test'
const dbConfig = {
    host: 'mysql76.unoeuro.com',
    user: 'liveidrott_se',
    password: 'kd4EawG2znc6hpBRHF5m',
    database: process.env.DB_NAME || 'liveidrott_se_db_test',
    waitForConnections: true,
    connectionLimit: 10
};

// Svenska Spel API
const SVENSKA_SPEL_BASE = 'https://api.www.svenskaspel.se/external/1/draw/stryktipset/';
const SVENSKA_SPEL_KEY = '45c5fc62-8386-4e59-b8ab-06b7f10f505d';

let pool = null;

function getPool() {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
    }
    return pool;
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
}

function jsonResponse(data, status = 200) {
    return {
        status,
        headers: corsHeaders(),
        body: JSON.stringify(data)
    };
}

// Determine if game is open: 0=closed, 1=tips open, 2=garderingar open
async function speletOppet(connection) {
    const [adminRows] = await connection.query('SELECT speletOppet FROM TIT_admin LIMIT 1');
    if (!adminRows.length || adminRows[0].speletOppet === 0) return 0;

    const now = new Date();
    // Swedish time = UTC+2 (summer) / UTC+1 (winter)
    const sweHour = now.getUTCHours() + 2;
    const sweDay = new Date(now.getTime() + 2 * 60 * 60 * 1000).getDay(); // 0=Sun, 4=Thu

    // Thursday after 12:00 Swedish → garderingar open
    if (sweDay === 4 && sweHour >= 12) {
        return 2;
    }
    // Friday-Saturday-Sunday → garderingar open
    if (sweDay === 5 || sweDay === 6 || sweDay === 0) {
        return 2;
    }

    return 1; // Monday-Thursday before 12: tips open
}

// GET USERS
async function getUsers() {
    const db = getPool();
    const [rows] = await db.query('SELECT id, fornamn, efternamn, userType FROM TIT_TipsTjanst ORDER BY fornamn');
    return jsonResponse(rows);
}

// LOGIN
async function login(body) {
    const { userId, password } = body;
    if (!userId || !password) {
        return jsonResponse({ success: false, error: 'Saknar userId eller password' });
    }
    const db = getPool();
    const [rows] = await db.query('SELECT id, fornamn, efternamn, userType, pwd FROM TIT_TipsTjanst WHERE id = ?', [userId]);
    if (!rows.length) {
        return jsonResponse({ success: false, error: 'Användaren finns inte' });
    }
    const user = rows[0];
    if (user.pwd !== password) {
        return jsonResponse({ success: false, error: 'Fel lösenord' });
    }
    return jsonResponse({ success: true, user: { id: user.id, fornamn: user.fornamn, efternamn: user.efternamn, userType: user.userType } });
}

// GET STATUS
async function getStatus() {
    const db = getPool();
    const connection = db;
    const status = await speletOppet(connection);
    const [ekoRows] = await db.query('SELECT spelomgang, isSlutspel, antalRatt FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : '';
    const isSlutspel = ekoRows.length ? ekoRows[0].isSlutspel : 0;
    const antalRatt = ekoRows.length ? ekoRows[0].antalRatt : 0;
    return jsonResponse({ speletOppet: status, spelomgang, isSlutspel, antalRatt });
}

// GET MY MATCH - get the match assigned to a user for tipping
async function getMyMatch(query) {
    const userId = query.userId;
    if (!userId) return jsonResponse({ error: 'Saknar userId' }, 400);

    const db = getPool();
    const [ekoRows] = await db.query('SELECT spelomgang FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : '';

    // Get which match this user is responsible for
    const [lottning] = await db.query(
        'SELECT matchNr FROM TIT_lottning WHERE spelomgang = ? AND ansvarigId = ?',
        [spelomgang, userId]
    );
    if (!lottning.length) return jsonResponse(null);

    const matchNr = lottning[0].matchNr;

    // Get match info from kupong view
    const [kupong] = await db.query(
        'SELECT * FROM TITVIEWomgangInfo WHERE spelomgang = ? AND matchNr = ?',
        [spelomgang, matchNr]
    );

    // Get posted sign from tipsrad
    const [tipsrad] = await db.query(
        'SELECT tecken FROM TIT_tipsrad WHERE spelomgang = ? AND matchNr = ? AND ansvarigId = ?',
        [spelomgang, matchNr, userId]
    );

    const matchInfo = kupong.length ? kupong[0] : { matchNr, lag: '', liga: '', spelomgang };
    if (tipsrad.length && tipsrad[0].tecken) {
        const t = tipsrad[0].tecken;
        matchInfo.etta = t === '1' ? '1' : '0';
        matchInfo.kryss = t === 'X' ? '1' : '0';
        matchInfo.tvaa = t === '2' ? '1' : '0';
    }

    return jsonResponse(matchInfo);
}

// GET KUPONG - get the current round's coupon
async function getKupong() {
    const db = getPool();
    const [ekoRows] = await db.query('SELECT spelomgang FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : '';

    const [rows] = await db.query(
        'SELECT * FROM TITVIEWomgangInfo WHERE spelomgang = ? ORDER BY matchNr',
        [spelomgang]
    );
    return jsonResponse(rows);
}

// SAVE TIPS
async function saveTips(body) {
    const { userId, tecken } = body;
    if (!userId || !tecken) {
        return jsonResponse({ error: 'Saknar data' }, 400);
    }

    const db = getPool();

    const [ekoRows] = await db.query('SELECT spelomgang, isSlutspel FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : '';
    const isSlutspel = ekoRows.length ? ekoRows[0].isSlutspel : 0;

    // Check if game is open for tips
    const status = await speletOppet(db);
    if (status !== 1) {
        return jsonResponse({ error: 'Spelet är inte öppet för tips' }, 403);
    }

    // Find user's assigned match
    const [lottning] = await db.query(
        'SELECT matchNr FROM TIT_lottning WHERE spelomgang = ? AND ansvarigId = ?',
        [spelomgang, userId]
    );
    if (!lottning.length) {
        return jsonResponse({ error: 'Ingen match tilldelad' }, 404);
    }
    const matchNr = lottning[0].matchNr;

    // Save or update tip
    const [existing] = await db.query(
        'SELECT matchNr FROM TIT_tipsrad WHERE spelomgang = ? AND matchNr = ? AND ansvarigId = ?',
        [spelomgang, matchNr, userId]
    );
    if (existing.length) {
        await db.query(
            'UPDATE TIT_tipsrad SET tecken = ? WHERE spelomgang = ? AND matchNr = ? AND ansvarigId = ?',
            [tecken, spelomgang, matchNr, userId]
        );
    } else {
        await db.query(
            'INSERT INTO TIT_tipsrad (spelomgang, matchNr, tecken, poangGrund, ansvarigId, slutspel) VALUES (?, ?, ?, 0, ?, ?)',
            [spelomgang, matchNr, tecken, userId, isSlutspel]
        );
    }

    return jsonResponse({ success: true });
}

// GET GARDERINGAR
async function getGarderingar(query) {
    const userId = query.userId;
    const db = getPool();
    const [ekoRows] = await db.query('SELECT spelomgang FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : '';

    const [rows] = await db.query(
        'SELECT matchNr, tecken FROM TIT_garderingar WHERE omgang = ? AND id = ? ORDER BY matchNr',
        [spelomgang, userId]
    );
    return jsonResponse(rows);
}

// SAVE GARDERINGAR
async function saveGarderingar(body) {
    const { userId, garderingar } = body;
    if (!userId || !garderingar) {
        return jsonResponse({ error: 'Saknar data' }, 400);
    }

    const db = getPool();

    // Check status
    const status = await speletOppet(db);
    if (status !== 2) {
        return jsonResponse({ error: 'Spelet är inte öppet för garderingar' }, 403);
    }

    const [ekoRows] = await db.query('SELECT spelomgang FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : '';

    // Delete existing garderingar for this user/round
    await db.query('DELETE FROM TIT_garderingar WHERE omgang = ? AND id = ?', [spelomgang, userId]);

    // Insert new garderingar
    for (const g of garderingar) {
        const { matchNr, tecken } = g;
        await db.query(
            'INSERT INTO TIT_garderingar (omgang, id, matchNr, tecken) VALUES (?, ?, ?, ?)',
            [spelomgang, userId, matchNr, tecken]
        );
    }

    return jsonResponse({ success: true });
}

// GET LIVE DRAW - from Svenska Spel API (combines draw info + forecast)
async function getLiveDraw() {
    try {
        // Get drawNumber from TIT_ekonomi (senaste omgång)
        const db = getPool();
        const [ekoRows] = await db.query('SELECT drawNumber FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
        const drawNumber = ekoRows.length && ekoRows[0].drawNumber ? ekoRows[0].drawNumber : null;

        if (!drawNumber) {
            return jsonResponse({ drawNumber: null, drawState: 'None', events: [] });
        }

        // Fetch draw info (league, sportEventStart, odds)
        let url = `${SVENSKA_SPEL_BASE}draws/${drawNumber}?accesskey=${SVENSKA_SPEL_KEY}`;
        let response = await fetch(url);
        const drawData = await response.json();
        const drawInfo = drawData.draw || {};
        const drawEvents = drawInfo.events || [];

        // Fetch forecast (live results)
        url = `${SVENSKA_SPEL_BASE}draws/${drawNumber}/forecast?accesskey=${SVENSKA_SPEL_KEY}`;
        response = await fetch(url);
        let data = await response.json();
        const forecast = data.forecast;

        // If forecast is available, merge with draw info
        if (forecast && forecast.events && forecast.events.length > 0) {
            const events = forecast.events.map((e, idx) => {
                const drawEvent = drawEvents[idx] || {};
                const parts = e.description ? e.description.split('-') : ['', ''];
                const scoreParts = e.outcomeScore ? e.outcomeScore.split('-') : null;
                const outcomes = scoreParts ? { home: scoreParts[0], draw: '0', away: scoreParts[1] } : null;

                return {
                    eventNumber: e.eventNumber,
                    description: e.description,
                    home: parts[0] ? parts[0].trim() : '',
                    away: parts.slice(1).join('-').trim(),
                    league: drawEvent.league ? (drawEvent.league.name || '') : '',
                    sportEventStart: drawEvent.sportEventStart || '',
                    sportEventStatus: e.sportEventStatus || (e.isFinished ? 'Avslutad' : 'Inte startat'),
                    outcomes,
                    odds: drawEvent.odds || null,
                };
            });

            return jsonResponse({
                drawNumber: forecast.drawNumber,
                drawComment: drawInfo.drawComment || '',
                drawState: forecast.events.every(e => e.isFinished) ? 'Finalized' : 'Live',
                closeTime: forecast.closeTime || drawInfo.closeTime,
                turnover: forecast.turnover,
                distribution: forecast.distribution || [],
                events,
            });
        }

        // Fallback: no forecast yet, use draw data to show upcoming matches
        if (drawEvents.length > 0) {
            const events = drawEvents.map((de, idx) => {
                const parts = de.description ? de.description.split('-') : ['', ''];
                return {
                    eventNumber: idx + 1,
                    description: de.description || '',
                    home: parts[0] ? parts[0].trim() : '',
                    away: parts.slice(1).join('-').trim(),
                    league: de.league ? (de.league.name || '') : '',
                    sportEventStart: de.sportEventStart || '',
                    sportEventStatus: 'Inte startat',
                    outcomes: null,
                    odds: de.odds || null,
                };
            });

            return jsonResponse({
                drawNumber,
                drawComment: drawInfo.drawComment || '',
                drawState: 'Upcoming',
                closeTime: drawInfo.closeTime || '',
                turnover: '0',
                distribution: [],
                events,
            });
        }

        return jsonResponse({ drawNumber, drawState: 'Unknown', events: [] });
    } catch (err) {
        return jsonResponse({ error: 'Kunde inte hämta från Svenska Spel', details: err.message }, 500);
    }
}

// GET LIVE RESULT - from Svenska Spel API
async function getLiveResult(query) {
    const drawNumber = query.drawNumber;
    if (!drawNumber) {
        return jsonResponse({ error: 'Saknar drawNumber' }, 400);
    }
    try {
        const url = `${SVENSKA_SPEL_BASE}${drawNumber}/result?accesskey=${SVENSKA_SPEL_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        return jsonResponse(data);
    } catch (err) {
        return jsonResponse({ error: 'Kunde inte hämta resultat', details: err.message }, 500);
    }
}

// GET SYSTEM ROWS
async function getSystemRows(query) {
    const drawNumber = query.drawNumber;
    if (!drawNumber) {
        return jsonResponse({ error: 'Saknar drawNumber' }, 400);
    }
    const db = getPool();
    const [rows] = await db.query(
        'SELECT radNr, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13 FROM TIT_systemrader WHERE drawNumber = ? ORDER BY radNr',
        [drawNumber]
    );
    return jsonResponse(rows);
}

// ESPN league code mapping
const LEAGUE_MAP = {
    'premier league': 'eng.1',
    'championship': 'eng.2',
    'league one': 'eng.3',
    'league two': 'eng.4',
    'la liga': 'esp.1',
    'segunda division': 'esp.2',
    'serie a': 'ita.1',
    'serie b': 'ita.2',
    'bundesliga': 'ger.1',
    '2. bundesliga': 'ger.2',
    'ligue 1': 'fra.1',
    'ligue 2': 'fra.2',
    'eredivisie': 'ned.1',
    'allsvenskan': 'swe.1',
    'superettan': 'swe.2',
    'eliteserien': 'nor.1',
    'obos-ligaen': 'nor.2',
    'superligaen': 'den.1',
    'brasileiro serie a': 'bra.1',
    'brasileiro serie b': 'bra.2',
    'primeira liga': 'por.1',
    'super lig': 'tur.1',
    'super league': 'gre.1',
    'scottish premiership': 'sco.1',
    'scottish championship': 'sco.2',
    'bundesliga, österrike': 'aut.1',
    'super league, schweiz': 'sui.1',
    'jupiler pro league': 'bel.1',
    'premier league, ryssland': 'rus.1',
    'primera division': 'arg.1',
    'liga mx': 'mex.1',
    'mls': 'usa.1',
    'liga betplay': 'col.1',
    'primera division, chile': 'chi.1',
    'j-league': 'jpn.1',
    'league of ireland': 'irl.1',
    'liga 1': 'rou.1',
    'czech first league': 'cze.1',
    'chinese super league': 'chn.1',
};

// TheSportsDB fallback for leagues ESPN doesn't cover
// Free tier returns top 5 teams only
const THESPORTSDB_MAP = {
    'veikkausliiga': '4636',
    'superettan': '4403',
    'ettan, sverige': ['4674', '4845'],  // North + South - search both
    'division 1, norra': '4674',
    'division 1, södra': '4845',
    'division 1 norra': '4674',
    'division 1 södra': '4845',
};

const standingsCache = {};

async function getMatchAnalysis(query) {
    const { league, home, away } = query;
    if (!league || !home || !away) {
        return jsonResponse({ error: 'Saknar league, home eller away' }, 400);
    }

    const leagueKey = league.toLowerCase();
    const espnLeague = LEAGUE_MAP[leagueKey];

    // Try ESPN first
    if (espnLeague) {
        const cacheKey = espnLeague;
        const now = Date.now();
        let espnResult = null;
        if (standingsCache[cacheKey] && (now - standingsCache[cacheKey].time) < 15 * 60 * 1000) {
            espnResult = await buildAnalysisResponse(standingsCache[cacheKey].data, home, away, league, espnLeague);
        } else {
            try {
                const url = `https://site.api.espn.com/apis/v2/sports/soccer/${espnLeague}/standings`;
                const resp = await fetch(url);
                if (resp.ok) {
                    const data = await resp.json();
                    standingsCache[cacheKey] = { data, time: now };
                    espnResult = await buildAnalysisResponse(data, home, away, league, espnLeague);
                }
            } catch (err) { /* fall through to TheSportsDB */ }
        }
        // If ESPN returned data with standings, use it
        if (espnResult) {
            const body = JSON.parse(espnResult.body);
            if (body.standings && body.standings.length > 0) {
                return espnResult;
            }
        }
    }

    // Fallback to TheSportsDB
    const sportsDbId = THESPORTSDB_MAP[leagueKey];
    if (sportsDbId) {
        return getMatchAnalysisFromTheSportsDB(sportsDbId, home, away, league);
    }

    return jsonResponse({ home: null, away: null, league, error: 'Liga ej mappad' });
}

async function getTeamForm(teamId, espnLeague) {
    try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/teams/${teamId}/schedule?season=2025`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (!data.events) return null;

        // Get last 5 completed matches (ESPN returns newest first)
        const completed = data.events.filter(e =>
            e.competitions && e.competitions[0] && e.competitions[0].status &&
            e.competitions[0].status.type && e.competitions[0].status.type.completed
        );
        const last5 = completed.slice(0, 5);

        return last5.map(e => {
            const comp = e.competitions[0];
            const homeTeam = comp.competitors.find(c => c.homeAway === 'home');
            const awayTeam = comp.competitors.find(c => c.homeAway === 'away');
            const isHome = homeTeam && homeTeam.id === String(teamId);
            const myScore = isHome ? parseInt(homeTeam.score.displayValue) : parseInt(awayTeam.score.displayValue);
            const oppScore = isHome ? parseInt(awayTeam.score.displayValue) : parseInt(homeTeam.score.displayValue);
            let result = 'O';
            if (myScore > oppScore) result = 'V';
            else if (myScore < oppScore) result = 'F';
            return {
                result,
                score: `${homeTeam.score.displayValue}-${awayTeam.score.displayValue}`,
                opponent: isHome ? (awayTeam.team.shortDisplayName || awayTeam.team.abbreviation) : (homeTeam.team.shortDisplayName || homeTeam.team.abbreviation),
                isHome,
            };
        });
    } catch {
        return null;
    }
}

// TheSportsDB fallback for leagues ESPN doesn't cover
async function getMatchAnalysisFromTheSportsDB(leagueIds, home, away, league) {
    const ids = Array.isArray(leagueIds) ? leagueIds : [leagueIds];
    const now = Date.now();
    // Keep entries per group so we can separate them
    const groupEntries = []; // [{id, entries: [...]}]

    for (const id of ids) {
        const cacheKey = `tsdb_${id}`;
        if (standingsCache[cacheKey] && (now - standingsCache[cacheKey].time) < 30 * 60 * 1000) {
            groupEntries.push({ id, entries: standingsCache[cacheKey].data });
            continue;
        }
        try {
            const year = new Date().getFullYear();
            const url = `https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${id}&s=${year}`;
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const data = await resp.json();
            if (data.table && data.table.length) {
                standingsCache[cacheKey] = { data: data.table, time: now };
                groupEntries.push({ id, entries: data.table });
            }
        } catch { /* ignore */ }
    }

    if (!groupEntries.length) {
        return jsonResponse({ home: null, away: null, league, error: 'Ingen tabelldata hittad' });
    }

    // If multiple groups, find the one containing the home team
    let allEntries;
    if (groupEntries.length > 1) {
        function normalizeForSearch(str) {
            return str.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        }
        const homeNorm = normalizeForSearch(home);
        // Find the group that contains the home team
        let matchedGroup = null;
        for (const group of groupEntries) {
            const found = group.entries.some(e => {
                const tn = normalizeForSearch(e.strTeam);
                return tn === homeNorm || tn.includes(homeNorm) || homeNorm.includes(tn);
            });
            if (found) { matchedGroup = group; break; }
        }
        // Fuzzy fallback: check word overlap
        if (!matchedGroup) {
            const homeWords = homeNorm.split(/[\s-]+/).filter(w => w.length > 2);
            for (const group of groupEntries) {
                const found = group.entries.some(e => {
                    const tn = normalizeForSearch(e.strTeam);
                    return homeWords.some(w => tn.includes(w));
                });
                if (found) { matchedGroup = group; break; }
            }
        }
        allEntries = matchedGroup ? matchedGroup.entries : groupEntries[0].entries;
    } else {
        allEntries = groupEntries[0].entries;
    }

    function normalize(str) {
        return str.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function findTeam(name) {
        const s = normalize(name);
        let entry = allEntries.find(e => normalize(e.strTeam) === s);
        if (!entry) entry = allEntries.find(e =>
            normalize(e.strTeam).includes(s) || s.includes(normalize(e.strTeam))
        );
        if (!entry) {
            const words = s.split(/[\s-]+/).filter(w => w.length > 2);
            let best = null, bestScore = 0;
            for (const e of allEntries) {
                const tn = normalize(e.strTeam);
                const score = words.filter(w => tn.includes(w)).length;
                if (score > bestScore) { bestScore = score; best = e; }
            }
            if (best && bestScore > 0) entry = best;
        }
        if (!entry) return null;

        return {
            name: entry.strTeam,
            logo: entry.strBadge || null,
            position: parseInt(entry.intRank) || null,
            points: parseInt(entry.intPoints) || 0,
            played: parseInt(entry.intPlayed) || 0,
            wins: parseInt(entry.intWin) || 0,
            draws: parseInt(entry.intDraw) || 0,
            losses: parseInt(entry.intLoss) || 0,
            goalsFor: parseInt(entry.intGoalsFor) || 0,
            goalsAgainst: parseInt(entry.intGoalsAgainst) || 0,
            form: entry.strForm ? entry.strForm.split('').map(c => {
                if (c === 'W') return { result: 'V' };
                if (c === 'L') return { result: 'F' };
                return { result: 'O' };
            }) : null,
        };
    }

    const homeTeam = findTeam(home);
    const awayTeam = findTeam(away);

    const standings = allEntries
        .map(e => ({
            name: e.strTeam,
            position: parseInt(e.intRank) || 99,
            played: parseInt(e.intPlayed) || 0,
            wins: parseInt(e.intWin) || 0,
            draws: parseInt(e.intDraw) || 0,
            losses: parseInt(e.intLoss) || 0,
            goalsFor: parseInt(e.intGoalsFor) || 0,
            goalsAgainst: parseInt(e.intGoalsAgainst) || 0,
            points: parseInt(e.intPoints) || 0,
        }))
        .sort((a, b) => a.position - b.position);

    return jsonResponse({ home: homeTeam, away: awayTeam, league, standings, source: 'thesportsdb' });
}

async function buildAnalysisResponse(data, homeName, awayName, league, espnLeague) {
    const entries = [];
    if (data.children) {
        for (const child of data.children) {
            if (child.standings && child.standings.entries) entries.push(...child.standings.entries);
        }
    }

    function normalize(str) {
        return str.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function findTeam(name) {
        const s = normalize(name);
        // 1. Exact match (accent-insensitive)
        let entry = entries.find(e => e.team && e.team.displayName && normalize(e.team.displayName) === s);
        // 2. One contains the other fully
        if (!entry) entry = entries.find(e => e.team && e.team.displayName && (
            normalize(e.team.displayName).includes(s) || s.includes(normalize(e.team.displayName))
        ));
        // 3. Word matching - prefer team with most matching words
        if (!entry) {
            const words = s.split(/[\s-]+/).filter(w => w.length > 2);
            let bestMatch = null;
            let bestScore = 0;
            for (const e of entries) {
                if (!e.team || !e.team.displayName) continue;
                const teamName = normalize(e.team.displayName);
                const matchCount = words.filter(w => teamName.includes(w)).length;
                if (matchCount > bestScore) {
                    bestScore = matchCount;
                    bestMatch = e;
                }
            }
            if (bestMatch && bestScore > 0) entry = bestMatch;
        }
        if (!entry) return null;

        const stats = {};
        if (entry.stats) for (const st of entry.stats) stats[st.name] = st.value;

        return {
            id: entry.team.id,
            name: entry.team.displayName,
            logo: (entry.team.logos && entry.team.logos[0]) ? entry.team.logos[0].href : null,
            position: stats.rank || null,
            points: stats.points || 0,
            played: stats.gamesPlayed || 0,
            wins: stats.wins || 0,
            draws: stats.ties || 0,
            losses: stats.losses || 0,
            goalsFor: stats.pointsFor || 0,
            goalsAgainst: stats.pointsAgainst || 0,
        };
    }

    const homeTeam = findTeam(homeName);
    const awayTeam = findTeam(awayName);

    // Fetch form for both teams in parallel
    const [homeForm, awayForm] = await Promise.all([
        homeTeam ? getTeamForm(homeTeam.id, espnLeague) : null,
        awayTeam ? getTeamForm(awayTeam.id, espnLeague) : null,
    ]);

    if (homeTeam) homeTeam.form = homeForm;
    if (awayTeam) awayTeam.form = awayForm;

    // Build full standings table sorted by position
    const standings = entries
        .map(e => {
            const st = {};
            if (e.stats) for (const s of e.stats) st[s.name] = s.value;
            return {
                name: e.team ? e.team.displayName : '?',
                position: st.rank || 99,
                played: st.gamesPlayed || 0,
                wins: st.wins || 0,
                draws: st.ties || 0,
                losses: st.losses || 0,
                goalsFor: st.pointsFor || 0,
                goalsAgainst: st.pointsAgainst || 0,
                points: st.points || 0,
            };
        })
        .sort((a, b) => a.position - b.position);

    return jsonResponse({ home: homeTeam, away: awayTeam, league, standings });
}

// GET TIPS ALLSVENSKAN - league table for the latest season
async function getTipsAllsvenskan(query) {
    const db = getPool();
    const userId = query.userId || null;

    // Get latest season
    const [maxRows] = await db.query('SELECT MAX(sasong) as maxSasong FROM TIT_TipsAllsvenskan');
    if (!maxRows.length || !maxRows[0].maxSasong) {
        return jsonResponse({ standings: [], myPosition: null, sasong: null });
    }
    const sasong = maxRows[0].maxSasong;

    // Get standings with user names
    const [rows] = await db.query(
        `SELECT a.id, a.spelade, a.sakra, a.poang, 
                CONCAT(u.fornamn, ' ', u.efternamn) as namn
         FROM TIT_TipsAllsvenskan a
         JOIN TIT_TipsTjanst u ON u.id = a.id
         WHERE a.sasong = ?
         ORDER BY a.poang DESC`,
        [sasong]
    );

    // Add position numbers
    const standings = rows.map((r, idx) => ({
        position: idx + 1,
        id: r.id,
        namn: r.namn,
        spelade: r.spelade,
        sakra: r.sakra,
        poang: r.poang,
    }));

    // Find user's position
    let myPosition = null;
    if (userId) {
        const entry = standings.find(s => s.id === parseInt(userId));
        if (entry) myPosition = entry.position;
    }

    return jsonResponse({ standings, myPosition, sasong });
}

// ===== PUSH NOTIFICATIONS =====

async function registerPushToken(params) {
    const { userId, pushToken, platform } = params;
    if (!userId || !pushToken) {
        return jsonResponse({ error: 'userId och pushToken krävs' }, 400);
    }
    const db = getPool();
    // Ensure tables exist
    await db.query(`CREATE TABLE IF NOT EXISTS TIT_push_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        pushToken VARCHAR(255) NOT NULL,
        platform VARCHAR(20) DEFAULT 'expo',
        notis_ny_kupong TINYINT(1) DEFAULT 1,
        notis_spelstopp TINYINT(1) DEFAULT 1,
        notis_live TINYINT(1) DEFAULT 1,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_token (userId, pushToken)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.query(`CREATE TABLE IF NOT EXISTS TIT_push_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        notisType VARCHAR(50) NOT NULL,
        spelomgang VARCHAR(20) NOT NULL,
        sentAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_notis (userId, notisType, spelomgang)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.query(
        `INSERT INTO TIT_push_tokens (userId, pushToken, platform)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE pushToken = VALUES(pushToken), platform = VALUES(platform), updatedAt = NOW()`,
        [userId, pushToken, platform || 'expo']
    );
    return jsonResponse({ success: true });
}

async function getPushSettings(params) {
    const { userId } = params;
    if (!userId) return jsonResponse({ error: 'userId krävs' }, 400);
    const db = getPool();
    const [rows] = await db.query(
        'SELECT notis_ny_kupong, notis_spelstopp, notis_live FROM TIT_push_tokens WHERE userId = ? LIMIT 1',
        [userId]
    );
    if (!rows.length) {
        return jsonResponse({ notis_ny_kupong: 1, notis_spelstopp: 1, notis_live: 1 });
    }
    return jsonResponse(rows[0]);
}

async function updatePushSettings(params) {
    const { userId, notis_ny_kupong, notis_spelstopp, notis_live } = params;
    if (!userId) return jsonResponse({ error: 'userId krävs' }, 400);
    const db = getPool();
    await db.query(
        `UPDATE TIT_push_tokens 
         SET notis_ny_kupong = ?, notis_spelstopp = ?, notis_live = ?
         WHERE userId = ?`,
        [notis_ny_kupong ? 1 : 0, notis_spelstopp ? 1 : 0, notis_live ? 1 : 0, userId]
    );
    return jsonResponse({ success: true });
}

async function sendExpoPush(tokens, title, body, data = {}) {
    const messages = tokens.map(token => ({
        to: token,
        sound: 'default',
        title,
        body,
        data,
    }));

    // Expo push API accepts max 100 per request
    const chunks = [];
    for (let i = 0; i < messages.length; i += 100) {
        chunks.push(messages.slice(i, i + 100));
    }

    for (const chunk of chunks) {
        await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chunk),
        });
    }
}

async function checkAndSendNotifications(context) {
    const db = getPool();
    const now = new Date();
    // Swedish time = UTC+2 (summer)
    const sweHour = now.getUTCHours() + 2;
    const sweDay = new Date(now.getTime() + 2 * 60 * 60 * 1000).getDay(); // 0=Sun, 1=Mon, ..., 4=Thu
    const sweMinutes = now.getUTCMinutes();

    // Get current spelomgang
    const [ekoRows] = await db.query('SELECT spelomgang, drawNumber FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    if (!ekoRows.length) return;
    const spelomgang = ekoRows[0].spelomgang;

    // === NOTIS 1: Ny kupong ute ===
    // Tue-Thu, Tue from 08:00, stop at Thu 12:00
    const isTue = sweDay === 2;
    const isWed = sweDay === 3;
    const isThu = sweDay === 4;
    const isFri = sweDay === 5;
    const inNotis1Window = (isTue && sweHour >= 8) || isWed || (isThu && sweHour < 12);

    if (inNotis1Window) {
        // Find users who have a lottning but haven't tipped yet
        const [untipped] = await db.query(
            `SELECT DISTINCT l.ansvarigId as userId
             FROM TIT_lottning l
             LEFT JOIN TIT_tipsrad t ON t.spelomgang = l.spelomgang AND t.ansvarigId = l.ansvarigId
             WHERE l.spelomgang = ? AND t.id IS NULL`,
            [spelomgang]
        );

        for (const row of untipped) {
            // Check if already sent this round
            const [logged] = await db.query(
                'SELECT id FROM TIT_push_log WHERE userId = ? AND notisType = ? AND spelomgang = ?',
                [row.userId, 'ny_kupong', spelomgang]
            );
            if (logged.length) continue;

            // Get tokens for this user with notis_ny_kupong enabled
            const [tokens] = await db.query(
                'SELECT pushToken FROM TIT_push_tokens WHERE userId = ? AND notis_ny_kupong = 1',
                [row.userId]
            );
            if (!tokens.length) continue;

            await sendExpoPush(
                tokens.map(t => t.pushToken),
                'Ny kupong ute',
                'Veckans match kan nu tippas.'
            );

            // Log it
            await db.query(
                'INSERT IGNORE INTO TIT_push_log (userId, notisType, spelomgang) VALUES (?, ?, ?)',
                [row.userId, 'ny_kupong', spelomgang]
            );
        }
    }

    // === NOTIS 2: Snart spelstopp (kl 10) ===
    if (isThu && sweHour === 10) {
        const [alreadySent] = await db.query(
            "SELECT id FROM TIT_push_log WHERE notisType = 'spelstopp_10' AND spelomgang = ? LIMIT 1",
            [spelomgang]
        );
        if (!alreadySent.length) {
            const [untipped] = await db.query(
                `SELECT DISTINCT l.ansvarigId as userId
                 FROM TIT_lottning l
                 LEFT JOIN TIT_tipsrad t ON t.spelomgang = l.spelomgang AND t.ansvarigId = l.ansvarigId
                 WHERE l.spelomgang = ? AND t.id IS NULL`,
                [spelomgang]
            );
            for (const row of untipped) {
                const [tokens] = await db.query(
                    'SELECT pushToken FROM TIT_push_tokens WHERE userId = ? AND notis_spelstopp = 1',
                    [row.userId]
                );
                if (!tokens.length) continue;
                await sendExpoPush(tokens.map(t => t.pushToken), 'Snart spelstopp', 'Veckans spel stänger kl 12.');
                await db.query(
                    'INSERT IGNORE INTO TIT_push_log (userId, notisType, spelomgang) VALUES (?, ?, ?)',
                    [row.userId, 'spelstopp_10', spelomgang]
                );
            }
        }
    }

    // === NOTIS 3: Snart spelstopp (kl 11:45) ===
    if (isThu && sweHour === 11 && now.getUTCMinutes() >= 43 && now.getUTCMinutes() <= 47) {
        const [alreadySent] = await db.query(
            "SELECT id FROM TIT_push_log WHERE notisType = 'spelstopp_1145' AND spelomgang = ? LIMIT 1",
            [spelomgang]
        );
        if (!alreadySent.length) {
            const [untipped] = await db.query(
                `SELECT DISTINCT l.ansvarigId as userId
                 FROM TIT_lottning l
                 LEFT JOIN TIT_tipsrad t ON t.spelomgang = l.spelomgang AND t.ansvarigId = l.ansvarigId
                 WHERE l.spelomgang = ? AND t.id IS NULL`,
                [spelomgang]
            );
            for (const row of untipped) {
                const [tokens] = await db.query(
                    'SELECT pushToken FROM TIT_push_tokens WHERE userId = ? AND notis_spelstopp = 1',
                    [row.userId]
                );
                if (!tokens.length) continue;
                await sendExpoPush(tokens.map(t => t.pushToken), 'Snart spelstopp', '15 minuter kvar till spelstopp.');
                await db.query(
                    'INSERT IGNORE INTO TIT_push_log (userId, notisType, spelomgang) VALUES (?, ?, ?)',
                    [row.userId, 'spelstopp_1145', spelomgang]
                );
            }
        }
    }

    // === NOTIS 3b: Garderingsspelet öppet (torsdag kl 12:15) ===
    if (isThu && sweHour === 12 && sweMinutes >= 13 && sweMinutes <= 17) {
        const [alreadySent] = await db.query(
            "SELECT id FROM TIT_push_log WHERE notisType = 'gardering_oppet' AND spelomgang = ? LIMIT 1",
            [spelomgang]
        );
        if (!alreadySent.length) {
            // Send to all users with notis_ny_kupong enabled
            const [tokenRows] = await db.query(
                'SELECT DISTINCT userId, pushToken FROM TIT_push_tokens WHERE notis_ny_kupong = 1'
            );
            const userTokens = {};
            for (const row of tokenRows) {
                if (!userTokens[row.userId]) userTokens[row.userId] = [];
                userTokens[row.userId].push(row.pushToken);
            }
            for (const [userId, tokens] of Object.entries(userTokens)) {
                await sendExpoPush(
                    tokens,
                    'Garderingsspelet öppet',
                    'Garderingar kan, med garanti, lämnas fram t.o.m. fredag kl 12. Ännu lite längre utan garanti.'
                );
                await db.query(
                    'INSERT IGNORE INTO TIT_push_log (userId, notisType, spelomgang) VALUES (?, ?, ?)',
                    [userId, 'gardering_oppet', spelomgang]
                );
            }
        }
    }

    // === NOTIS 3c: Garderingsspelet stänger snart (fredag kl 11:50) ===
    if (isFri && sweHour === 11 && sweMinutes >= 48 && sweMinutes <= 52) {
        const [alreadySent] = await db.query(
            "SELECT id FROM TIT_push_log WHERE notisType = 'gardering_spelstopp' AND spelomgang = ? LIMIT 1",
            [spelomgang]
        );
        if (!alreadySent.length) {
            // Find users who have NOT saved garderingar for this round
            const [allUsers] = await db.query(
                `SELECT DISTINCT pt.userId
                 FROM TIT_push_tokens pt
                 LEFT JOIN TIT_garderingar g ON g.id = pt.userId AND g.omgang = ?
                 WHERE pt.notis_spelstopp = 1 AND g.id IS NULL`,
                [spelomgang]
            );
            for (const row of allUsers) {
                const [tokens] = await db.query(
                    'SELECT pushToken FROM TIT_push_tokens WHERE userId = ? AND notis_spelstopp = 1',
                    [row.userId]
                );
                if (!tokens.length) continue;
                await sendExpoPush(
                    tokens.map(t => t.pushToken),
                    'Garderingsspelet stänger snart',
                    'Garderingsspelet är med garanti öppet till kl 12:00. Det kan vara öppet längre om du vill vänta och chansa.'
                );
                await db.query(
                    'INSERT IGNORE INTO TIT_push_log (userId, notisType, spelomgang) VALUES (?, ?, ?)',
                    [row.userId, 'gardering_spelstopp', spelomgang]
                );
            }
        }
    }

    // === NOTIS 4, 5, 6: Live-notiser ===
    // Get draw data from Svenska Spel
    const drawNumber = ekoRows[0].drawNumber;
    if (!drawNumber) return;

    let forecastUrl = `${SVENSKA_SPEL_BASE}draws/${drawNumber}/forecast?accesskey=${SVENSKA_SPEL_KEY}`;
    let resp = await fetch(forecastUrl);
    let forecastData = await resp.json();
    const forecast = forecastData.forecast;
    if (!forecast || !forecast.events || !forecast.events.length) return;

    const events = forecast.events;
    const started = events.filter(e => e.sportEventStatus !== 'Inte startat');
    const finished = events.filter(e => e.sportEventStatus === 'Slut' || e.sportEventStatus === 'Avslutad');
    const inProgress = started.length > 0 && finished.length < 13;
    const allDone = finished.length === 13;

    // Get system rows for calculating rätt
    const [sysRows] = await db.query('SELECT * FROM TIT_systemrader WHERE drawNumber = ?', [drawNumber]);

    function calcBestCorrect(sysRows, events) {
        let best = 0;
        for (const row of sysRows) {
            let correct = 0;
            for (let i = 1; i <= 13; i++) {
                const event = events[i - 1];
                if (!event || !event.outcomeScore) continue;
                const parts = event.outcomeScore.split('-');
                const homeGoals = parseInt(parts[0]) || 0;
                const awayGoals = parseInt(parts[1]) || 0;
                const resultSign = homeGoals > awayGoals ? '1' : homeGoals < awayGoals ? '2' : 'X';
                if (row[`m${i}`] === resultSign) correct++;
            }
            if (correct > best) best = correct;
        }
        return best;
    }

    function calcWinnings(sysRows, events, distribution) {
        if (!distribution || !distribution.length) return 0;
        const rightCount = {};
        for (const row of sysRows) {
            let correct = 0;
            for (let i = 1; i <= 13; i++) {
                const event = events[i - 1];
                if (!event || !event.outcomeScore) continue;
                const parts = event.outcomeScore.split('-');
                const homeGoals = parseInt(parts[0]) || 0;
                const awayGoals = parseInt(parts[1]) || 0;
                const resultSign = homeGoals > awayGoals ? '1' : homeGoals < awayGoals ? '2' : 'X';
                if (row[`m${i}`] === resultSign) correct++;
            }
            rightCount[correct] = (rightCount[correct] || 0) + 1;
        }
        let total = 0;
        for (const dist of distribution) {
            const match = dist.name.match(/(\d+)/);
            if (!match) continue;
            const numRight = parseInt(match[1]);
            if (numRight < 10) continue;
            const count = rightCount[numRight] || 0;
            if (count > 0) {
                const amount = parseFloat(dist.amount.replace(',', '.'));
                total += count * amount;
            }
        }
        return Math.round(total);
    }

    // Get live tokens (all users with notis_live = 1)
    const [liveTokenRows] = await db.query('SELECT DISTINCT pushToken FROM TIT_push_tokens WHERE notis_live = 1');
    const liveTokens = liveTokenRows.map(r => r.pushToken);
    if (!liveTokens.length) return;

    // === NOTIS 4: Stryktipset har startat ===
    if (started.length > 0) {
        const [alreadySent] = await db.query(
            "SELECT id FROM TIT_push_log WHERE notisType = 'live_start' AND spelomgang = ? LIMIT 1",
            [spelomgang]
        );
        if (!alreadySent.length) {
            const bestCorrect = sysRows.length ? calcBestCorrect(sysRows, events) : 0;
            await sendExpoPush(
                liveTokens,
                'Stryktipset har startat',
                `Vi startar med ${bestCorrect} rätt. Följ spänningen i appen.`
            );
            // Log for all users
            const [allLiveUsers] = await db.query('SELECT DISTINCT userId FROM TIT_push_tokens WHERE notis_live = 1');
            for (const u of allLiveUsers) {
                await db.query(
                    'INSERT IGNORE INTO TIT_push_log (userId, notisType, spelomgang) VALUES (?, ?, ?)',
                    [u.userId, 'live_start', spelomgang]
                );
            }
        }
    }

    // === NOTIS 5: Rapport var 15:e minut ===
    if (inProgress && sysRows.length) {
        // Check: has 15 min passed since last rapport?
        const [lastRapport] = await db.query(
            "SELECT sentAt FROM TIT_push_log WHERE notisType = 'live_rapport' AND spelomgang = ? ORDER BY sentAt DESC LIMIT 1",
            [spelomgang]
        );
        let shouldSend = true;
        if (lastRapport.length) {
            const lastSent = new Date(lastRapport[0].sentAt);
            const diffMin = (now - lastSent) / 60000;
            if (diffMin < 14) shouldSend = false;
        }
        if (shouldSend) {
            const bestCorrect = calcBestCorrect(sysRows, events);
            // Get distribution for winnings calc
            let drawUrl = `${SVENSKA_SPEL_BASE}draws/${drawNumber}?accesskey=${SVENSKA_SPEL_KEY}`;
            let drawResp = await fetch(drawUrl);
            let drawJson = await drawResp.json();
            const distribution = drawJson.draw?.distribution || [];
            const winnings = calcWinnings(sysRows, events, distribution);
            const winStr = winnings > 0 ? `${winnings.toLocaleString('sv-SE')} kr` : '0 kr';

            await sendExpoPush(
                liveTokens,
                'Rapport från Stryktipset',
                `Just nu: ${bestCorrect} rätt. Prognos: ${winStr}. Följ spänningen i appen.`
            );
            const [allLiveUsers] = await db.query('SELECT DISTINCT userId FROM TIT_push_tokens WHERE notis_live = 1');
            for (const u of allLiveUsers) {
                await db.query(
                    'INSERT IGNORE INTO TIT_push_log (userId, notisType, spelomgang, sentAt) VALUES (?, ?, ?, NOW())',
                    [u.userId, 'live_rapport', spelomgang]
                );
            }
        }
    }

    // === NOTIS 6: Slutresultat ===
    if (allDone && sysRows.length) {
        const [alreadySent] = await db.query(
            "SELECT id FROM TIT_push_log WHERE notisType = 'live_slut' AND spelomgang = ? LIMIT 1",
            [spelomgang]
        );
        if (!alreadySent.length) {
            const bestCorrect = calcBestCorrect(sysRows, events);
            let drawUrl = `${SVENSKA_SPEL_BASE}draws/${drawNumber}?accesskey=${SVENSKA_SPEL_KEY}`;
            let drawResp = await fetch(drawUrl);
            let drawJson = await drawResp.json();
            const distribution = drawJson.draw?.distribution || [];
            const winnings = calcWinnings(sysRows, events, distribution);
            const winStr = winnings > 0 ? `${winnings.toLocaleString('sv-SE')} kr` : '0 kr';

            await sendExpoPush(
                liveTokens,
                'Stryktipset slutresultat',
                `Veckans resultat: ${bestCorrect} rätt. Vinst: ${winStr}. Se utfallet i appen.`
            );
            const [allLiveUsers] = await db.query('SELECT DISTINCT userId FROM TIT_push_tokens WHERE notis_live = 1');
            for (const u of allLiveUsers) {
                await db.query(
                    'INSERT IGNORE INTO TIT_push_log (userId, notisType, spelomgang) VALUES (?, ?, ?)',
                    [u.userId, 'live_slut', spelomgang]
                );
            }
        }
    }
}

// Main API function - single HTTP trigger handling all actions
app.http('api', {
    methods: ['GET', 'POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'api',
    handler: async (request, context) => {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return { status: 204, headers: corsHeaders() };
        }

        try {
            const url = new URL(request.url);
            const query = Object.fromEntries(url.searchParams);
            let body = {};

            if (request.method === 'POST') {
                try { body = await request.json(); } catch (e) { /* no body */ }
            }

            // Action comes from query string (as the app sends it)
            const action = query.action || body.action;

            if (!action) {
                return jsonResponse({ error: 'Saknar action parameter' }, 400);
            }

            // Merge query and body for parameter access
            const params = { ...query, ...body };

            switch (action) {
                case 'getUsers':
                    return await getUsers();
                case 'login':
                    return await login(params);
                case 'getStatus':
                    return await getStatus();
                case 'getMyMatch':
                    return await getMyMatch(params);
                case 'getKupong':
                    return await getKupong();
                case 'saveTips':
                    return await saveTips(params);
                case 'getGarderingar':
                    return await getGarderingar(params);
                case 'saveGarderingar':
                    return await saveGarderingar(params);
                case 'getLiveDraw':
                    return await getLiveDraw();
                case 'getLiveResult':
                    return await getLiveResult(params);
                case 'getSystemRows':
                    return await getSystemRows(params);
                case 'getMatchAnalysis':
                    return await getMatchAnalysis(params);
                case 'debug': {
                    const db = getPool();
                    const [lott] = await db.query('SELECT DISTINCT spelomgang FROM TIT_lottning ORDER BY spelomgang DESC LIMIT 5');
                    const [tips] = await db.query('SELECT DISTINCT spelomgang FROM TIT_tipsrad ORDER BY spelomgang DESC LIMIT 5');
                    const [kup] = await db.query('SELECT DISTINCT spelomgang FROM TIT_kupong ORDER BY spelomgang DESC LIMIT 5');
                    const [eko] = await db.query('SELECT * FROM TIT_ekonomi');
                    return jsonResponse({ lottning: lott, tipsrad: tips, kupong: kup, ekonomi: eko });
                }
                case 'getTipsAllsvenskan':
                    return await getTipsAllsvenskan(params);
                case 'registerPushToken':
                    return await registerPushToken(params);
                case 'getPushSettings':
                    return await getPushSettings(params);
                case 'updatePushSettings':
                    return await updatePushSettings(params);
                case 'testPush': {
                    const db = getPool();
                    const testUserId = params.get('userId') || body?.userId;
                    if (!testUserId) return jsonResponse({ error: 'userId required' }, 400);
                    const [tokens] = await db.query(
                        'SELECT pushToken FROM TIT_push_tokens WHERE userId = ?',
                        [testUserId]
                    );
                    if (!tokens.length) return jsonResponse({ error: 'No tokens found for user' }, 404);
                    const pushTokens = tokens.map(t => t.pushToken);
                    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(pushTokens.map(token => ({
                            to: token,
                            sound: 'default',
                            title: 'Ny kupong ute',
                            body: 'Veckans match kan nu tippas.',
                            data: {},
                        }))),
                    });
                    const result = await resp.json();
                    return jsonResponse({ sent: pushTokens, expoResponse: result });
                }
                case 'debugPush': {
                    const db = getPool();
                    const now = new Date();
                    const sweHour = now.getUTCHours() + 2;
                    const sweDay = new Date(now.getTime() + 2 * 60 * 60 * 1000).getDay();
                    const [ekoRows] = await db.query('SELECT spelomgang, drawNumber FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
                    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : null;
                    const [tokens] = await db.query('SELECT * FROM TIT_push_tokens');
                    const [logs] = await db.query('SELECT * FROM TIT_push_log ORDER BY sentAt DESC LIMIT 20');
                    const [lottning] = await db.query('SELECT * FROM TIT_lottning WHERE spelomgang = ?', [spelomgang]);
                    const [tipsrad] = await db.query('SELECT DISTINCT ansvarigId FROM TIT_tipsrad WHERE spelomgang = ?', [spelomgang]);
                    const isTue = sweDay === 2;
                    const isWed = sweDay === 3;
                    const isThu = sweDay === 4;
                    const inNotis1Window = (isTue && sweHour >= 8) || isWed || (isThu && sweHour < 12);
                    return jsonResponse({
                        utcNow: now.toISOString(),
                        sweHour,
                        sweDay,
                        dayName: ['Sön','Mån','Tis','Ons','Tor','Fre','Lör'][sweDay],
                        spelomgang,
                        inNotis1Window,
                        tokens,
                        logs,
                        lottning,
                        tipsradUsers: tipsrad
                    });
                }
                case 'initPushTables': {
                    const db = getPool();
                    await db.query(`CREATE TABLE IF NOT EXISTS TIT_push_tokens (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        userId INT NOT NULL,
                        pushToken VARCHAR(255) NOT NULL,
                        platform VARCHAR(20) DEFAULT 'expo',
                        notis_ny_kupong TINYINT(1) DEFAULT 1,
                        notis_spelstopp TINYINT(1) DEFAULT 1,
                        notis_live TINYINT(1) DEFAULT 1,
                        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        UNIQUE KEY unique_user_token (userId, pushToken)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
                    await db.query(`CREATE TABLE IF NOT EXISTS TIT_push_log (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        userId INT NOT NULL,
                        notisType VARCHAR(50) NOT NULL,
                        spelomgang VARCHAR(20) NOT NULL,
                        sentAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY unique_notis (userId, notisType, spelomgang)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
                    return jsonResponse({ success: true, message: 'Push tables created' });
                }
                case 'getAdminData':
                    return await getAdminData(params);
                case 'setSpeletOppet':
                    return await setSpeletOppet(params);
                case 'saveAdminTipsrad':
                    return await saveAdminTipsrad(params);
                default:
                    return jsonResponse({ error: `Okänd action: ${action}` }, 400);
            }
        } catch (err) {
            context.log('API Error:', err);
            return jsonResponse({ error: 'Serverfel', details: err.message }, 500);
        }
    }
});

// ===== ADMIN ENDPOINTS =====

// GET ADMIN DATA - full coupon with tips, gardering stats, odds
async function getAdminData(params) {
    const userId = parseInt(params.userId || params.get?.('userId'));
    if (userId !== 1) return jsonResponse({ error: 'Ej behörig' }, 403);

    const db = getPool();
    const [ekoRows] = await db.query('SELECT spelomgang, isSlutspel FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : '';

    // Get speletOppet status
    const [adminRows] = await db.query('SELECT speletOppet FROM TIT_admin LIMIT 1');
    const speletOppetVal = adminRows.length ? adminRows[0].speletOppet : 0;

    // Get matches with kupong info, lottning (who's responsible), and tipsrad
    const [matches] = await db.query(`
        SELECT k.matchNr, k.lag, k.liga, k.home, k.away, k.odds1, k.oddsX, k.odds2,
               l.ansvarigId, u.fornamn, u.efternamn,
               t.tecken AS grundtecken, t.evGardering, t.poangGrund
        FROM TIT_kupong k
        LEFT JOIN TIT_lottning l ON l.spelomgang = k.spelomgang AND l.matchNr = k.matchNr
        LEFT JOIN TIT_TipsTjanst u ON u.id = l.ansvarigId
        LEFT JOIN TIT_tipsrad t ON t.spelomgang = k.spelomgang AND t.matchNr = k.matchNr
        WHERE k.spelomgang = ?
        ORDER BY k.matchNr
    `, [spelomgang]);

    // Get gardering counts per match per sign
    const [gardStats] = await db.query(`
        SELECT matchNr, tecken, COUNT(*) AS antal
        FROM TIT_garderingar
        WHERE omgang = ? AND tecken != '-'
        GROUP BY matchNr, tecken
    `, [spelomgang]);

    // Build gardering stats lookup
    const gardMap = {};
    for (const row of gardStats) {
        if (!gardMap[row.matchNr]) gardMap[row.matchNr] = {};
        gardMap[row.matchNr][row.tecken] = row.antal;
    }

    // Merge gardering stats into matches
    const result = matches.map(m => ({
        ...m,
        gard1: gardMap[m.matchNr]?.['1'] || 0,
        gardX: gardMap[m.matchNr]?.['X'] || 0,
        gard2: gardMap[m.matchNr]?.['2'] || 0,
    }));

    return jsonResponse({
        spelomgang,
        speletOppet: speletOppetVal,
        isSlutspel: ekoRows.length ? ekoRows[0].isSlutspel : 0,
        matches: result
    });
}

// SET SPELET ÖPPET
async function setSpeletOppet(params) {
    const userId = parseInt(params.userId || params.get?.('userId'));
    if (userId !== 1) return jsonResponse({ error: 'Ej behörig' }, 403);

    const value = parseInt(params.speletOppet ?? params.get?.('speletOppet'));
    if (value !== 0 && value !== 1) return jsonResponse({ error: 'Ogiltigt värde' }, 400);

    const db = getPool();
    await db.query('UPDATE TIT_admin SET speletOppet = ?', [value]);
    return jsonResponse({ success: true, speletOppet: value });
}

// SAVE ADMIN TIPSRAD - save grundtecken, garderingar, STMF for all 13 matches
async function saveAdminTipsrad(params) {
    const userId = parseInt(params.userId || params.get?.('userId'));
    if (userId !== 1) return jsonResponse({ error: 'Ej behörig' }, 403);

    const { matches } = params;
    if (!matches || !Array.isArray(matches)) return jsonResponse({ error: 'Saknar matches-data' }, 400);

    const db = getPool();
    const [ekoRows] = await db.query('SELECT spelomgang FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : '';

    // Delete existing tipsrad for this round
    await db.query('DELETE FROM TIT_tipsrad WHERE spelomgang = ?', [spelomgang]);

    // Insert each match
    for (const m of matches) {
        await db.query(
            `INSERT INTO TIT_tipsrad (spelomgang, matchNr, tecken, evGardering, poangGrund, ansvarigId, slutspel)
             VALUES (?, ?, ?, ?, ?, ?, 0)`,
            [spelomgang, m.matchNr, m.tecken || '', m.evGardering || '', m.poangGrund ? 1 : 0, m.ansvarigId || 0]
        );
    }

    return jsonResponse({ success: true });
}

// Timer trigger for push notifications - runs every 5 minutes
app.timer('pushNotificationTimer', {
    schedule: '0 */5 * * * *',
    handler: async (timer, context) => {
        context.log('Push notification timer triggered');
        try {
            await checkAndSendNotifications(context);
        } catch (err) {
            context.log('Push notification error:', err);
        }
    }
});
