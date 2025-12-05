// index.js — Clean KNEX-only version, session fixed, Multer, and routes normalized

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads folder exists (so multer dest won't fail)
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    // optionally add a .gitkeep locally so the folder is tracked
}

// ===== Middleware & Parsers =====
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session should be registered before any route that depends on it
app.use(session({
    secret: process.env.SESSION_SECRET || 'tempsecret',
    resave: false,
    saveUninitialized: false, // do not save empty sessions
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Multer (file uploads)
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// ===== Knex setup =====
const knex = require("knex")({
    client: "pg",
    connection: {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT) || 5432,
        ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : false
    },
    pool: { min: 0, max: 10 }
});

// Make user available in all views as `user`
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Authentication helper
function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

// ===== View Engine =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ===== Routes =====

// Home
app.get('/', (req, res) => {
    res.render('index'); // res.locals.user is available in EJS
});

// Login pages
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async(req, res) => {
    const { email, password } = req.body;

    try {
        const participant = await knex('Participants')
            .where({ ParticipantEmail: email })
            .first();

        if (!participant) {
            return res.render('login', { error: 'Invalid login' });
        }

        // TODO: If using hashed passwords, use bcrypt.compare()
        if (participant.ParticipantPassword !== password) {
            return res.render('login', { error: 'Invalid login' });
        }

        // Save minimal session info: id, email, role
        req.session.user = {
            id: participant.Participant_ID,
            email: participant.ParticipantEmail,
            role: participant.ParticipantRole // expected values: 'participant' or 'admin'
        };

        return res.redirect('/');
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).send('Server error');
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) console.error('Session destroy error:', err);
        res.redirect('/');
    });
});

app.get('/manage_dashboard', requireLogin, (req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.redirect('/index');
    }

    res.render('manage_dashboard', {
        user: req.session.user,
        contentFile: 'manage_default_content',
        contentData: { user: req.session.user }, // render it first
    });
});

// ===============
// EVENTS ROUTES 
// ===============
// Admin events route
app.get('/events', requireLogin, async(req, res) => {
    const user = req.session.user;

    // Only admins go through manage_dashboard
    if (!user || user.role !== 'admin') {
        return res.redirect('/events_nonverified');
    }

    try {
        const now = new Date();

        const events = await knex('EventOccurrence as eo')
            .join('EventTemplates as et', 'eo.Event_ID', 'et.Event_ID')
            .select(
                'et.Event_ID',
                'et.EventName',
                'et.EventType',
                'et.EventDescription',
                'eo.EventDateTimeStart',
                'eo.EventLocation'
            )
            .orderBy('eo.EventDateTimeStart', 'asc');

        const upcomingEvents = events.filter(e => new Date(e.EventDateTimeStart) >= now);
        const pastEvents = events.filter(e => new Date(e.EventDateTimeStart) < now);

        // Render manage_dashboard with events_content
        res.render('manage_dashboard', {
            user,
            title: 'Events',
            contentFile: 'events_content',
            contentData: {
                user,
                upcomingEvents,
                pastEvents
            }
        });

    } catch (err) {
        console.error("Admin events error:", err);
        res.status(500).send("Error retrieving events");
    }
});


// User event routes
app.get('/events_user/:id', requireLogin, async(req, res) => {
    const userId = req.session.user.id;

    try {
        const upcomingEvents = await knex('EventOccurrence as eo')
            .join('EventTemplates as et', 'eo.Event_ID', 'et.Event_ID')
            .select(
                'eo.Event_ID',
                'eo.EventDateTimeStart',
                'et.EventName',
                'et.EventDescription',
                'eo.EventLocation'
            )
            .where('eo.EventDateTimeStart', '>=', new Date())
            .orderBy('eo.EventDateTimeStart', 'asc');

        const userPastEvents = await knex('EventOccurrence as eo')
            .join('EventTemplates as et', 'eo.Event_ID', 'et.Event_ID')
            .join('Registration as r', function() {
                this.on('r.Event_ID', '=', 'eo.Event_ID')
                    .andOn('r.EventDateTimeStart', '=', 'eo.EventDateTimeStart')
                    .andOn('r.Participant_ID', '=', knex.raw('?', [userId]));
            })
            .select(
                'eo.Event_ID',
                'eo.EventDateTimeStart',
                'et.EventName',
                'et.EventDescription',
                'eo.EventLocation',
                'r.RegistrationAttendedFlag'
            )
            .where('eo.EventDateTimeStart', '<', new Date())
            .andWhere('r.RegistrationAttendedFlag', '=', 'T')
            .orderBy('eo.EventDateTimeStart', 'desc');

        res.render('events_user', {
            user: req.session.user,
            upcomingEvents,
            userPastEvents
        });

    } catch (err) {
        console.error("User events error:", err);
        res.status(500).send("Server error");
    }
});

// Public events route
// PUBLIC — shows upcoming events only
app.get('/events_nonverified', async(req, res) => {
    try {
        const now = new Date();

        const events = await knex('EventOccurrence as eo')
            .join('EventTemplates as et', 'eo.Event_ID', 'et.Event_ID')
            .select(
                'et.EventName',
                'et.EventDescription',
                'eo.EventDateTimeStart'
            )
            .where('eo.EventDateTimeStart', '>=', now)
            .orderBy('eo.EventDateTimeStart', 'asc');

        res.render('events_nonverified', {
            user: req.session.user,
            events
        });
    } catch (err) {
        console.error("Public events error:", err);
        res.status(500).send("Server error");
    }
});


// ===============
// ADD EVENT FORM (ADMIN)
// ===============
app.get('/events/add', requireLogin, async(req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.redirect('/events_nonverified');
    }

    try {
        const eventTemplates = await knex('EventTemplates')
            .select(
                'Event_ID',
                'EventName',
                'EventType',
                'EventDescription',
                'EventRecurrencePattern',
                'EventDefaultCapacity'
            )
            .orderBy('EventName', 'asc');

        res.render('add_events', {
            user: req.session.user,
            eventTemplates
        });

    } catch (err) {
        console.error("Error loading event templates:", err);
        res.status(500).send("Server error retrieving event templates");
    }
});


