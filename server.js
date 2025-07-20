require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const puppeteer = require('puppeteer');    // <— qui usiamo la versione completa
const ejs = require('ejs');





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
  const { cognome = '', nome = '' } = req.query;
  try {
    let query = supabase.from('anagrafica').select('*').order('id', { ascending: false });
    if (cognome) query = query.ilike('cognome', `%${cognome}%`);
    if (nome)     query = query.ilike('nome',     `%${nome}%`);
    const { data: giocatori, error } = await query;
    if (error) throw error;
    res.render('layout', {
      page:    'anagrafica_content',
      giocatori,
      filters: { cognome, nome },
      message: null
    });
  } catch (err) {
    console.error(err);
    res.render('layout', {
      page:    'anagrafica_content',
      giocatori: [],
      filters: { cognome, nome },
      message: 'Errore nel caricamento delle anagrafiche'
    });
  }
});

// POST /anagrafica  (con Cloudinary + multer-storage)
// subito dopo aver definito `const upload = multer({ storage })`
app.post('/anagrafica', upload.single('foto'), async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const { cognome, nome, dataNascita, luogoNascita, cellulare, note } = req.body;
  // multer-storage-cloudinary mette l’URL in req.file.path
  const fotoUrl = req.file?.path ?? null;

  try {
    // Inserisci in PostgreSQL (pool) o in Supabase
    const { error } = await supabase
      .from('anagrafica')
      .insert({
        cognome,
        nome,
        data_nascita:   dataNascita,
        luogo_nascita:  luogoNascita,
        cellulare,
        note,
        foto:           fotoUrl
      });

    if (error) throw error;
    res.redirect('/anagrafica');
  } catch (err) {
    console.error("Errore nel salvataggio:", err);
    // In caso di errore, ripresenta il form con il messaggio
    res.render('layout', {
      page:       'anagrafica_content',
      giocatori:  [],
      filters:    { cognome:'', nome:'' },
      message:    'Errore nel salvataggio: ' + (err.message || err)
    });
  }
});

// POST /anagrafica/delete/:id
app.post('/anagrafica/delete/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const id = req.params.id;
  try {
    let { error } = await supabase
      .from('terapie')
      .delete()
      .eq('anagrafica_id', id);
    if (error) throw error;
    ({ error } = await supabase
      .from('anagrafica')
      .delete()
      .eq('id', id));
    if (error) throw error;
    res.redirect('/anagrafica');
  } catch (err) {
    console.error(err);
    res.redirect('/anagrafica');
  }
});



