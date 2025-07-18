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

// --- CREAZIONE TABELLE & POPOLAMENTO INIZIALE ---
(async () => {
  try {
    // anagrafica
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

    // distretti
    await pool.query(`
      CREATE TABLE IF NOT EXISTS distretti (
        id SERIAL PRIMARY KEY,
        nome TEXT UNIQUE,
        coords TEXT
      );
    `);
    // pulisco e reinserisco secondo lista
    await pool.query('DELETE FROM distretti;');
    const distrettiDaInserire = [
      ['adduttore dx', '282,500'],
      ['adduttore sx', '309,500'],
      ['alluce sx',   '305,810'],
      ['anca dx',     '221,438'],
      ['anca sx',     '368,438'],
      ['caviglia dx', '267,780'],
      ['caviglia sx', '324,780'],
      ['cervicale',   '565,200'],
      ['dorsale',     '565,270'],
      ['fascia alata','300,380'],
      ['fascia plantare','530,815'],
      ['flessore dx','600,530'],
      ['flessore sx','530,530'],
      ['ginocchio dx','267,615'],
      ['ginocchio sx','324,615'],
      ['gluteo dx','600,420'],
      ['gluteo sx','530,420'],
      ['lombare','565,380'],
      ['polpaccio dx','600,690'],
      ['polpaccio sx','530,690'],
      ['pube','300,410'],
      ['quadricipite dx','267,550'],
      ['quadricipite sx','324,550'],
      ['spalla dx','655,210'],
      ['spalla sx','474,210'],
      ['tendine d\'achille dx','585,775'],
      ['tendine d\'achille sx','545,775'],
      ['tibiale dx','264,710'],
      ['tibiale sx','327,710']
    ];
    for (const [n, c] of distrettiDaInserire) {
      await pool.query(`INSERT INTO distretti(nome,coords) VALUES($1,$2)`, [n, c]);
    }

    // trattamenti
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trattamenti (
        id SERIAL PRIMARY KEY,
        nome TEXT
      );
    `);
    const cnt = await pool.query(`SELECT COUNT(*) FROM trattamenti`);
    if (+cnt.rows[0].count === 0) {
      await pool.query(`
        INSERT INTO trattamenti(nome) VALUES
        ('Massaggio decontratturante'),
        ('TENS'),
        ('Tecarterapia'),
        ('Ultrasuoni'),
        ('Crioterapia'),
        ('Esercizi di rinforzo'),
        ('Stretching passivo'),
        ('Manipolazioni vertebrali');
      `);
    }

    // terapie (con operatore)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS terapie (
        id SERIAL PRIMARY KEY,
        anagrafica_id INTEGER REFERENCES anagrafica(id),
        distretto_id  INTEGER REFERENCES distretti(id),
        trattamento_id INTEGER REFERENCES trattamenti(id),
        data_trattamento DATE,
        note TEXT,
        operatore TEXT
      );
    `);

    console.log("✅ Tabelle pronte e popolate");
  } catch (e) {
    console.error("❌ Errore creazione tabelle:", e);
  }
})();

// --- ROTTE AUTENTICAZIONE ---
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

// --- DASHBOARD ---
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('layout', {
    page: 'dashboard_content',
    user: req.session.user
  });
});