// ===============
// ADD EVENT ACTION (ADMIN)
// ===============
app.post('/events/add', requireLogin, async(req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.redirect('/events_nonverified');
    }

    try {
        const {
            Event_ID,
            EventDateTimeStart,
            EventDateTimeEnd,
            EventLocation,
            EventCapacity,
            EventRegistrationDeadline
        } = req.body;

        await knex('EventOccurrence').insert({
            Event_ID,
            EventDateTimeStart,
            EventDateTimeEnd,
            EventLocation,
            EventCapacity,
            EventRegistrationDeadline
        });

        res.redirect('/events');

    } catch (err) {
        console.error("Error adding event occurrence:", err);
        res.status(500).send("Server error creating event occurrence");
    }
});



// Dashboard (requires login)
app.get('/milestones', requireLogin, async(req, res) => {
    const user = req.session.user;

    try {
        // Fetch milestones with participant names
        const milestones = await knex('Milestones as m')
            .join('Participants as p', 'm.Participant_ID', 'p.Participant_ID')
            .select(
                'm.Participant_ID',
                'p.ParticipantFirstName',
                'p.ParticipantLastName',
                'm.MilestoneTitle',
                'm.MilestoneDate'
            )
            .orderBy('m.MilestoneDate', 'desc');

        if (user.role === 'admin') {
            // Admin view goes through manage_dashboard
            return res.render('manage_dashboard', {
                user,
                title: 'Milestones',
                contentFile: 'milestones',
                contentData: {
                    user,
                    milestones
                }
            });
        }

    } catch (err) {
        console.error('Error loading dashboard:', err);
        res.status(500).send('Server error.');
    }
});

app.get('/dashboard', requireLogin, (req, res) => {
    const user = req.session.user;
    res.render('manage_dashboard', {
        title: 'Dashboard',
        contentFile: 'dashboard_content',
        contentData: { user }
    });
});

// GET route to display the new donation form
app.get("/donations/add", requireLogin, (req, res) => {
    const user = req.session.user;
    res.render("add_donation_admin", {
        user: user
    });
});

// ===== ADMIN ADD DONATION =====
app.post("/donations/add", requireLogin, async (req, res) => {
    try {
        let { DonationAmount, Participant_ID, DonationDate, firstName, lastName, email } = req.body;

        // Validate required fields
        const numericAmount = parseFloat(DonationAmount || 0);
        if (numericAmount <= 0) {
            return res.status(400).send("Invalid donation amount.");
        }

        let participantID = Participant_ID;

        // 1️⃣ If no Participant_ID is provided, create a temporary participant
        if (!participantID) {
            const [newParticipant] = await knex("Participants")
                .insert({
                    ParticipantFirstName: firstName || "Visitor",
                    ParticipantLastName: lastName || "Donor",
                    ParticipantEmail: email || null,
                    ParticipantPassword: "publicdonor", // required by ERD
                    ParticipantRole: "visitor",
                    ParticipantDOB: null,
                    ParticipantPhone: null,
                    ParticipantCity: "N/A",
                    ParticipantState: "N/A",
                    ParticipantZIP: "00000",
                    ParticipantSchoolorEmployer: null,
                    ParticipantFieldOfInterest: null
                })
                .returning("Participant_ID");

            participantID = newParticipant.Participant_ID;
        }

        // 2️⃣ Insert donation
        await knex("Donations").insert({
            Participant_ID: participantID,
            DonationAmount: numericAmount,
            DonationDate: DonationDate || knex.fn.now()
        });

        // 3️⃣ Optionally store a success message
        req.session.message = "Donation added successfully!";

        // 4️⃣ Redirect to donations list or dashboard
        res.redirect("/donations");

    } catch (err) {
        console.error("Error adding donation:", err);
        res.status(500).send("Server error adding donation");
    }
});



// ===== Participants page (admin only) =====
app.get('/participants', requireLogin, async(req, res) => {
    const user = req.session.user;

    // Only admins can access
    if (!user || user.role !== 'admin') {
        return res.status(403).send('Access denied');
    }

    try {
        // 2) Get participants who attended (RegistrationAttendedFlag = 'T')
        const participantsRaw = await knex('Registration as r')
            .join('Participants as p', 'r.Participant_ID', 'p.Participant_ID')
            .select(
                'r.Participant_ID',
                'p.ParticipantFirstName',
                'p.ParticipantLastName',
                'p.ParticipantEmail',
                'p.ParticipantPhone',
                'r.Event_ID',
                'r.EventDateTimeStart'
            )
            .where('r.RegistrationAttendedFlag', 'T');

        // Render directly to manage_dashboard
        res.render('manage_dashboard', {
            user,
            title: 'Participants',
            contentFile: 'participants_content',
            contentData: {
                user,
                participantsRaw
            }
        });

    } catch (err) {
        console.error('Error loading participants:', err);
        res.status(500).send('Database error.');
    }
});

app.get('/users', requireLogin, async(req, res) => {
    const user = req.session.user;

    // Only admins can access
    if (!user || user.role !== 'admin') {
        return res.status(403).send('Access denied');
    }

    try {
        // 1) Get all participants
        const usersRaw = await knex('Participants')
            .select('Participant_ID', 'ParticipantFirstName', 'ParticipantLastName', 'ParticipantEmail', 'ParticipantPhone');

        // Deduplicate by email for each list
        const uniqueByEmail = (arr) => {
            const seen = new Set();
            return arr.filter(p => {
                if (!seen.has(p.ParticipantEmail)) {
                    seen.add(p.ParticipantEmail);
                    return true;
                }
                return false;
            });
        };

        const users = uniqueByEmail(usersRaw).map(p => ({
            Participant_ID: p.Participant_ID,
            firstName: p.ParticipantFirstName,
            lastName: p.ParticipantLastName,
            email: p.ParticipantEmail,
            phone: p.ParticipantPhone
        }));

        // Render directly to manage_dashboard
        res.render('manage_dashboard', {
            user,
            title: 'Users',
            contentFile: 'users',
            contentData: {
                user,
                users
            }
        });

    } catch (err) {
        console.error('Error loading participants:', err);
        res.status(500).send('Database error.');
    }
});





