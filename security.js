// security.js - Zentrale Sicherheits- und Auth-Logik
const SecureAuth = {
    getSession() {
        return localStorage.getItem('secure_nexus_logged_user') || null;
    },
    setSession(email) {
        localStorage.setItem('secure_nexus_logged_user', email);
    },
    clearSession() {
        localStorage.removeItem('secure_nexus_logged_user');
    },
    getUsersDB() {
        try {
            return JSON.parse(localStorage.getItem('secure_nexus_master_users_db_v5')) || {};
        } catch(e) { return {}; }
    },
    saveUsersDB(db) {
        localStorage.setItem('secure_nexus_master_users_db_v5', JSON.stringify(db));
    },
    
    pendingEmail: null,
    pendingPin: null,
    pendingAction: null,
    activeCode: null,

    initAuthAction(email, pin, actionType) {
        if (!email || !email.includes('@')) return { success: false, msg: '❌ Ungültige E-Mail-Adresse!' };
        if (!pin || pin.length < 4) return { success: false, msg: '❌ PIN muss mindestens 4 Ziffern haben!' };

        email = email.trim().toLowerCase();
        pin = pin.trim();
        let db = this.getUsersDB();

        if (actionType === 'register') {
            if (db[email]) return { success: false, msg: '❌ Diese E-Mail ist bereits registriert!' };
        } else if (actionType === 'login' || actionType === 'reset_pin') {
            if (!db[email]) return { success: false, msg: '❌ E-Mail-Adresse nicht gefunden!' };
            if (actionType === 'login' && db[email].pin !== pin) return { success: false, msg: '❌ Falsche PIN!' };
        }

        const code = Math.floor(1000 + Math.random() * 9000).toString();
        this.activeCode = code;
        this.pendingEmail = email;
        this.pendingPin = pin;
        this.pendingAction = actionType;

        return { success: true, code: code, msg: '✅ Code generiert!' };
    },

    verifyAndExecute(enteredCode) {
        if (!enteredCode || enteredCode.trim() !== this.activeCode) {
            return { success: false, msg: '❌ Falscher Verifizierungscode!' };
        }

        let db = this.getUsersDB();
        let email = this.pendingEmail;
        let pin = this.pendingPin;
        let action = this.pendingAction;

        if (action === 'register') {
            db[email] = {
                pin: pin,
                gameData: { beats: 0, fans: 0, releases: 0, upgrades: {} },
                createdAt: new Date().toISOString()
            };
            this.saveUsersDB(db);
        } else if (action === 'reset_pin') {
            if (db[email]) {
                db[email].pin = pin;
                this.saveUsersDB(db);
            }
        }

        this.setSession(email);
        this.activeCode = null;
        this.pendingEmail = null;
        this.pendingPin = null;
        this.pendingAction = null;

        return { success: true, msg: '✅ Erfolgreich verifiziert & eingeloggt!' };
    },

    getUserGameData() {
        let user = this.getSession();
        if (!user) return null;
        let db = this.getUsersDB();
        if (db[user]) {
            if (!db[user].gameData) db[user].gameData = { beats: 0, fans: 0, releases: 0, upgrades: {} };
            return db[user].gameData;
        }
        return null;
    },

    saveUserGameData(gData) {
        let user = this.getSession();
        if (!user) return;
        let db = this.getUsersDB();
        if (db[user]) {
            db[user].gameData = gData;
            this.saveUsersDB(db);
        }
    }
};
