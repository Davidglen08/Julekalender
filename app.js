// ---------- 1. IMPORTER OG OPPSETT ----------
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');

const Door = require('./models/Door');
const Quizzes = require('./models/Quizzes');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 4000;

// ---------- 2. MIDDLEWARE ----------
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 // 24 timer
    }
  })
);
// Engangsmelding som vises på neste side (og så forsvinner)
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// Gjør innlogget bruker tilgjengelig i alle EJS-filer (brukes i nav.ejs)
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});


// ---------- 3. DATABASE ----------
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log('Tilkoblet MongoDB'))
  .catch((err) => console.error('Kunne ikke koble til MongoDB:', err.message));

// ---------- 4. HJELPEFUNKSJONER ----------
// Finner dagens dato i norsk tid (eller testdatoen fra .env)
function getToday() {
  const now = process.env.FAKE_DATE ? new Date(process.env.FAKE_DATE) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(now);

  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

// Returnerer 'locked', 'today' eller 'past'
function getDoorStatus(doorNumber, today) {
  const calendarYear = Number(process.env.CALENDAR_YEAR) || today.year;

  // Gjør datoer om til tall som kan sammenlignes, f.eks. 20261205
  const doorValue = calendarYear * 10000 + 12 * 100 + doorNumber;
  const todayValue = today.year * 10000 + today.month * 100 + today.day;

  if (doorValue > todayValue) return 'locked';
  if (doorValue === todayValue) return 'today';
  return 'past';
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    req.session.flash = { text: 'Du må logge inn før du kan åpne en luke.' };
    return res.redirect('/');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).send('Ingen tilgang.');
  }
  next();
}

// ---------- 5. RUTER FOR BRUKERE ----------
app.get('/', async (req, res) => {
  try {
    const today = getToday();
    const doorsFromDb = await Door.find().lean();

    // Slå opp luker på nummer
    const doorMap = new Map(doorsFromDb.map((d) => [d.number, d]));

    // Lag alltid 24 ruter, selv om det ikke er lagt inn innhold ennå
    const doors = [];
    for (let number = 1; number <= 24; number++) {
      doors.push({
        number,
        title: doorMap.get(number)?.title || '',
        status: getDoorStatus(number, today)
      });
    }

    res.render('index', { doors });
  } catch (err) {
    console.error(err);
    res.status(500).send('Noe gikk galt. Prøv igjen senere.');
  }
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login');
});

app.post('/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!username || !email.endsWith('@afk.no')) {
      return res.status(400).render('login', {
        error: 'Du må fylle ut brukernavn og bruke en @afk.no epost.'
      });
    }

    // Finn brukeren, eller lag en ny (role blir 'user' som standard)
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ username, email });
    }

    req.session.user = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role
    };

    const target = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(target);
  } catch (err) {
    console.error(err);
    res.status(500).send('Noe gikk galt. Prøv igjen senere.');
  }
});

app.get('/profile', requireLogin, (req, res) => {
  res.render('profile');
});

app.get('/luke/:id', requireLogin, async (req, res) => {
  try {
    const number = Number(req.params.id);

    if (!Number.isInteger(number) || number < 1 || number > 24) {
      return res.status(404).send('Siden finnes ikke.');
    }

    // Kun dagens luke (eller testluker) kan åpnes
    const status = getDoorStatus(number, getToday());
    if (status !== 'today' && status !== 'open') {
      return res.status(403).send('Denne luken er ikke åpen.');
    }

    const doc = await Quizzes.findById('christmas-quiz').lean();
    const found = doc?.questions?.find((q) => Number(q.id) === number);

    if (!found) {
      return res.status(404).send('Denne luken har ikke fått innhold ennå.');
    }

    // Ikke send det riktige svaret til nettleseren
    const { correct_answer, ...quiz } = found;

    res.render('door', { doorNumber: number, quiz });
  } catch (err) {
    console.error(err);
    res.status(500).send('Noe gikk galt. Prøv igjen senere.');
  }
});

// TODO: POST /luke/:id/answer

// ---------- 6. RUTER FOR ADMIN ----------
app.get('/admin', requireAdmin, (req, res) => {
  res.render('adminDashboard');
});

// ---------- 7. FEILHÅNDTERING ----------
app.use((req, res) => {
  res.status(404).send('Siden finnes ikke.');
});

// ---------- 8. START SERVEREN ----------
app.listen(PORT, () => {
  console.log(`Serveren kjører på http://localhost:${PORT}`);
  console.log('Dagens dato i appen:', getToday());
});