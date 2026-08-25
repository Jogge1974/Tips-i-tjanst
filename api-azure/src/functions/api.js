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

// Google Gemini API
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';

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

// Ensure message-related schema exists (runs once per warm instance)
let messageSchemaEnsured = false;
async function ensureMessageSchema(db) {
    if (messageSchemaEnsured) return;
    const ignore = ['ER_DUP_FIELDNAME', 'ER_NO_SUCH_TABLE'];
    try {
        await db.query('ALTER TABLE TIT_admin ADD COLUMN message TEXT NULL');
    } catch (e) { if (!ignore.includes(e.code)) throw e; }
    try {
        await db.query('ALTER TABLE TIT_push_tokens ADD COLUMN notis_meddelande TINYINT(1) DEFAULT 1');
    } catch (e) { if (!ignore.includes(e.code)) throw e; }
    messageSchemaEnsured = true;
}

// Ensure målrapport schema exists (goal log + last-seen scores per round)
let mallistaSchemaEnsured = false;
async function ensureMallistaSchema(db) {
    if (mallistaSchemaEnsured) return;
    await db.query(`CREATE TABLE IF NOT EXISTS TIT_mallista (
        id INT AUTO_INCREMENT PRIMARY KEY,
        spelomgang VARCHAR(20),
        eventNumber INT,
        home VARCHAR(100),
        away VARCHAR(100),
        fromScore VARCHAR(10),
        toScore VARCHAR(10),
        detectedAtMs BIGINT,
        INDEX idx_mallista_spelomgang (spelomgang)
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS TIT_livescore (
        spelomgang VARCHAR(20),
        eventNumber INT,
        score VARCHAR(10),
        PRIMARY KEY (spelomgang, eventNumber)
    )`);
    mallistaSchemaEnsured = true;
}

// Upptäck och logga måländringar under live. Körs från timer-funktionen så att
// listan byggs upp på servern oavsett om någon app-användare är aktiv.
async function detectGoals(db, spelomgang, events) {
    if (!spelomgang || !events || !events.length) return;
    await ensureMallistaSchema(db);
    const [prev] = await db.query('SELECT eventNumber, score FROM TIT_livescore WHERE spelomgang = ?', [spelomgang]);
    const prevMap = {};
    for (const p of prev) prevMap[p.eventNumber] = p.score;

    const now = Date.now();
    for (const e of events) {
        if (!e.outcomeScore) continue; // ej startad / inget resultat än
        const cur = e.outcomeScore;
        const evNr = e.eventNumber;
        const known = prevMap[evNr];
        if (known === undefined) {
            // Första observationen = baslinje, logga inget mål
            await db.query(
                'INSERT INTO TIT_livescore (spelomgang, eventNumber, score) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE score = VALUES(score)',
                [spelomgang, evNr, cur]
            );
        } else if (known !== cur) {
            const parts = (e.description || '').split('-');
            const home = parts[0] ? parts[0].trim() : '';
            const away = parts.length > 1 ? parts.slice(1).join('-').trim() : '';
            await db.query(
                'INSERT INTO TIT_mallista (spelomgang, eventNumber, home, away, fromScore, toScore, detectedAtMs) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [spelomgang, evNr, home, away, known, cur, now]
            );
            await db.query('UPDATE TIT_livescore SET score = ? WHERE spelomgang = ? AND eventNumber = ?', [cur, spelomgang, evNr]);
        }
    }
}