// POST /anagrafica/update/:id
app.post('/anagrafica/update/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const id = req.params.id;
  const { nome, cognome, data_nascita, luogo_nascita, cellulare, note } = req.body;
  try {
    const { error } = await supabase
      .from('anagrafica')
      .update({ nome, cognome, data_nascita, luogo_nascita, cellulare, note })
      .eq('id', id);
    if (error) throw error;
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// aggiorna solo la foto
app.post('/anagrafica/update-photo/:id',
  upload.single('foto'),
  async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const id = req.params.id;
    const fotoUrl = req.file?.path ?? null;
    try {
      // se usi Supabase:
      const { error } = await supabase
        .from('anagrafica')
        .update({ foto: fotoUrl })
        .eq('id', id);
      if (error) throw error;
      res.redirect('/fascicoli?'); // rimanda a fascicoli o dove preferisci
    } catch (err) {
      console.error("Errore update-photo:", err);
      res.status(500).send('Errore durante l’aggiornamento della foto');
    }
});


// ROTTE TERAPIE
app.get('/terapie', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const {
    filter_anagrafica = 'all',
    filter_distretto   = 'all',
    filter_trattamento = 'all'
  } = req.query;

  try {
    // Dropdown
    const [{ data: anagrafiche }, { data: distretti }, { data: trattamenti }] = await Promise.all([
      supabase.from('anagrafica').select('id,nome,cognome').order('cognome'),
      supabase.from('distretti').select('id,nome,coords').order('nome'),
      supabase.from('trattamenti').select('id,nome').order('nome')
    ]);

    // Query terapie con join
    let query = supabase
      .from('terapie')
      .select(`
        id,
        operatore,
        data_trattamento,
        note,
        anagrafica:anagrafica!inner(nome,cognome),
        distretti:distretti!inner(nome),
        trattamenti:trattamenti!inner(nome)
      `)
      .order('data_trattamento', { ascending: false });

    if (filter_anagrafica!=='all') query = query.eq('anagrafica_id', filter_anagrafica);
    if (filter_distretto!=='all')   query = query.eq('distretto_id',   filter_distretto);
    if (filter_trattamento!=='all') query = query.eq('trattamento_id', filter_trattamento);

    const { data: raw, error } = await query;
    if (error) throw error;

    const therapies = raw.map(t => ({
      id: t.id,
      operatore: t.operatore,
      data_trattamento: t.data_trattamento,
      anagrafica: `${t.anagrafica.nome} ${t.anagrafica.cognome}`,
      distretto: t.distretti.nome,
      trattamento: t.trattamenti.nome,
      note: t.note
    }));

      res.render('layout', {
      page:        'terapie_content',
      anagrafiche, distretti, trattamenti, therapies,
      filters: { filter_anagrafica, filter_distretto, filter_trattamento },
      message: null
    });
  } catch (err) {
    console.error(err);
    res.render('layout', {
      page: 'terapie_content',
      anagrafiche: [], distretti: [], trattamenti: [], therapies: [],
      filters: { filter_anagrafica:'all',filter_distretto:'all',filter_trattamento:'all' },
      message: 'Errore nel caricamento delle terapie'
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
      .insert({ anagrafica_id, distretto_id, trattamento_id, data_trattamento, note, operatore });
    if (error) throw error;
    res.redirect('/terapie');
  } catch (err) {
    console.error(err);
    res.redirect('/terapie');
  }
});


app.post('/terapie/update/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const id = req.params.id;
  const { data_trattamento, anagrafica_id, distretto_id, trattamento_id, note } = req.body;
  try {
    const { error } = await supabase
      .from('terapie')
      .update({ data_trattamento, anagrafica_id, distretto_id, trattamento_id, note })
      .eq('id', id);
    if (error) throw error;
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// POST /terapie/delete/:id
app.post('/terapie/delete/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  try {
    const { error } = await supabase
      .from('terapie')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.redirect('/terapie');
  } catch (err) {
    console.error(err);
    res.redirect('/terapie');
  }
});
/*
// Upload di un singolo allegato per una terapia (usando Supabase)
app.post('/terapie/:id/allegati', upload.single('allegato'), async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const therapyId = parseInt(req.params.id, 10);

  if (!req.file) {
    // nessun file selezionato: torna indietro con errore
    return res.status(400).send('Nessun file caricato');
  }

  // req.file.path contiene l'URL Cloudinary
  const url = req.file.path;

  try {
    const { error } = await supabase
      .from('allegati')
      .insert({
        terapia_id: therapyId,
        url
      });

    if (error) throw error;

    // torno indietro alla pagina di fascicoli (o alla stessa view)
    res.redirect('back');
  } catch (err) {
    console.error('Errore upload allegato via Supabase:', err);
    res.status(500).send('Errore interno durante il salvataggio dell\'allegato');
  }
}); */



// ROTTA FASCICOLI
app.get('/fascicoli', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  const { cognome = '', nome = '' } = req.query;

  try {
    // 1) Prendo le anagrafiche filtrate
    let query = supabase
      .from('anagrafica')
      .select('id,cognome,nome,data_nascita,luogo_nascita,cellulare,note,foto')
      .order('cognome', { ascending: true })
      .order('nome',   { ascending: true });
    if (cognome) query = query.ilike('cognome', `%${cognome}%`);
    if (nome)     query = query.ilike('nome',     `%${nome}%`);
    const { data: anagrafiche, error: e1 } = await query;
    if (e1) throw e1;

    // 2) Prendo tutte le terapie relative
    const ids = anagrafiche.map(a => a.id);
    let therapies = [];
    if (ids.length) {
      const { data: th, error: e2 } = await supabase
        .from('terapie')
        .select(`anagrafica_id,data_trattamento,note,distretti(nome),trattamenti(nome)`)
        .in('anagrafica_id', ids)
        .order('data_trattamento', { ascending: false });
      if (e2) throw e2;

      therapies = th.map(t => ({
        anagrafica_id:    t.anagrafica_id,
        data_trattamento: t.data_trattamento,
        distretto:        t.distretti.nome,
        trattamento:      t.trattamenti.nome,
        note:             t.note
      }));
    }

    // 3) Render in caso di successo
    return res.render('layout', {
      page:         'fascicoli_content',
      anagrafiche,
      therapies,
      filters:      { cognome, nome },
      defaultPhoto: '/images/default.png',
      message:      null
    });

  } catch (err) {
    console.error("Errore nel caricamento dei fascicoli:", err);
    // Render in caso di errore
    return res.render('layout', {
      page:         'fascicoli_content',
      anagrafiche:  [],
      therapies:    [],
      filters:      { cognome: '', nome: '' },
      defaultPhoto: '/images/default.png',
      message:      'Errore nel caricamento dei fascicoli'
    });
  }
});


// dettaglio di un singolo fascicolo (partial HTML)
app.get('/fascicoli/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).send('ID non valido');

  try {
    // 1) Recupera l’anagrafica
    const { data: anag, error: errA } = await supabase
      .from('anagrafica')
      .select('id, cognome, nome, data_nascita, luogo_nascita, cellulare, note, foto')
      .eq('id', id)
      .single();
    if (errA || !anag) return res.status(404).send('Non trovato');

    // 2) Recupera le terapie correlate
    const { data: th, error: errT } = await supabase
      .from('terapie')
      .select(`
        id,
        data_trattamento,
        note,
        distretti(nome),
        trattamenti(nome)
      `)
      .eq('anagrafica_id', id)
      .order('data_trattamento', { ascending: false });
    if (errT) throw errT;
    const therapies = th.map(t => ({
      id: t.id,
      data_trattamento: t.data_trattamento,
      note: t.note,
      distretto: t.distretti.nome,
      trattamento: t.trattamenti.nome
    }));

    // 3) Recupera gli allegati per ciascuna terapia
    const terapiaIds = therapies.map(t => t.id);
    let attachments = [];
    if (terapiaIds.length) {
      const { data: att, error: errAtt } = await supabase
        .from('allegati')
        .select('id, terapia_id, url')
        .in('terapia_id', terapiaIds);
      if (errAtt) throw errAtt;
      attachments = att;
    }

    // 4) Render del partial (views/fascicoli_detail.ejs)
    res.render('fascicoli_detail', {
      anagrafica:  anag,
      therapies,
      attachments,
      defaultPhoto: '/images/default.png'
    });
  } catch (err) {
    console.error("Errore nel caricamento del fascicolo:", err);
    res.status(500).send('Errore interno');
  }
});

