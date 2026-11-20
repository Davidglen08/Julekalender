// ---------- 1. IMPORTER OG OPPSETT ----------
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const crypto = require('crypto');

const Door = require('./models/Door');
const Quizzes = require('./models/Quizzes');
const User = require('./models/User');
const Answer = require('./models/Answer');

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
  .then(() => console.log('Tilkoblet MongoDB, database:', mongoose.connection.name))
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

function isValidDay(n) {
  return Number.isInteger(n) && n >= 1 && n <= 24;
}

async function getQuiz() {
  return Quizzes.findById('christmas-quiz').lean();
}

async function getQuestion(day) {
  const doc = await getQuiz();
  return doc?.questions?.find((q) => Number(q.id) === day) || null;
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    // Husk siden kun for GET, ellers gir redirecten 404 på POST-ruter
    if (req.method === 'GET') req.session.returnTo = req.originalUrl;
    req.session.flash = { text: 'Du må logge inn før du kan åpne en luke.' };
    return res.redirect('/');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    if (req.method === 'GET') req.session.returnTo = req.originalUrl;
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
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    console.log('Login-forsøk:', { username, email });

    if (!username || !email.endsWith('@afk.no')) {
      return res.status(400).render('login', {
        error: 'Du må fylle ut brukernavn og bruke en @afk.no epost.'
      });
    }

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ username, email });
      console.log('Ny bruker opprettet:', user._id.toString());
    } else {
      console.log('Eksisterende bruker:', user._id.toString());
    }

    req.session.user = {
      id: user._id.toString(),
      username: user.username,
      email: user.email,
      role: user.role
    };

    const target = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(target);
  } catch (err) {
    console.error('Feil under innlogging:', err);
    res.status(500).render('login', {
      error: `Teknisk feil: ${err.message}`
    });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/profile', requireLogin, async (req, res) => {
  try {
    const answers = await Answer.find({ user: req.session.user.id }).sort({ day: 1 }).lean();
    res.render('profile', { answers });
  } catch (err) {
    console.error(err);
    res.status(500).send('Noe gikk galt. Prøv igjen senere.');
  }
});

app.get('/luke/:id', requireLogin, async (req, res) => {
  try {
    const number = Number(req.params.id);
    if (!isValidDay(number)) return res.status(404).send('Siden finnes ikke.');

    // Kun dagens luke kan åpnes
    if (getDoorStatus(number, getToday()) !== 'today') {
      return res.status(403).send('Denne luken er ikke åpen.');
    }

    const found = await getQuestion(number);
    if (!found) return res.status(404).send('Denne luken har ikke fått innhold ennå.');

    // Ikke send det riktige svaret til nettleseren
    const { correct_answer, ...quiz } = found;

    const existing = await Answer.findOne({ user: req.session.user.id, day: number }).lean();

    res.render('door', { doorNumber: number, quiz, existing });
  } catch (err) {
    console.error(err);
    res.status(500).send('Noe gikk galt. Prøv igjen senere.');
  }
});

app.post('/luke/:id/answer', requireLogin, async (req, res) => {
  try {
    const number = Number(req.params.id);
    if (!isValidDay(number)) return res.status(404).send('Siden finnes ikke.');

    if (getDoorStatus(number, getToday()) !== 'today') {
      return res.status(403).send('Denne luken er ikke åpen.');
    }

    const question = await getQuestion(number);
    if (!question) return res.status(404).send('Denne luken har ikke fått innhold ennå.');

    const given = String(req.body.answer || '').trim();
    if (!given) {
      req.session.flash = { text: 'Du må velge eller skrive et svar.' };
      return res.redirect(`/luke/${number}`);
    }

    // Flervalg rettes automatisk, resten vurderes av admin
    const correct = question.type === 'multiple_choice' ? given === question.correct_answer : null;

    try {
      await Answer.create({ user: req.session.user.id, day: number, answer: given, correct });
    } catch (err) {
      if (err.code === 11000) {
        req.session.flash = { text: 'Du har allerede svart på denne luken.' };
        return res.redirect(`/luke/${number}`);
      }
      throw err;
    }

    req.session.flash = { text: 'Svaret ditt er lagret!' };
    res.redirect(`/luke/${number}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Noe gikk galt. Prøv igjen senere.');
  }
});

// ---------- 6. RUTER FOR ADMIN ----------
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const status = String(req.query.status || '');
    const day = Number(req.query.day);

    const filter = {};
    if (isValidDay(day)) filter.day = day;
    if (status === 'riktig') filter.correct = true;
    if (status === 'galt') filter.correct = false;
    if (status === 'ubehandlet') filter.correct = null;

    let answers = await Answer.find(filter)
      .populate('user', 'username email')
      .sort({ day: 1, createdAt: 1 })
      .lean();

    if (q) {
      answers = answers.filter(
        (a) =>
          a.user &&
          ((a.user.username || '').toLowerCase().includes(q) ||
            a.user.email.toLowerCase().includes(q))
      );
    }

    const users = await User.find().sort({ username: 1 }).lean();
    const counts = await Answer.aggregate([{ $group: { _id: '$user', count: { $sum: 1 } } }]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    const winners = await Answer.find({ isWinner: true })
      .populate('user', 'username')
      .sort({ day: 1 })
      .lean();

    const quiz = await getQuiz();

    res.render('adminDashboard', {
      users,
      countMap,
      answers,
      winners,
      questions: quiz?.questions || [],
      q: req.query.q || '',
      status,
      day: isValidDay(day) ? day : ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Noe gikk galt. Prøv igjen senere.');
  }
});

app.post('/admin/svar/:id/vurder', requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Siden finnes ikke.');
    await Answer.updateOne({ _id: req.params.id }, { correct: req.body.correct === 'true' });
    req.session.flash = { text: 'Vurderingen er lagret.' };
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Noe gikk galt. Prøv igjen senere.');
  }
});

app.post('/admin/trekk', requireAdmin, async (req, res) => {
  try {
    const day = Number(req.body.day);
    if (!isValidDay(day)) return res.status(400).send('Ugyldig luke.');

    const eligible = await Answer.find({ day, correct: true }).lean();
    if (eligible.length === 0) {
      req.session.flash = { text: `Luke ${day} har ingen riktige svar å trekke blant.` };
      return res.redirect('/admin');
    }

    const winner = eligible[crypto.randomInt(eligible.length)];
    await Answer.updateMany({ day }, { isWinner: false });
    await Answer.updateOne({ _id: winner._id }, { isWinner: true });

    req.session.flash = { text: `Vinner er trukket for luke ${day}.` };
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Noe gikk galt. Prøv igjen senere.');
  }
});

app.post('/admin/sporsmal/:day', requireAdmin, async (req, res) => {
  try {
    const day = Number(req.params.day);
    const text = String(req.body.question || '').trim();
    if (!isValidDay(day) || !text) return res.status(400).send('Ugyldig input.');

    await Quizzes.updateOne(
      { _id: 'christmas-quiz', 'questions.id': day },
      { $set: { 'questions.$.question': text } }
    );
    req.session.flash = { text: `Spørsmålet for luke ${day} er oppdatert.` };
    res.redirect('/admin');
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