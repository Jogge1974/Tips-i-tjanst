# Azure Function App - Tips(i)tjänst API

Denna Azure Function App ersätter tillfälligt api.php medan PHP-hostingen hos Simply/unoeuro löses.

## Struktur
```
api-azure/
├── src/functions/api.js    ← All API-logik (en HTTP-trigger)
├── host.json
├── local.settings.json     ← Miljövariabler (INTE committa!)
├── package.json
└── .funcignore
```

## Lokal utveckling

```bash
cd api-azure
func start
```

API:et finns då på: `http://localhost:7071/api/api`

Testa med: `curl http://localhost:7071/api/api?action=getUsers`

## Deploya till Azure

### 1. Skapa en Function App i Azure Portal
- Runtime: Node.js 20 LTS
- OS: Windows eller Linux
- Plan: Consumption (serverless) - gratis upp till 1 miljon anrop/månad

### 2. Sätt miljövariabler (Application Settings i Azure Portal)
```
DB_HOST = mysql76.unoeuro.com
DB_USER = liveidrott_se
DB_PASSWORD = kd4EawG2znc6hpBRHF5m
DB_NAME = liveidrott_se_db
SVENSKA_SPEL_KEY = 45c5fc62-8386-4e59-b8ab-06b7f10f505d
```

### 3. Deploya med CLI
```bash
az login
cd api-azure
func azure functionapp publish <DIN-APP-NAMN>
```

### 4. Uppdatera appen
I `app/src/services/api.ts`, ändra `API_BASE_URL` till:
```
https://<DIN-APP-NAMN>.azurewebsites.net/api/api
```

## Endpoints (identiska med api.php)

| Action | Metod | Beskrivning |
|--------|-------|-------------|
| getUsers | GET | Hämta alla användare |
| login | POST | Logga in (userId, password) |
| getStatus | GET | Spelstatus (öppet/stängt) |
| getMyMatch | POST | Min tilldelade match (userId) |
| getKupong | GET | Aktuell kupong |
| saveTips | POST | Spara tipstecken |
| getGarderingar | POST | Hämta garderingar (userId) |
| saveGarderingar | POST | Spara garderingar |
| getLiveDraw | GET | Hämta live-omgång från Svenska Spel |
| getLiveResult | GET | Hämta resultat (drawNumber) |
| getSystemRows | GET | Hämta systemrader (drawNumber) |

## Viktigt
- `local.settings.json` innehåller lösenord och ska INTE committas till git
- CORS är öppet (`*`) - fungerar med Expo/React Native
- Node.js 20 LTS rekommenderas (v25 ger varning men fungerar)
