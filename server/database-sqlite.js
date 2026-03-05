const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const crypto = require('crypto');
const path = require('path');

let db;

/**
 * Initialize the SQLite database and create tables if they don't exist
 */
async function initDb() {
    const dbPath = path.join(__dirname, 'database.sqlite');
    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    console.log(`🗄️ Connected to SQLite database at ${dbPath}`);
    // Create users table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            avatar TEXT DEFAULT '👤',
            rating INTEGER DEFAULT 1200,
            wins INTEGER DEFAULT 0,
            games_played INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Migrate existing DB if avatar column is missing (simple safe-check)
    try {
        await db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT '👤'`);
        console.log('🗄️ Added missing avatar column to users table.');
    } catch (e) {
        // Ignore if column already exists
    }

    console.log('🗄️ Database tables verified.');
    return db;
}

/**
 * Hash a password using scrypt
 */
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
}

/**
 * Verify a password against a hash and salt
 */
function verifyPassword(password, hashHex, saltHex) {
    const testHash = crypto.scryptSync(password, saltHex, 64);
    const validHash = Buffer.from(hashHex, 'hex');
    if (testHash.length !== validHash.length) return false;
    return crypto.timingSafeEqual(testHash, validHash);
}

/**
 * Register a new user
 * @returns {Promise<Object>} user record without sensitive info
 */
async function registerUser(username, password, avatar = '👤') {
    if (!username || !password || username.length > 20 || password.length < 4) {
        throw new Error('Invalid username or password format.');
    }

    try {
        const { salt, hash } = hashPassword(password);

        const result = await db.run(
            'INSERT INTO users (username, password_hash, salt, avatar) VALUES (?, ?, ?, ?)',
            [username, hash, salt, avatar]
        );

        return await getUserById(result.lastID);
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            throw new Error('Username already exists.');
        }
        throw err;
    }
}

/**
 * Login a user
 * @returns {Promise<Object>} user record without sensitive info
 */
async function loginUser(username, password) {
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
        throw new Error('Invalid username or password.');
    }

    const isValid = verifyPassword(password, user.password_hash, user.salt);
    if (!isValid) {
        throw new Error('Invalid username or password.');
    }

    // Update last login
    await db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    return sanitizeUser(user);
}

/**
 * Fetch a user by ID
 */
async function getUserById(userId) {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return null;
    return sanitizeUser(user);
}

/**
 * Remove sensitive fields before returning
 */
function sanitizeUser(user) {
    const { password_hash, salt, ...safeUser } = user;
    return safeUser;
}

/**
 * Update user statistics after a match
 */
async function updateUserStats(userId, isWin, ratingChange) {
    const winIncrement = isWin ? 1 : 0;

    await db.run(`
        UPDATE users
    SET
    rating = rating + ?,
        wins = wins + ?,
        games_played = games_played + 1
        WHERE id = ?
        `, [ratingChange, winIncrement, userId]);

    return await getUserById(userId);
}

/**
 * Get top players for leaderboard
 */
async function getLeaderboard(limit = 10) {
    const users = await db.all(`
        SELECT id, username, avatar, rating, wins, games_played
        FROM users 
        ORDER BY rating DESC, wins DESC
    LIMIT ?
        `, [limit]);
    return users;
}

module.exports = {
    initDb,
    registerUser,
    loginUser,
    getUserById,
    updateUserStats,
    getLeaderboard
};
