require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');


const app = express();
const PORT = process.env.PORT || 3000;


const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // lato server usa la service-role key
);


// Cloudinary configuration
cloudinary.config({
  cloud_name:   process.env.CLOUDINARY_CLOUD_NAME,
  api_key:      process.env.CLOUDINARY_API_KEY,
  api_secret:   process.env.CLOUDINARY_API_SECRET,
});
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'anagrafica',
    allowedFormats: ['jpg','png','jpeg'],
  }
});
const upload = require('multer')({ storage });



// Assicura la directory degli upload
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Database connection
/*typeof process.env.DATABASE_URL === 'undefined' && console.warn('⚠️ DATABASE_URL not set');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}); */

// Connessione al database
/*const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}); */

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

/*
// Creazione tabelle e popolamento iniziale
;(async () => {
  try {
    // --- anagrafica
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
    // se esiste già senza foto, la aggiungiamo
    await pool.query(`
      ALTER TABLE anagrafica
        ADD COLUMN IF NOT EXISTS foto TEXT;
    `);

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
})();  */

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

// ANAGRAFICA
app.get('/anagrafica', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  try {
    const { data: giocatori, error } = await supabase
      .from('anagrafica')
      .select('*')
      .order('id', { ascending: false });
    if (error) throw error;
    res.render('layout', {
      page: 'anagrafica_content',
      giocatori,
      filters: { cognome: '', nome: '' },
      message: null
    });
  } catch (err) {
    console.error(err);
    res.render('layout', {
      page: 'anagrafica_content',
      giocatori: [],
      filters: { cognome: '', nome: '' },
      message: 'Errore nel caricamento delle anagrafiche'
    });
  }
});


// creazione con upload Cloudinary
app.post('/anagrafica', upload.single('foto'), async (req, res) => {
  const { cognome, nome, dataNascita, luogoNascita, cellulare, note } = req.body;
  // CloudinaryStorage ti mette qui l’URL
  const fotoUrl = req.file?.path ?? null;

  try {
    // usa Supabase per l'insert
    const { error } = await supabase
      .from('anagrafica')
      .insert({
        cognome,
        nome,
        data_nascita: dataNascita,
        luogo_nascita: luogoNascita,
        cellulare,
        note,
        foto: fotoUrl
      });
    if (error) throw error;
    res.redirect('/anagrafica');
  } catch (err) {
    console.error("Errore nel salvataggio:", err);
    res.redirect('/anagrafica');
  }
});


// POST elimina anagrafica (e tutte le terapie collegate)
app.post('/anagrafica/delete/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const id = req.params.id;

  try {
    // 1) elimina tutte le terapie che fanno riferimento a questa anagrafica
    let { error: errT } = await supabase
      .from('terapie')
      .delete()
      .eq('anagrafica_id', id);

    if (errT) throw errT;

    // 2) elimina l’anagrafica
    let { error: errA } = await supabase
      .from('anagrafica')
      .delete()
      .eq('id', id);

    if (errA) throw errA;

    res.redirect('/anagrafica');
  } catch (err) {
    console.error("Errore nella cancellazione via Supabase:", err);
    res.redirect('/anagrafica');
  }
});



app.post('/anagrafica/update/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');

  const id = req.params.id;
  const { nome, cognome, data_nascita, luogo_nascita, cellulare, note } = req.body;

  try {
    const { error } = await supabase
      .from('anagrafica')
      .update({
        nome,
        cognome,
        data_nascita,
        luogo_nascita,
        cellulare,
        note
      })
      .eq('id', id);

    if (error) throw error;

    res.sendStatus(200);
  } catch (err) {
    console.error("Errore nell'update via Supabase:", err);
    res.sendStatus(500);
  }
});


// --- TERAPIE con filtri e join ---
// … tutto quello che hai già sopra, fino a prima di app.get('/terapie' …

// ROTTE TERAPIE
// … tutto quello che hai già sopra …

