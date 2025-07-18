const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Collegamento al database PostgreSQL
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
  res.render('layout', {
    page: 'dashboard_content',
    user: req.session.user
  });
});

app.get('/anagrafica', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('layout', {
    page: 'anagrafica_content'
  });
});
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/anagrafica', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const { cognome, nome } = req.query;
  let query = 'SELECT * FROM anagrafica';
  let values = [];

  if (cognome || nome) {
    let conditions = [];
    if (cognome) {
      values.push(`%${cognome}%`);
      conditions.push(`cognome ILIKE $${values.length}`);
    }
    if (nome) {
      values.push(`%${nome}%`);
      conditions.push(`nome ILIKE $${values.length}`);
    }
    query += ' WHERE ' + conditions.join(' AND ');
  }

  try {
    const result = await pool.query(query, values);
    res.render('layout', {
      page: 'anagrafica_content',
      giocatori: result.rows,
      filters: { cognome: cognome || '', nome: nome || '' },
      message: null
    });
  } catch (err) {
    console.error(err);
    res.render('layout', {
      page: 'anagrafica_content',
      giocatori: [],
      filters: {},
      message: 'Errore nel caricamento delle anagrafiche'
    });
  }
});

app.post('/anagrafica/delete/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  try {
    await pool.query('DELETE FROM anagrafica WHERE id = $1', [req.params.id]);
    res.redirect('/anagrafica');
  } catch (err) {
    console.error(err);
    res.redirect('/anagrafica');
  }
});

app.post('/anagrafica', async (req, res) => {
  const { cognome, nome, dataNascita, luogoNascita, cellulare, note } = req.body;
  try {
    await pool.query(
      'INSERT INTO anagrafica (cognome, nome, data_nascita, luogo_nascita, cellulare, note) VALUES ($1, $2, $3, $4, $5, $6)',
      [cognome, nome, dataNascita, luogoNascita, cellulare, note]
    );
    res.render('layout', {
      page: 'anagrafica_content',
      message: 'Dati salvati con successo!'
    });   
  } catch (err) {
    console.error("Errore nel salvataggio:", err);
    res.render('layout', {
      page: 'anagrafica_content',
      message: 'Errore nel salvataggio.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});
