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
  ssl: { rejectUnauthorized: false }
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

const USERS = { "admin@admin.com": "admin123" };

// Creazione tabelle e popolamento iniziale
;(async () => {
  try {
    // --- anagrafica
    await pool.query(`
      CREATE TABLE IF NOT EXISTS anagrafica (
        id SERIAL PRIMARY KEY,
        cognome TEXT, nome TEXT,
        data_nascita DATE,
        luogo_nascita TEXT,
        cellulare TEXT,
        note TEXT
      );`
    );

    // --- distretti
    await pool.query(`
      CREATE TABLE IF NOT EXISTS distretti (
        id     SERIAL PRIMARY KEY,
        nome   TEXT UNIQUE,
        coords TEXT
      );`
    );

    // lista dei distretti + coords
    const distrettiDaInserire = [
      ['adduttore dx',       '282,500'],
      ['adduttore sx',       '309,500'],
      ['alluce sx',          '305,810'],
      ['anca dx',            '221,438'],
      ['anca sx',            '368,438'],
      ['caviglia dx',        '267,780'],
      ['caviglia sx',        '324,780'],
      ['cervicale',          '565,200'],
      ['dorsale',            '565,270'],
      ['fascia alata',       '300,380'],
      ['fascia plantare',    '530,815'],
      ['flessore dx',        '600,530'],
      ['flessore sx',        '530,530'],
      ['ginocchio dx',       '267,615'],
      ['ginocchio sx',       '324,615'],
      ['gluteo dx',          '600,420'],
      ['gluteo sx',          '530,420'],
      ['lombare',            '565,380'],
      ['polpaccio dx',       '600,690'],
      ['polpaccio sx',       '530,690'],
      ['pube',               '300,410'],
      ['quadricipite dx',    '267,550'],
      ['quadricipite sx',    '324,550'],
      ['spalla dx',          '655,210'],
      ['spalla sx',          '474,210'],
      ['tendine d\'achille dx','585,775'],
      ['tendine d\'achille sx','545,775'],
      ['tibiale dx',         '264,710'],
      ['tibiale sx',         '327,710']
    ];

    // upsert per ogni distretto
    for (const [nome, coords] of distrettiDaInserire) {
      await pool.query(
        `INSERT INTO distretti (nome, coords)
         VALUES ($1, $2)
         ON CONFLICT (nome) DO UPDATE
           SET coords = EXCLUDED.coords`,
        [nome, coords]
      );
    }

    // --- trattamenti
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trattamenti (
        id   SERIAL PRIMARY KEY,
        nome TEXT
      );`
    );

    const cnt = await pool.query(`SELECT COUNT(*) FROM trattamenti`);
    if (+cnt.rows[0].count === 0) {
      await pool.query(`
        INSERT INTO trattamenti (nome) VALUES
        ('Massaggio decontratturante'),
        ('TENS'),
        ('Tecarterapia'),
        ('Ultrasuoni'),
        ('Crioterapia'),
        ('Esercizi di rinforzo'),
        ('Stretching passivo'),
        ('Manipolazioni vertebrali');`
      );
      console.log("✅ Tabella trattamenti popolata");
    }

    // --- terapie
    await pool.query(`
      CREATE TABLE IF NOT EXISTS terapie (
        id              SERIAL PRIMARY KEY,
        anagrafica_id   INTEGER REFERENCES anagrafica(id),
        distretto_id    INTEGER REFERENCES distretti(id),
        trattamento_id  INTEGER REFERENCES trattamenti(id),
        data_trattamento DATE,
        note            TEXT
      );`
    );

    console.log("✅ Tutte le tabelle pronte e popolate");
  } catch (err) {
    console.error("❌ Errore nella creazione delle tabelle:", err);
  }
})();

// Rotte di base e autenticazione
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (USERS[email] && USERS[email] === password) {
    req.session.user = email;
    return res.redirect('/dashboard');
  }
  res.render('login', { error: 'Credenziali errate' });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('layout', { page: 'dashboard_content', user: req.session.user });
});

// --- ANAGRAFICA ---
app.get('/anagrafica', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { cognome = '', nome = '' } = req.query;
  let query = 'SELECT * FROM anagrafica WHERE 1=1';
  const vals = [];
  if (cognome) { vals.push(`%${cognome}%`); query += ` AND cognome ILIKE $${vals.length}`; }
  if (nome)     { vals.push(`%${nome}%`);   query += ` AND nome ILIKE $${vals.length}`;   }
  query += ' ORDER BY id DESC';
  try {
    const result = await pool.query(query, vals);
    res.render('layout', {
      page: 'anagrafica_content',
      giocatori: result.rows,
      filters: { cognome, nome },
      message: null
    });
  } catch (e) {
    console.error(e);
    res.render('layout', {
      page: 'anagrafica_content',
      giocatori: [], filters: { cognome, nome },
      message: 'Errore nel caricamento'
    });
  }
});

app.post('/anagrafica', async (req, res) => {
  const { cognome, nome, dataNascita, luogoNascita, cellulare, note } = req.body;
  try {
    await pool.query(
      `INSERT INTO anagrafica
        (cognome,nome,data_nascita,luogo_nascita,cellulare,note)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [cognome,nome,dataNascita,luogoNascita,cellulare,note]
    );
    res.redirect('/anagrafica');
  } catch (e) {
    console.error(e);
    res.redirect('/anagrafica');
  }
});

