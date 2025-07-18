const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: 'fisiocatania_secret',
  resave: false,
  saveUninitialized: true
}));

const USERS = {
  "admin@admin.com": "admin123"
};

app.get('/', (req, res) => {
  if (req.session.user) {
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: null });
  }
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (USERS[email] && USERS[email] === password) {
    req.session.user = email;
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'Credenziali errate' });
  }
});

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('dashboard', { user: req.session.user });
});

app.get('/anagrafica', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('anagrafica');
});

app.post('/anagrafica', (req, res) => {
  const data = req.body;
  console.log("Dati ricevuti:", data);
  res.render('anagrafica', { message: 'Dati salvati (temporaneamente)!' });
});

app.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});