// ROTTE TERAPIE
app.get('/terapie', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  // Estrai i filtri dalla query string
  const {
    filter_anagrafica   = 'all',
    filter_distretto     = 'all',
    filter_trattamento   = 'all'
  } = req.query;

  try {
    // Dati per i dropdown
    const { data: anagrafiche, error: errA } = await supabase
      .from('anagrafica')
      .select('id, nome, cognome')
      .order('cognome', { ascending: true });
    if (errA) throw errA;

    const { data: distretti, error: errD } = await supabase
      .from('distretti')
      .select('id, nome, coords')
      .order('nome', { ascending: true });
    if (errD) throw errD;

    const { data: trattamenti, error: errT } = await supabase
      .from('trattamenti')
      .select('id, nome')
      .order('nome', { ascending: true });
    if (errT) throw errT;

    // Costruisci la query per le terapie con join sui record collegati
    let query = supabase
      .from('terapie')
      .select(`
        id,
        operatore,
        data_trattamento,
        note,
        anagrafica!inner(nome, cognome),
        distretti!inner(nome),
        trattamenti!inner(nome)
      `)
      .order('data_trattamento', { ascending: false });

    if (filter_anagrafica !== 'all') {
      query = query.eq('anagrafica_id', filter_anagrafica);
    }
    if (filter_distretto !== 'all') {
      query = query.eq('distretto_id', filter_distretto);
    }
    if (filter_trattamento !== 'all') {
      query = query.eq('trattamento_id', filter_trattamento);
    }

    const { data: therapies, error: errTh } = await query;
    if (errTh) throw errTh;

    // Renderizza la pagina
    res.render('layout', {
      page: 'terapie_content',
      anagrafiche,
      distretti,
      trattamenti,
      therapies: therapies.map(t => ({
        id: t.id,
        operatore: t.operatore,
        data_trattamento: t.data_trattamento,
        anagrafica: `${t.anagrafica.nome} ${t.anagrafica.cognome}`,
        distretto: t.distretti.nome,
        trattamento: t.trattamenti.nome,
        note: t.note
      })),
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
      anagrafiche: [],
      distretti: [],
      trattamenti: [],
      therapies: [],
      filters: {
        filter_anagrafica: 'all',
        filter_distretto: 'all',
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
    const { error } = await supabase
      .from('terapie')
      .insert({
        anagrafica_id:   anagrafica_id,
        distretto_id:    distretto_id,
        trattamento_id:  trattamento_id,
        data_trattamento: data_trattamento,
        note:             note,
        operatore:        operatore
      });
    if (error) throw error;

    res.redirect('/terapie');
  } catch (err) {
    console.error("Errore nel salvataggio terapia:", err);
    res.redirect('/terapie');
  }
});


// UPDATE inline di una terapia
app.post('/terapie/update/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const id = req.params.id;
  const {
    data_trattamento,
    anagrafica_id,
    distretto_id,
    trattamento_id,
    note
  } = req.body;

  try {
    const { error } = await supabase
      .from('terapie')
      .update({
        data_trattamento,
        anagrafica_id,
        distretto_id,
        trattamento_id,
        note
      })
      .eq('id', id);

    if (error) throw error;
    res.sendStatus(200);
  } catch (err) {
    console.error("Errore nell'update terapia:", err);
    res.sendStatus(500);
  }
});


// DELETE di una terapia
app.post('/terapie/delete/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const id = req.params.id;
  try {
    const { error } = await supabase
      .from('terapie')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.redirect('/terapie');
  } catch (err) {
    console.error("Errore nella cancellazione terapia:", err);
    res.redirect('/terapie');
  }
});


