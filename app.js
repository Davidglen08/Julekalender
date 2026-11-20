// ---------- 1. IMPORTER OG OPPSETT ----------
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const Door = require('./models/Door');
const Quizzes = require('./models/Quizzes');

const User = require('./models/User'); // NY

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
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 } // 24 timer
  })
);

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

function getDoorStatus(doorNumber, today) {
  // Under utvikling: alle luker er åpne
  if (process.env.OPEN_ALL_DOORS === 'true') return 'open';

  const calendarYear = Number(process.env.CALENDAR_YEAR) || today.year;

  // Gjør datoer om til tall som kan sammenlignes, f.eks. 20261205
  const doorValue = calendarYear * 10000 + 12 * 100 + doorNumber;
  const todayValue = today.year * 10000 + today.month * 100 + today.day;

  if (doorValue > todayValue) return 'locked';
  if (doorValue === todayValue) return 'today';
  return 'past';
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

// TODO: GET /door/:number
// TODO: POST /door/:number/answer
//

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {

  const { username, email } = req.body;

  if(email.includes("@afk.no")) {
    
    res.redirect('/');

  } else {
    res.send("Du må bruke en @afk.no epost for å logge inn.");
  }
});


app.get('/luke/:id', async (req, res) => {
  try {
    const number = Number(req.params.id);

    if (!Number.isInteger(number) || number < 1 || number > 24) {
      return res.status(404).send('Siden finnes ikke.');
    }

    if (getDoorStatus(number, getToday()) === 'locked') {
      return res.status(403).send('Denne luken er ikke åpen ennå!');
    }

    const quiz = await Quizzes.findOne({ day: number }).lean();

    if (!quiz) {
      return res.status(404).send('Denne luken har ikke fått innhold ennå.');
    }

    res.render('door', { doorNumber: number, quiz });
  } catch (err) {
    console.error(err);
    res.status(500).send('Noe gikk galt. Prøv igjen senere.');
  }
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