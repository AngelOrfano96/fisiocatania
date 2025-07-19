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
        // Assicura che esista un indice UNIQUE su nome, anche se la tabella era già lì senza constraint
        await pool.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_distretti_nome 
          ON distretti (nome);
        `);
    

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

    await pool.query(`
      ALTER TABLE terapie
        ADD COLUMN IF NOT EXISTS operatore TEXT,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now();
    `);

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
// … tutto quello che hai già sopra, fino a prima di app.get('/terapie' …

// ROTTE TERAPIE
// … tutto quello che hai già sopra …

// ROTTE TERAPIE
app.get('/terapie', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  // estrai i filtri dalla query string
  const {
    filter_anagrafica   = 'all',
    filter_distretto     = 'all',
    filter_trattamento   = 'all'
  } = req.query;

  try {
    // dati per i dropdown
    const anagraficheQ = await pool.query('SELECT id, nome, cognome FROM anagrafica ORDER BY cognome');
    const distrettiQ   = await pool.query('SELECT id, nome, coords FROM distretti ORDER BY nome');
    const trattamentiQ = await pool.query('SELECT id, nome FROM trattamenti ORDER BY nome');

    // build dynamic WHERE
    let clauses = [], values = [];
    if (filter_anagrafica   !== 'all') { values.push(filter_anagrafica);   clauses.push(`t.anagrafica_id   = $${values.length}`); }
    if (filter_distretto     !== 'all') { values.push(filter_distretto);     clauses.push(`t.distretto_id     = $${values.length}`); }
    if (filter_trattamento   !== 'all') { values.push(filter_trattamento);   clauses.push(`t.trattamento_id   = $${values.length}`); }
    const whereSQL = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

    // prendi le terapie con join e include il campo note
    const therapiesQ = await pool.query(`
      SELECT
        t.id,
        t.operatore,
        t.data_trattamento,
        a.nome   || ' ' || a.cognome AS anagrafica,
        d.nome                      AS distretto,
        tr.nome                     AS trattamento,
        t.note
      FROM terapie t
      JOIN anagrafica   a  ON t.anagrafica_id   = a.id
      JOIN distretti    d  ON t.distretto_id    = d.id
      JOIN trattamenti tr ON t.trattamento_id  = tr.id
      ${whereSQL}
      ORDER BY t.data_trattamento DESC
    `, values);

    res.render('layout', {
      page: 'terapie_content',
      anagrafiche: anagraficheQ.rows,
      distretti:   distrettiQ.rows,
      trattamenti: trattamentiQ.rows,
      therapies:   therapiesQ.rows,
      filters: {
        filter_anagrafica,
        filter_distretto,
        filter_trattamento
      },
      message: null
    });

  } catch (err) {
    console.error("Errore nel caricamento terapie:", err);
    res.render('layout', {
      page: 'terapie_content',
      anagrafiche: [], distretti: [], trattamenti: [], therapies: [],
      filters: {
        filter_anagrafica: 'all',
        filter_distretto:   'all',
        filter_trattamento: 'all'
      },
      message: 'Errore nel caricamento della pagina terapie.'
    });
  }
});

app.post('/terapie', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const { anagrafica_id, distretto_id, trattamento_id, data_trattamento, note } = req.body;
  const operatore = req.session.user;

  try {
    await pool.query(
      `INSERT INTO terapie
         (anagrafica_id, distretto_id, trattamento_id, data_trattamento, note, operatore)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [anagrafica_id, distretto_id, trattamento_id, data_trattamento, note, operatore]
    );
    res.redirect('/terapie');
  } catch (err) {
    console.error("Errore nel salvataggio terapia:", err);
    res.redirect('/terapie');
  }
});

// UPDATE inline di una terapia
app.post('/terapie/update/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const id = req.params.id;
  const {
    anagrafica_id,
    distretto_id,
    trattamento_id,
    data_trattamento,
    note
  } = req.body;

  try {
    await pool.query(
      `UPDATE terapie
         SET anagrafica_id   = $1,
             distretto_id     = $2,
             trattamento_id   = $3,
             data_trattamento = $4,
             note             = $5
       WHERE id = $6`,
      [anagrafica_id, distretto_id, trattamento_id, data_trattamento, note, id]
    );
    res.redirect('/terapie');
  } catch (err) {
    console.error("Errore nell'aggiornamento terapia:", err);
    res.redirect('/terapie');
  }
});

// Avvio server
app.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});