// ROTTA FASCICOLI
app.get('/fascicoli', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const { cognome = '', nome = '' } = req.query;

  try {
    // 1) Prendo le anagrafiche filtrate
    let query = supabase
      .from('anagrafica')
      .select('id, cognome, nome, data_nascita, luogo_nascita, cellulare, note, foto')
      .order('cognome', { ascending: true })
      .order('nome',   { ascending: true });

    if (cognome) query = query.ilike('cognome', `%${cognome}%`);
    if (nome)     query = query.ilike('nome',     `%${nome}%`);

    const { data: anagrafiche, error: anagErr } = await query;
    if (anagErr) throw anagErr;

    // 2) Prendo tutte le terapie per questi id
    const ids = anagrafiche.map(a => a.id);
    let therapies = [];
    if (ids.length) {
      const { data: th, error: thErr } = await supabase
        .from('terapie')
        .select(`
          anagrafica_id,
          data_trattamento,
          note,
          distretti ( nome ),
          trattamenti ( nome )
        `)
        .in('anagrafica_id', ids)
        .order('data_trattamento', { ascending: false });
      if (thErr) throw thErr;
      // re-mappo per portare distretto e trattamento in campi top-level
      therapies = th.map(t => ({
        anagrafica_id:   t.anagrafica_id,
        data_trattamento: t.data_trattamento,
        distretto:       t.distretti.nome,
        trattamento:     t.trattamenti.nome,
        note:            t.note
      }));
    }

    // render
    res.render('layout', {
      page:         'fascicoli_content',
      anagrafiche,               // lista delle anagrafiche
      therapies,                 // tutte le terapie correlate
      filters:     { cognome, nome },
      defaultPhoto: '/images/default.png',
      message:      null
    });

  } catch (err) {
    console.error("Errore nel caricamento fascicoli:", err);
    res.render('layout', {
      page:         'fascicoli_content',
      anagrafiche:  [],
      therapies:    [],
      filters:      { cognome:'', nome:'' },
      defaultPhoto: '/images/default.png',
      message:      'Errore nel caricamento dei fascicoli'
    });
  }
});


// dettaglio di un singolo fascicolo (partial HTML)
/*app.get('/fascicoli/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const { id } = req.params;
  try {
    // 1) prendi l’anagrafica
    const aRes = await pool.query(`
      SELECT id, nome, cognome, data_nascita, luogo_nascita, cellulare, note, foto
      FROM anagrafica
      WHERE id = $1
    `, [id]);
    if (aRes.rowCount === 0) return res.status(404).send('Non trovato');

    const a = aRes.rows[0];

    // 2) tutte le terapie relative
    const tRes = await pool.query(`
      SELECT data_trattamento, d.nome AS distretto, tr.nome AS trattamento, note
      FROM terapie t
      JOIN distretti d   ON t.distretto_id   = d.id
      JOIN trattamenti tr ON t.trattamento_id = tr.id
      WHERE t.anagrafica_id = $1
      ORDER BY t.data_trattamento DESC
    `, [id]);

    // 3) render di un partial (lo creiamo subito qui di seguito)
    res.render('fascicolo_detail', {
      a,
      therapies: tRes.rows,
      defaultPhoto: '/images/default.png'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Errore interno');
  }
}); */

app.get('/fascicoli/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const { id } = req.params;

  try {
    // 1) Recupera l’anagrafica
    const { data: anag, error: anagErr } = await supabase
      .from('anagrafica')
      .select('id, cognome, nome, data_nascita, luogo_nascita, cellulare, note, foto')
      .eq('id', id)
      .single();
    if (anagErr || !anag) return res.status(404).send('Non trovato');

    // 2) Recupera le terapie correlate
    const { data: th, error: thErr } = await supabase
      .from('terapie')
      .select(`
        data_trattamento,
        note,
        distretti(nome),
        trattamenti(nome)
      `)
      .eq('anagrafica_id', id)
      .order('data_trattamento', { ascending: false });
    if (thErr) throw thErr;

    // 3) Rimappiamo in un formato più semplice
    const therapies = th.map(t => ({
      data_trattamento: t.data_trattamento,
      note: t.note,
      distretto: t.distretti.nome,
      trattamento: t.trattamenti.nome
    }));

    // 4) Render del partial (views/fascicoli_detail.ejs)
    res.render('fascicoli_detail', {
      anagrafica:  anag,
      therapies,
      defaultPhoto: '/images/default.png'
    });
  } catch (err) {
    console.error("Errore nel caricamento del fascicolo:", err);
    res.status(500).send('Errore interno');
  }
});


// Avvio server
app.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});
