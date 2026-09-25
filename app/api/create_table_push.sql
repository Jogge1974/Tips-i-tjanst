-- Push notification tokens och inställningar per enhet
CREATE TABLE IF NOT EXISTS TIT_push_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    pushToken VARCHAR(255) NOT NULL,
    platform VARCHAR(20) DEFAULT 'expo',
    deviceId VARCHAR(255) NULL,
    deviceName VARCHAR(255) NULL,
    notis_ny_kupong TINYINT(1) DEFAULT 1,
    notis_spelstopp TINYINT(1) DEFAULT 1,
    notis_live TINYINT(1) DEFAULT 1,
    notis_meddelande TINYINT(1) DEFAULT 1,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_token (userId, pushToken),
    UNIQUE KEY unique_user_device (userId, deviceId),
    FOREIGN KEY (userId) REFERENCES TIT_TipsTjanst(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migrering för befintlig tabell (kör en gång om tabellen redan finns):
-- ALTER TABLE TIT_push_tokens ADD COLUMN deviceId VARCHAR(255) NULL;
-- ALTER TABLE TIT_push_tokens ADD COLUMN deviceName VARCHAR(255) NULL;
-- ALTER TABLE TIT_push_tokens ADD UNIQUE KEY unique_user_device (userId, deviceId);

-- Logg för skickade push notiser (undvika dubbletter)
CREATE TABLE IF NOT EXISTS TIT_push_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    notisType VARCHAR(50) NOT NULL,
    spelomgang VARCHAR(20) NOT NULL,
    sentAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_notis (userId, notisType, spelomgang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