// --- ANAGRAFICA ---
app.get('/anagrafica', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { cognome = '', nome = '' } = req.query;
  let sql = 'SELECT * FROM anagrafica WHERE 1=1';
  const vals = [];
  if (cognome) {
    vals.push(`%${cognome}%`);
    sql += ` AND cognome ILIKE $${vals.length}`;
  }
  if (nome) {
    vals.push(`%${nome}%`);
    sql += ` AND nome ILIKE $${vals.length}`;
  }
  sql += ' ORDER BY id DESC';
  try {
    const r = await pool.query(sql, vals);
    res.render('layout', {
      page: 'anagrafica_content',
      giocatori: r.rows,
      filters: { cognome, nome },
      message: null
    });
  } catch {
    res.render('layout', {
      page: 'anagrafica_content',
      giocatori: [],
      filters: { cognome, nome },
      message: 'Errore nel caricamento'
    });
  }
});
app.post('/anagrafica', async (req, res) => {
  const { cognome, nome, dataNascita, luogoNascita, cellulare, note } = req.body;
  try {
    await pool.query(
      `INSERT INTO anagrafica(cognome,nome,data_nascita,luogo_nascita,cellulare,note)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [cognome, nome, dataNascita, luogoNascita, cellulare, note]
    );
    res.redirect('/anagrafica');
  } catch {
    res.redirect('/anagrafica');
  }
});
app.post('/anagrafica/delete/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  await pool.query(`DELETE FROM anagrafica WHERE id=$1`, [req.params.id]);
  res.redirect('/anagrafica');
});
app.post('/anagrafica/update/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const { nome, cognome, data_nascita, luogo_nascita, cellulare, note } = req.body;
  await pool.query(
    `UPDATE anagrafica SET nome=$1,cognome=$2,data_nascita=$3,luogo_nascita=$4,cellulare=$5,note=$6
     WHERE id=$7`,
    [nome, cognome, data_nascita, luogo_nascita, cellulare, note, req.params.id]
  );
  res.sendStatus(200);
});

// --- TERAPIE: FORM & LISTA FILTRATA ---
app.get('/terapie', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { anagrafica = 'Tutti', distretto = 'Tutti', trattamento = 'Tutti' } = req.query;

  // select lists
  const [anagrafiche, distretti, trattamenti] = await Promise.all([
    pool.query('SELECT id,nome,cognome FROM anagrafica ORDER BY cognome'),
    pool.query('SELECT id,nome,coords FROM distretti ORDER BY nome'),
    pool.query('SELECT id,nome FROM trattamenti ORDER BY nome')
  ]);

  // where dinamico
  const where = [];
  const vals  = [];
  if (anagrafica!=='Tutti') { vals.push(anagrafica); where.push(`t.anagrafica_id=$${vals.length}`); }
  if (distretto!=='Tutti')  { vals.push(distretto);  where.push(`t.distretto_id=$${vals.length}`); }
  if (trattamento!=='Tutti'){ vals.push(trattamento);where.push(`t.trattamento_id=$${vals.length}`); }
  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // recupero lista
  const therapies = await pool.query(`
    SELECT
      t.id,
      t.operatore,
      to_char(t.data_trattamento,'DD/MM/YYYY') AS data_trattamento,
      a.nome     AS nome_anagrafica,
      a.cognome  AS cognome_anagrafica,
      d.nome     AS nome_distretto,
      tr.nome    AS nome_trattamento
    FROM terapie t
    LEFT JOIN anagrafica a ON a.id=t.anagrafica_id
    LEFT JOIN distretti  d ON d.id=t.distretto_id
    LEFT JOIN trattamenti tr ON tr.id=t.trattamento_id
    ${whereSQL}
    ORDER BY t.data_trattamento DESC
  `, vals);

  res.render('layout', {
    page: 'terapie_content',
    anagrafiche: anagrafiche.rows,
    distretti:    distretti.rows,
    trattamenti:  trattamenti.rows,
    therapies:    therapies.rows,
    filters:      { anagrafica, distretto, trattamento },
    message:      null
  });
});

app.post('/terapie', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { anagrafica_id, distretto_id, trattamento_id, data_trattamento, note } = req.body;
  await pool.query(
    `INSERT INTO terapie(anagrafica_id,distretto_id,trattamento_id,data_trattamento,note,operatore)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [anagrafica_id, distretto_id, trattamento_id, data_trattamento, note, req.session.user]
  );
  res.redirect('/terapie');
});

// --- AVVIO SERVER ---
app.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});