// ===== Profile Routes =====
app.get('/profile/:id', requireLogin, async(req, res) => {
    const message = req.session.message;
    delete req.session.message;
    try {
        // If id param provided use it, otherwise use current user's id
        const id = req.params.id || req.session.user.id;

        const profile = await knex('Participants')
            .where({ Participant_ID: id })
            .first();

        const milestones = await knex('Milestones')
            .where({ Participant_ID: id })
            .orderBy('MilestoneDate', 'desc');

        res.render('profile', {
            user: req.session.user,
            message,
            profile,
            milestones
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading profile');
    }
});

app.post('/profile/update', upload.single('ProfilePicture'), requireLogin, async(req, res) => {
    try {
        const id = req.body.Participant_ID;

        // Basic validation
        if (!id) return res.status(400).send('Missing Participant_ID');

        const updateData = {
            ParticipantFirstName: req.body.ParticipantFirstName,
            ParticipantLastName: req.body.ParticipantLastName,
            ParticipantEmail: req.body.ParticipantEmail,
            ParticipantDOB: req.body.ParticipantDOB,
            ParticipantPhone: req.body.ParticipantPhone,
            ParticipantSchoolorEmployer: req.body.ParticipantSchoolorEmployer,
            ParticipantFieldOfInterest: req.body.ParticipantFieldOfInterest
        };

        if (req.file) {
            updateData.ProfilePicture = req.file.filename;
        }

        await knex('Participants')
            .where({ Participant_ID: id })
            .update(updateData);

        res.redirect(`/profile/${id}`);
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).send('Update failed');
    }
});


// ===== Surveys route (composite key) =====
app.get('/surveys/:eventId/:eventDateTimeStart', async(req, res) => {
    const { eventId, eventDateTimeStart } = req.params;

    try {
        const event = await knex('EventOccurrence as eo')
            .join('EventTemplates as et', 'eo.Event_ID', 'et.Event_ID')
            .select(
                'eo.Event_ID',
                'eo.EventDateTimeStart',
                'et.EventName' // <-- pulled from EventTemplate
            )
            .where({
                'eo.Event_ID': eventId,
                'eo.EventDateTimeStart': eventDateTimeStart
            })
            .first();

        if (!event) return res.status(404).send('Event not found');

        const surveys = await knex('Surveys as s')
            .join('Participants as p', 's.Participant_ID', 'p.Participant_ID')
            .select('s.*', 'p.ParticipantFirstName', 'p.ParticipantLastName')
            .where({ 's.Event_ID': eventId, 's.EventDateTimeStart': eventDateTimeStart });

        const averages = {
            overall: 0,
            satisfaction: 0,
            usefulness: 0,
            instructor: 0,
            recommendation: 0
        };

        if (surveys.length > 0) {
            const count = surveys.length;
            averages.overall = (surveys.reduce((t, r) => t + Number(r.SurveyOverallScore || 0), 0) / count).toFixed(2);
            averages.satisfaction = (surveys.reduce((t, r) => t + Number(r.SurveySatisfactionScore || 0), 0) / count).toFixed(2);
            averages.usefulness = (surveys.reduce((t, r) => t + Number(r.SurveyUsefulnessScore || 0), 0) / count).toFixed(2);
            averages.instructor = (surveys.reduce((t, r) => t + Number(r.SurveyInstructorScore || 0), 0) / count).toFixed(2);
            averages.recommendation = (surveys.reduce((t, r) => t + Number(r.SurveyRecommendationScore || 0), 0) / count).toFixed(2);
        }

        res.render('surveys', {
            event,
            surveys,
            averages,
            user: req.session.user
        });
    } catch (err) {
        console.error('Knex Surveys route error:', err);
        res.status(500).send('Error retrieving surveys');
    }
});

// ===== Milestones (use KNEX) =====
app.get('/milestones', async(req, res) => {
    try {
        // Use Milestones table (capitalization consistent with other routes)
        const rows = await knex('Milestones').select('*').orderBy('id', 'desc');
        res.render('milestones', { milestones: rows, user: req.session.user });
    } catch (err) {
        console.error('Error loading milestones:', err);
        res.status(500).send('Error loading milestones');
    }
});

app.get('/milestones/add', (req, res) => {
    res.render('add_milestone', { user: req.session.user });
});

app.post('/milestones/add', requireLogin, async(req, res) => {
    const { title, due_date, details } = req.body;

    try {
        await knex('Milestones').insert({
            title,
            due_date,
            details
        });
        res.redirect('/milestones');
    } catch (err) {
        console.error('Error adding milestone:', err);
        res.status(500).send('Error adding milestone');
    }
});

// ===== Donations =====
// ===== PUBLIC DONATION PAGE (no login required) =====
app.get('/donate-public', (req, res) => {
    res.render('add_donation_public', { message: null });
});



// ===== PUBLIC DONATION SUBMIT =====
app.post('/submit-donation-public', async(req, res) => {
    try {
        const { firstName, lastName, email, amount } = req.body;

        const numericAmount = parseFloat(amount || 0);
        if (numericAmount <= 0) {
            return res.status(400).send("Invalid donation amount.");
        }

        // 1️⃣ Create temporary/visitor participant
        const [newParticipant] = await knex("Participants")
            .insert({
                ParticipantFirstName: firstName || "Visitor",
                ParticipantLastName: lastName || "Donor",
                ParticipantEmail: email || null,
                ParticipantPassword: "publicdonor", // REQUIRED BY ERD
                ParticipantRole: "visitor",

                // Safe defaults in case schema does NOT allow null
                ParticipantDOB: null,
                ParticipantPhone: null,
                ParticipantCity: "N/A",
                ParticipantState: "N/A",
                ParticipantZIP: "00000",
                ParticipantSchoolorEmployer: null,
                ParticipantFieldOfInterest: null
            })
            .returning("Participant_ID");

        const visitorID = newParticipant.Participant_ID;

        // 2️⃣ Insert donation linked to visitor participant
        await knex("Donations").insert({
            Participant_ID: visitorID,
            DonationAmount: numericAmount,
            DonationDate: knex.fn.now()
        });

        // 3️⃣ Re-render form with thank-you message
        return res.render("add_donation_public", {
            message: "Thank you for your donation!"
        });

    } catch (err) {
        console.error("Public donation error:", err);
        return res.status(500).send("Server error submitting donation.");
    }
});


// ===== LOGGED-IN DONATIONS PAGE =====
app.get('/donations', requireLogin, async(req, res) => {
    const user = req.session.user;

    try {
        let donations = [];

        // ADMIN VIEW
        if (user.role === 'admin') {
            donations = await knex('Donations')
                .leftJoin('Participants', 'Donations.Participant_ID', 'Participants.Participant_ID')
                .select(
                    'Donations.Donation_ID',
                    'Donations.Participant_ID',
                    'Donations.DonationAmount',
                    'Donations.DonationDate',
                    'Participants.ParticipantFirstName',
                    'Participants.ParticipantLastName'
                )
                .orderBy('Donations.DonationDate', 'desc');

            const totalAmount = donations.reduce((s, d) => s + Number(d.DonationAmount || 0), 0);

            return res.render('manage_dashboard', {
                user,
                title: 'Donations',
                contentFile: 'donations_admin_content',
                contentData: {
                    user,
                    donations,
                    totalAmount
                }
            });
        }

        // PARTICIPANT VIEW
        if (user.role === 'participant') {
            donations = await knex('Donations')
                .where({ Participant_ID: user.id })
                .select('Donation_ID', 'DonationAmount', 'DonationDate')
                .orderBy('DonationDate', 'desc');

            const totalAmount = donations.reduce((s, d) => s + Number(d.DonationAmount || 0), 0);

            return res.render('donations_user', {
                user,
                donations,
                totalAmount
            });
        }

        return res.status(403).send("Unauthorized role.");
    } catch (err) {
        console.error("Error fetching donations:", err);
        res.status(500).send("Server error.");
    }
});

// ===== LOGGED-IN PARTICIPANT SUBMIT DONATION =====
app.post('/submit-donation', requireLogin, async(req, res) => {
    try {
        const user = req.session.user;
        const amount = parseFloat(req.body.amount);

        if (user.role !== "participant") {
            return res.status(403).send("Only participants can submit donations.");
        }

        if (isNaN(amount) || amount <= 0) {
            return res.status(400).send("Invalid donation amount.");
        }

        await knex('Donations').insert({
            Participant_ID: user.id,
            DonationAmount: amount,
            DonationDate: knex.fn.now()
        });

        try {
            await knex('Participants')
                .where({ Participant_ID: user.id })
                .increment('TotalDonations', amount);
        } catch (e) {
            console.warn("TotalDonations optional column not updated:", e.message);
        }

        res.redirect('/donations');

    } catch (err) {
        console.error("Error submitting donation:", err);
        res.status(500).send("Error submitting donation.");
    }
});


// ===== SHOW ADD DONATION FORM (USER ONLY) =====
app.get('/donate', requireLogin, (req, res) => {
    const user = req.session.user;

    if (user.role !== 'participant') {
        return res.status(403).send("Only participants can add donations.");
    }

    res.render('add_donation_user', { user });
});

app.get('/thank-you', (req, res) => {
    res.render('thank_you');
});



// ===== Enroll / Create User / Add Events (render forms) =====
app.get('/enroll', (req, res) => res.render('enroll', { user: req.session.user }));

app.get('/create_user', requireLogin, (req, res) =>
    res.render('manage_dashboard', {
        user: req.session.user,
        title: 'Create User',
        contentFile: 'create_user_content',
        contentData: { user: req.session.user }
    }));

app.get('/add_events', requireLogin, (req, res) => res.render('add_events', { user: req.session.user }));



// Admin Add Milestone page
app.get('/add_milestone_admin', requireLogin, async(req, res) => {
    const user = req.session.user;

    if (user.role !== 'admin') {
        return res.redirect('/dashboard');
    }

    const participants = await knex('Participants')
        .select(
            'Participant_ID',
            'ParticipantFirstName',
            'ParticipantLastName',
            'ParticipantEmail'
        );

    res.render('add_milestone_admin', { user, participants });
});

// User get add milestone page
app.get("/milestone/add/:id", requireLogin, async(req, res) => {
    const participantId = req.params.id;

    const participant = await knex("Participants")
        .where("Participant_ID", participantId)
        .first();

    res.render("add_milestone_user", {
        user: req.session.user,
        participant
    });
});



// User post add milestone page
app.post("/milestone/add", requireLogin, async(req, res) => {
    const { Participant_ID, MilestoneTitle, MilestoneDate } = req.body;

    try {
        await knex("Milestones").insert({
            Participant_ID,
            MilestoneTitle,
            MilestoneDate
        });

        res.redirect(`/profile/${Participant_ID}`);
    } catch (err) {
        console.error("Error adding milestone:", err);
        res.status(500).send("Error adding milestone");
    }
});



app.get('/add_survey/:Participant_ID/:Event_ID/:EventDateTimeStart', requireLogin, (req, res) => {
    const { Participant_ID, Event_ID, EventDateTimeStart } = req.params;
    res.render('add_survey', { user: req.session.user, Participant_ID, Event_ID, EventDateTimeStart });
});

// Teapot
app.get('/teapot', (req, res) => res.status(418).send("I'm a teapot ☕"));

// ===== POST: Enroll =====
app.post('/enroll', async(req, res) => {
    const data = req.body;

    try {
        await knex('Participants').insert({
            ParticipantEmail: data.ParticipantEmail,
            ParticipantPassword: data.ParticipantPassword,
            ParticipantFirstName: data.ParticipantFirstName,
            ParticipantLastName: data.ParticipantLastName,
            ParticipantDOB: data.ParticipantDOB,
            ParticipantRole: data.ParticipantRole,
            ParticipantPhone: data.ParticipantPhone,
            ParticipantCity: data.ParticipantCity,
            ParticipantState: data.ParticipantState,
            ParticipantZIP: data.ParticipantZIP,
            ParticipantSchoolorEmployer: data.ParticipantSchoolorEmployer,
            ParticipantFieldOfInterest: data.ParticipantFieldOfInterest
        });

        res.redirect('/login');

    } catch (err) {
        console.error('Error enrolling participant:');

        // Log full error object
        console.error(err);

        // PostgreSQL-specific info
        if (err.code) console.error('Error code:', err.code);
        if (err.constraint) console.error('Constraint failed:', err.constraint);
        if (err.column) console.error('Column involved:', err.column);
        if (err.detail) console.error('Detail:', err.detail);
        if (err.hint) console.error('Hint:', err.hint);

        // Return detailed message to client for debugging (optional)
        res.status(500).send(`Error enrolling participant: ${err.message}`);
    }
});


// ===== POST: Create user (admin) =====
app.post('/create-user-submit', requireLogin, async(req, res) => {
    const body = req.body;

    try {
        await knex('Participants').insert({
            ParticipantEmail: body.ParticipantEmail,
            ParticipantPassword: body.ParticipantPassword,
            ParticipantFirstName: body.ParticipantFirstName,
            ParticipantLastName: body.ParticipantLastName,
            ParticipantDOB: body.ParticipantDOB,
            ParticipantRole: body.ParticipantRole,
            ParticipantPhone: body.ParticipantPhone,
            ParticipantCity: body.ParticipantCity,
            ParticipantState: body.ParticipantState,
            ParticipantZIP: body.ParticipantZIP,
            ParticipantSchoolorEmployer: body.ParticipantSchoolorEmployer,
            ParticipantFieldOfInterest: body.ParticipantFieldOfInterest,
        });

        res.redirect('/participants');

    } catch (err) {
        console.error('Error creating user:');

        // Log full error object
        console.error(err);

        // PostgreSQL-specific info
        if (err.code) console.error('Error code:', err.code);
        if (err.constraint) console.error('Constraint failed:', err.constraint);
        if (err.column) console.error('Column involved:', err.column);
        if (err.detail) console.error('Detail:', err.detail);
        if (err.hint) console.error('Hint:', err.hint);

        // Return detailed message to client for debugging (optional)
        res.status(500).send(`Error creating user: ${err.message}`);
    }
});


// ===== POST: Submit Survey (example storing) =====
app.post('/submit-survey', requireLogin, async(req, res) => {
    try {
        const {
            SurveySatisfactionScore,
            SurveyUsefulnessScore,
            SurveyInstructorScore,
            SurveyRecommendationScore,
            SurveyComments,
            Event_ID,
            EventDateTimeStart,
            Participant_ID
        } = req.body;

        const sat = parseInt(SurveySatisfactionScore || 0);
        const use = parseInt(SurveyUsefulnessScore || 0);
        const instr = parseInt(SurveyInstructorScore || 0);
        const rec = parseInt(SurveyRecommendationScore || 0);

        const overall = ((sat + use + instr) / 3).toFixed(2);

        let npsBucket;
        if (rec === 5) npsBucket = 'Promoter';
        else if (rec === 4) npsBucket = 'Passive';
        else npsBucket = 'Detractor';

        await knex('Surveys').insert({
            Participant_ID,
            Event_ID,
            EventDateTimeStart,
            SurveySatisfaction: sat,
            SurveyUsefulnessScore: use,
            SurveyInstructorScore: instr,
            SurveyRecommendationScore: rec,
            SurveyOverallScore: overall,
            SurveyNPSBucket: npsBucket,
            SurveyComments,
            SurveySubmissionDate: knex.fn.now()
        });

        res.send('Survey submitted successfully!');
    } catch (err) {
        console.error('Error saving survey:', err);
        res.status(500).send('Error submitting survey');
    }
});

// ===== Registration routes =====
app.post('/register', async(req, res) => {
    const { Participant_ID, Event_ID, EventDateTimeStart } = req.body;

    try {
        if (!Participant_ID || !Event_ID || !EventDateTimeStart) {
            return res.status(400).send('Missing required fields');
        }

        const event = await knex('EventOccurrence')
            .where({ Event_ID, EventDateTimeStart })
            .first();

        if (!event) return res.status(404).send('Event occurrence not found');

        const now = new Date();
        const registrationDeadline = new Date(event.EventRegistrationDeadline || 0);

        if (registrationDeadline && now > registrationDeadline) {
            return res.status(400).send('Registration deadline has passed');
        }

        if (event.EventNumRegistered >= event.EventCapacity) {
            return res.status(400).send('Event is full');
        }

        await knex('Registration').insert({
            Participant_ID,
            Event_ID,
            EventDateTimeStart,
            RegistrationStatus: 'tbd',
            RegistrationAttendedFlag: 'F'
        });

        // increment count safely
        await knex('EventOccurrence')
            .where({ Event_ID, EventDateTimeStart })
            .increment('EventNumRegistered', 1);

        res.status(200).send('Registration successful');
    } catch (err) {
        console.error('Error registering:', err);
        res.status(500).send('Server error');
    }
});

app.post('/registration/update', async(req, res) => {
    const { Participant_ID, Event_ID, EventDateTimeStart, action } = req.body;

    try {
        if (!Participant_ID || !Event_ID || !EventDateTimeStart) {
            return res.status(400).send('Missing required fields');
        }

        const updateFields = (action === 'attended') ? { RegistrationStatus: 'attended', RegistrationAttendedFlag: 'T' } :
            (action === 'absent') ? { RegistrationStatus: 'no-show', RegistrationAttendedFlag: 'F' } :
            (action === 'cancel') ? { RegistrationStatus: 'cancelled', RegistrationAttendedFlag: 'F' } :
            null;

        if (!updateFields) return res.status(400).send('Invalid action');

        const existingReg = await knex('Registration')
            .where({ Participant_ID, Event_ID, EventDateTimeStart })
            .first();

        await knex('Registration')
            .where({ Participant_ID, Event_ID, EventDateTimeStart })
            .update(updateFields);

        if (action === 'cancel' && existingReg && existingReg.RegistrationStatus !== 'cancelled') {
            const event = await knex('EventOccurrence')
                .where({ Event_ID, EventDateTimeStart })
                .first();

            const newCount = Math.max(0, (event.EventNumRegistered || 0) - 1);

            await knex('EventOccurrence')
                .where({ Event_ID, EventDateTimeStart })
                .update({ EventNumRegistered: newCount });
        }

        res.redirect('back');
    } catch (err) {
        console.error('Error updating registration:', err);
        res.status(500).send('Error updating registration');
    }
});

// ===== Submit milestone (participants limited) =====
app.post('/submit-milestone', requireLogin, async(req, res) => {
    try {
        const user = req.session.user;
        let { Participant_ID, MilestoneTitle, MilestoneDescription } = req.body;

        if (user.role === 'participant') {
            Participant_ID = user.id;
        }

        await knex('Milestones').insert({
            Participant_ID,
            MilestoneTitle,
            MilestoneDescription,
            MilestoneDate: knex.fn.now()
        });

        res.redirect('/milestones');
    } catch (err) {
        console.error('Error creating milestone:', err);
        res.status(500).send('Error creating milestone');
    }
});

// ===== ALL EDIT ROUTES =====

// Edit participant (retrieve for edit form)
app.get('/participant/:id/edit', async(req, res) => {
    const user = req.session.user;
    const participantId = req.params.id;

    try {
        const participant = await knex('Participants')
            .where({ Participant_ID: participantId })
            .first();

        if (participant) {
            res.render('edit_user', { user, participant });
        } else {
            res.status(404).send('Participant not found.');
        }
    } catch (err) {
        console.error('Error fetching participant:', err);
        res.status(500).send('Internal server error.');
    }
});

// Edit donation
app.get('/donation/:id/edit', async(req, res) => {
    const user = req.session.user;
    const donationId = req.params.id;

    try {
        const donation = await knex('Donations')
            .where({ Donation_ID: donationId })
            .first();

        if (donation) {
            res.render('edit_donation', { user, donation });
        } else {
            res.status(404).send('Donation not found.');
        }
    } catch (err) {
        console.error('Error fetching donation:', err);
        res.status(500).send('Internal server error.');
    }
});

// Edit event occurrence (composite key)
app.get('/events/edit/:eventId/:startTime', async(req, res) => {
    const user = req.session.user;
    const { eventId, startTime } = req.params;

    try {
        const event = await knex('EventOccurrence')
            .where({
                Event_ID: eventId,
                EventDateTimeStart: startTime
            })
            .first();

        if (!event) return res.status(404).send('Event occurrence not found.');

        res.render('edit_events', { user, event });

    } catch (err) {
        console.error('Error fetching event occurrence:', err);
        res.status(500).send('Internal server error.');
    }
});

// Handles saving updated event occurrence details after the admin submits the edit form.
// ==================
// EDIT EVENT SUBMIT
// ==================
app.post('/events/edit', requireLogin, async(req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.redirect('/events_nonverified');
    }

    try {
        const {
            Event_ID,
            OriginalDateTimeStart,
            EventDateTimeStart,
            EventDateTimeEnd,
            EventLocation,
            EventCapacity,
            EventRegistrationDeadline
        } = req.body;

        // Convert all dates to ISO format for Postgres
        const newStart = new Date(EventDateTimeStart).toISOString();
        const newEnd = EventDateTimeEnd ? new Date(EventDateTimeEnd).toISOString() : null;
        const regDeadline = EventRegistrationDeadline ? new Date(EventRegistrationDeadline).toISOString() : null;

        await knex("EventOccurrence")
            .where({
                Event_ID: Event_ID,
                EventDateTimeStart: OriginalDateTimeStart // exact match to find the row
            })
            .update({
                EventDateTimeStart: newStart,
                EventDateTimeEnd: newEnd,
                EventLocation,
                EventCapacity,
                EventRegistrationDeadline: regDeadline
            });

        res.redirect("/events");

    } catch (err) {
        console.error("Error editing event:", err);
        res.status(500).send("Server error editing event");
    }
});



