<?php
// API for Tips-i-tjänst React Native app
// Deploy this file to your web hosting at unoeuro.com

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$host = 'mysql76.unoeuro.com';
$db = 'liveidrott_se_db';
$user = 'liveidrott_se';
$pass = 'kd4EawG2znc6hpBRHF5m';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$db;charset=utf8mb4", $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Databasanslutning misslyckades']);
    exit();
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'getUsers':
        $stmt = $pdo->query('SELECT id, fornamn, efternamn FROM TIT_TipsTjanst ORDER BY fornamn');
        echo json_encode($stmt->fetchAll());
        break;

    case 'login':
        $input = json_decode(file_get_contents('php://input'), true);
        $userId = intval($input['userId'] ?? 0);
        $password = $input['password'] ?? '';
        
        $stmt = $pdo->prepare('SELECT id, fornamn, efternamn, userType FROM TIT_TipsTjanst WHERE id = ? AND pwd = ?');
        $stmt->execute([$userId, $password]);
        $user = $stmt->fetch();
        
        if ($user) {
            echo json_encode(['success' => true, 'user' => $user]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Fel lösenord']);
        }
        break;

    case 'getStatus':
        // Returnerar spelstatus: 0=stängt, 1=tipstecken öppet, 2=garderingar öppet
        $stmt = $pdo->query('SELECT speletOppet FROM TIT_admin LIMIT 1');
        $admin = $stmt->fetch();
        
        $stmt2 = $pdo->query('SELECT isSlutspel FROM TIT_ekonomi ORDER BY spelomgang DESC LIMIT 1');
        $ekonomi = $stmt2->fetch();
        
        $speletOppet = intval($admin['speletOppet'] ?? 0);
        $isSlutspel = intval($ekonomi['isSlutspel'] ?? 0);
        
        $tipsstatus = 0;
        if ($speletOppet == 1) {
            if ($isSlutspel == 1) {
                $tipsstatus = 2;
            } else {
                $now = new DateTime('now', new DateTimeZone('Europe/Stockholm'));
                $dayOfWeek = intval($now->format('N')); // 1=mån, 4=tors
                $hour = intval($now->format('G'));
                if ($dayOfWeek < 4 || ($dayOfWeek == 4 && $hour < 12)) {
                    $tipsstatus = 1;
                } else {
                    $tipsstatus = 2;
                }
            }
        }
        
        echo json_encode([
            'tipsstatus' => $tipsstatus,
            'isSlutspel' => $isSlutspel,
            'speletOppet' => $speletOppet
        ]);
        break;

    case 'getMyMatch':
        // Hämta användarens tilldelade match för senaste spelomgång
        $input = json_decode(file_get_contents('php://input'), true);
        $userId = intval($input['userId'] ?? 0);
        
        $stmt = $pdo->prepare(
            'SELECT * FROM TITVIEWomgangInfo 
             WHERE spelomgang = (SELECT MAX(spelomgang) FROM TIT_lottning) 
             AND id = ?'
        );
        $stmt->execute([$userId]);
        $match = $stmt->fetch();
        echo json_encode($match ?: null);
        break;

    case 'getKupong':
        // Hämta alla matcher för senaste spelomgång (för garderingsvyn)
        $stmt = $pdo->query(
            'SELECT * FROM TITVIEWomgangInfo 
             WHERE spelomgang = (SELECT MAX(spelomgang) FROM TIT_lottning) 
             ORDER BY matchNr'
        );
        echo json_encode($stmt->fetchAll());
        break;

    case 'saveTips':
        // Spara tipstecken för användarens match
        $input = json_decode(file_get_contents('php://input'), true);
        $userId = intval($input['userId'] ?? 0);
        $tecken = $input['tecken'] ?? '';
        $password = $input['password'] ?? '';
        
        // Verifiera lösenord
        $stmt = $pdo->prepare('SELECT id FROM TIT_TipsTjanst WHERE id = ? AND pwd = ?');
        $stmt->execute([$userId, $password]);
        if (!$stmt->fetch()) {
            echo json_encode(['success' => false, 'error' => 'Fel lösenord']);
            break;
        }
        
        // Hämta spelomgång och matchNr
        $stmt = $pdo->prepare(
            'SELECT spelomgang, matchNr FROM TIT_lottning 
             WHERE spelomgang = (SELECT MAX(spelomgang) FROM TIT_lottning) 
             AND ansvarigId = ?'
        );
        $stmt->execute([$userId]);
        $lottning = $stmt->fetch();
        
        if (!$lottning) {
            echo json_encode(['success' => false, 'error' => 'Ingen match tilldelad']);
            break;
        }
        
        $spelomgang = $lottning['spelomgang'];
        $matchNr = $lottning['matchNr'];
        
        // Ta bort befintligt tips och spara nytt
        $stmt = $pdo->prepare('DELETE FROM TIT_tipsrad WHERE ansvarigId = ? AND spelomgang = ?');
        $stmt->execute([$userId, $spelomgang]);
        
        $stmt = $pdo->prepare(
            'INSERT INTO TIT_tipsrad (spelomgang, matchNr, tecken, poangGrund, ansvarigId, slutspel) 
             VALUES (?, ?, ?, 0, ?, 0)'
        );
        $stmt->execute([$spelomgang, $matchNr, $tecken, $userId]);
        
        // Uppdatera lottning
        $stmt = $pdo->prepare(
            "UPDATE TIT_lottning SET tipsTecken = 'Klar' 
             WHERE ansvarigId = ? AND spelomgang = ?"
        );
        $stmt->execute([$userId, $spelomgang]);
        
        echo json_encode(['success' => true]);
        break;

    case 'getGarderingar':
        // Hämta användarens sparade garderingar
        $input = json_decode(file_get_contents('php://input'), true);
        $userId = intval($input['userId'] ?? 0);
        
        $stmt = $pdo->prepare(
            'SELECT g.matchNr, g.tecken FROM TIT_garderingar g
             WHERE g.id = ? AND g.omgang = (SELECT MAX(spelomgang) FROM TIT_lottning)
             ORDER BY g.matchNr'
        );
        $stmt->execute([$userId]);
        echo json_encode($stmt->fetchAll());
        break;

    case 'saveGarderingar':
        // Spara garderingar
        $input = json_decode(file_get_contents('php://input'), true);
        $userId = intval($input['userId'] ?? 0);
        $password = $input['password'] ?? '';
        $garderingar = $input['garderingar'] ?? []; // [{matchNr, tecken}]
        
        // Verifiera lösenord
        $stmt = $pdo->prepare('SELECT id FROM TIT_TipsTjanst WHERE id = ? AND pwd = ?');
        $stmt->execute([$userId, $password]);
        if (!$stmt->fetch()) {
            echo json_encode(['success' => false, 'error' => 'Fel lösenord']);
            break;
        }
        
        // Hämta senaste spelomgång
        $stmt = $pdo->query('SELECT MAX(spelomgang) as spelomgang FROM TIT_lottning');
        $row = $stmt->fetch();
        $spelomgang = $row['spelomgang'];
        
        // Ta bort befintliga garderingar
        $stmt = $pdo->prepare('DELETE FROM TIT_garderingar WHERE id = ? AND omgang = ?');
        $stmt->execute([$userId, $spelomgang]);
        
        // Spara nya garderingar
        $stmt = $pdo->prepare(
            'INSERT INTO TIT_garderingar (omgang, id, matchNr, tecken) VALUES (?, ?, ?, ?)'
        );
        foreach ($garderingar as $g) {
            $stmt->execute([$spelomgang, $userId, intval($g['matchNr']), $g['tecken']]);
        }
        
        echo json_encode(['success' => true]);
        break;

    case 'getLiveDraw':
        // Hämta aktuell stryktipset-omgång från Svenska Spel
        $accesskey = '45c5fc62-8386-4e59-b8ab-06b7f10f505d';
        $url = "https://api.www.svenskaspel.se/external/1/draw/stryktipset/draws?accesskey=$accesskey";
        $response = file_get_contents($url);
        if ($response === false) {
            echo json_encode(['error' => 'Kunde inte hämta data från Svenska Spel']);
            break;
        }
        $data = json_decode($response, true);
        $draw = $data['draws'][0] ?? null;
        
        if (!$draw) {
            echo json_encode(['error' => 'Ingen aktiv omgång']);
            break;
        }
        
        // Formatera svaret
        $events = [];
        foreach ($draw['events'] as $event) {
            $events[] = [
                'eventNumber' => $event['eventNumber'],
                'description' => $event['description'],
                'home' => $event['participants'][0]['name'] ?? '',
                'away' => $event['participants'][1]['name'] ?? '',
                'league' => $event['league']['name'] ?? '',
                'sportEventStart' => $event['sportEventStart'],
                'sportEventStatus' => $event['sportEventStatus'],
                'outcomes' => $event['outcomes'],
                'odds' => $event['odds'],
            ];
        }
        
        echo json_encode([
            'drawNumber' => $draw['drawNumber'],
            'drawState' => $draw['drawState'],
            'closeTime' => $draw['closeTime'],
            'turnover' => $draw['turnover'],
            'events' => $events,
        ]);
        break;

    case 'getLiveResult':
        // Hämta senaste resultat (för avslutade/pågående omgångar)
        $accesskey = '45c5fc62-8386-4e59-b8ab-06b7f10f505d';
        $drawNumber = $_GET['drawNumber'] ?? '';
        
        if ($drawNumber) {
            $url = "https://api.www.svenskaspel.se/external/1/draw/stryktipset/draws/$drawNumber/result?accesskey=$accesskey";
        } else {
            $url = "https://api.www.svenskaspel.se/external/1/draw/stryktipset/draws/result?accesskey=$accesskey";
        }
        
        $response = file_get_contents($url);
        if ($response === false) {
            echo json_encode(['error' => 'Kunde inte hämta resultat']);
            break;
        }
        echo $response;
        break;

    case 'getSystemRows':
        // Hämta systemrader för aktuell omgång
        $drawNumber = $_GET['drawNumber'] ?? '';
        
        if ($drawNumber) {
            $stmt = $pdo->prepare(
                'SELECT * FROM TIT_systemrader WHERE drawNumber = ? ORDER BY radNr'
            );
            $stmt->execute([$drawNumber]);
        } else {
            $stmt = $pdo->query(
                'SELECT * FROM TIT_systemrader WHERE drawNumber = (SELECT MAX(drawNumber) FROM TIT_systemrader) ORDER BY radNr'
            );
        }
        echo json_encode($stmt->fetchAll());
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Ogiltig action']);
        break;
}
