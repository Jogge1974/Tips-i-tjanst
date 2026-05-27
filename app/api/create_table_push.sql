-- Push notification tokens och inställningar per användare
CREATE TABLE IF NOT EXISTS TIT_push_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    pushToken VARCHAR(255) NOT NULL,
    platform VARCHAR(20) DEFAULT 'expo',
    notis_ny_kupong TINYINT(1) DEFAULT 1,
    notis_spelstopp TINYINT(1) DEFAULT 1,
    notis_live TINYINT(1) DEFAULT 1,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_token (userId, pushToken),
    FOREIGN KEY (userId) REFERENCES TIT_TipsTjanst(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Logg för skickade push notiser (undvika dubbletter)
CREATE TABLE IF NOT EXISTS TIT_push_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT NOT NULL,
    notisType VARCHAR(50) NOT NULL,
    spelomgang VARCHAR(20) NOT NULL,
    sentAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_notis (userId, notisType, spelomgang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