// Edit milestone (composite key)
app.get('/milestone/:participantId/:title/edit', async(req, res) => {
    const user = req.session.user;
    const { participantId, title } = req.params;

    try {
        const milestone = await knex('Milestones')
            .where({
                Participant_ID: participantId,
                MilestoneTitle: title
            })
            .first();

        if (milestone) {
            res.render('edit_milestone', { user, milestone });
        } else {
            res.status(404).send('Milestone not found.');
        }
    } catch (err) {
        console.error('Error fetching milestone:', err);
        res.status(500).send('Internal server error.');
    }
});

// Edit registration (composite key)
app.get('/registration/:participantId/:eventId/:startTime/edit', async(req, res) => {
    user = req.session.user;
    const { participantId, eventId, startTime } = req.params;

    try {
        const registration = await knex('Registration')
            .where({
                Participant_ID: participantId,
                Event_ID: eventId,
                EventDateTimeStart: startTime
            })
            .first();

        if (registration) {
            res.render('edit_registration', { user, registration });
        } else {
            res.status(404).send('Registration not found.');
        }
    } catch (err) {
        console.error('Error fetching registration:', err);
        res.status(500).send('Internal server error.');
    }
});

// Edit survey (composite key)
app.get('/survey/:participantId/:eventId/:startTime/edit', async(req, res) => {
    const user = req.session.user;
    const { participantId, eventId, startTime } = req.params;

    try {
        const survey = await knex('Surveys')
            .where({
                Participant_ID: participantId,
                Event_ID: eventId,
                EventDateTimeStart: startTime
            })
            .first();

        if (survey) {
            res.render('edit_survey', { user, survey });
        } else {
            res.status(404).send('Survey not found.');
        }
    } catch (err) {
        console.error('Error fetching survey:', err);
        res.status(500).send('Internal server error.');
    }
});

