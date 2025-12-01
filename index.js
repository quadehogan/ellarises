// ==========================
// index.js — All-in-One Frontend + Auth
// ==========================

const express = require('express');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// Middleware
// ==========================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'tempsecret',
    resave: false,
    saveUninitialized: true
}));

// Authentication helper
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
// Routes
// ==========================

// Home page
app.get('/', (req, res) => {
    res.render('index');
});

// Login page
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Login handler (demo user: admin/admin)
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (username === 'admin' && password === 'admin') {
        req.session.user = { username: 'admin' };
        return res.redirect('/dashboard');
    }

    res.render('login', { error: 'Invalid login' });
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Dashboard (requires login)
app.get('/dashboard', requireLogin, (req, res) => {
    res.render('dashboard', { user: req.session.user });
});

// Other placeholder pages (demo purposes)
app.get('/participants', requireLogin, (req, res) => res.render('participants'));
app.get('/events', requireLogin, (req, res) => res.render('events'));
app.get('/surveys', requireLogin, (req, res) => res.render('surveys'));
app.get('/milestones', requireLogin, (req, res) => res.render('milestones'));
app.get('/donations', requireLogin, (req, res) => res.render('donations'));

// Fun IS 404 requirement route
app.get('/teapot', (req, res) => {
    res.status(418).send("I'm a teapot ☕");
});

// ==========================
// Start Server
// ==========================
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));