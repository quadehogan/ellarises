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

////////////////// KNEX SETUP //////////////////
const knex = require("knex")({
    client: "pg",
    connection: {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT),
        ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : false
    }
});

// Make user info available in all views
app.use((req, res, next) => {
    res.locals.user = req.session.user || null; // user stored in session
    next();
});

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
app.post('/login', async(req, res) => {
    const { email, password } = req.body;

    try {
        // Look up participant by email
        const participant = await knex('participants')
            .where({ Email: email })
            .first();

        if (!participant) {
            // Email not found
            return res.render('login', { error: 'Invalid login' });
        }

        // Check password
        // If you store hashed passwords, use bcrypt.compare(password, participant.Password)
        if (participant.Password !== password) {
            return res.render('login', { error: 'Invalid login' });
        }

        // Save minimal info in session
        req.session.user = {
            id: participant.ID, // store ID for later
            email: participant.Email,
            role: participant.ParticipantRole // save role for frequent access
        };

        return res.redirect('/dashboard');
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).send('Server error');
    }
});


// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

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
            .where('eo.EventDateTimeStart', '>', now)
            .orderBy('eo.EventDateTimeStart', 'asc');

        res.render('events_nonverified', { events });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});


// Dashboard (requires login)
app.get('/dashboard', requireLogin, (req, res) => {
    res.render('dashboard', { user: req.session.user });
});

// GET routes
// ----------------------
// PARTICIPANTS PAGE
// ----------------------
app.get("/participants", async(req, res) => {
    const user = req.session.user;
    // Must be logged in
    if (!user) {
        return res.redirect("/login");
    }
    // Must be admin
    if (user.role !== "admin") {
        return res.status(403).send("Access denied");
    }
    try {
        // 1. Get ALL users
        const [users] = await db.query(`
            SELECT User_ID, FirstName, LastName
            FROM Users
        `);
        // 2. Get participants who attended (RegistrationAttendedFlag = 'T')
        const [participants] = await db.query(`
            SELECT r.Participant_ID, u.FirstName, u.LastName
            FROM Registration r
            JOIN Users u 
                ON r.Participant_ID = u.User_ID
            WHERE r.RegistrationAttendedFlag = 'T'
        `);
        // 3. Format the data the way your EJS expects
        const formattedUsers = users.map(u => ({
            User_ID: u.User_ID,
            name: `${u.FirstName} ${u.LastName}`
        }));
        const formattedParticipants = participants.map(p => ({
            Participant_ID: p.Participant_ID,
            name: `${p.FirstName} ${p.LastName}`
        }));
        // Render the page
        res.render("participants", {
            user,
            users: formattedUsers,
            participants: formattedParticipants
        });
    } catch (err) {
        console.error("Error loading participants:", err);
        res.status(500).send("Database error.");
    }
});

// ==========================
// Profile Routes
// ==========================

// View profile (user sees own profile, manager can view any participant)
app.get('/profile/:id', requireLogin, async(req, res) => {
    const userId = req.params.id || req.session.user.id; // manager can pass id

    // TODO: Query the database for this participant
    // Example:
    // const profile = await db.query('SELECT * FROM Participants WHERE Participant_ID = ?', [userId]);
    // const milestones = await db.query('SELECT * FROM Milestones WHERE Participant_ID = ?', [userId]);

    // For now, just pass empty arrays/objects so the template works
    const profile = {};
    const milestones = [];

    res.render('profile', { user: req.session.user, profile, milestones });
});

// Update profile (user or manager)
app.post('/profile/update', requireLogin, async(req, res) => {
    const userId = req.body.Participant_ID || req.session.user.id;

    // TODO: Update participant info in the database
    // Example:
    // await db.query('UPDATE Participants SET ... WHERE Participant_ID = ?', [userId]);

    res.redirect(`/profile/${userId}`);
});