// ===== POST: Update Event Occurrence =====
app.post("/events/edit", async(req, res) => {
    try {
        const {
            Event_ID,
            EventDateTimeStart,
            EventDateTimeEnd,
            EventLocation,
            EventCapacity,
            EventRegistrationDeadline
        } = req.body;

        await knex("Events")
            .where({
                Event_ID: Event_ID,
                EventDateTimeStart: EventDateTimeStart // Required because datetime is part of PK
            })
            .update({
                EventDateTimeEnd,
                EventLocation,
                EventCapacity,
                EventRegistrationDeadline
            });

        req.session.message = "Event updated successfully!";
        res.redirect("/manage_dashboard");

    } catch (err) {
        console.error("Error updating event:", err);
        res.status(500).send("Server Error updating event");
    }
});

/* ----- POST: Update Participant ----- */
app.post("/profile/update/admin", async (req, res) => {
    const user = req.session.user;
  try {
    // Pull every field exactly as named in the form
    const {
      Participant_ID,  
      ParticipantEmail,
      ParticipantPassword,
      ParticipantFirstName,
      ParticipantLastName,
      ParticipantDOB,
      ParticipantRole,
      ParticipantPhone,
      ParticipantCity,
      ParticipantState,
      ParticipantZIP,
      ParticipantSchoolorEmployer,
      ParticipantFieldOfInterest
    } = req.body;

        // Update the participant record
        await knex("Participants")
            .where({ Participant_ID: Participant_ID })
            .update({
                ParticipantEmail,
                ParticipantPassword,
                ParticipantFirstName,
                ParticipantLastName,
                ParticipantDOB,
                ParticipantRole,
                ParticipantPhone,
                ParticipantCity,
                ParticipantState,
                ParticipantZIP,
                ParticipantSchoolorEmployer,
                ParticipantFieldOfInterest
            });

        // Optional success message
        req.session.message = "Profile updated successfully!";

    // Redirect back to profile page or dashboard
    if (user.role === "admin") {
      res.redirect("/manage_dashboard");
    } 
    else if (user.role === "participant") {
      res.redirect("/profile");
    }

    } catch (err) {
        console.error("Error updating profile:", err);
        res.status(500).send("Server Error updating profile");
    }
});

