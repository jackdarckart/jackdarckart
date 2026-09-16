// security.js - Verschlüsselte Authentifizierungs- und Sicherheits-Logik (Robust & Auto-Repair)
const SecureAuth = {
    getSession() {
        let session = localStorage.getItem('secure_nexus_logged_user');
        if (!session) {
            // Automatischer Fallback, damit das Spiel sofort ohne Zwanglogin funktioniert
            session = "commander@jackdarckart.net";
            localStorage.setItem('secure_nexus_logged_user', session);
        }
        return session;
    },
    setSession(email) {
        localStorage.setItem('secure_nexus_logged_user', email);
    },
    clearSession() {
        localStorage.removeItem('secure_nexus_logged_user');
    },
    getUsersDB() {
        try {
            return JSON.parse(localStorage.getItem('secure_nexus_master_users_db_secure_v7')) || {};
        } catch(e) { return {}; }
    },
    saveUsersDB(db) {
        localStorage.setItem('secure_nexus_master_users_db_secure_v7', JSON.stringify(db));
    },

    async hashPin(pin) {
        const encoder = new TextEncoder();
        const data = encoder.encode(pin.trim() + "_jackdarckart_secure_salt_2026");
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },
    
    pendingEmail: null,
    pendingPinHash: null,
    pendingAction: null,
    activeCode: null,

    async initAuthAction(email, pin, actionType) {
        if (!email || !email.includes('@')) return { success: false, msg: '❌ Ungültige E-Mail-Adresse!' };
        if (!pin || pin.length < 4) return { success: false, msg: '❌ PIN muss mindestens 4 Ziffern haben!' };

        email = email.trim().toLowerCase();
        let db = this.getUsersDB();
        let pinHash = await this.hashPin(pin);

        if (actionType === 'register') {
            if (db[email]) return { success: false, msg: '❌ Diese E-Mail ist bereits registriert!' };
        } else if (actionType === 'login' || actionType === 'reset_pin') {
            if (!db[email]) {
                // Automatisch anlegen, falls noch nicht in der DB
                db[email] = { pinHash: pinHash, gameData: { beats: 0, fans: 0, releases: 0, upgrades: {} } };
            }
            if (actionType === 'login' && db[email].pinHash !== pinHash) {
                return { success: false, msg: '❌ Falsche PIN!' };
            }
        }

        const code = Math.floor(1000 + Math.random() * 9000).toString();
        this.activeCode = code;
        this.pendingEmail = email;
        this.pendingPinHash = pinHash;
        this.pendingAction = actionType;

        return { success: true, code: code, msg: '✅ Code generiert!' };
    },

    async verifyAndExecute(enteredCode) {
        if (!enteredCode || enteredCode.trim() !== this.activeCode) {
            return { success: false, msg: '❌ Falscher Verifizierungscode!' };
        }

        let db = this.getUsersDB();
        let email = this.pendingEmail;
        let pinHash = this.pendingPinHash;
        let action = this.pendingAction;

        if (!db[email]) {
            db[email] = {
                pinHash: pinHash,
                gameData: { beats: 0, fans: 0, releases: 0, upgrades: {} },
                createdAt: new Date().toISOString()
            };
        } else if (action === 'reset_pin') {
            db[email].pinHash = pinHash;
        }
        this.saveUsersDB(db);

        this.setSession(email);
        this.activeCode = null;
        this.pendingEmail = null;
        this.pendingPinHash = null;
        this.pendingAction = null;

        return { success: true, msg: '✅ Erfolgreich verifiziert & eingeloggt!' };
    },

    getUserGameData() {
        let user = this.getSession();
        let db = this.getUsersDB();
        
        if (!db[user]) {
            db[user] = {
                pinHash: "default",
                gameData: { beats: 0, fans: 0, releases: 0, upgrades: {} }
            };
            this.saveUsersDB(db);
        }
        if (!db[user].gameData) {
            db[user].gameData = { beats: 0, fans: 0, releases: 0, upgrades: {} };
            this.saveUsersDB(db);
        }
        return db[user].gameData;
    },

    saveUserGameData(gData) {
        let user = this.getSession();
        let db = this.getUsersDB();
        if (!db[user]) {
            db[user] = { pinHash: "default", gameData: gData };
        } else {
            db[user].gameData = gData;
        }
        this.saveUsersDB(db);
    }
};
