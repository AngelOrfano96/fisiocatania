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
app.use(bodyParser.json());

app.use(session({
  secret: 'fisiocatania_secret',
  resave: false,
  saveUninitialized: true
}));

const USERS = {
  "admin@admin.com": "admin123"
};

// Creazione tabelle e popolamento iniziale
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS distretti (
        id SERIAL PRIMARY KEY,
        nome TEXT,
        coords TEXT
      );
    `);

    const distrettiCount = await pool.query('SELECT COUNT(*) FROM distretti');
    if (parseInt(distrettiCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO distretti (nome, coords) VALUES
        ('Collo', '270,80'),
        ('Spalla destra', '340,130'),
        ('Spalla sinistra', '200,130'),
        ('Gomito destro', '370,180'),
        ('Gomito sinistro', '170,180'),
        ('Polso destro', '390,250'),
        ('Polso sinistro', '150,250'),
        ('Schiena alta', '270,150'),
        ('Schiena media', '270,200'),
        ('Schiena bassa', '270,250'),
        ('Gluteo destro', '310,300'),
        ('Gluteo sinistro', '230,300'),
        ('Coscia destra', '310,360'),
        ('Coscia sinistra', '230,360'),
        ('Ginocchio destro', '310,420'),
        ('Ginocchio sinistro', '230,420'),
        ('Caviglia destra', '310,480'),
        ('Caviglia sinistra', '230,480');
      `);
      console.log("✅ Tabella distretti popolata");
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS trattamenti (
        id SERIAL PRIMARY KEY,
        nome TEXT
      );
    `);

    const trattamentiCount = await pool.query('SELECT COUNT(*) FROM trattamenti');
    if (parseInt(trattamentiCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO trattamenti (nome) VALUES
        ('Massaggio decontratturante'),
        ('TENS'),
        ('Tecarterapia'),
        ('Ultrasuoni'),
        ('Crioterapia'),
        ('Esercizi di rinforzo'),
        ('Stretching passivo'),
        ('Manipolazioni vertebrali');
      `);
      console.log("✅ Tabella trattamenti popolata");
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS terapie (
        id SERIAL PRIMARY KEY,
        anagrafica_id INTEGER REFERENCES anagrafica(id),
        distretto_id INTEGER REFERENCES distretti(id),
        trattamento_id INTEGER REFERENCES trattamenti(id),
        data_trattamento DATE,
        note TEXT
      );
    `);

    console.log("✅ Tutte le tabelle pronte e popolate se necessario");
  } catch (err) {
    console.error("❌ Errore nella creazione delle tabelle:", err);
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

app.post('/anagrafica/update/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');

  const id = req.params.id;
  const {
    nome,
    cognome,
    data_nascita,
    luogo_nascita,
    cellulare,
    note
  } = req.body;

  try {
    await pool.query(
      `UPDATE anagrafica 
       SET nome = $1, cognome = $2, data_nascita = $3, luogo_nascita = $4, cellulare = $5, note = $6 
       WHERE id = $7`,
      [nome, cognome, data_nascita, luogo_nascita, cellulare, note, id]
    );
    res.status(200).send('Aggiornato');
  } catch (err) {
    console.error("Errore nell'aggiornamento:", err);
    res.status(500).send('Errore interno');
  }
});

// ROTTE TERAPIE
app.get('/terapie', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  try {
    const anagrafiche = await pool.query('SELECT id, nome, cognome FROM anagrafica ORDER BY cognome');
    const distretti = await pool.query('SELECT id, nome, coords FROM distretti ORDER BY nome');
    const trattamenti = await pool.query('SELECT id, nome FROM trattamenti ORDER BY nome');

    res.render('layout', {
      page: 'terapie_content',
      anagrafiche: anagrafiche.rows,
      distretti: distretti.rows,
      trattamenti: trattamenti.rows,
      message: null
    });
  } catch (err) {
    console.error("Errore nel caricamento terapie:", err);
    res.render('layout', {
      page: 'terapie_content',
      anagrafiche: [],
      distretti: [],
      trattamenti: [],
      message: 'Errore nel caricamento della pagina terapie.'
    });
  }
});

app.post('/terapie', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const { anagrafica_id, distretto_id, trattamento_id, data_trattamento, note } = req.body;

  try {
    await pool.query(
      'INSERT INTO terapie (anagrafica_id, distretto_id, trattamento_id, data_trattamento, note) VALUES ($1, $2, $3, $4, $5)',
      [anagrafica_id, distretto_id, trattamento_id, data_trattamento, note]
    );
    res.redirect('/terapie');
  } catch (err) {
    console.error("Errore nel salvataggio terapia:", err);
    res.redirect('/terapie');
  }
});

// AVVIO SERVER
app.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});