// Lista e upload allegati per una singola terapia
app.get('/terapie/:id/allegati', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const therapyId = parseInt(req.params.id, 10);
  if (isNaN(therapyId)) return res.status(400).send('ID terapia non valido');

  // 1) Prendo i dati della terapia
  const { data: therapy, error: errTher } = await supabase
    .from('terapie')
    .select(`id, data_trattamento, anagrafica (nome, cognome)`)
    .eq('id', therapyId)
    .single();
  if (errTher || !therapy) return res.status(404).send('Terapia non trovata');

  // 2) Prendo gli allegati esistenti
  const { data: attachments = [], error: errAtt } = await supabase
    .from('allegati')
    .select('id, terapia_id, url, public_id')
    .eq('terapia_id', therapyId);
  if (errAtt) console.error(errAtt);

  // 3) Renderizzo usando il layout principale
  res.render('layout', {
    page:         'allegati_content',
    therapy,             // qui passiamo therapy
    attachments,
    defaultPhoto: '/images/default.png'
  });
});
 // <- qui chiudiamo la callback di app.get


/*
app.post('/terapie/:id/allegati', upload.single('allegato'), async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const therapyId = req.params.id;
  if (!req.file) return res.status(400).send('Nessun file caricato');

  const url = req.file.path;  // URL Cloudinary

  // Salvo in Supabase
  const { error } = await supabase
    .from('allegati')
    .insert({ terapia_id: therapyId, url });
  if (error) {
    console.error('Errore upload allegato:', error);
    return res.status(500).send('Upload fallito');
  }

  // Invece di redirect, rispondi con 200 OK e lascia che sia il client JS a
  // mostrare il toast / pulire i controlli
  //res.sendStatus(200);
  res.redirect(req.get('Referer') || '/fascicoli');

}); */