// Delete user (manager only)
app.post('/profile/delete', requireLogin, async(req, res) => {
    if (!req.session.user.isManager) return res.status(403).send('Forbidden');

    const userId = req.body.Participant_ID;

    // TODO: Delete participant and milestones from database
    // Example:
    // await db.query('DELETE FROM Milestones WHERE Participant_ID = ?', [userId]);
    // await db.query('DELETE FROM Participants WHERE Participant_ID = ?', [userId]);

    res.redirect('/participants');
});

// ===== EVENTS ROUTE =====
app.get('/events', async(req, res) => {
    try {
        // 1. Fetch all events from EventOccurrence
        const events = await knex('EventOccurrence')
            .select(
                'Event_ID',
                'EventName',
                'EventType',
                'EventDateTimeStart',
                'EventLocation'
            )
            .orderBy('EventDateTimeStart', 'asc');

        const now = new Date();

        // 2. Split into upcoming and past events
        const upcomingEvents = events.filter(e => new Date(e.EventDateTimeStart) >= now);
        const pastEvents = events.filter(e => new Date(e.EventDateTimeStart) < now);

        // 3. Render the events page
        res.render('events', {
            user: req.session.user,
            upcomingEvents,
            pastEvents
        });

    } catch (err) {
        console.error('Knex Events route error:', err);
        res.status(500).send('Error retrieving events');
    }
});



// ===== SURVEYS ROUTE (Composite Key Version) =====
app.get('/surveys/:eventId/:eventDateTimeStart', async(req, res) => {
    const { eventId, eventDateTimeStart } = req.params;

    try {
        // 1. Fetch event info using composite key
        const event = await knex("EventOccurrence")
            .select("Event_ID", "EventName", "EventDateTimeStart")
            .where({
                Event_ID: eventId,
                EventDateTimeStart: eventDateTimeStart
            })
            .first();

        if (!event) {
            return res.status(404).send("Event not found");
        }

        // 2. Fetch surveys for this event occurrence
        const surveys = await knex("Surveys as s")
            .join(
                "Participants as p",
                "s.Participant_ID",
                "=",
                "p.Participant_ID"
            )
            .select(
                "s.*",
                "p.ParticipantFirstName",
                "p.ParticipantLastName"
            )
            .where({
                "s.Event_ID": eventId,
                "s.EventDateTimeStart": eventDateTimeStart
            });

        // 3. Compute averages
        const averages = {
            overall: 0,
            satisfaction: 0,
            usefulness: 0,
            instructor: 0,
            recommendation: 0
        };

        if (surveys.length > 0) {
            const count = surveys.length;

            averages.overall = (
                surveys.reduce((t, r) => t + r.SurveyOverallScore, 0) / count
            ).toFixed(2);

            averages.satisfaction = (
                surveys.reduce((t, r) => t + r.SurveySatisfactionScore, 0) / count
            ).toFixed(2);

            averages.usefulness = (
                surveys.reduce((t, r) => t + r.SurveyUsefulnessScore, 0) / count
            ).toFixed(2);

            averages.instructor = (
                surveys.reduce((t, r) => t + r.SurveyInstructorScore, 0) / count
            ).toFixed(2);

            averages.recommendation = (
                surveys.reduce((t, r) => t + r.SurveyRecommendationScore, 0) / count
            ).toFixed(2);
        }

        // 4. Render the survey page
        res.render("surveys", {
            event,
            surveys,
            averages,
            user: req.session.user
        });

    } catch (err) {
        console.error("Knex Surveys route error:", err);
        res.status(500).send("Error retrieving surveys");
    }
});



app.get('/milestones', (req, res) =>
    res.render('milestones'));

app.get('/donations', requireLogin, async(req, res) => {
    const user = req.session.user; // Logged-in user
    let donations = [];
    let totalAmount = 0;

    try {
        if (user.role === 'admin') {
            // Admin: fetch all donations with donor name
            donations = await knex('donations')
                .join('participants', 'donations.Participant_ID', 'participants.ID')
                .select(
                    'donations.Donation_ID',
                    'donations.Participant_ID',
                    'donations.DonationAmount',
                    'donations.DonationDate',
                    'participants.FirstName',
                    'participants.LastName'
                );
        } else if (user.role === 'participant') {
            // Participant: fetch only their donations
            donations = await knex('donations')
                .where({ Participant_ID: user.id })
                .select('Donation_ID', 'DonationAmount', 'DonationDate');
        } else {
            return res.status(403).send('Unauthorized role');
        }

        // Calculate total amount
        totalAmount = donations.reduce(
            (sum, d) => sum + Number(d.DonationAmount),
            0
        );

        res.render('donations', { user, donations, totalAmount });
    } catch (err) {
        console.error('Error fetching donations:', err);
        res.status(500).send('Server error');
    }
});



