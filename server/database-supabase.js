const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

let supabase;

async function initDb() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
        throw new Error('Supabase credentials missing.');
    }

    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    console.log('🗄️ Connected to Supabase');

    // Attempt a silent schema check/setup instruction
    console.log('🗄️ Make sure your Supabase "users" table has columns: id (UUID), username, password_hash, salt, avatar, rating, wins, games_played, last_login.');

    return supabase;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { salt, hash };
}

function verifyPassword(password, hashHex, saltHex) {
    const testHash = crypto.scryptSync(password, saltHex, 64);
    const validHash = Buffer.from(hashHex, 'hex');
    if (testHash.length !== validHash.length) return false;
    return crypto.timingSafeEqual(testHash, validHash);
}

async function registerUser(username, password, avatar = '👤') {
    if (!username || !password || username.length > 20 || password.length < 4) {
        throw new Error('Invalid username or password format.');
    }

    const { salt, hash } = hashPassword(password);

    // Check if user exists
    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .maybeSingle();

    if (existingUser) {
        throw new Error('Username already exists.');
    }

    // Insert user
    const { data, error } = await supabase
        .from('users')
        .insert([{
            username,
            password_hash: hash,
            salt,
            avatar,
            rating: 1200,
            wins: 0,
            games_played: 0
        }])
        .select()
        .single();

    if (error) {
        if (error.code === '23505') throw new Error('Username already exists.'); // Unique violation
        console.error('Supabase register error:', error);
        throw error;
    }

    return sanitizeUser(data);
}

async function loginUser(username, password) {
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .maybeSingle();

    if (error || !user) {
        throw new Error('Invalid username or password.');
    }

    const isValid = verifyPassword(password, user.password_hash, user.salt);
    if (!isValid) {
        throw new Error('Invalid username or password.');
    }

    // Update last login (fire and forget)
    supabase.from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', user.id)
        .then();

    return sanitizeUser(user);
}

async function getUserById(userId) {
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (error || !user) return null;
    return sanitizeUser(user);
}

function sanitizeUser(user) {
    // Supabase returns all columns, we scrub sensitives
    if (!user) return null;
    const { password_hash, salt, ...safeUser } = user;
    return safeUser;
}

async function updateUserStats(userId, isWin, ratingChange) {
    const user = await getUserById(userId);
    if (!user) return null;

    const winIncrement = isWin ? 1 : 0;

    const { data, error } = await supabase
        .from('users')
        .update({
            rating: user.rating + ratingChange,
            wins: user.wins + winIncrement,
            games_played: user.games_played + 1
        })
        .eq('id', userId)
        .select()
        .single();

    if (error) {
        console.error('Supabase update stats error:', error);
        throw error;
    }

    return sanitizeUser(data);
}

async function getLeaderboard(limit = 10) {
    const { data, error } = await supabase
        .from('users')
        .select('id, username, avatar, rating, wins, games_played')
        .order('rating', { ascending: false })
        .order('wins', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Supabase leaderboard error:', error);
        return [];
    }

    return data || [];
}

module.exports = {
    initDb,
    registerUser,
    loginUser,
    getUserById,
    updateUserStats,
    getLeaderboard
};
