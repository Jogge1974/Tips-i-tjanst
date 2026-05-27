// Importera systemrader från textfil till TIT_systemrader
// Användning: node import-systemrader.js <filsökväg> <drawNumber>
// Exempel:  node import-systemrader.js rader.txt 4954

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const dbConfig = {
    host: 'mysql76.unoeuro.com',
    user: 'liveidrott_se',
    password: 'kd4EawG2znc6hpBRHF5m',
    database: 'liveidrott_se_db'
};

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Användning: node import-systemrader.js <filsökväg> <drawNumber>');
        console.log('Exempel:    node import-systemrader.js rader.txt 4954');
        process.exit(1);
    }

    const filePath = path.resolve(args[0]);
    const drawNumber = parseInt(args[1]);

    if (!fs.existsSync(filePath)) {
        console.error(`Filen finns inte: ${filePath}`);
        process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split(/\r?\n/);

    // Hoppa över första raden ("Stryktipset" eller liknande header)
    const dataLines = lines.filter(line => {
        const parts = line.split(',');
        // En datarad har minst 14 värden (E + 13 tecken) och börjar med "E"
        return parts.length >= 14 && parts[0].trim() === 'E';
    });

    console.log(`Läste ${dataLines.length} rader från ${path.basename(filePath)}`);
    console.log(`DrawNumber: ${drawNumber}`);

    const connection = await mysql.createConnection(dbConfig);

    // Skapa tabellen om den inte finns
    await connection.query(`
        CREATE TABLE IF NOT EXISTS TIT_systemrader (
            id INT AUTO_INCREMENT PRIMARY KEY,
            drawNumber INT NOT NULL,
            radNr INT NOT NULL,
            m1 CHAR(1) NOT NULL,
            m2 CHAR(1) NOT NULL,
            m3 CHAR(1) NOT NULL,
            m4 CHAR(1) NOT NULL,
            m5 CHAR(1) NOT NULL,
            m6 CHAR(1) NOT NULL,
            m7 CHAR(1) NOT NULL,
            m8 CHAR(1) NOT NULL,
            m9 CHAR(1) NOT NULL,
            m10 CHAR(1) NOT NULL,
            m11 CHAR(1) NOT NULL,
            m12 CHAR(1) NOT NULL,
            m13 CHAR(1) NOT NULL,
            UNIQUE KEY unique_row (drawNumber, radNr)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Ta bort gamla rader för detta drawNumber
    const [deleteResult] = await connection.query('DELETE FROM TIT_systemrader WHERE drawNumber = ?', [drawNumber]);
    if (deleteResult.affectedRows > 0) {
        console.log(`Tog bort ${deleteResult.affectedRows} gamla rader för drawNumber ${drawNumber}`);
    }

    // Infoga nya rader i batchar
    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < dataLines.length; i += batchSize) {
        const batch = dataLines.slice(i, i + batchSize);
        const values = batch.map((line, idx) => {
            const parts = line.split(',').map(s => s.trim());
            // Hoppa över första värdet ("E"), ta 13 tecken
            const signs = parts.slice(1, 14);
            const radNr = i + idx + 1;
            return [drawNumber, radNr, ...signs];
        });

        const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const flatValues = values.flat();

        await connection.query(
            `INSERT INTO TIT_systemrader (drawNumber, radNr, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13) VALUES ${placeholders}`,
            flatValues
        );
        inserted += batch.length;
    }

    console.log(`✓ Importerade ${inserted} systemrader för drawNumber ${drawNumber}`);
    await connection.end();
}

main().catch(err => {
    console.error('Fel:', err.message);
    process.exit(1);
});