/* ----- POST: Update Donation ----- */
app.post("/donations/update", async (req, res) => {
    try {
        const { Donation_ID, DonationAmount, Participant_ID, DonationDate } = req.body;

        // Validate required fields
        if (!Donation_ID || !DonationAmount) {
            return res.status(400).send("Donation ID and Donation Amount are required.");
        }

        // Build update object dynamically
        const updateData = {
            DonationAmount
        };

        if (Participant_ID) updateData.Participant_ID = Participant_ID;
        if (DonationDate) updateData.DonationDate = DonationDate;

        // Update donation in the database
        await knex("Donations")
            .where({ Donation_ID })
            .update(updateData);

        // Optionally set a session message
        req.session.message = "Donation updated successfully!";

        // Redirect to donations list
        res.redirect("/donations");

    } catch (err) {
        console.error("Error updating donation:", err);
        res.status(500).send("Server error updating donation");
    }
});


app.post("/survey/update", async(req, res) => {
    const {
        Participant_ID,
        Event_ID,
        EventDateTimeStart,
        SurveySatisfactionScore,
        SurveyUsefulnessScore,
        SurveyInstructorScore,
        SurveyRecommendationScore,
        SurveyComments
    } = req.body;

    try {
        // Convert numeric fields
        const sat = parseInt(SurveySatisfactionScore || 0);
        const use = parseInt(SurveyUsefulnessScore || 0);
        const instr = parseInt(SurveyInstructorScore || 0);
        const rec = parseInt(SurveyRecommendationScore || 0);

        // Recalculate overall score (same formula as insert)
        const overall = ((sat + use + instr) / 3).toFixed(2);

        // Recalculate NPS bucket (same logic as insert)
        let npsBucket;
        if (rec === 5) npsBucket = "Promoter";
        else if (rec === 4) npsBucket = "Passive";
        else npsBucket = "Detractor";

        // Perform update using composite key
        await db("Surveys")
            .where({
                Participant_ID: Participant_ID,
                Event_ID: Event_ID,
                EventDateTimeStart: EventDateTimeStart
            })
            .update({
                SurveySatisfaction: sat, // corrected name!
                SurveyUsefulnessScore: use,
                SurveyInstructorScore: instr,
                SurveyRecommendationScore: rec,
                SurveyOverallScore: overall,
                SurveyNPSBucket: npsBucket,
                SurveyComments: SurveyComments,
                SurveySubmissionDate: db.fn.now() // optional: refresh timestamp
            });

        res.redirect("/dashboard");

    } catch (err) {
        console.error("Error updating survey:", err);
        res.status(500).send("Server Error");
    }
});