app.post('/terapie/:therapyId/allegati/:id/delete', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const { therapyId, id } = req.params;

  try {
    // 1) recupera record per avere public_id
    const { data, error: fetchErr } = await supabase
      .from('allegati')
      .select('public_id')
      .eq('id', id)
      .single();
    if (fetchErr) throw fetchErr;

    // 2) cancella da Cloudinary
    await cloudinary.uploader.destroy(data.public_id);

    // 3) cancella da Supabase
    const { error: delErr } = await supabase
      .from('allegati')
      .delete()
      .eq('id', id);
    if (delErr) throw delErr;

    return res.redirect(`/terapie/${therapyId}/allegati`);
  } catch (err) {
    console.error('Errore eliminazione allegato:', err);
    return res.status(500).send('Errore durante l’eliminazione allegato');
  }
});

// Upload di un singolo allegato per una terapia
app.post('/terapie/:id/allegati', upload.single('allegato'), async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const therapyId = parseInt(req.params.id, 10);
  if (isNaN(therapyId)) return res.status(400).send('ID terapia non valido');
  if (!req.file)             return res.status(400).send('Nessun file caricato');

  const url      = req.file.path;      // url completo
  const publicId = req.file.filename;  // public_id in Cloudinary

  try {
    const { error } = await supabase
      .from('allegati')
      .insert({
        terapia_id: therapyId,
        url,
        public_id: publicId
      });
    if (error) throw error;
    // redirect indietro per ricaricare la pagina degli allegati
    return res.redirect(req.get('Referer') || `/terapie/${therapyId}/allegati`);
  } catch (err) {
    console.error('Errore upload allegato:', err);
    return res.status(500).send('Upload fallito');
  }
});


// Elimina un allegato sia da Supabase che da Cloudinary
app.post('/allegati/:id/delete', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).send('ID non valido');

  try {
    // 1) Leggi il public_id e la terapia di riferimento
    const { data: att, error: fetchErr } = await supabase
      .from('allegati')
      .select('public_id, terapia_id')
      .eq('id', id)
      .single();
    if (fetchErr || !att) throw fetchErr || new Error('Allegato non trovato');

    // 2) Rimuovi da Cloudinary
    await cloudinary.uploader.destroy(att.public_id);

    // 3) Rimuovi da Supabase
    const { error: delErr } = await supabase
      .from('allegati')
      .delete()
      .eq('id', id);
    if (delErr) throw delErr;

    // 4) Ritorna alla pagina degli allegati per quella terapia
    res.redirect(`/terapie/${att.terapia_id}/allegati`);
  } catch (err) {
    console.error('Errore eliminazione allegato:', err);
    res.status(500).send('Errore durante eliminazione allegato');
  }
});

app.get('/fascicoli/:anagID/export/:therapyID', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const anagID    = parseInt(req.params.anagID,   10);
  const therapyID = parseInt(req.params.therapyID, 10);
  if (isNaN(anagID) || isNaN(therapyID)) {
    return res.status(400).send('ID non valido');
  }

  try {
    // 1) Anagrafica
    const { data: anag, error: errA } = await supabase
      .from('anagrafica')
      .select('*')
      .eq('id', anagID)
      .single();
    if (errA || !anag) throw errA || new Error('Anagrafica non trovata');

    // 2) Terapia
    const { data: th, error: errT } = await supabase
      .from('terapie')
      .select(`
        id, data_trattamento, note, operatore,
        distretti(nome),
        trattamenti(nome)
      `)
      .eq('id', therapyID)
      .single();
    if (errT || !th) throw errT || new Error('Terapia non trovata');

    // 3) Allegati
    const { data: attachments = [], error: errAtt } = await supabase
      .from('allegati')
      .select('*')
      .eq('terapia_id', therapyID);
    if (errAtt) console.error(errAtt);

    // 4) Genera HTML da template EJS
    const html = await ejs.renderFile(
      path.join(__dirname, 'views', 'export_template.ejs'),
      { anagrafica: anag, therapy: th, attachments, defaultPhoto: '/images/default.png' }
    );

    // 5) Avvia Puppeteer (con Chromium incluso)
    const browser = await puppeteer.launch();
    const page    = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '10mm', right: '10mm' }
    });
    await browser.close();

    // 6) Spedisci il PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Fascicolo_${anag.cognome}_${therapyID}.pdf"`
    );
    res.send(pdfBuffer);

  } catch (err) {
    console.error('Errore nell’esportazione:', err);
    res.status(500).send('Errore nell’esportazione');
  }
});

// Avvio server
app.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});
