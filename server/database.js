// database.js - Dynamically switches between SQLite (local dev) and Supabase (production)

const sqliteDb = require('./database-sqlite');
let supabaseDb = null;

try {
    supabaseDb = require('./database-supabase');
} catch (e) {
    // @supabase/supabase-js might not be installed in all environments
    console.warn('Supabase client not found, falling back strictly to SQLite.');
}

if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY && supabaseDb) {
    console.log('🔗 Database Mode: Supabase (Production Stack)');
    module.exports = supabaseDb;
} else {
    console.log('🔗 Database Mode: SQLite (Local Development)');
    module.exports = sqliteDb;
}