app.get('/enroll', (req, res) =>
    res.render('enroll'));

app.get('/create_user', requireLogin, (req, res) =>
    res.render('create_user'));

app.get('/add_events', requireLogin, (req, res) =>
    res.render('add_events'));

// GET: Add Milestone Page
app.get('/add_milestone', requireLogin, async(req, res) => {
    const user = req.session.user;

    let participants = [];

    if (user.role === 'admin') {
        // Admin sees the list of all participants
        participants = await knex('participants')
            .select('Participant_ID', 'FirstName', 'LastName', 'Email');
    }

    res.render('add_milestone', {
        user,
        participants
    });
});

app.get('/add_survey', requireLogin, (req, res) =>
    res.render('add_survey'));

app.get('/add_donation', (req, res) =>
    res.render('add_donation'));

// Fun IS 404 requirement route
app.get('/teapot', (req, res) => {
    res.status(418).send("I'm a teapot ☕");
});

// POST routes
app.post('/enroll', async(req, res) => {
    const data = req.body;

    try {
        await knex('Participant').insert({
            ParticipantEmail: data.ParticipantEmail,
            ParticipantFirstName: data.ParticipantFirstName,
            ParticipantLastName: data.ParticipantLastName,
            ParticipantDOB: data.ParticipantDOB,
            ParticipantRole: "participant", // enforced
            ParticipantPhone: data.ParticipantPhone,
            ParticipantCity: data.ParticipantCity,
            ParticipantState: data.ParticipantState,
            ParticipantZip: data.ParticipantZip,
            ParticipantSchoolOrEmployer: data.ParticipantSchoolOrEmployer,
            ParticipantFieldOfInterest: data.ParticipantFieldOfInterest
        });

        res.redirect('/success');

    } catch (err) {
        console.error(err);
        res.status(500).send("Error enrolling participant");
    }
});

app.post('/create-user-submit', async(req, res) => {
    const {
        ParticipantEmail,
        ParticipantFirstName,
        ParticipantLastName,
        ParticipantDOB,
        ParticipantRole,
        ParticipantPhone,
        ParticipantCity,
        ParticipantState,
        ParticipantZip,
        ParticipantSchoolOrEmployer,
        ParticipantFieldOfInterest
    } = req.body;

    try {
        await knex('Participant').insert({
            ParticipantEmail,
            ParticipantFirstName,
            ParticipantLastName,
            ParticipantDOB,
            ParticipantRole,
            ParticipantPhone,
            ParticipantCity,
            ParticipantState,
            ParticipantZip,
            ParticipantSchoolOrEmployer,
            ParticipantFieldOfInterest,
            CreatedAt: knex.fn.now()
        });

        res.redirect('/participants'); // or wherever your success page is

    } catch (err) {
        console.error(err);
        res.status(500).send("Error creating user");
    }
});


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
    if (rec === 5) npsBucket = 'Promoter';
    else if (rec === 4) npsBucket = 'Passive';
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

app.post('/submit-donation', async(req, res) => {
    try {
        const userId = req.session.userId; // assuming user ID is stored in session
        const amount = parseFloat(req.body.amount);

        if (isNaN(amount) || amount <= 0) {
            return res.status(400).send("Invalid donation amount.");
        }

        // Insert donation record
        await db.query(
            'INSERT INTO donations (user_id, amount, created_at) VALUES ($1, $2, NOW())', [userId, amount]
        );

        // Update running total in users table
        await db.query(
            'UPDATE users SET total_donations = total_donations + $1 WHERE id = $2', [amount, userId]
        );

        res.redirect('/donations'); // redirect back to donations page
    } catch (err) {
        console.error(err);
        res.status(500).send("Error submitting donation.");
    }
});

