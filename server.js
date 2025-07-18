const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Connessione al database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

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

// Crea la tabella se non esiste
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS anagrafica (
        id SERIAL PRIMARY KEY,
        cognome TEXT,
        nome TEXT,
        data_nascita DATE,
        luogo_nascita TEXT,
        cellulare TEXT,
        note TEXT
      );
    `);
    console.log("✅ Tabella anagrafica pronta");
  } catch (err) {
    console.error("❌ Errore nella creazione della tabella:", err);
  }
})();

// ROTTE

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

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('layout', {
    page: 'dashboard_content',
    user: req.session.user
  });
});

app.get('/anagrafica', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const { cognome = '', nome = '' } = req.query;
  let query = 'SELECT * FROM anagrafica WHERE 1=1';
  const values = [];

  if (cognome) {
    values.push(`%${cognome}%`);
    query += ` AND cognome ILIKE $${values.length}`;
  }
  if (nome) {
    values.push(`%${nome}%`);
    query += ` AND nome ILIKE $${values.length}`;
  }

  query += ' ORDER BY id DESC';

  try {
    const result = await pool.query(query, values);
    res.render('layout', {
      page: 'anagrafica_content',
      giocatori: result.rows,
      filters: { cognome, nome },
      message: null
    });
  } catch (err) {
    console.error("Errore nel caricamento dati:", err);
    res.render('layout', {
      page: 'anagrafica_content',
      giocatori: [],
      filters: { cognome, nome },
      message: 'Errore nel caricamento delle anagrafiche'
    });
  }
});

app.post('/anagrafica', async (req, res) => {
  const { cognome, nome, dataNascita, luogoNascita, cellulare, note } = req.body;
  try {
    await pool.query(
      'INSERT INTO anagrafica (cognome, nome, data_nascita, luogo_nascita, cellulare, note) VALUES ($1, $2, $3, $4, $5, $6)',
      [cognome, nome, dataNascita, luogoNascita, cellulare, note]
    );
    res.redirect('/anagrafica');
  } catch (err) {
    console.error("Errore nel salvataggio:", err);
    res.render('layout', {
      page: 'anagrafica_content',
      giocatori: [],
      filters: { cognome: '', nome: '' },
      message: 'Errore nel salvataggio.'
    });
  }
});

app.post('/anagrafica/delete/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  try {
    await pool.query('DELETE FROM anagrafica WHERE id = $1', [req.params.id]);
    res.redirect('/anagrafica');
  } catch (err) {
    console.error("Errore nella cancellazione:", err);
    res.redirect('/anagrafica');
  }
});

// AVVIO SERVER
app.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});
