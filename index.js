// ==========================
// Basic Setup
// ==========================
const express = require('express');
const session = require('express-session');
require('dotenv').config();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// Middleware
// ==========================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sessions
app.use(session({
    secret: process.env.SESSION_SECRET || 'tempsecret',
    resave: false,
    saveUninitialized: true
}));

// Authentication Helper
function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

// ==========================
// View Engine
// ==========================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==========================
// Routes (frontend + auth)
// ==========================

// Home
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user || null });
});

// Login Page
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Login Handler (demo version)
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // SUPER SIMPLE demo user check
    if (username === 'admin' && password === 'admin') {
        req.session.user = { username: 'admin' };
        return res.redirect('/dashboard');
    }

    return res.render('login', { error: 'Invalid login' });
});

// Dashboard
app.get('/dashboard', requireLogin, (req, res) => {
    res.render('dashboard', { user: req.session.user });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));