app.post("/milestone/update", async(req, res) => {
    const { Participant_ID, MilestoneTitle, MilestoneDate } = req.body;

    try {
        await db("Milestones")
            .where({
                Participant_ID: Participant_ID,
                MilestoneTitle: MilestoneTitle
            })
            .update({
                MilestoneDate: MilestoneDate
            });
        if (req.session.user.id === "admin") {
            res.redirect("/manage_dashboard");
        } else {
            res.redirect(`/profile/${Participant_ID}`);
        }
    } catch (err) {
        console.error("Error updating milestone:", err);
        res.status(500).send("Server Error");
    }
});


/* ----- POST: Update Registration ----- */
app.post("/registration/:Participant_ID/:Event_ID/:EventDateTimeStart/edit", async(req, res) => {
    try {
        const { Participant_ID, Event_ID, EventDateTimeStart } = req.params;

        const {
            RegistrationStatus,
            RegistrationAttendedFlag,
            RegistrationCheckInTime,
            RegistrationCreatedAt
        } = req.body;

        await knex("Registrations")
            .where({
                Participant_ID,
                Event_ID,
                EventDateTimeStart
            })
            .update({
                RegistrationStatus,
                RegistrationAttendedFlag,
                RegistrationCheckInTime,
                RegistrationCreatedAt
            });

        req.session.message = "Registration updated successfully!";
        if (req.session.user.id === "admin") {
            res.redirect("/manage_dashboard");
        } else {
            res.redirect(`/profile/${Participant_ID}`);
        }
    } catch (err) {
        console.error("Error updating registration:", err);
        res.status(500).send("Server Error");
    }
});



