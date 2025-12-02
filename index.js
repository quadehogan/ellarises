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

// GET routes
app.get('/participants', requireLogin, (req, res) => 
    res.render('participants'));

app.get('/events', requireLogin, (req, res) => 
    res.render('events'));

app.get('/surveys', (req, res) => 
    res.render('surveys'));

app.get('/milestones', (req, res) => 
    res.render('milestones'));

app.get('/donations', requireLogin, (req, res) => 
    res.render('donations'));

app.get('/enroll', (req, res) => 
    res.render('enroll'));

app.get('/create_user', requireLogin, (req, res) => 
    res.render('create_user'));

app.get('/add_events', requireLogin, (req, res) => 
    res.render('add_events'));

app.get('/add_milestone', requireLogin, (req, res) => 
    res.render('add_milestone'));

app.get('/add_survey', requireLogin, (req, res) => 
    res.render('add_survey'));

app.get('/add_donation', (req, res) => 
    res.render('add_donation'));

// Fun IS 404 requirement route
app.get('/teapot', (req, res) => {
    res.status(418).send("I'm a teapot ☕");
});

// POST routes
app.post('/submit-survey', requireLogin, (req, res) => {
    const {
        SurveySatisfactionScore,
        SurveyUsefulnessScore,
        SurveyInstructorScore,
        SurveyRecommendationScore,
        SurveyComments
    } = req.body;

    // Parse scores as integers
    const sat = parseInt(SurveySatisfactionScore);
    const use = parseInt(SurveyUsefulnessScore);
    const instr = parseInt(SurveyInstructorScore);
    const rec = parseInt(SurveyRecommendationScore);

    // Calculate overall score (average of first 3)
    const overall = ((sat + use + instr) / 3).toFixed(2);

    // Determine NPS bucket
    let npsBucket;
    if(rec === 5) npsBucket = 'Promoter';
    else if(rec === 4) npsBucket = 'Passive';
    else npsBucket = 'Detractor';

    // Example: save to database
    const surveyData = {
        SurveySatisfactionScore: sat,
        SurveyUsefulnessScore: use,
        SurveyInstructorScore: instr,
        SurveyRecommendationScore: rec,
        SurveyOverallScore: overall,
        SurveyNPSBucket: npsBucket,
        SurveyComments
    };

    // TODO: insert surveyData into your database
    console.log('Saving survey:', surveyData);

    // Redirect or render a success page
    res.send('Survey submitted successfully!');
});


// ==========================
// Start Server
// ==========================
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));