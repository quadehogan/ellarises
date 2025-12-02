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
// ----------------------
// PARTICIPANTS PAGE
// ----------------------
app.get("/participants", async(req, res) => {
    const user = req.session.user;
    // Must be logged in
    if (!user) {
        return res.redirect("/login");
    }
    // Must be manager
    if (user.role !== "manager") {
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

app.get('/events', requireLogin, (req, res) =>
    res.render('events'));

app.get('/surveys', (req, res) =>
    res.render('surveys'));

app.get('/milestones', (req, res) =>
    res.render('milestones'));

app.get('/donations', requireLogin, async(req, res) => {
    const user = req.session.user; // Logged-in user
    let donations, totalAmount;

    if (user.role === 'M') {
        donations = await db.query('SELECT * FROM donations'); // All donations
        totalAmount = donations.reduce((sum, d) => sum + d.amount, 0);
    } else if (user.role === 'U') {
        donations = await db.query('SELECT * FROM donations WHERE userId = ?', [user.id]);
        totalAmount = donations.reduce((sum, d) => sum + d.amount, 0);
    }

    res.render('donations', { user, donations, totalAmount });
});

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
app.post('/enroll', async (req, res) => {
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

app.post('/create-user-submit', async (req, res) => {
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

app.post('/registration/update', async (req, res) => {
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



// ==========================
// Start Server
// ==========================
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));