// ===== ALL DELETE ROUTES =====
// Soft delete / anonymize a participant via POST
app.post('/participant/:id/delete', async(req, res) => {
    const participantId = req.params.id;

    try {
        const updated = await knex('Participants')
            .where({ Participant_ID: participantId })
            .update({
                ParticipantEmail: null,
                ParticipantPassword: null,
                ParticipantFirstName: null,
                ParticipantLastName: null,
                ParticipantDOB: null,
                ParticipantRole: null,
                ParticipantPhone: null,
                ParticipantCity: null,
                ParticipantState: null,
                ParticipantZIP: null,
                ParticipantSchoolorEmployer: null,
                ParticipantFieldOfInterest: null
            });

        if (updated) {
            res.redirect('/participants'); // redirect back to the page
        } else {
            res.status(404).send('Participant not found.');
        }
    } catch (err) {
        console.error('Error anonymizing participant:', err);
        res.status(500).send('Internal server error.');
    }
});

// Delete a specific donation by Donation_ID
app.post('/donation/:id/delete', async(req, res) => {
    const donationId = req.params.id;

    try {
        const deleted = await knex('Donations')
            .where({ Donation_ID: donationId })
            .del();

        if (deleted) {
            res.status(200).json({ message: 'Donation deleted successfully.' });
            if (user.role === 'admin') {
                res.redirect('/donations_admin');
            } else {
                res.redirect('/donations_user');
            }
        } else {
            res.status(404).json({ message: 'Donation not found.' });
        }
    } catch (err) {
        console.error('Error deleting donation:', err);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

// Delete a specific EventOccurrence by composite key
// ==================
// DELETE EVENT OCCURRENCE (ADMIN)
// ==================
app.post('/events/delete/:eventId/:startTime', requireLogin, async(req, res) => {
    if (req.session.user.role !== 'admin') {
        return res.redirect('/events_nonverified');
    }

    try {
        const { eventId, startTime } = req.params;

        // Convert startTime (coming from URL) into valid ISO format
        const startISO = new Date(startTime).toISOString();

        const deleted = await knex("EventOccurrence")
            .where({
                Event_ID: eventId,
                EventDateTimeStart: startISO
            })
            .del();

        if (!deleted) {
            console.warn("Delete attempted but no record found:", eventId, startISO);
        }

        res.redirect("/events");

    } catch (err) {
        console.error("Error deleting event occurrence:", err);
        res.status(500).send("Internal server error");
    }
});



// Delete a specific Milestone by composite key
app.post('/milestone/:participantId/:title/delete', async(req, res) => {
    const { participantId, title } = req.params;

    try {
        const deleted = await knex('Milestones')
            .where({
                Participant_ID: participantId,
                MilestoneTitle: title
            })
            .del();

        if (deleted) {
            res.status(200).json({ message: 'Milestone deleted successfully.' });
            if (user.role === 'admin') {
                res.redirect('/dashboard');
            } else {
                res.redirect(`/profile/${participantId}`);
            }
        } else {
            res.status(404).json({ message: 'Milestone not found.' });
        }
    } catch (err) {
        console.error('Error deleting milestone:', err);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

// Delete a specific Registration by composite key
app.post('/registration/:participantId/:eventId/:startTime/delete', async(req, res) => {
    const { participantId, eventId, startTime } = req.params;

    try {
        const deleted = await knex('Registration')
            .where({
                Participant_ID: participantId,
                Event_ID: eventId,
                EventDateTimeStart: startTime
            })
            .del();

        if (deleted) {
            res.status(200).json({ message: 'Registration deleted successfully.' });
            if (user.role === 'admin') {
                res.redirect('/registrations_content');
            } else {
                res.redirect(`/profile/${participantId}`);
            }
        } else {
            res.status(404).json({ message: 'Registration not found.' });
        }
    } catch (err) {
        console.error('Error deleting registration:', err);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

// Delete a specific Survey by composite key
app.post('/survey/:participantId/:eventId/:startTime/delete', async(req, res) => {
    const { participantId, eventId, startTime } = req.params;

    try {
        const deleted = await knex('Surveys')
            .where({
                Participant_ID: participantId,
                Event_ID: eventId,
                EventDateTimeStart: startTime
            })
            .del();

        if (deleted) {
            res.status(200).json({ message: 'Survey deleted successfully.' });
            if (user.role === 'admin') {
                res.redirect('/surveys_content');
            } else {
                res.redirect(`/profile/${participantId}`);
            }
        } else {
            res.status(404).json({ message: 'Survey not found.' });
        }
    } catch (err) {
        console.error('Error deleting survey:', err);
        res.status(500).json({ message: 'Internal server error.' });
    }
});

// ===== Start server =====
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));