app.post('/anagrafica/delete/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  await pool.query('DELETE FROM anagrafica WHERE id=$1', [req.params.id]);
  res.redirect('/anagrafica');
});

app.post('/anagrafica/update/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const { nome, cognome, data_nascita, luogo_nascita, cellulare, note } = req.body;
  await pool.query(
    `UPDATE anagrafica
       SET nome=$1,cognome=$2,data_nascita=$3,luogo_nascita=$4,cellulare=$5,note=$6
     WHERE id=$7`,
    [nome,cognome,data_nascita,luogo_nascita,cellulare,note,req.params.id]
  );
  res.status(200).send('Aggiornato');
});

// --- TERAPIE con filtri e join ---
app.get('/terapie', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const anagRes  = await pool.query('SELECT id,nome,cognome FROM anagrafica ORDER BY cognome');
  const distRes  = await pool.query('SELECT id,nome,coords FROM distretti ORDER BY nome');
  const trattRes = await pool.query('SELECT id,nome FROM trattamenti ORDER BY nome');

  // leggo i filtri ('' = tutti)
  const { filter_anagrafica='', filter_distretto='', filter_trattamento='' } = req.query;
  const wheres = [];
  const vals   = [];

  if (filter_anagrafica)  { vals.push(filter_anagrafica);  wheres.push(`t.anagrafica_id = $${vals.length}`); }
  if (filter_distretto)    { vals.push(filter_distretto);    wheres.push(`t.distretto_id   = $${vals.length}`); }
  if (filter_trattamento)  { vals.push(filter_trattamento);  wheres.push(`t.trattamento_id = $${vals.length}`); }
  const whereSQL = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  const therapiesRes = await pool.query(
    `
      SELECT
        t.id,
        t.data_trattamento,
        a.nome   AS nome_anagrafica,
        a.cognome AS cognome_anagrafica,
        d.nome   AS nome_distretto,
        tr.nome  AS nome_trattamento
      FROM terapie t
      JOIN anagrafica a ON t.anagrafica_id = a.id
      JOIN distretti  d ON t.distretto_id   = d.id
      JOIN trattamenti tr ON t.trattamento_id = tr.id
      ${whereSQL}
      ORDER BY t.id DESC
    `,
    vals
  );

  res.render('layout', {
    page: 'terapie_content',
    anagrafiche:  anagRes.rows,
    distretti:    distRes.rows,
    trattamenti: trattRes.rows,
    therapies:   therapiesRes.rows,
    filters: { filter_anagrafica, filter_distretto, filter_trattamento },
    message: null
  });
});

app.post('/terapie', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { anagrafica_id, distretto_id, trattamento_id, data_trattamento, note } = req.body;
  await pool.query(
    `INSERT INTO terapie
      (anagrafica_id,distretto_id,trattamento_id,data_trattamento,note)
     VALUES ($1,$2,$3,$4,$5)`,
    [anagrafica_id,distretto_id,trattamento_id,data_trattamento,note]
  );
  res.redirect('/terapie');
});

// Avvio server
app.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});
