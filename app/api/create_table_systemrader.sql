-- Skapa tabell för systemrader (tipsrader)
-- Varje rad representerar en enskild rad i ett reducerat system eller matematiskt system
-- m1-m13 innehåller tecknet (1, X eller 2) för varje match

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Exempel på INSERT (byt ut drawNumber och tecken):
-- INSERT INTO TIT_systemrader (drawNumber, radNr, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13)
-- VALUES (4954, 1, '1', 'X', '2', '1', '1', 'X', '2', '1', 'X', '1', '2', '1', 'X');