// GET MÅLLISTA - goal report for the current round (newest first)
async function getMallista() {
    const db = getPool();
    await ensureMallistaSchema(db);
    const [ekoRows] = await db.query('SELECT spelomgang FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : '';
    const [rows] = await db.query(
        'SELECT eventNumber, home, away, fromScore, toScore, detectedAtMs FROM TIT_mallista WHERE spelomgang = ? ORDER BY detectedAtMs DESC, id DESC',
        [spelomgang]
    );
    return jsonResponse(rows);
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

// GET DASHBOARD - aggregated home screen data
async function getDashboard(query) {
    const userId = parseInt(query.userId);
    if (!userId) return jsonResponse({ error: 'Saknar userId' }, 400);

    const db = getPool();
    await ensureMessageSchema(db);
    const [adminMsgRows] = await db.query('SELECT message FROM TIT_admin LIMIT 1');
    const adminMessage = adminMsgRows.length ? (adminMsgRows[0].message || '') : '';
    const status = await speletOppet(db);

    // Current round info
    const [ekoRows] = await db.query('SELECT * FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    if (!ekoRows.length) return jsonResponse({ error: 'Ingen ekonomidata' }, 404);
    const current = ekoRows[0];
    const spelomgang = current.spelomgang;
    const sasong = current.sasong;

    // Season economy: sum insats+extraInsats vs vinst+extraVinst
    const [ecoRows] = await db.query(
        `SELECT SUM(insats + extraInsats) as totalInsats, SUM(vinst + extraVinst) as totalVinst
         FROM TIT_ekonomi WHERE sasong = ?`,
        [sasong]
    );
    const totalInsats = ecoRows[0].totalInsats || 0;
    const totalVinst = ecoRows[0].totalVinst || 0;

    // TipsAllsvenskan leader + user position
    const [maxSasong] = await db.query('SELECT MAX(sasong) as s FROM TIT_TipsAllsvenskan');
    let leader = null;
    let myPosition = null;
    let myPoang = null;
    let slutspelsInfo = '';
    if (maxSasong.length && maxSasong[0].s) {
        const [standings] = await db.query(
            `SELECT a.id, a.poang, CONCAT(u.fornamn, ' ', u.efternamn) as namn
             FROM TIT_TipsAllsvenskan a
             JOIN TIT_TipsTjanst u ON u.id = a.id
             WHERE a.sasong = ?
             ORDER BY a.poang DESC`,
            [maxSasong[0].s]
        );
        if (standings.length) {
            leader = { namn: standings[0].namn, poang: standings[0].poang };
            const myEntry = standings.find(s => s.id === userId);
            if (myEntry) {
                myPosition = standings.indexOf(myEntry) + 1;
                myPoang = myEntry.poang;
                // Slutspels info
                if (standings.length >= 8) {
                    if (myPosition <= 8) {
                        const ninth = standings[8];
                        if (ninth) slutspelsInfo = `${(myEntry.poang - ninth.poang).toFixed(1)}p ner till 9:an`;
                        else slutspelsInfo = 'Slutspelsplats!';
                    } else {
                        const eighth = standings[7];
                        if (eighth) slutspelsInfo = `${(eighth.poang - myEntry.poang).toFixed(1)}p upp till 8:an`;
                    }
                }
            }
        }
    }

    // Last completed round result (where antalRatt is filled in)
    const [lastRound] = await db.query(
        `SELECT spelomgang, antalRatt, insats, vinst, extraInsats, extraVinst
         FROM TIT_ekonomi WHERE sasong = ? AND antalRatt > 0
         ORDER BY spelomgang DESC LIMIT 1`,
        [sasong]
    );
    const lastResult = lastRound.length ? {
        spelomgang: lastRound[0].spelomgang,
        antalRatt: lastRound[0].antalRatt,
        insats: lastRound[0].insats || 0,
        vinst: lastRound[0].vinst || 0,
        extraInsats: lastRound[0].extraInsats || 0,
        extraVinst: lastRound[0].extraVinst || 0,
    } : null;

    // Streak: consecutive rounds with 10+ rätt (current season, backwards)
    const [allRounds] = await db.query(
        `SELECT antalRatt FROM TIT_ekonomi WHERE sasong = ? AND antalRatt > 0 ORDER BY spelomgang DESC`,
        [sasong]
    );
    let streak = 0;
    for (const r of allRounds) {
        if (r.antalRatt >= 10) streak++;
        else break;
    }

    // Has user tipped this round?
    const [tipsrad] = await db.query(
        'SELECT matchNr FROM TIT_tipsrad WHERE spelomgang = ? AND ansvarigId = ? LIMIT 1',
        [spelomgang, userId]
    );
    let hasTipped = tipsrad.length > 0;

    // Has user submitted garderingar?
    const [gard] = await db.query(
        'SELECT matchNr FROM TIT_garderingar WHERE omgang = ? AND id = ? LIMIT 1',
        [spelomgang, userId]
    );
    let hasGardering = gard.length > 0;

    // Slutspel: enkelraden lämnas som garderingar (13 tecken). "Klar" = alla 13 lämnade.
    if (current.isSlutspel === 1) {
        const [gardCount] = await db.query(
            'SELECT COUNT(*) as cnt FROM TIT_garderingar WHERE omgang = ? AND id = ?',
            [spelomgang, userId]
        );
        hasTipped = gardCount[0].cnt >= 13;
        hasGardering = hasTipped;
    }

    // Current tipsrad (all 13 matches with team names and signs)
    const [tipsradRows] = await db.query(
        `SELECT t.matchNr, t.tecken, t.evGardering, k.home, k.away
         FROM TIT_tipsrad t
         LEFT JOIN TIT_kupong k ON k.spelomgang = t.spelomgang AND k.matchNr = t.matchNr
         WHERE t.spelomgang = ?
         ORDER BY t.matchNr`,
        [spelomgang]
    );

    // System info (hel/halv/rader/garanti)
    let systemInfo = null;
    if (tipsradRows.length > 0 && current.drawNumber) {
        let hel = 0, halv = 0;
        for (const r of tipsradRows) {
            const extraSigns = (r.evGardering || '').length;
            if (extraSigns === 2) hel++;
            else if (extraSigns === 1) halv++;
        }
        const [sysCount] = await db.query(
            'SELECT COUNT(*) as cnt FROM TIT_systemrader WHERE drawNumber = ?',
            [current.drawNumber]
        );
        const antalRader = sysCount[0].cnt;
        const variableCount = hel + halv;
        const grupper = variableCount > 0 ? Math.ceil(variableCount / 3) : 0;
        const garanti = grupper > 0 ? 13 - grupper : 13;
        systemInfo = { hel, halv, rader: antalRader, garanti };
    }

    // Har veckans systemrad publicerats? (finns rader i TIT_systemrader)
    let radPublicerad = false;
    if (current.drawNumber) {
        const [pubCount] = await db.query(
            'SELECT COUNT(*) as cnt FROM TIT_systemrader WHERE drawNumber = ?',
            [current.drawNumber]
        );
        radPublicerad = pubCount[0].cnt > 0;
    }

    // Live status check
    let liveState = 'waiting'; // 'waiting' | 'live' | 'finished'
    if (current.drawNumber) {
        try {
            // First try draw endpoint for Finalized state
            const drawUrl = `${SVENSKA_SPEL_BASE}draws/${current.drawNumber}?accesskey=${SVENSKA_SPEL_KEY}`;
            const drawResp = await fetch(drawUrl);
            const drawJson = await drawResp.json();
            const drawState = drawJson?.draw?.drawState;
            if (drawState === 'Finalized') {
                liveState = 'finished';
            } else {
                // Use forecast endpoint to check if matches have started
                const forecastUrl = `${SVENSKA_SPEL_BASE}draws/${current.drawNumber}/forecast?accesskey=${SVENSKA_SPEL_KEY}`;
                const forecastResp = await fetch(forecastUrl);
                const forecastJson = await forecastResp.json();
                const events = forecastJson?.forecast?.events || [];
                if (events.length > 0) {
                    const allFinished = events.every(e => e.isFinished);
                    if (allFinished) liveState = 'finished';
                    else {
                        const started = events.some(e => e.sportEventStatus !== 'Inte startat');
                        liveState = started ? 'live' : 'waiting';
                    }
                }
            }
        } catch (e) { /* keep waiting */ }
    }

    return jsonResponse({
        status: { speletOppet: status, spelomgang, isSlutspel: current.isSlutspel, antalRatt: current.antalRatt },
        seasonEconomy: { totalInsats, totalVinst, balance: totalVinst - totalInsats, sasong },
        leader,
        myPosition,
        myPoang,
        slutspelsInfo,
        lastResult,
        streak,
        hasTipped,
        hasGardering,
        tipsrad: tipsradRows,
        liveState,
        systemInfo,
        radPublicerad,
        message: adminMessage,
    });
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
    // Always derive tip state from TIT_tipsrad; do not trust view-leaked values
    const t = tipsrad.length ? tipsrad[0].tecken : '';
    matchInfo.etta = t === '1' ? '1' : '0';
    matchInfo.kryss = t === 'X' ? '1' : '0';
    matchInfo.tvaa = t === '2' ? '1' : '0';

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

    // Mark the user's match as completed in TIT_lottning
    await db.query(
        'UPDATE TIT_lottning SET tipsTecken = ? WHERE spelomgang = ? AND matchNr = ? AND ansvarigId = ?',
        ['Klar', spelomgang, matchNr, userId]
    );

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

    const [ekoRows] = await db.query('SELECT spelomgang, isSlutspel FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : '';
    const isSlutspel = ekoRows.length ? ekoRows[0].isSlutspel : 0;

    // Check status. Slutspel (enkelrad) kan lämnas hela veckan; garderingar bara i garderingsfasen.
    const status = await speletOppet(db);
    if (isSlutspel === 1) {
        if (status === 0) {
            return jsonResponse({ error: 'Spelet är stängt' }, 403);
        }
    } else if (status !== 2) {
        return jsonResponse({ error: 'Spelet är inte öppet för garderingar' }, 403);
    }

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
                    isFinished: !!e.isFinished,
                    cancelled: !!e.cancelled,
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
                    isFinished: false,
                    cancelled: false,
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

// GET LIVE GARDERING TABLE - live ranking of user gardering/enkelrad signs vs results
async function getLiveGarderingTable() {
    const db = getPool();
    const [ekoRows] = await db.query('SELECT spelomgang, isSlutspel, drawNumber FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    if (!ekoRows.length) return jsonResponse([]);
    const { spelomgang, isSlutspel, drawNumber } = ekoRows[0];

    // Get all users
    const [users] = await db.query('SELECT id, fornamn, efternamn FROM TIT_TipsTjanst ORDER BY id');

    // Get live results from Svenska Spel
    let liveResults = []; // array of 13 signs ('1','X','2')
    if (drawNumber) {
        try {
            const url = `${SVENSKA_SPEL_BASE}draws/${drawNumber}/forecast?accesskey=${SVENSKA_SPEL_KEY}`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (data.forecast?.events) {
                liveResults = data.forecast.events.map(e => {
                    if (!e.outcomeScore) return 'X'; // not started = 0-0 = X
                    const parts = e.outcomeScore.split('-');
                    const home = parseInt(parts[0]) || 0;
                    const away = parseInt(parts[1]) || 0;
                    if (home > away) return '1';
                    if (home < away) return '2';
                    return 'X';
                });
            }
        } catch (e) { /* fallback to empty */ }
    }
    if (liveResults.length === 0) {
        liveResults = Array(13).fill('X'); // default 0-0 = X
    }

    let table = [];

    if (isSlutspel === 1) {
        // Slutspel: varje användares enkelrad ligger i TIT_garderingar (13 tecken)
        const [allTips] = await db.query(
            'SELECT id, matchNr, tecken FROM TIT_garderingar WHERE omgang = ? ORDER BY id, matchNr',
            [spelomgang]
        );
        const tipsByUser = {};
        for (const t of allTips) {
            if (!tipsByUser[t.id]) tipsByUser[t.id] = {};
            tipsByUser[t.id][t.matchNr] = t.tecken;
        }

        for (const user of users) {
            const userTips = tipsByUser[user.id];
            if (!userTips) {
                table.push({ userId: user.id, namn: `${user.fornamn} ${user.efternamn}`, ratt: null });
            } else {
                let ratt = 0;
                for (let i = 1; i <= 13; i++) {
                    if (userTips[i] && userTips[i] !== '-' && userTips[i] === liveResults[i - 1]) ratt++;
                }
                table.push({ userId: user.id, namn: `${user.fornamn} ${user.efternamn}`, ratt });
            }
        }
    } else {
        // Normal: garderingar
        const [allGard] = await db.query(
            'SELECT id, matchNr, tecken FROM TIT_garderingar WHERE omgang = ? ORDER BY id, matchNr',
            [spelomgang]
        );
        const gardByUser = {};
        for (const g of allGard) {
            if (!gardByUser[g.id]) gardByUser[g.id] = {};
            gardByUser[g.id][g.matchNr] = g.tecken;
        }

        for (const user of users) {
            const userGard = gardByUser[user.id];
            if (!userGard) {
                table.push({ userId: user.id, namn: `${user.fornamn} ${user.efternamn}`, ratt: null });
            } else {
                let ratt = 0;
                for (let i = 1; i <= 13; i++) {
                    const tecken = userGard[i];
                    if (tecken && tecken !== '-' && tecken === liveResults[i - 1]) ratt++;
                }
                table.push({ userId: user.id, namn: `${user.fornamn} ${user.efternamn}`, ratt });
            }
        }
    }

    // Sort: users with ratt !== null by ratt DESC, then null users at end
    table.sort((a, b) => {
        if (a.ratt === null && b.ratt === null) return 0;
        if (a.ratt === null) return 1;
        if (b.ratt === null) return -1;
        return b.ratt - a.ratt;
    });

    // Assign positions (shared for ties)
    let pos = 1;
    for (let i = 0; i < table.length; i++) {
        if (table[i].ratt === null) {
            table[i].position = null;
        } else {
            if (i > 0 && table[i].ratt === table[i - 1].ratt && table[i - 1].ratt !== null) {
                table[i].position = table[i - 1].position;
            } else {
                table[i].position = pos;
            }
            pos = i + 2; // next position after this index
        }
    }

    return jsonResponse({ isSlutspel, spelomgang, table });
}

// GET GRUNDTIPSEN - shows each match with responsible user, their sign, correctness and odds
async function getGrundtipsen() {
    const db = getPool();
    const [ekoRows] = await db.query('SELECT spelomgang, drawNumber FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    if (!ekoRows.length) return jsonResponse([]);
    const { spelomgang, drawNumber } = ekoRows[0];

    // Get lottning (who is responsible for each match)
    const [lottRows] = await db.query('SELECT matchNr, ansvarigId FROM TIT_lottning WHERE spelomgang = ?', [spelomgang]);
    if (!lottRows.length) return jsonResponse([]);

    // Get tipsrad (grundtecken + poangGrund)
    const [tipsRows] = await db.query('SELECT matchNr, tecken, poangGrund FROM TIT_tipsrad WHERE spelomgang = ?', [spelomgang]);
    const tipsByMatch = {};
    for (const t of tipsRows) {
        tipsByMatch[t.matchNr] = { tecken: t.tecken, poangGrund: t.poangGrund };
    }

    // Get user names
    const [users] = await db.query('SELECT id, fornamn, efternamn FROM TIT_TipsTjanst ORDER BY id');
    const userMap = {};
    for (const u of users) {
        userMap[u.id] = `${u.fornamn} ${u.efternamn}`;
    }

    // Get kupong odds
    const [kupongRows] = await db.query('SELECT matchNr, odds1, oddsX, odds2 FROM TIT_kupong WHERE spelomgang = ?', [spelomgang]);
    const oddsByMatch = {};
    for (const k of kupongRows) {
        oddsByMatch[k.matchNr] = { '1': k.odds1, 'X': k.oddsX, '2': k.odds2 };
    }

    // Get live results from forecast
    let liveResults = []; // array of { sign, score, status }
    if (drawNumber) {
        try {
            const forecastUrl = `${SVENSKA_SPEL_BASE}draws/${drawNumber}/forecast?accesskey=${SVENSKA_SPEL_KEY}`;
            const resp = await fetch(forecastUrl);
            const data = await resp.json();
            if (data.forecast?.events) {
                liveResults = data.forecast.events.map(e => {
                    const status = e.sportEventStatus || 'Inte startat';
                    const isStarted = status !== 'Inte startat';
                    const score = isStarted ? (e.outcomeScore || '0-0') : null;
                    let sign = null;
                    if (score) {
                        const parts = score.split('-');
                        const home = parseInt(parts[0]) || 0;
                        const away = parseInt(parts[1]) || 0;
                        sign = home > away ? '1' : home < away ? '2' : 'X';
                    }
                    return { sign, score, status, isFinished: !!e.isFinished, cancelled: !!e.cancelled };
                });
            }
        } catch (e) { /* fallback */ }
    }

    // Get draw events for sportEventStart
    let startTimes = [];
    if (drawNumber) {
        try {
            const drawUrl = `${SVENSKA_SPEL_BASE}draws/${drawNumber}?accesskey=${SVENSKA_SPEL_KEY}`;
            const resp = await fetch(drawUrl);
            const data = await resp.json();
            if (data.draw?.events) {
                startTimes = data.draw.events.map(e => e.sportEventStart || '');
            }
        } catch (e) { /* fallback */ }
    }

    // Build result
    const result = [];
    for (const lott of lottRows) {
        const matchNr = lott.matchNr;
        const tip = tipsByMatch[matchNr] || null;
        const live = liveResults[matchNr - 1] || { sign: null, score: null, status: 'Inte startat' };
        const matchOdds = oddsByMatch[matchNr] || {};
        const isCorrect = tip && live.sign ? tip.tecken === live.sign : null;
        const isSTMF = tip ? tip.poangGrund === 1 : false;

        // Odds for the correct sign (the actual result sign)
        let odds = 0;
        if (isCorrect && !isSTMF && live.sign) {
            odds = parseFloat(matchOdds[live.sign]) || 0;
        }

        result.push({
            matchNr,
            ansvarig: userMap[lott.ansvarigId] || 'Okänd',
            tecken: tip ? tip.tecken : null,
            isCorrect,
            isSTMF,
            odds,
            score: live.score,
            status: live.status,
            isFinished: live.isFinished || false,
            cancelled: live.cancelled || false,
            sportEventStart: startTimes[matchNr - 1] || '',
        });
    }

    return jsonResponse(result);
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
const aiCache = {}; // key -> { text, time } (per warm instance, TTL nedan)

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
    // ESPN soccer-säsong = startår (t.ex. 2026-27-säsongen = "2026").
    const now = new Date();
    const currentSeason = (now.getMonth() + 1) >= 7 ? now.getFullYear() : now.getFullYear() - 1;

    const fetchCompleted = async (season) => {
        try {
            const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${espnLeague}/teams/${teamId}/schedule?season=${season}`;
            const resp = await fetch(url);
            if (!resp.ok) return [];
            const data = await resp.json();
            if (!data.events) return [];
            // Avslutade matcher, ESPN returnerar nyast först
            return data.events.filter(e =>
                e.competitions && e.competitions[0] && e.competitions[0].status &&
                e.competitions[0].status.type && e.competitions[0].status.type.completed
            );
        } catch { return []; }
    };

    // Innevarande säsong; tidigt på säsongen fylls listan på med förra säsongens senaste
    let completed = await fetchCompleted(currentSeason);
    if (completed.length < 5) {
        completed = completed.concat(await fetchCompleted(currentSeason - 1));
    }
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
            date: e.date || '',
        };
    });
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

// GET USER KUPONG - returns a user's gardering/enkelrad for a specific round with results
async function getUserKupong(query) {
    const db = getPool();
    const userId = query.userId;
    const spelomgang = query.spelomgang;
    if (!userId || !spelomgang) return jsonResponse({ error: 'userId and spelomgang required' }, 400);

    // Get round info
    const [ekoRows] = await db.query(
        'SELECT isSlutspel FROM TIT_ekonomi WHERE spelomgang = ?', [spelomgang]
    );
    const isSlutspel = ekoRows.length ? ekoRows[0].isSlutspel : 0;

    // Get user name
    const [userRows] = await db.query(
        "SELECT CONCAT(fornamn, ' ', efternamn) as namn FROM TIT_TipsTjanst WHERE id = ?", [userId]
    );
    const userName = userRows.length ? userRows[0].namn : '';

    // Get match info (lag, rtecken, odds)
    const [kupongRows] = await db.query(
        'SELECT matchNr, `lag`, rtecken, odds1, oddsX, odds2 FROM TITVIEWomgangInfo WHERE spelomgang = ? ORDER BY matchNr',
        [spelomgang]
    );

    // Get grundtecken
    const [grundRows] = await db.query(
        'SELECT matchNr, tecken as grundtecken, poangGrund FROM TIT_tipsrad WHERE spelomgang = ? ORDER BY matchNr',
        [spelomgang]
    );
    const grundMap = {};
    for (const g of grundRows) grundMap[g.matchNr] = g;

    // Get user's gardering/enkelrad (enkelrad ligger i TIT_garderingar även i slutspel)
    let userTeckenMap = {};
    if (isSlutspel) {
        const [rows] = await db.query(
            'SELECT matchNr, tecken FROM TIT_garderingar WHERE omgang = ? AND id = ? ORDER BY matchNr',
            [spelomgang, userId]
        );
        for (const r of rows) userTeckenMap[r.matchNr] = r.tecken;
    } else {
        const [rows] = await db.query(
            'SELECT matchNr, tecken FROM TIT_garderingar WHERE omgang = ? AND id = ? ORDER BY matchNr',
            [spelomgang, userId]
        );
        for (const r of rows) userTeckenMap[r.matchNr] = r.tecken;
    }

    // Build matches array
    const matches = [];
    const seen = new Set();
    for (const k of kupongRows) {
        if (seen.has(k.matchNr)) continue;
        seen.add(k.matchNr);
        const grund = grundMap[k.matchNr] || {};
        const userTecken = userTeckenMap[k.matchNr] || null;
        const rtecken = k.rtecken || null;
        const isSTMF = grund.poangGrund === -1;

        // Determine which odds to show
        let odds = 0;
        if (rtecken === '1') odds = k.odds1 || 0;
        else if (rtecken === 'X') odds = k.oddsX || 0;
        else if (rtecken === '2') odds = k.odds2 || 0;

        // Is the user's gardering correct?
        let isCorrect = null;
        if (rtecken && userTecken && userTecken !== '-') {
            if (isSlutspel) {
                isCorrect = userTecken === rtecken;
            } else {
                // Gardering is a string like "1X" or "1" - correct if rtecken is contained
                isCorrect = userTecken.includes(rtecken);
            }
        }

        matches.push({
            matchNr: k.matchNr,
            lag: k.lag || '',
            grundtecken: grund.grundtecken || null,
            userTecken,
            rtecken,
            isCorrect,
            isSTMF,
            odds,
        });
    }

    return jsonResponse({ userName, spelomgang, isSlutspel, matches });
}

// GET ALL GARDERINGAR - returns all users' garderingar for a round in a table format
async function getAllGarderingar(query) {
    const db = getPool();
    const spelomgang = query.spelomgang;
    if (!spelomgang) return jsonResponse({ error: 'spelomgang required' }, 400);

    const [ekoRows] = await db.query('SELECT isSlutspel FROM TIT_ekonomi WHERE spelomgang = ?', [spelomgang]);
    const isSlutspel = ekoRows.length ? ekoRows[0].isSlutspel : 0;

    // Get match info
    const [kupongRows] = await db.query(
        'SELECT matchNr, `lag`, rtecken FROM TITVIEWomgangInfo WHERE spelomgang = ? ORDER BY matchNr',
        [spelomgang]
    );
    const seen = new Set();
    const matches = [];
    const rteckenMap = {};
    for (const k of kupongRows) {
        if (seen.has(k.matchNr)) continue;
        seen.add(k.matchNr);
        matches.push({ matchNr: k.matchNr, lag: k.lag || '' });
        rteckenMap[k.matchNr] = k.rtecken || null;
    }

    // Get all users
    const [userRows] = await db.query("SELECT id, CONCAT(fornamn, ' ', efternamn) as namn FROM TIT_TipsTjanst ORDER BY id");

    // Get all garderingar/enkelrader (enkelrad ligger i TIT_garderingar även i slutspel)
    let teckenByUser = {};
    {
        const [rows] = await db.query(
            'SELECT id, matchNr, tecken FROM TIT_garderingar WHERE omgang = ? ORDER BY id, matchNr',
            [spelomgang]
        );
        for (const r of rows) {
            if (!teckenByUser[r.id]) teckenByUser[r.id] = {};
            teckenByUser[r.id][r.matchNr] = r.tecken;
        }
    }

    // Build users array with ratt count and per-match tecken
    const users = [];
    for (const u of userRows) {
        const userTecken = teckenByUser[u.id];
        if (!userTecken) continue; // skip users who haven't tipped
        let ratt = 0;
        const tecken = {};
        for (const m of matches) {
            const ut = userTecken[m.matchNr] || null;
            const rt = rteckenMap[m.matchNr];
            let isCorrect = null;
            if (rt && ut && ut !== '-') {
                isCorrect = isSlutspel ? (ut === rt) : ut.includes(rt);
                if (isCorrect) ratt++;
            }
            tecken[m.matchNr] = { t: ut, c: isCorrect };
        }
        users.push({ userId: u.id, namn: u.namn, ratt, tecken });
    }

    // Sort by ratt descending
    users.sort((a, b) => b.ratt - a.ratt);

    // Build rtecken array for matches
    const matchesWithResult = matches.map(m => ({
        matchNr: m.matchNr,
        lag: m.lag,
        rtecken: rteckenMap[m.matchNr],
    }));

    return jsonResponse({ spelomgang, isSlutspel, matches: matchesWithResult, users });
}

// AVSLUTA OMGÅNG - finalize the current round
async function avslutaOmgang() {
    const db = getPool();

    // 1. Get current round info
    const [ekoRows] = await db.query('SELECT spelomgang, drawNumber, isSlutspel, sasong FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    if (!ekoRows.length) return jsonResponse({ error: 'Ingen omgång hittad' }, 400);
    const { spelomgang, drawNumber, isSlutspel, sasong } = ekoRows[0];

    // 2. Fetch results from Svenska Spel
    const resultUrl = `${SVENSKA_SPEL_BASE}draws/result?accesskey=${SVENSKA_SPEL_KEY}`;
    const resultResp = await fetch(resultUrl);
    const resultData = await resultResp.json();
    if (!resultData.result || !resultData.result.events) {
        return jsonResponse({ error: 'Kunde inte hämta resultat från Svenska Spel' }, 500);
    }

    // 3. Update TIT_rattrad
    await db.query('DELETE FROM TIT_rattrad WHERE spelomgang = ?', [spelomgang]);
    for (const ev of resultData.result.events) {
        const matchNr = ev.eventNumber;
        const tecken = ev.outcome; // '1', 'X', or '2'
        await db.query('INSERT INTO TIT_rattrad (spelomgang, matchNr, tecken) VALUES (?, ?, ?)', [spelomgang, matchNr, tecken]);
        // Set odds based on tecken
        if (tecken === '1') {
            await db.query('UPDATE TIT_rattrad r JOIN TIT_kupong k ON r.spelomgang = k.spelomgang AND r.matchNr = k.matchNr SET r.odds = k.odds1 WHERE r.spelomgang = ? AND r.matchNr = ?', [spelomgang, matchNr]);
        } else if (tecken === 'X') {
            await db.query('UPDATE TIT_rattrad r JOIN TIT_kupong k ON r.spelomgang = k.spelomgang AND r.matchNr = k.matchNr SET r.odds = k.oddsX WHERE r.spelomgang = ? AND r.matchNr = ?', [spelomgang, matchNr]);
        } else if (tecken === '2') {
            await db.query('UPDATE TIT_rattrad r JOIN TIT_kupong k ON r.spelomgang = k.spelomgang AND r.matchNr = k.matchNr SET r.odds = k.odds2 WHERE r.spelomgang = ? AND r.matchNr = ?', [spelomgang, matchNr]);
        }
    }

    // Also update rtecken in kupong (if column exists)
    // rtecken is derived from TIT_rattrad in the VIEW, no need to update TIT_kupong

    // Remove garderingar that match grundtecken (they don't count as gardering)
    if (!isSlutspel) {
        await db.query("UPDATE TIT_garderingar g JOIN TIT_tipsrad t ON g.omgang = t.spelomgang AND g.matchNr = t.matchNr AND g.tecken = t.tecken SET g.tecken = '-' WHERE t.spelomgang = ?", [spelomgang]);
    }

    // 4. Calculate bästa enkelrad (antal rätt) from system rows
    const [rattRows] = await db.query('SELECT matchNr, tecken FROM TIT_rattrad WHERE spelomgang = ?', [spelomgang]);
    const rattMap = {};
    for (const r of rattRows) rattMap[r.matchNr] = r.tecken;

    let antalRatt = 0;
    const [sysRows] = await db.query('SELECT m1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12,m13 FROM TIT_systemrader WHERE drawNumber = ?', [drawNumber]);
    for (const row of sysRows) {
        let ratt = 0;
        for (let i = 1; i <= 13; i++) {
            if (row[`m${i}`] === rattMap[i]) ratt++;
        }
        if (ratt > antalRatt) antalRatt = ratt;
    }

    // 5. Get insats (antal systemrader)
    const [sysCount] = await db.query('SELECT COUNT(*) as cnt FROM TIT_systemrader WHERE drawNumber = ?', [drawNumber]);
    const insats = sysCount[0].cnt;

    // 6. Get utdelning from forecast distribution
    let vinst = 0;
    try {
        const forecastUrl = `${SVENSKA_SPEL_BASE}draws/${drawNumber}/forecast?accesskey=${SVENSKA_SPEL_KEY}`;
        const forecastResp = await fetch(forecastUrl);
        const forecastData = await forecastResp.json();
        if (forecastData.forecast && forecastData.forecast.distribution) {
            // Find distribution matching our antal rätt
            for (const d of forecastData.forecast.distribution) {
                // d.name is like "13 rätt", "12 rätt", etc.
                const match = d.name.match(/(\d+)\s*rätt/);
                if (match && parseInt(match[1]) === antalRatt) {
                    vinst = parseFloat(d.amount.replace(',', '.')) || 0;
                    break;
                }
            }
        }
    } catch (e) { /* ignore */ }

    // 7. Update TIT_ekonomi
    await db.query('UPDATE TIT_ekonomi SET antalRatt = ?, insats = ?, vinst = ? WHERE spelomgang = ?', [antalRatt, insats, vinst, spelomgang]);

    // 8. Update TipsAllsvenskan (only if not slutspel)
    if (!isSlutspel) {
        await updateTipsAllsvenskan(db, sasong);
    } else {
        // Slutspel: uppdatera slutspelstabellen (TIT_newSlutspel) för aktuell fas
        await updateSlutspel(db, sasong, spelomgang);
    }

    return jsonResponse({ 
        success: true, 
        spelomgang, 
        antalRatt, 
        insats, 
        vinst,
        tipsAllsvenskanUpdated: !isSlutspel,
        slutspelUpdated: !!isSlutspel
    });
}

// Uppdatera slutspelstabellen för aktuell fas (motsvarar webbens UpdateSlutspel).
// Fas (typ): 0=kvartsfinal, 1=semifinal, 2=final, utifrån hur många slutspels-
// omgångar säsongen har t.o.m. denna omgång. resultat = enkelradens (TIT_garderingar)
// antal rätt mot rättraden; sortpoang = seedning (TipsAllsvenskan-placering) som ärvs.
async function updateSlutspel(db, sasong, spelomgang) {
    // Vilken fas är denna slutspelsomgång? (0=kvart, 1=semi, 2=final)
    const [slutRounds] = await db.query(
        'SELECT COUNT(*) as cnt FROM TIT_ekonomi WHERE sasong = ? AND isSlutspel = 1 AND spelomgang <= ?',
        [sasong, spelomgang]
    );
    const typ = slutRounds[0].cnt - 1;
    if (typ < 0 || typ > 2) return;

    // Rättraden för omgången
    const [rattRows] = await db.query('SELECT matchNr, tecken FROM TIT_rattrad WHERE spelomgang = ?', [spelomgang]);
    const rattMap = {};
    for (const r of rattRows) rattMap[r.matchNr] = r.tecken;

    // Deltagare + seedning (sortpoang)
    let participants = []; // { id, namn, seed }
    if (typ === 0) {
        // Kvartsfinal: de 8 främsta i TipsAllsvenskan (seed = placering 1-8)
        const [top8] = await db.query(
            `SELECT a.id, CONCAT(u.fornamn, ' ', u.efternamn) as namn
             FROM TIT_TipsAllsvenskan a JOIN TIT_TipsTjanst u ON u.id = a.id
             WHERE a.sasong = ? ORDER BY a.poang DESC LIMIT 8`,
            [sasong]
        );
        participants = top8.map((r, i) => ({ id: r.id, namn: r.namn, seed: i + 1 }));
    } else {
        // Semifinal (4 från kvart) / Final (2 från semi): bästa från föregående fas
        const advanceCount = typ === 1 ? 4 : 2;
        const [prev] = await db.query(
            `SELECT id, namn, sortpoang FROM TIT_newSlutspel
             WHERE sasong = ? AND typ = ?
             ORDER BY resultat DESC, sortpoang ASC LIMIT ${advanceCount}`,
            [sasong, typ - 1]
        );
        participants = prev.map(r => ({ id: r.id, namn: r.namn, seed: r.sortpoang }));
    }

    // Enkelradens (TIT_garderingar) antal rätt per deltagare
    const [gardRows] = await db.query(
        'SELECT id, matchNr, tecken FROM TIT_garderingar WHERE omgang = ?',
        [spelomgang]
    );
    const enkelByUser = {};
    for (const g of gardRows) {
        (enkelByUser[g.id] ||= {})[g.matchNr] = g.tecken;
    }
    const calcRatt = (uid) => {
        const m = enkelByUser[uid];
        if (!m) return 0;
        let c = 0;
        for (let i = 1; i <= 13; i++) {
            if (m[i] && m[i] !== '-' && m[i] === rattMap[i]) c++;
        }
        return c;
    };

    // Skriv om fasens rader (idempotent vid omkörning)
    await db.query('DELETE FROM TIT_newSlutspel WHERE sasong = ? AND typ = ?', [sasong, typ]);
    for (const p of participants) {
        await db.query(
            'INSERT INTO TIT_newSlutspel (sasong, typ, id, namn, sortpoang, resultat) VALUES (?, ?, ?, ?, ?, ?)',
            [sasong, typ, p.id, p.namn, p.seed, calcRatt(p.id)]
        );
    }
}

// Helper: recalculate TipsAllsvenskan for a season
async function updateTipsAllsvenskan(db, sasong) {
    // Delete existing
    await db.query('DELETE FROM TIT_TipsAllsvenskan WHERE sasong = ?', [sasong]);

    // Get all rows from the VIEW for this season (non-slutspel), ordered by id (ansvarigId)
    // Each row = one match assigned to one user in one round
    const [viewRows] = await db.query(
        'SELECT id, etta, kryss, tvaa, rtecken, odds, poangGrund FROM TITVIEWomgangInfo WHERE sasong = ? AND isSlutspel = 0 ORDER BY id',
        [sasong]
    );

    // Group by user (id = ansvarigId)
    let currentUser = null;
    let v = 0, f = 0, po = 0;
    const usersData = [];

    for (const row of viewRows) {
        if (currentUser !== null && row.id !== currentUser) {
            usersData.push({ id: currentUser, spelade: v + f, sakra: v, poang: po });
            v = 0; f = 0; po = 0;
        }
        currentUser = row.id;

        if (row.poangGrund == 0 && row.rtecken && (
            (row.etta == 1 && row.rtecken === '1') ||
            (row.kryss == 1 && row.rtecken === 'X') ||
            (row.tvaa == 1 && row.rtecken === '2')
        )) {
            v++;
            po += parseFloat(row.odds) || 0;
        } else {
            f++;
        }
    }
    if (currentUser !== null) {
        usersData.push({ id: currentUser, spelade: v + f, sakra: v, poang: po });
    }

    // Insert
    for (const u of usersData) {
        await db.query(
            'INSERT INTO TIT_TipsAllsvenskan (sasong, id, spelade, sakra, gard, EnP, NollP, poang) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
            [sasong, u.id, u.spelade, u.sakra, u.sakra, u.spelade - u.sakra, u.poang.toFixed(2)]
        );
    }

    // Add bonus points from garderingar
    // SQL: join TIT_ekonomi (sasong, isSlutspel=0) with TIT_garderingar and TIT_rattrad
    // to find per round who has most correct garderingar
    const [gardBonusRows] = await db.query(
        `SELECT g.omgang, g.id, COUNT(*) as antal 
         FROM TIT_ekonomi e 
         JOIN TIT_garderingar g ON e.spelomgang = g.omgang 
         JOIN TIT_rattrad r ON g.omgang = r.spelomgang AND g.matchNr = r.matchNr AND g.tecken = r.tecken 
         WHERE e.sasong = ? AND e.isSlutspel = 0 
         GROUP BY g.omgang, g.id 
         ORDER BY g.omgang, COUNT(*) DESC, g.id`,
        [sasong]
    );

    let currentOmgang = null;
    let maxAntal = 0;
    for (const row of gardBonusRows) {
        if (row.omgang !== currentOmgang) {
            currentOmgang = row.omgang;
            maxAntal = row.antal;
        }
        if (row.omgang === currentOmgang && row.antal === maxAntal) {
            let bonusPo = 1;
            if (maxAntal >= 7) bonusPo = 3;
            else if (maxAntal >= 4) bonusPo = 2;
            await db.query(
                'UPDATE TIT_TipsAllsvenskan SET poang = poang + ?, BP = BP + ? WHERE id = ? AND sasong = ?',
                [bonusPo, bonusPo, row.id, sasong]
            );
        }
    }
}

// GET OMGANG STATUS - determines the state of the admin action button
async function getOmgangStatus() {
    const db = getPool();

    // Get latest round info
    const [ekoRows] = await db.query('SELECT spelomgang, drawNumber, isSlutspel FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    if (!ekoRows.length) return jsonResponse({ status: 'startNy', nextDrawNumber: null });
    const { spelomgang, drawNumber } = ekoRows[0];

    // Check if this round has been closed (TIT_rattrad filled)
    const [rattRows] = await db.query('SELECT COUNT(*) as cnt FROM TIT_rattrad WHERE spelomgang = ?', [spelomgang]);
    const roundClosed = rattRows[0].cnt >= 13;

    if (roundClosed) {
        // Round is closed - check if Svenska Spel has a new draw
        try {
            const drawsUrl = `${SVENSKA_SPEL_BASE}draws?accesskey=${SVENSKA_SPEL_KEY}`;
            const resp = await fetch(drawsUrl);
            const data = await resp.json();
            if (data.draws && data.draws[0]) {
                const nextDrawNumber = data.draws[0].drawNumber;
                if (nextDrawNumber > drawNumber) {
                    return jsonResponse({ status: 'startNy', nextDrawNumber, nextSpelomgang: extractSpelomgang(data.draws[0].drawComment) });
                }
            }
        } catch (e) { /* ignore */ }
        return jsonResponse({ status: 'vantar', spelomgang });
    }

    // Round not closed - check if all matches are finished via forecast
    try {
        const forecastUrl = `${SVENSKA_SPEL_BASE}draws/${drawNumber}/forecast?accesskey=${SVENSKA_SPEL_KEY}`;
        const resp = await fetch(forecastUrl);
        const data = await resp.json();
        if (data.forecast && data.forecast.events) {
            const allFinished = data.forecast.events.every(e => e.isFinished || e.cancelled);
            if (allFinished) {
                return jsonResponse({ status: 'avsluta', spelomgang });
            }
        }
    } catch (e) { /* ignore */ }

    // Round is active, not all finished yet → can update odds
    return jsonResponse({ status: 'updateOdds', spelomgang, drawNumber });
}

function extractSpelomgang(drawComment) {
    if (!drawComment) return 'XXXX-XX';
    const str = drawComment.toString();
    return str.length > 7 ? str.substring(str.length - 7, str.length).trim() : 'XXXX-XX';
}

// Svenska Spel returns decimal numbers as strings with comma ("1,68"). Parse safely.
function parseSSNumber(val, fallback = 0) {
    if (val === null || val === undefined || val === '') return fallback;
    const s = String(val).replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? fallback : n;
}

// START NY OMGÅNG - initiate a new round
async function startNyOmgang(params) {
    const db = getPool();
    const veckansKapital = params.veckansKapital || 260;
    const isSlutspel = params.isSlutspel || 0;

    // Fetch latest draw from Svenska Spel
    const drawsUrl = `${SVENSKA_SPEL_BASE}draws?accesskey=${SVENSKA_SPEL_KEY}`;
    const resp = await fetch(drawsUrl);
    const data = await resp.json();
    if (!data.draws || !data.draws[0] || !data.draws[0].events) {
        return jsonResponse({ error: 'Ingen kupong tillgänglig hos Svenska Spel' }, 400);
    }

    const draw = data.draws[0];
    const newDrawNumber = draw.drawNumber;
    const spelomgang = extractSpelomgang(draw.drawComment);

    // Check that this draw is actually new
    const [ekoRows] = await db.query('SELECT MAX(drawNumber) as maxDraw, MAX(sasong) as sasong FROM TIT_ekonomi');
    const maxDraw = ekoRows[0].maxDraw || 0;
    const sasong = ekoRows[0].sasong || 1;
    if (newDrawNumber <= maxDraw) {
        return jsonResponse({ error: 'Denna omgång finns redan i databasen' }, 400);
    }

    // 1. Insert into TIT_ekonomi
    await db.query(
        'INSERT INTO TIT_ekonomi (spelomgang, drawNumber, antalRatt, sasong, isSlutspel, veckansKapital) VALUES (?, ?, 0, ?, ?, ?)',
        [spelomgang, newDrawNumber, sasong, isSlutspel, veckansKapital]
    );

    // 2. Insert kupong from Svenska Spel data
    await db.query('DELETE FROM TIT_kupong WHERE spelomgang = ?', [spelomgang]);
    for (const ev of draw.events) {
        const matchNr = ev.eventNumber;
        const lag = `${ev.participants[0].name} - ${ev.participants[1].name}`;
        const home = ev.participants[0].name;
        const away = ev.participants[1].name;
        const odds1 = ev.odds ? (parseSSNumber(ev.odds.home, 0) || 1) : 1;
        const oddsX = ev.odds ? (parseSSNumber(ev.odds.draw, 0) || 1) : 1;
        const odds2 = ev.odds ? (parseSSNumber(ev.odds.away, 0) || 1) : 1;
        const tio1 = ev.newspaperAdvice ? parseSSNumber(ev.newspaperAdvice.home, 0) : 0;
        const tioX = ev.newspaperAdvice ? parseSSNumber(ev.newspaperAdvice.draw, 0) : 0;
        const tio2 = ev.newspaperAdvice ? parseSSNumber(ev.newspaperAdvice.away, 0) : 0;
        const sv1 = ev.distribution ? parseSSNumber(ev.distribution.home, 0) : 0;
        const svX = ev.distribution ? parseSSNumber(ev.distribution.draw, 0) : 0;
        const sv2 = ev.distribution ? parseSSNumber(ev.distribution.away, 0) : 0;
        const matchid = ev.sportEventId || 0;
        const liga = ev.league ? ev.league.name : '';
        const datum = ev.sportEventStart || '';

        await db.query(
            'INSERT INTO TIT_kupong (spelomgang, matchNr, `lag`, odds1, oddsX, odds2, home, away, tioTidningar1, tioTidningarX, tioTidningar2, svenskaFolket1, svenskaFolketX, svenskaFolket2, matchid, liga, datum) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [spelomgang, matchNr, lag, odds1, oddsX, odds2, home, away, tio1, tioX, tio2, sv1, svX, sv2, matchid, liga, datum]
        );
    }

    // 3. Lottning - assign users randomly to matches
    await db.query('DELETE FROM TIT_lottning WHERE spelomgang = ?', [spelomgang]);
    const [users] = await db.query('SELECT id FROM TIT_TipsTjanst ORDER BY RAND()');
    for (let i = 0; i < users.length && i < 13; i++) {
        await db.query(
            'INSERT INTO TIT_lottning (spelomgang, matchNr, ansvarigId) VALUES (?, ?, ?)',
            [spelomgang, i + 1, users[i].id]
        );
    }

    // 4. Set game to open
    await db.query('UPDATE TIT_admin SET speletOppet = 1');

    // 5. Nollställ målrapporten (sparas bara för aktuell omgång)
    await ensureMallistaSchema(db);
    await db.query('DELETE FROM TIT_mallista');
    await db.query('DELETE FROM TIT_livescore');

    return jsonResponse({
        success: true,
        spelomgang,
        drawNumber: newDrawNumber,
        antalMatcher: draw.events.length,
        antalDeltagare: users.length,
    });
}

// UPDATE ODDS - refresh odds from Svenska Spel for current round
async function updateOdds() {
    const db = getPool();

    // Get current round's drawNumber and spelomgang
    const [ekoRows] = await db.query('SELECT spelomgang, drawNumber FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    if (!ekoRows.length) return jsonResponse({ error: 'Ingen omgång hittad' }, 400);
    const { spelomgang, drawNumber } = ekoRows[0];

    // Fetch current draw from Svenska Spel
    const drawUrl = `${SVENSKA_SPEL_BASE}draws/${drawNumber}?accesskey=${SVENSKA_SPEL_KEY}`;
    const resp = await fetch(drawUrl);
    const data = await resp.json();
    if (!data.draw || !data.draw.events) {
        return jsonResponse({ error: 'Kunde inte hämta kupong från Svenska Spel' }, 500);
    }

    let updated = 0;
    for (const ev of data.draw.events) {
        const matchNr = ev.eventNumber;
        const odds1 = ev.odds ? (parseSSNumber(ev.odds.home, 0) || 1) : 1;
        const oddsX = ev.odds ? (parseSSNumber(ev.odds.draw, 0) || 1) : 1;
        const odds2 = ev.odds ? (parseSSNumber(ev.odds.away, 0) || 1) : 1;
        const sv1 = ev.distribution ? parseSSNumber(ev.distribution.home, 0) : 0;
        const svX = ev.distribution ? parseSSNumber(ev.distribution.draw, 0) : 0;
        const sv2 = ev.distribution ? parseSSNumber(ev.distribution.away, 0) : 0;

        const [result] = await db.query(
            'UPDATE TIT_kupong SET odds1 = ?, oddsX = ?, odds2 = ?, svenskaFolket1 = ?, svenskaFolketX = ?, svenskaFolket2 = ? WHERE spelomgang = ? AND matchNr = ?',
            [odds1, oddsX, odds2, sv1, svX, sv2, spelomgang, matchNr]
        );
        if (result.changedRows > 0) updated++;
    }

    return jsonResponse({ success: true, spelomgang, updated });
}

// GET ROUND HISTORY - all rounds in current season with gardering table + grundtips
async function getRoundHistory() {
    const db = getPool();

    // Get latest season
    const [maxRows] = await db.query('SELECT MAX(sasong) as maxSasong FROM TIT_TipsAllsvenskan');
    if (!maxRows.length || !maxRows[0].maxSasong) return jsonResponse({ rounds: [], sasong: null });
    const sasong = maxRows[0].maxSasong;

    // Get all rounds in this season (finished ones - with antalRatt set)
    const [ekoRows] = await db.query(
        'SELECT spelomgang, antalRatt, isSlutspel FROM TIT_ekonomi WHERE sasong = ? AND antalRatt > 0 ORDER BY spelomgang ASC',
        [sasong]
    );
    if (!ekoRows.length) return jsonResponse({ rounds: [], sasong });

    // Get all users
    const [users] = await db.query('SELECT id, fornamn, efternamn FROM TIT_TipsTjanst ORDER BY id');
    const userMap = {};
    for (const u of users) {
        userMap[u.id] = `${u.fornamn} ${u.efternamn}`;
    }

    const rounds = [];
    let roundNr = 1;

    for (const eko of ekoRows) {
        const { spelomgang, isSlutspel } = eko;

        // Get kupong data (has rtecken, odds, user assignment)
        const [kupongRows] = await db.query(
            'SELECT matchNr, id, odds1, oddsX, odds2, rtecken FROM TITVIEWomgangInfo WHERE spelomgang = ? ORDER BY matchNr',
            [spelomgang]
        );

        // Get tipsrad (grundtecken + poangGrund) - more reliable than VIEW ltecken
        const [tipsRows] = await db.query(
            'SELECT matchNr, tecken, poangGrund FROM TIT_tipsrad WHERE spelomgang = ?',
            [spelomgang]
        );
        const tipsByMatch = {};
        for (const t of tipsRows) {
            tipsByMatch[t.matchNr] = { tecken: t.tecken, poangGrund: t.poangGrund };
        }

        // Build grundtips
        const grundtips = kupongRows.map(k => {
            const tip = tipsByMatch[k.matchNr] || null;
            const tecken = tip ? tip.tecken : null;
            const isSTMF = tip ? tip.poangGrund === 1 : false;
            const isCorrect = tecken && k.rtecken ? tecken === k.rtecken : null;
            let odds = 0;
            if (isCorrect && !isSTMF && k.rtecken) {
                if (k.rtecken === '1') odds = parseFloat(k.odds1) || 0;
                else if (k.rtecken === 'X') odds = parseFloat(k.oddsX) || 0;
                else if (k.rtecken === '2') odds = parseFloat(k.odds2) || 0;
            }
            return {
                matchNr: k.matchNr,
                ansvarig: userMap[k.id] || 'Okänd',
                tecken,
                rtecken: k.rtecken || null,
                isCorrect,
                isSTMF,
                odds,
            };
        });

        // Gardering/enkelrad-tabell. Enkelraden i slutspel ligger också i TIT_garderingar,
        // så tabellen räknas identiskt oavsett omgångstyp.
        let garderingTable = [];
        {
            const [allGard] = await db.query(
                'SELECT id, matchNr, tecken FROM TIT_garderingar WHERE omgang = ? ORDER BY id, matchNr',
                [spelomgang]
            );
            const gardByUser = {};
            for (const g of allGard) {
                if (!gardByUser[g.id]) gardByUser[g.id] = {};
                gardByUser[g.id][g.matchNr] = g.tecken;
            }
            for (const user of users) {
                const userGard = gardByUser[user.id];
                if (!userGard) {
                    garderingTable.push({ userId: user.id, namn: userMap[user.id], ratt: null });
                } else {
                    let ratt = 0;
                    for (const k of kupongRows) {
                        const tecken = userGard[k.matchNr];
                        if (tecken && tecken !== '-' && k.rtecken && tecken === k.rtecken) ratt++;
                    }
                    garderingTable.push({ userId: user.id, namn: userMap[user.id], ratt });
                }
            }
        }

        // Sort gardering table
        garderingTable.sort((a, b) => {
            if (a.ratt === null && b.ratt === null) return 0;
            if (a.ratt === null) return 1;
            if (b.ratt === null) return -1;
            return b.ratt - a.ratt;
        });
        let pos = 1;
        for (let i = 0; i < garderingTable.length; i++) {
            if (garderingTable[i].ratt === null) {
                garderingTable[i].position = null;
            } else {
                if (i > 0 && garderingTable[i].ratt === garderingTable[i - 1].ratt && garderingTable[i - 1].ratt !== null) {
                    garderingTable[i].position = garderingTable[i - 1].position;
                } else {
                    garderingTable[i].position = pos;
                }
                pos = i + 2;
            }
        }

        rounds.push({
            roundNr,
            spelomgang,
            isSlutspel,
            grundtips,
            garderingTable,
        });
        roundNr++;
    }

    return jsonResponse({ rounds, sasong });
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
        `SELECT a.id, a.spelade, a.sakra, a.poang, a.BP,
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
        odds: parseFloat((r.poang - (r.BP || 0)).toFixed(2)),
        gard: r.BP || 0,
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

// GET SLUTSPEL - playoff bracket (kvartsfinal -> semifinal -> final) for current season
async function getSlutspel() {
    const db = getPool();

    // Current season = latest TipsAllsvenskan season
    const [maxRows] = await db.query('SELECT MAX(sasong) as s FROM TIT_TipsAllsvenskan');
    if (!maxRows.length || !maxRows[0].s) {
        return jsonResponse({ sasong: null });
    }
    const sasong = maxRows[0].s;

    // All finished-phase results for the season (populated only after a phase is played)
    const [rows] = await db.query(
        'SELECT typ, id, namn, sortpoang, resultat FROM TIT_newSlutspel WHERE sasong = ?',
        [sasong]
    );
    const byTyp = { 0: [], 1: [], 2: [] };
    for (const r of rows) {
        if (byTyp[r.typ]) byTyp[r.typ].push(r);
    }

    // resultat DESC, then sortpoang ASC (tiebreak)
    const rank = (arr) => [...arr].sort((a, b) => {
        if (b.resultat !== a.resultat) return b.resultat - a.resultat;
        return (a.sortpoang ?? 0) - (b.sortpoang ?? 0);
    });

    const played = (arr, advanceCount) => ({
        played: true,
        entries: rank(arr).map((r, i) => ({
            id: r.id, namn: r.namn, resultat: r.resultat,
            sortpoang: r.sortpoang, advances: i < advanceCount,
        })),
    });
    const upcoming = (entries) => ({
        played: false,
        entries: entries.map(e => ({ id: e.id, namn: e.namn, resultat: null, sortpoang: null, advances: false })),
    });

    // Kvartsfinal (typ 0): played -> use results; else the 8 qualifiers from TipsAllsvenskan
    let kvart;
    if (byTyp[0].length > 0) {
        kvart = played(byTyp[0], 4);
    } else {
        const [standings] = await db.query(
            `SELECT a.id, a.poang, CONCAT(u.fornamn, ' ', u.efternamn) as namn
             FROM TIT_TipsAllsvenskan a JOIN TIT_TipsTjanst u ON u.id = a.id
             WHERE a.sasong = ? ORDER BY a.poang DESC LIMIT 8`,
            [sasong]
        );
        kvart = { played: false, entries: standings.map(s => ({ id: s.id, namn: s.namn, resultat: null, sortpoang: null, advances: false, poang: s.poang })) };
    }

    // Semifinal (typ 1): played -> use results; else the top 4 kvartsfinalists (if kvart played)
    let semi;
    if (byTyp[1].length > 0) {
        semi = played(byTyp[1], 2);
    } else if (byTyp[0].length > 0) {
        semi = upcoming(rank(byTyp[0]).slice(0, 4));
    } else {
        semi = { played: false, entries: [] };
    }

    // Final (typ 2): played -> use results; else the top 2 semifinalists (if semi played)
    let final;
    if (byTyp[2].length > 0) {
        final = played(byTyp[2], 1);
    } else if (byTyp[1].length > 0) {
        final = upcoming(rank(byTyp[1]).slice(0, 2));
    } else {
        final = { played: false, entries: [] };
    }

    const winner = final.played && final.entries.length
        ? { id: final.entries[0].id, namn: final.entries[0].namn }
        : null;

    let currentPhase = 'kvart';
    if (byTyp[2].length > 0) currentPhase = 'done';
    else if (byTyp[1].length > 0) currentPhase = 'final';
    else if (byTyp[0].length > 0) currentPhase = 'semi';

    return jsonResponse({ sasong, currentPhase, kvart, semi, final, winner });
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
        notis_meddelande TINYINT(1) DEFAULT 1,
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
    // Remove this token from any other user (device changed owner)
    await db.query(
        'DELETE FROM TIT_push_tokens WHERE pushToken = ? AND userId != ?',
        [pushToken, userId]
    );
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
    await ensureMessageSchema(db);
    const [rows] = await db.query(
        'SELECT notis_ny_kupong, notis_spelstopp, notis_live, notis_meddelande FROM TIT_push_tokens WHERE userId = ? LIMIT 1',
        [userId]
    );
    if (!rows.length) {
        return jsonResponse({ notis_ny_kupong: 1, notis_spelstopp: 1, notis_live: 1, notis_meddelande: 1 });
    }
    return jsonResponse(rows[0]);
}

async function updatePushSettings(params) {
    const { userId, notis_ny_kupong, notis_spelstopp, notis_live, notis_meddelande } = params;
    if (!userId) return jsonResponse({ error: 'userId krävs' }, 400);
    const db = getPool();
    await ensureMessageSchema(db);
    await db.query(
        `UPDATE TIT_push_tokens 
         SET notis_ny_kupong = ?, notis_spelstopp = ?, notis_live = ?, notis_meddelande = ?
         WHERE userId = ?`,
        [notis_ny_kupong ? 1 : 0, notis_spelstopp ? 1 : 0, notis_live ? 1 : 0, notis_meddelande ? 1 : 0, userId]
    );
    return jsonResponse({ success: true });
}

// SAVE ADMIN MESSAGE - update the message shown on home screen
async function saveAdminMessage(params) {
    const userId = parseInt(params.userId || params.get?.('userId'));
    if (userId !== 1) return jsonResponse({ error: 'Ej behörig' }, 403);
    const db = getPool();
    await ensureMessageSchema(db);
    const message = (params.message ?? '').toString();
    await db.query('UPDATE TIT_admin SET message = ?', [message]);
    return jsonResponse({ success: true, message });
}

// SEND MESSAGE PUSH - push the current admin message to all opted-in users
async function sendMessagePush(params) {
    const userId = parseInt(params.userId || params.get?.('userId'));
    if (userId !== 1) return jsonResponse({ error: 'Ej behörig' }, 403);
    const db = getPool();
    await ensureMessageSchema(db);
    const [adminRows] = await db.query('SELECT message FROM TIT_admin LIMIT 1');
    const message = adminRows.length ? (adminRows[0].message || '').trim() : '';
    if (!message) return jsonResponse({ error: 'Inget meddelande att skicka' }, 400);
    const [tokens] = await db.query('SELECT DISTINCT pushToken FROM TIT_push_tokens WHERE notis_meddelande = 1');
    const pushTokens = tokens.map(t => t.pushToken);
    if (!pushTokens.length) return jsonResponse({ success: true, sent: 0 });
    await sendExpoPush(pushTokens, '📢 Meddelande', message, { type: 'message' });
    return jsonResponse({ success: true, sent: pushTokens.length });
}

// SEND PUSH ONLY - send a one-off push notification WITHOUT saving to DB
async function sendPushOnly(params) {
    const userId = parseInt(params.userId || params.get?.('userId'));
    if (userId !== 1) return jsonResponse({ error: 'Ej behörig' }, 403);
    const message = (params.message ?? '').toString().trim();
    if (!message) return jsonResponse({ error: 'Inget meddelande att skicka' }, 400);
    const db = getPool();
    await ensureMessageSchema(db);
    const [tokens] = await db.query('SELECT DISTINCT pushToken FROM TIT_push_tokens WHERE notis_meddelande = 1');
    const pushTokens = tokens.map(t => t.pushToken);
    if (!pushTokens.length) return jsonResponse({ success: true, sent: 0 });
    await sendExpoPush(pushTokens, '📢 Meddelande', message, { type: 'message' });
    return jsonResponse({ success: true, sent: pushTokens.length });
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
    const [ekoRows] = await db.query('SELECT spelomgang, drawNumber, isSlutspel FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    if (!ekoRows.length) return;
    const spelomgang = ekoRows[0].spelomgang;
    const isSlutspel = ekoRows[0].isSlutspel === 1;

    // === NOTIS 1: Ny kupong ute ===
    // Tue-Thu, Tue from 08:00, stop at Thu 12:00
    const isTue = sweDay === 2;
    const isWed = sweDay === 3;
    const isThu = sweDay === 4;
    const isFri = sweDay === 5;
    const inNotis1Window = (isTue && sweHour >= 8) || isWed || (isThu && sweHour < 12);

    if (!isSlutspel && inNotis1Window) {
        // Find users who have a lottning but haven't tipped yet
        const [untipped] = await db.query(
            `SELECT DISTINCT l.ansvarigId as userId
             FROM TIT_lottning l
             LEFT JOIN TIT_tipsrad t ON t.spelomgang = l.spelomgang AND t.ansvarigId = l.ansvarigId
             WHERE l.spelomgang = ? AND t.matchNr IS NULL`,
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
    if (!isSlutspel && isThu && sweHour === 10) {
        const [alreadySent] = await db.query(
            "SELECT id FROM TIT_push_log WHERE notisType = 'spelstopp_10' AND spelomgang = ? LIMIT 1",
            [spelomgang]
        );
        if (!alreadySent.length) {
            const [untipped] = await db.query(
                `SELECT DISTINCT l.ansvarigId as userId
                 FROM TIT_lottning l
                 LEFT JOIN TIT_tipsrad t ON t.spelomgang = l.spelomgang AND t.ansvarigId = l.ansvarigId
                 WHERE l.spelomgang = ? AND t.matchNr IS NULL`,
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
    if (!isSlutspel && isThu && sweHour === 11 && now.getUTCMinutes() >= 43 && now.getUTCMinutes() <= 47) {
        const [alreadySent] = await db.query(
            "SELECT id FROM TIT_push_log WHERE notisType = 'spelstopp_1145' AND spelomgang = ? LIMIT 1",
            [spelomgang]
        );
        if (!alreadySent.length) {
            const [untipped] = await db.query(
                `SELECT DISTINCT l.ansvarigId as userId
                 FROM TIT_lottning l
                 LEFT JOIN TIT_tipsrad t ON t.spelomgang = l.spelomgang AND t.ansvarigId = l.ansvarigId
                 WHERE l.spelomgang = ? AND t.matchNr IS NULL`,
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
    if (!isSlutspel && isThu && sweHour === 12 && sweMinutes >= 13 && sweMinutes <= 17) {
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
    if (!isSlutspel && isFri && sweHour === 11 && sweMinutes >= 48 && sweMinutes <= 52) {
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

    // === NOTIS 3d + 3e: Slutspel - påminnelse om enkelrad (fredag kl 10 + 11:45) ===
    // Enkelraden kan lämnas hela veckan t.o.m. fredag kl 12, så ingen påminnelse förrän fredag kl 10.
    if (isSlutspel && isFri) {
        const enkelReminders = [];
        if (sweHour === 10 && sweMinutes <= 4) {
            enkelReminders.push({ type: 'enkelrad_10', body: 'Enkelraden stänger kl 12. Lämna din rad i appen.' });
        }
        if (sweHour === 11 && sweMinutes >= 43 && sweMinutes <= 47) {
            enkelReminders.push({ type: 'enkelrad_1145', body: '15 minuter kvar till spelstopp – lämna din enkelrad.' });
        }
        for (const rem of enkelReminders) {
            const [alreadySent] = await db.query(
                'SELECT id FROM TIT_push_log WHERE notisType = ? AND spelomgang = ? LIMIT 1',
                [rem.type, spelomgang]
            );
            if (alreadySent.length) continue;
            // Users with a push token who have NOT submitted a complete enkelrad (13 tecken)
            const [untipped] = await db.query(
                `SELECT DISTINCT pt.userId
                 FROM TIT_push_tokens pt
                 WHERE pt.notis_spelstopp = 1
                   AND (SELECT COUNT(*) FROM TIT_garderingar g
                        WHERE g.omgang = ? AND g.id = pt.userId) < 13`,
                [spelomgang]
            );
            for (const row of untipped) {
                const [tokens] = await db.query(
                    'SELECT pushToken FROM TIT_push_tokens WHERE userId = ? AND notis_spelstopp = 1',
                    [row.userId]
                );
                if (!tokens.length) continue;
                await sendExpoPush(tokens.map(t => t.pushToken), 'Snart spelstopp', rem.body);
                await db.query(
                    'INSERT IGNORE INTO TIT_push_log (userId, notisType, spelomgang) VALUES (?, ?, ?)',
                    [row.userId, rem.type, spelomgang]
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

    // Bygg upp målrapporten (måländringar sedan förra hämtningen)
    try { await detectGoals(db, spelomgang, events); } catch (e) { context.log('detectGoals error:', e); }
    const started = events.filter(e => e.sportEventStatus !== 'Inte startat');
    const finished = events.filter(e => e.isFinished || e.cancelled);

    const currentlyPlaying = events.filter(e => e.sportEventStatus !== 'Inte startat' && !e.isFinished && !e.cancelled);
    const inProgress = currentlyPlaying.length > 0; // At least one match actively playing right now

    const allDone = finished.length === 13;

    // Get system rows for calculating rätt
    const [sysRows] = await db.query('SELECT * FROM TIT_systemrader WHERE drawNumber = ?', [drawNumber]);

    // Tecken för ett event. Ej startad match (saknar outcomeScore) = 0-0 = X,
    // samma antagande som live-vyn i appen använder.
    function eventSign(event) {
        if (!event || !event.outcomeScore) return 'X';
        const parts = event.outcomeScore.split('-');
        const homeGoals = parseInt(parts[0]) || 0;
        const awayGoals = parseInt(parts[1]) || 0;
        return homeGoals > awayGoals ? '1' : homeGoals < awayGoals ? '2' : 'X';
    }

    function calcBestCorrect(sysRows, events) {
        let best = 0;
        for (const row of sysRows) {
            let correct = 0;
            for (let i = 1; i <= 13; i++) {
                const event = events[i - 1];
                if (!event) continue;
                if (row[`m${i}`] === eventSign(event)) correct++;
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
                if (!event) continue;
                if (row[`m${i}`] === eventSign(event)) correct++;
            }
            rightCount[correct] = (rightCount[correct] || 0) + 1;
        }
        // När en match är oavgjord publicerar Svenska Spel tre varianter per
        // vinstgrupp (tecken 1/X/2 för den kvarvarande matchen). Välj den variant
        // som matchar matchens aktuella resultat i stället för att summera alla tre.
        let total = 0;
        for (const numRight of [13, 12, 11, 10]) {
            const count = rightCount[numRight] || 0;
            if (count <= 0) continue;
            const entries = distribution.filter(d => {
                if (!d || !d.name) return false;
                const m = d.name.match(/(\d+)/);
                return m && parseInt(m[1]) === numRight;
            });
            if (!entries.length) continue;
            let entry = entries[0];
            if (entries.length > 1 && entries[0].eventNumber) {
                const evNr = parseInt(entries[0].eventNumber);
                const ev = events[evNr - 1] || events.find(e => e.eventNumber === evNr);
                const sign = eventSign(ev);
                const matched = entries.find(e => e.sign === sign);
                if (matched) entry = matched;
            }
            const amountStr = typeof entry.amount === 'string' ? entry.amount : String(entry.amount || 0);
            const amount = parseFloat(amountStr.replace(',', '.')) || 0;
            total += count * amount;
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
                // Seed live_rapport timestamp so first rapport waits 15 min after start
                await db.query(
                    'INSERT IGNORE INTO TIT_push_log (userId, notisType, spelomgang, sentAt) VALUES (?, ?, ?, UTC_TIMESTAMP())',
                    [u.userId, 'live_rapport', spelomgang]
                );
            }
        }
    }

    // === NOTIS 5: Rapport var 15:e minut ===
    if (inProgress && sysRows.length) {
      try {
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
            // Use forecast distribution (available during live)
            const distribution = forecast.distribution || [];
            const winnings = calcWinnings(sysRows, events, distribution);
            const winStr = winnings > 0 ? `${winnings.toLocaleString('sv-SE')} kr` : '0 kr';

            await sendExpoPush(
                liveTokens,
                'Rapport från Stryktipset',
                `Just nu: ${bestCorrect} rätt. Prognos: ${winStr}. Följ spänningen i appen.`
            );
            // Delete old rapport entries then insert fresh with current timestamp
            await db.query(
                "DELETE FROM TIT_push_log WHERE notisType = 'live_rapport' AND spelomgang = ?",
                [spelomgang]
            );
            const [allLiveUsers] = await db.query('SELECT DISTINCT userId FROM TIT_push_tokens WHERE notis_live = 1');
            for (const u of allLiveUsers) {
                await db.query(
                    'INSERT INTO TIT_push_log (userId, notisType, spelomgang, sentAt) VALUES (?, ?, ?, UTC_TIMESTAMP())',
                    [u.userId, 'live_rapport', spelomgang]
                );
            }
        }
      } catch (err) {
        context.log('NOTIS 5 (live_rapport) error:', err);
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
            // Use forecast distribution
            const distribution = forecast.distribution || [];
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
                case 'getDashboard':
                    return await getDashboard(params);
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
                case 'getLiveGarderingTable':
                    return await getLiveGarderingTable();
                case 'getMallista':
                    return await getMallista();
                case 'getGrundtipsen':
                    return await getGrundtipsen();
                case 'getMatchAnalysis':
                    return await getMatchAnalysis(params);
                case 'debug': {
                    const db = getPool();
                    const [lott] = await db.query('SELECT DISTINCT spelomgang FROM TIT_lottning ORDER BY spelomgang DESC LIMIT 5');
                    const [tips] = await db.query('SELECT DISTINCT spelomgang FROM TIT_tipsrad ORDER BY spelomgang DESC LIMIT 5');
                    const [kup] = await db.query('SELECT DISTINCT spelomgang FROM TIT_kupong ORDER BY spelomgang DESC LIMIT 5');
                    const [eko] = await db.query('SELECT * FROM TIT_ekonomi');
                    const [pushLog] = await db.query('SELECT * FROM TIT_push_log WHERE spelomgang = (SELECT spelomgang FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1) ORDER BY sentAt DESC');
                    return jsonResponse({ lottning: lott, tipsrad: tips, kupong: kup, ekonomi: eko, pushLog });
                }
                case 'getTipsAllsvenskan':
                    return await getTipsAllsvenskan(params);
                case 'getSlutspel':
                    return await getSlutspel();
                case 'getRoundHistory':
                    return await getRoundHistory();
                case 'getUserKupong':
                    return await getUserKupong(params);
                case 'getAllGarderingar':
                    return await getAllGarderingar(params);
                case 'avslutaOmgang':
                    return await avslutaOmgang();
                case 'getOmgangStatus':
                    return await getOmgangStatus();
                case 'startNyOmgang':
                    return await startNyOmgang(params);
                case 'updateOdds':
                    return await updateOdds();
                case 'registerPushToken':
                    return await registerPushToken(params);
                case 'getPushSettings':
                    return await getPushSettings(params);
                case 'updatePushSettings':
                    return await updatePushSettings(params);
                case 'saveAdminMessage':
                    return await saveAdminMessage(params);
                case 'sendMessagePush':
                    return await sendMessagePush(params);
                case 'sendPushOnly':
                    return await sendPushOnly(params);
                case 'analyzeMatch': {
                    if (!GEMINI_API_KEY) return jsonResponse({ error: 'AI not configured' }, 503);
                    const hemmalag = params.hemmalag;
                    const bortalag = params.bortalag;
                    const serie = params.serie || 'okänd serie';
                    const matchdata = params.matchdata || '';
                    if (!hemmalag || !bortalag) return jsonResponse({ error: 'hemmalag and bortalag required' }, 400);

                    // Cache per match (~30 min) så upprepade öppningar blir omedelbara
                    const cacheKey = `${hemmalag}|${bortalag}|${serie}|${matchdata ? '1' : '0'}`;
                    const cached = aiCache[cacheKey];
                    if (cached && (Date.now() - cached.time) < 30 * 60 * 1000) {
                        return jsonResponse({ analysis: cached.text, hemmalag, bortalag, serie, cached: true });
                    }

                    const prompt = matchdata
                        ? `Du är en fotbollsexpert. Analysera matchen ${hemmalag} vs ${bortalag} i ${serie} utifrån AKTUELL data nedan.\n\n${matchdata}\n\nGe en kort analys (max 120 ord) på svenska om lagens form, styrkor/svagheter och troligt utfall (1/X/2). Grunda analysen på datan ovan. Avsluta med din rekommendation.`
                        : `Du är en fotbollsexpert. Analysera matchen ${hemmalag} vs ${bortalag} i ${serie}. Ge en kort analys (max 150 ord) på svenska om lagets form, styrkor/svagheter och troligt utfall (1/X/2). Avsluta med din rekommendation.`;

                    try {
                        const geminiResp = await fetch(GEMINI_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'X-goog-api-key': GEMINI_API_KEY },
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: prompt }] }],
                                generationConfig: { temperature: 0.7, maxOutputTokens: 320 }
                            })
                        });

                        if (geminiResp.status === 429) {
                            const errBody = await geminiResp.text();
                            return jsonResponse({ error: 'rate_limit', message: 'För många förfrågningar. Försök igen om 1 minut.', details: errBody }, 429);
                        }
                        if (!geminiResp.ok) {
                            const errText = await geminiResp.text();
                            return jsonResponse({ error: 'AI error', status: geminiResp.status, details: errText }, 502);
                        }

                        const geminiData = await geminiResp.json();
                        const candidate = geminiData?.candidates?.[0];
                        const text = candidate?.content?.parts?.[0]?.text || 'Inget svar från AI.';
                        const finishReason = candidate?.finishReason || 'unknown';
                        if (text && text !== 'Inget svar från AI.') aiCache[cacheKey] = { text, time: Date.now() };
                        return jsonResponse({ analysis: text, hemmalag, bortalag, serie, finishReason });
                    } catch (err) {
                        return jsonResponse({ error: 'AI request failed', message: err.message }, 500);
                    }
                }
                case 'runNotificationsNow': {
                    await checkAndSendNotifications(context);
                    return jsonResponse({ success: true, ranAt: new Date().toISOString() });
                }
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
                case 'testRapport': {
                    const db = getPool();
                    const now = new Date();
                    const [ekoRows] = await db.query('SELECT spelomgang, drawNumber FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
                    if (!ekoRows.length) return jsonResponse({ error: 'No ekonomi rows' });
                    const spelomgang = ekoRows[0].spelomgang;
                    const drawNumber = ekoRows[0].drawNumber;
                    if (!drawNumber) return jsonResponse({ error: 'No drawNumber', spelomgang });

                    const forecastUrl = `${SVENSKA_SPEL_BASE}draws/${drawNumber}/forecast?accesskey=${SVENSKA_SPEL_KEY}`;
                    const fResp = await fetch(forecastUrl);
                    const forecastData = await fResp.json();
                    const forecast = forecastData.forecast;
                    if (!forecast || !forecast.events || !forecast.events.length) return jsonResponse({ error: 'No forecast events', forecastData });

                    const events = forecast.events;
                    const started = events.filter(e => e.sportEventStatus !== 'Inte startat');
                    const finished = events.filter(e => e.isFinished || e.cancelled);
                    const inProgress = started.length > 0 && finished.length < 13;

                    const [sysRows] = await db.query('SELECT * FROM TIT_systemrader WHERE drawNumber = ?', [drawNumber]);

                    const [lastRapport] = await db.query(
                        "SELECT sentAt FROM TIT_push_log WHERE notisType = 'live_rapport' AND spelomgang = ? ORDER BY sentAt DESC LIMIT 1",
                        [spelomgang]
                    );
                    let diffMin = null;
                    let shouldSend = true;
                    if (lastRapport.length) {
                        const lastSent = new Date(lastRapport[0].sentAt);
                        diffMin = (now - lastSent) / 60000;
                        if (diffMin < 14) shouldSend = false;
                    }

                    const [liveTokenRows] = await db.query('SELECT DISTINCT pushToken FROM TIT_push_tokens WHERE notis_live = 1');

                    let drawUrl = `${SVENSKA_SPEL_BASE}draws/${drawNumber}?accesskey=${SVENSKA_SPEL_KEY}`;
                    let drawResp = await fetch(drawUrl);
                    let drawJson = await drawResp.json();
                    const distribution = drawJson.draw?.distribution || [];

                    return jsonResponse({
                        now: now.toISOString(),
                        spelomgang,
                        drawNumber,
                        startedCount: started.length,
                        finishedCount: finished.length,
                        inProgress,
                        sysRowsCount: sysRows.length,
                        lastRapportSentAt: lastRapport.length ? lastRapport[0].sentAt : null,
                        diffMin,
                        shouldSend,
                        liveTokensCount: liveTokenRows.length,
                        distributionCount: distribution.length,
                        distributionSample: distribution.slice(0, 3),
                    });
                }
                case 'fixRapportLog': {
                    const db = getPool();
                    const [ekoRows] = await db.query('SELECT spelomgang FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
                    const spelomgang = ekoRows[0].spelomgang;
                    await db.query("DELETE FROM TIT_push_log WHERE notisType = 'live_rapport' AND spelomgang = ?", [spelomgang]);
                    return jsonResponse({ ok: true, deleted: 'live_rapport entries for ' + spelomgang });
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
                case 'getEkonomiData':
                    return await getEkonomiData(params);
                case 'saveEkonomi':
                    return await saveEkonomi(params);
                case 'generateSystem':
                    return await generateSystem(params);
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
    await ensureMessageSchema(db);
    const [ekoRows] = await db.query('SELECT spelomgang, isSlutspel FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const spelomgang = ekoRows.length ? ekoRows[0].spelomgang : '';

    // Get speletOppet status + admin message
    const [adminRows] = await db.query('SELECT speletOppet, message FROM TIT_admin LIMIT 1');
    const speletOppetVal = adminRows.length ? adminRows[0].speletOppet : 0;
    const adminMessage = adminRows.length ? (adminRows[0].message || '') : '';

    // Get matches with kupong info, lottning (who's responsible), and tipsrad
    const [matches] = await db.query(`
        SELECT k.matchNr, k.lag, k.liga, k.home, k.away, k.odds1, k.oddsX, k.odds2,
               l.ansvarigId, u.fornamn, u.efternamn,
               t.tecken AS grundtecken, t.evGardering, t.poangGrund, t.matematisk
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
        message: adminMessage,
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
            `INSERT INTO TIT_tipsrad (spelomgang, matchNr, tecken, evGardering, poangGrund, matematisk, ansvarigId, slutspel)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
            [spelomgang, m.matchNr, m.tecken || '', m.evGardering || '', m.poangGrund ? 1 : 0, m.matematisk ? 1 : 0, m.ansvarigId || 0]
        );
    }

    return jsonResponse({ success: true });
}

// GET EKONOMI DATA - get current round's economy data + system row count
async function getEkonomiData(params) {
    const userId = parseInt(params.userId || params.get?.('userId'));
    if (userId !== 1) return jsonResponse({ error: 'Ej behörig' }, 403);

    const db = getPool();
    const [ekoRows] = await db.query('SELECT * FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    if (!ekoRows.length) return jsonResponse({ error: 'Ingen ekonomidata' }, 404);

    const eko = ekoRows[0];

    // Get system row count (insats = antal rader)
    const [sysRows] = await db.query(
        'SELECT COUNT(*) as antalRader FROM TIT_systemrader WHERE drawNumber = ?',
        [eko.drawNumber]
    );
    const antalRader = sysRows.length ? sysRows[0].antalRader : 0;

    return jsonResponse({
        spelomgang: eko.spelomgang,
        sasong: eko.sasong,
        antalRatt: eko.antalRatt,
        veckansKapital: eko.veckansKapital,
        insats: eko.insats,
        vinst: eko.vinst,
        extraInsats: eko.extraInsats,
        extraVinst: eko.extraVinst,
        utdelning: eko.utdelning,
        kommentar: eko.kommentar || '',
        isSlutspel: eko.isSlutspel,
        drawNumber: eko.drawNumber,
        antalRader,
    });
}

// SAVE EKONOMI - update economy fields for current round
async function saveEkonomi(params) {
    const userId = parseInt(params.userId || params.get?.('userId'));
    if (userId !== 1) return jsonResponse({ error: 'Ej behörig' }, 403);

    const { veckansKapital, insats, vinst, antalRatt, isSlutspel, extraInsats, extraVinst, kommentar, utdelning } = params;

    const db = getPool();
    const [ekoRows] = await db.query('SELECT spelomgang FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    if (!ekoRows.length) return jsonResponse({ error: 'Ingen ekonomidata' }, 404);
    const spelomgang = ekoRows[0].spelomgang;

    await db.query(
        `UPDATE TIT_ekonomi SET
            veckansKapital = ?,
            insats = ?,
            vinst = ?,
            antalRatt = ?,
            isSlutspel = ?,
            extraInsats = ?,
            extraVinst = ?,
            kommentar = ?,
            utdelning = ?
        WHERE spelomgang = ?`,
        [
            parseInt(veckansKapital) || 0,
            parseInt(insats) || 0,
            parseInt(vinst) || 0,
            parseInt(antalRatt) || 0,
            parseInt(isSlutspel) || 0,
            parseInt(extraInsats) || 0,
            parseInt(extraVinst) || 0,
            kommentar || '',
            parseInt(utdelning) || 0,
            spelomgang
        ]
    );

    return jsonResponse({ success: true });
}

// ===== SYSTEM GENERATION (Reduction Algorithm) =====

// GENERATE SYSTEM - replicate TipsAdmin reduction on server
async function generateSystem(params) {
    const userId = parseInt(params.userId || params.get?.('userId'));
    if (userId !== 1) return jsonResponse({ error: 'Ej behörig' }, 403);

    const { matches } = params;
    if (!matches || !Array.isArray(matches) || matches.length !== 13) {
        return jsonResponse({ error: 'Saknar 13 matcher' }, 400);
    }

    // Build selections from match data
    const selections = matches.map((m, i) => {
        const grund = m.tecken || '';
        const gard = m.evGardering || '';
        const matematik = m.matematisk ? true : false;
        const etta = grund === '1' || gard.includes('1');
        const kryss = grund === 'X' || gard.includes('X');
        const tvaa = grund === '2' || gard.includes('2');
        const antalTecken = (etta ? 1 : 0) + (kryss ? 1 : 0) + (tvaa ? 1 : 0);
        const isEnkeltecken = antalTecken === 1;
        const isHalvgardering = antalTecken === 2 && !matematik;
        const isHelgardering = antalTecken === 3 && !matematik;
        const isMatematisk = antalTecken >= 2 && matematik;
        const getTecken = () => {
            const r = [];
            if (etta) r.push('1');
            if (kryss) r.push('X');
            if (tvaa) r.push('2');
            return r;
        };
        return { matchNr: i + 1, etta, kryss, tvaa, matematik, antalTecken, isEnkeltecken, isHalvgardering, isHelgardering, isMatematisk, getTecken };
    });

    // Run smart reduction
    const result = smartReduce(selections);

    // Debug: log what was classified
    const debugInfo = {
        hel: selections.filter(s => s.isHelgardering).map(s => s.matchNr),
        halv: selections.filter(s => s.isHalvgardering).map(s => s.matchNr),
        mat: selections.filter(s => s.isMatematisk).map(s => s.matchNr),
        enkel: selections.filter(s => s.isEnkeltecken).map(s => s.matchNr),
    };

    if (result.error) {
        return jsonResponse({ error: result.error, debug: debugInfo }, 400);
    }

    const { rows, grupper, garantiNiva } = result;

    // Save to database
    const db = getPool();
    const [ekoRows] = await db.query('SELECT drawNumber FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
    const drawNumber = ekoRows.length ? ekoRows[0].drawNumber : 0;

    if (drawNumber) {
        await db.query('DELETE FROM TIT_systemrader WHERE drawNumber = ?', [drawNumber]);
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            await db.query(
                'INSERT INTO TIT_systemrader (drawNumber, radNr, m1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12,m13) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [drawNumber, i + 1, row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12]]
            );
        }
    }

    // Generate text file content
    const fileContent = 'Stryktipset\n' + rows.map(r => 'E,' + r.split('').join(',')).join('\n');

    return jsonResponse({
        success: true,
        antalRader: rows.length,
        grupper,
        garantiNiva,
        drawNumber,
        fileContent,
        debug: debugInfo,
    });
}

// ===== REDUCTION ALGORITHM FUNCTIONS =====

// Hardcoded optimal covering codes
// 4-0: Ternary (3^4=81), 9 codewords, 12-rätts garanti
const CODE_4_0 = [
    [0,0,0,0], [0,1,1,1], [0,2,2,2], [1,0,1,2], [1,1,2,0],
    [1,2,0,1], [2,0,2,1], [2,1,0,2], [2,2,1,0]
];

// 0-7: Binary (2^7=128), 16 codewords (Hamming [7,4]), 12-rätts garanti
const CODE_0_7 = [
    [0,0,0,0,0,0,0], [1,1,0,1,0,0,1], [0,1,0,1,0,1,0], [1,0,0,0,0,1,1],
    [1,0,0,1,1,0,0], [0,1,0,0,1,0,1], [1,1,0,0,1,1,0], [0,0,0,1,1,1,1],
    [1,1,1,0,0,0,0], [0,0,1,1,0,0,1], [1,0,1,1,0,1,0], [0,1,1,0,0,1,1],
    [0,1,1,1,1,0,0], [1,0,1,0,1,0,1], [0,0,1,0,1,1,0], [1,1,1,1,1,1,1]
];

// 3-3: Mixed (3^3 × 2^3 = 216), 24 codewords, 12-rätts garanti
// First 3 positions = ternary (hel), last 3 = binary (halv)
const CODE_3_3 = [
    [2,1,0,1,0,0], [2,1,0,0,1,1], [1,0,1,1,0,0], [1,0,1,0,1,1],
    [0,2,2,1,0,0], [0,2,2,0,1,1], [2,1,0,1,0,1], [2,1,0,0,1,0],
    [1,2,0,1,1,0], [1,2,0,0,0,1], [1,1,2,1,1,1], [1,1,2,0,0,0],
    [2,2,1,1,1,1], [2,2,1,0,0,0], [2,0,2,1,1,0], [2,0,2,0,0,1],
    [1,0,1,1,0,1], [1,0,1,0,1,0], [0,2,2,1,0,1], [0,2,2,0,1,0],
    [0,1,1,1,1,0], [0,1,1,0,0,1], [0,0,0,1,1,1], [0,0,0,0,0,0]
];

function smartReduce(selections) {
    const helPositions = [];
    const halvPositions = [];
    const matPositions = [];

    for (let i = 0; i < selections.length; i++) {
        if (selections[i].isHelgardering) helPositions.push(i);
        else if (selections[i].isHalvgardering) halvPositions.push(i);
        else if (selections[i].isMatematisk) matPositions.push(i);
    }

    const hel = helPositions.length;
    const halv = halvPositions.length;

    if (hel === 0 && halv === 0) {
        // Only enkeltecken + eventuellt matematiska
        return { rows: generateAllRows(selections), grupper: 0, garantiNiva: 13 };
    }

    // Try to decompose (hel, halv) into blocks of (4,0), (0,7), (3,3)
    const decomp = decomposeSystem(hel, halv);
    if (!decomp) {
        return { rows: null, grupper: 0, garantiNiva: 0, error: `Kombinationen ${hel}-${halv} stöds inte. Giltiga: 4-0, 0-7, 3-3 och kombinationer av dessa.` };
    }

    const { a, b, c } = decomp; // a st (4,0), b st (0,7), c st (3,3)

    // Assign positions to blocks
    // Order: helPositions first consumed by (4,0) blocks, then by (3,3) blocks
    // halvPositions consumed by (0,7) blocks, then by (3,3) blocks
    const blocks = [];
    let helIdx = 0;
    let halvIdx = 0;

    for (let i = 0; i < a; i++) {
        blocks.push({ type: '4-0', positions: helPositions.slice(helIdx, helIdx + 4), code: CODE_4_0 });
        helIdx += 4;
    }
    for (let i = 0; i < b; i++) {
        blocks.push({ type: '0-7', positions: halvPositions.slice(halvIdx, halvIdx + 7), code: CODE_0_7 });
        halvIdx += 7;
    }
    for (let i = 0; i < c; i++) {
        const helPart = helPositions.slice(helIdx, helIdx + 3);
        const halvPart = halvPositions.slice(halvIdx, halvIdx + 3);
        blocks.push({ type: '3-3', positions: [...helPart, ...halvPart], code: CODE_3_3 });
        helIdx += 3;
        halvIdx += 3;
    }

    // Convert each block's code indices to actual signs
    const blockRows = blocks.map(block => {
        return block.code.map(codeword =>
            codeword.map((val, idx) => {
                const pos = block.positions[idx];
                return selections[pos].getTecken()[val];
            })
        );
    });

    // Cartesian product of all blocks
    let combined = [[]];
    for (const bRows of blockRows) {
        const newCombined = [];
        for (const existing of combined) {
            for (const row of bRows) {
                newCombined.push([...existing, ...row]);
            }
        }
        combined = newCombined;
    }

    // Build full 13-position rows
    const baseRows = combined.map(combo => {
        const fullRow = new Array(13);
        let comboIdx = 0;
        const allBlockPositions = blocks.flatMap(bl => bl.positions);

        for (let i = 0; i < 13; i++) {
            const blockPosIdx = allBlockPositions.indexOf(i);
            if (blockPosIdx >= 0) {
                fullRow[i] = combo[blockPosIdx];
            } else if (selections[i].isEnkeltecken) {
                fullRow[i] = selections[i].getTecken()[0];
            } else {
                fullRow[i] = '0'; // matematisk placeholder
            }
        }
        return fullRow.join('');
    });

    // Expand matematisk positions
    const rows = expandMatPositions(selections, baseRows);

    const totalBlocks = a + b + c;
    const garantiNiva = totalBlocks === 1 ? 12 : 13 - totalBlocks;

    return { rows, grupper: totalBlocks, garantiNiva };
}

// Decompose (hel, halv) into a×(4,0) + b×(0,7) + c×(3,3)
function decomposeSystem(hel, halv) {
    // hel = 4a + 3c, halv = 7b + 3c → c must satisfy both
    for (let c = 0; c <= Math.min(Math.floor(hel / 3), Math.floor(halv / 3)); c++) {
        const remHel = hel - 3 * c;
        const remHalv = halv - 3 * c;
        if (remHel % 4 === 0 && remHalv % 7 === 0) {
            return { a: remHel / 4, b: remHalv / 7, c };
        }
    }
    // Also try c consuming all halv first
    for (let c = Math.min(Math.floor(hel / 3), Math.floor(halv / 3)); c >= 0; c--) {
        const remHel = hel - 3 * c;
        const remHalv = halv - 3 * c;
        if (remHel >= 0 && remHalv >= 0 && remHel % 4 === 0 && remHalv % 7 === 0) {
            return { a: remHel / 4, b: remHalv / 7, c };
        }
    }
    return null;
}

function generateAllRows(selections) {
    let rows = [''];
    for (const sel of selections) {
        const tecken = sel.getTecken();
        const newRows = [];
        for (const row of rows) {
            for (const t of tecken) {
                newRows.push(row + t);
            }
        }
        rows = newRows;
    }
    return rows;
}

function reduceSystem(selections) {
    const reducedPositions = [];
    for (let i = 0; i < selections.length; i++) {
        if (selections[i].isHalvgardering || selections[i].isHelgardering)
            reducedPositions.push(i);
    }

    if (reducedPositions.length === 0) return generateAllRows(selections);

    // Sort: helgarderingar first, then halvgarderingar
    reducedPositions.sort((a, b) => {
        const countDiff = selections[b].antalTecken - selections[a].antalTecken;
        return countDiff !== 0 ? countDiff : a - b;
    });

    const reducedSelections = reducedPositions.map(i => selections[i]);
    const allOutcomes = generateAllRows(reducedSelections);
    const coveringSet = greedyCoveringCode(allOutcomes);
    return expandWithMatematiska(selections, reducedPositions, coveringSet);
}

function reduceCombinedSystem(selections, groupAssignment, antalGrupper) {
    const groupPositions = Array.from({ length: antalGrupper }, () => []);
    for (let i = 0; i < selections.length; i++) {
        const g = groupAssignment[i];
        if (g >= 1 && g <= antalGrupper)
            groupPositions[g - 1].push(i);
    }

    const coveringSets = [];
    for (let g = 0; g < antalGrupper; g++) {
        const groupSel = groupPositions[g].map(i => selections[i]);
        const allOutcomes = generateAllRows(groupSel);
        coveringSets.push(greedyCoveringCode(allOutcomes));
    }

    // Cartesian product
    let combined = [new Array(antalGrupper)];
    for (let g = 0; g < antalGrupper; g++) {
        const newCombined = [];
        for (const existing of combined) {
            for (const item of coveringSets[g]) {
                const copy = [...existing];
                copy[g] = item;
                newCombined.push(copy);
            }
        }
        combined = newCombined;
    }

    const baseRows = [];
    for (const combo of combined) {
        const fullRow = new Array(13);
        for (let i = 0; i < selections.length; i++) {
            const g = groupAssignment[i];
            if (g >= 1 && g <= antalGrupper) {
                const posInGroup = groupPositions[g - 1].indexOf(i);
                fullRow[i] = combo[g - 1][posInGroup];
            } else if (selections[i].isEnkeltecken) {
                fullRow[i] = selections[i].getTecken()[0];
            } else if (selections[i].isMatematisk) {
                fullRow[i] = '0';
            }
        }
        baseRows.push(fullRow.join(''));
    }

    return expandMatPositions(selections, baseRows);
}

function expandWithMatematiska(selections, reducedPositions, coveringSet) {
    const baseRows = [];
    for (const reducedRow of coveringSet) {
        const fullRow = new Array(13);
        for (let i = 0; i < selections.length; i++) {
            const idxInReduced = reducedPositions.indexOf(i);
            if (idxInReduced >= 0) {
                fullRow[i] = reducedRow[idxInReduced];
            } else if (selections[i].isEnkeltecken) {
                fullRow[i] = selections[i].getTecken()[0];
            } else {
                fullRow[i] = '0';
            }
        }
        baseRows.push(fullRow.join(''));
    }
    return expandMatPositions(selections, baseRows);
}

function expandMatPositions(selections, baseRows) {
    const matPositions = [];
    for (let i = 0; i < selections.length; i++) {
        if (selections[i].isMatematisk) matPositions.push(i);
    }
    if (matPositions.length === 0) return baseRows;

    const expandedRows = [];
    for (const baseRow of baseRows) {
        let expanded = [baseRow];
        for (const pos of matPositions) {
            const tecken = selections[pos].getTecken();
            const newExpanded = [];
            for (const row of expanded) {
                for (const t of tecken) {
                    const chars = row.split('');
                    chars[pos] = t;
                    newExpanded.push(chars.join(''));
                }
            }
            expanded = newExpanded;
        }
        expandedRows.push(...expanded);
    }
    return expandedRows;
}

function greedyCoveringCode(allOutcomes) {
    const restarts = allOutcomes.length <= 100 ? 200
                   : allOutcomes.length <= 300 ? 100
                   : allOutcomes.length <= 1000 ? 40
                   : 15;
    let bestResult = null;

    for (let attempt = 0; attempt < restarts; attempt++) {
        let candidates = [...allOutcomes];
        if (attempt > 0) {
            // Seeded shuffle for reproducibility
            for (let i = candidates.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
            }
        }
        let coveringSet = greedyPass(candidates, allOutcomes);
        coveringSet = removeRedundant(coveringSet, allOutcomes);
        if (!bestResult || coveringSet.length < bestResult.length)
            bestResult = coveringSet;
    }

    bestResult = localSearch(bestResult, allOutcomes);
    return bestResult;
}

function greedyPass(candidates, allOutcomes) {
    const coveringSet = [];
    const uncovered = new Set(allOutcomes.map((_, i) => i));

    while (uncovered.size > 0) {
        let bestRow = '';
        let bestCoverage = -1;
        for (const candidate of candidates) {
            let coverage = 0;
            for (const idx of uncovered) {
                if (hammingDistance(candidate, allOutcomes[idx]) <= 1) coverage++;
            }
            if (coverage > bestCoverage) {
                bestCoverage = coverage;
                bestRow = candidate;
            }
        }
        coveringSet.push(bestRow);
        const nowCovered = [];
        for (const idx of uncovered) {
            if (hammingDistance(bestRow, allOutcomes[idx]) <= 1) nowCovered.push(idx);
        }
        for (const idx of nowCovered) uncovered.delete(idx);
    }
    return coveringSet;
}

function removeRedundant(coveringSet, allOutcomes) {
    let result = [...coveringSet];
    for (let i = result.length - 1; i >= 0; i--) {
        const without = result.filter((_, idx) => idx !== i);
        if (isCovering(without, allOutcomes)) result = without;
    }
    return result;
}

function localSearch(coveringSet, allOutcomes) {
    let best = [...coveringSet];
    for (let pass = 0; pass < 3; pass++) {
        let improved = false;
        for (let i = best.length - 1; i >= 0; i--) {
            const without = best.filter((_, idx) => idx !== i);
            const uncoveredIdxs = [];
            for (let o = 0; o < allOutcomes.length; o++) {
                if (!without.some(cw => hammingDistance(cw, allOutcomes[o]) <= 1))
                    uncoveredIdxs.push(o);
            }
            if (uncoveredIdxs.length === 0) {
                best = without;
                improved = true;
                continue;
            }
            for (const candidate of allOutcomes) {
                if (without.includes(candidate)) continue;
                if (uncoveredIdxs.every(idx => hammingDistance(candidate, allOutcomes[idx]) <= 1)) {
                    without.push(candidate);
                    best = removeRedundant(without, allOutcomes);
                    improved = true;
                    break;
                }
            }
        }
        if (!improved) break;
    }
    return best;
}

function isCovering(coveringSet, allOutcomes) {
    for (const outcome of allOutcomes) {
        if (!coveringSet.some(cw => hammingDistance(cw, outcome) <= 1)) return false;
    }
    return true;
}

function hammingDistance(a, b) {
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) dist++;
    }
    return dist;
}

// Timer trigger for push notifications - runs every minute
app.timer('pushNotificationTimer', {
    schedule: '0 */1 * * * *',
    handler: async (timer, context) => {
        context.log('Push notification timer triggered');
        try {
            await checkAndSendNotifications(context);
        } catch (err) {
            context.log('Push notification error:', err);
        }
    }
});