app.post('/register', async(req, res) => {
    const { Participant_ID, Event_ID, EventDateTimeStart } = req.body;

    try {
        // 1. Validate required inputs
        if (!Participant_ID || !Event_ID || !EventDateTimeStart) {
            return res.status(400).send("Missing required fields");
        }

        // 2. Look up event occurrence
        const event = await knex('EventOccurrence')
            .where({
                Event_ID: Event_ID,
                EventDateTimeStart: EventDateTimeStart
            })
            .first();

        if (!event) {
            return res.status(404).send("Event occurrence not found");
        }

        // 3. Validate registration deadline
        const now = new Date();
        const registrationDeadline = new Date(event.EventRegistrationDeadline);

        if (now > registrationDeadline) {
            return res.status(400).send("Registration deadline has passed");
        }

        // 4. Validate capacity
        if (event.EventNumRegistered >= event.EventCapacity) {
            return res.status(400).send("Event is full");
        }

        // 5. Insert registration
        await knex('Registration').insert({
            Participant_ID,
            Event_ID,
            EventDateTimeStart,
            RegistrationStatus: "tbd",
            RegistrationAttendedFlag: "F"
                // RegistrationCreatedAt handled by DB default
        });

        // 6. Optionally increment event registered count
        await knex('EventOccurrence')
            .where({
                Event_ID: Event_ID,
                EventDateTimeStart: EventDateTimeStart
            })
            .update({
                EventNumRegistered: event.EventNumRegistered + 1
            });

        res.status(200).send("Registration successful");

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

app.post('/registration/update', async(req, res) => {
    const { Participant_ID, Event_ID, EventDateTimeStart, action } = req.body;

    let updateFields = {};

    if (action === "attended") {
        updateFields = {
            RegistrationStatus: "attended",
            RegistrationAttendedFlag: "T"
        };

    } else if (action === "absent") {
        updateFields = {
            RegistrationStatus: "no-show",
            RegistrationAttendedFlag: "F"
        };

    } else if (action === "cancel") {
        updateFields = {
            RegistrationStatus: "cancelled",
            RegistrationAttendedFlag: "F"
        };

    } else {
        return res.status(400).send("Invalid action");
    }

    try {
        // Get the existing registration BEFORE updating — we need to know if it was already cancelled
        const existingReg = await knex('Registration')
            .where({
                Participant_ID,
                Event_ID,
                EventDateTimeStart
            })
            .first();

        // Update the registration first
        await knex('Registration')
            .where({
                Participant_ID,
                Event_ID,
                EventDateTimeStart
            })
            .update(updateFields);

        // Handle capacity adjustment ONLY if action = cancel AND it was NOT already cancelled
        if (action === "cancel" && existingReg.RegistrationStatus !== "cancelled") {
            const event = await knex('EventOccurrence')
                .where({
                    Event_ID,
                    EventDateTimeStart
                })
                .first();

            // Decrement the registered count, but do NOT allow negative values
            const newCount = Math.max(0, event.EventNumRegistered - 1);

            await knex('EventOccurrence')
                .where({
                    Event_ID,
                    EventDateTimeStart
                })
                .update({
                    EventNumRegistered: newCount
                });
        }

        res.redirect('back');

    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating registration");
    }
});

// POST: Submit Milestone
app.post('/submit-milestone', requireLogin, async(req, res) => {
    const user = req.session.user;

    let { Participant_ID, MilestoneTitle, MilestoneDescription } = req.body;

    // Participants cannot modify the ID
    if (user.role === 'participant') {
        Participant_ID = user.id;
    }

    // Insert milestone into DB
    await knex('milestones').insert({
        Participant_ID,
        MilestoneTitle,
        MilestoneDescription,
        MilestoneDate: knex.fn.now() // store current date/time
    });

    res.redirect('/milestones');
});

// ==========================
// Start Server
// ==========================
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));