require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const LOGO_PATH = path.join(__dirname, 'public', 'images', 'Logo_CATANIA_FC.svg.png'); 







const app = express();
const PORT = process.env.PORT || 3000;


const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // lato server usa la service-role key
);

function getSinceDate(period = 'month') {
  const d = new Date();
  if (period === 'week')  d.setDate(d.getDate() - 7);
  if (period === 'month') d.setMonth(d.getMonth() - 1);
  if (period === 'year')  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString();
}

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

// Utility per generare l’hash SHA‑256 di una stringa
function sha256(text) {
  return crypto
    .createHash('sha256')
    .update(text)
    .digest('hex');
}


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

//const USERS = { "admin@admin.com": "admin123" };

// Rotte di base e autenticazione
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

// POST /login — autentica contro la tabella operatori
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    // 1) Cerco l’operatore
    const { data: op, error } = await supabase
      .from('operatori')
      .select('id, nome, cognome, password_hash')
      .eq('email', email)
      .single();
    if (error || !op) {
      return res.render('login', { error: 'Credenziali errate' });
    }

    // 2) Calcolo hash della password inviata e confronto
    const hash = crypto.createHash('sha256')
                       .update(password)
                       .digest('hex');
    if (hash !== op.password_hash) {
      return res.render('login', { error: 'Credenziali errate' });
    }

    // 3) Autenticato: salvo in sessione solo l’email (o anche id/nome se ti serve)
    req.session.user = email;
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Errore autenticazione:', err);
    return res.render('login', { error: 'Errore interno, riprova più tardi' });
  }
});


app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});
/*
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.render('layout', { page: 'dashboard_content', user: req.session.user });
}); */

app.get('/dashboard', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  try {
    // 1) Recupera gli utenti “disponibili” (infortunio = false)
    const { data: disponibili, error: errDisp } = await supabase
      .from('anagrafica')
      .select('id, nome, cognome, infortunio')
      .eq('infortunio', false);
    if (errDisp) throw errDisp;

    // 2) Recupera gli utenti “non disponibili” (infortunio = true)
    const { data: nondisponibili, error: errNon } = await supabase
      .from('anagrafica')
      .select('id, nome, cognome, infortunio')
      .eq('infortunio', true);
    if (errNon) throw errNon;

    // 3) Render della dashboard passando i 4 dataset
    return res.render('layout', {
      page:              'dashboard_content',
      user:              req.session.user,
      disponibili,       // array di giocatori non infortunati
      nondisponibili     // array di giocatori infortunati
    });
  } catch (err) {
    console.error('Errore caricamento dashboard:', err);
    return res.render('layout', {
      page:              'dashboard_content',
      user:              req.session.user,
      disponibili:       [],
      nondisponibili:    [],
      message:           'Impossibile caricare la dashboard'
    });
  }
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

// POST /anagrafica/:id/infortunio — aggiorna infortunio + data_rientro
app.post('/anagrafica/:id/infortunio', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const id = parseInt(req.params.id, 10);
  const { infortunio, data_rientro } = req.body;
  if (isNaN(id)) return res.status(400).send('ID non valido');

  try {
    const { error } = await supabase
      .from('anagrafica')
      .update({ infortunio, data_rientro })
      .eq('id', id);
    if (error) throw error;
    res.sendStatus(200);
  } catch (err) {
    console.error('Errore update infortunio:', err);
    res.status(500).send('Errore nel salvataggio');
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
        sigla,
        note,
        anagrafica:anagrafica!inner(nome,cognome),
        distretti:distretti!inner(nome),
        trattamenti:trattamenti!inner(nome)
      `)
      .order('data_trattamento', { ascending: false })
      .order('id', { ascending: true });

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
      sigla: t.sigla || null,
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

  let { anagrafica_id, distretto_id, trattamento_id, data_trattamento, sigla, note } = req.body;
  const operatore = req.session.user;

  sigla = sigla?.trim() || null;  // <- rende opzionale

  try {
    const { error } = await supabase
      .from('terapie')
      .insert({ anagrafica_id, distretto_id, trattamento_id, data_trattamento, sigla, note, operatore });
    if (error) throw error;
    res.redirect('/terapie');
  } catch (err) {
    console.error(err);
    res.redirect('/terapie');
  }
});


app.post('/terapie/update/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const id = parseInt(req.params.id, 10);

  let { data_trattamento, anagrafica_id, distretto_id, trattamento_id, sigla, note } = req.body;
  sigla = sigla?.trim() || null;

  try {
    // leggo la data attuale per confrontarla
    const { data: oldRow, error: eFetch } = await supabase
      .from('terapie')
      .select('data_trattamento')
      .eq('id', id)
      .single();
    if (eFetch) throw eFetch;

    const oldDate = String(oldRow?.data_trattamento || '').slice(0, 10);
    const newDate = (data_trattamento || '').slice(0, 10);

    // costruiamo payload dinamico (PATCH-like)
    const payload = {
      anagrafica_id,
      distretto_id,
      trattamento_id,
      sigla,
      note
    };

    // includo la data SOLO se è diversa da quella salvata
    if (newDate && newDate !== oldDate) {
      payload.data_trattamento = newDate;
    }

    const { error } = await supabase
      .from('terapie')
      .update(payload)
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
      .select('id, cognome, nome, data_nascita, luogo_nascita, cellulare, note, foto, infortunio, data_rientro')
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

    // Dopo aver fatto `const anag = data from supabase`
if (anag.infortunio && anag.data_rientro) {
  const today = new Date().toISOString().slice(0,10);
  if (anag.data_rientro === today) {
    // resetta infortunio
    await supabase
      .from('anagrafica')
      .update({ infortunio: false, data_rientro: null })
      .eq('id', anag.id);
    anag.infortunio = false;
    anag.data_rientro = null;
  }
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
  if (isNaN(anagID) || isNaN(therapyID))
    return res.status(400).send('ID non valido');

  try {
    // 1) Prendi anagrafica
    const { data: anag, error: errA } = await supabase
      .from('anagrafica')
      .select('*')
      .eq('id', anagID)
      .single();
    if (errA || !anag) throw errA || new Error('Anagrafica non trovata');

    // 2) Prendi la terapia
    const { data: th, error: errT } = await supabase
      .from('terapie')
      .select(`
        id, data_trattamento, sigla, note, operatore,
        distretti(nome), trattamenti(nome)
      `)
      .eq('id', therapyID)
      .single();
    if (errT || !th) throw errT || new Error('Terapia non trovata');

    // 3) Prendi gli allegati (i loro URL)
    const { data: attachments = [] } = await supabase
      .from('allegati')
      .select('url')
      .eq('terapia_id', therapyID);

    // 4) Componi il PDF con PDFKit
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Fascicolo_${anag.cognome}_${therapyID}.pdf"`
    );
    doc.pipe(res);

    doc.fontSize(20).text(`Fascicolo di ${anag.nome} ${anag.cognome}`, { underline: true });
    doc.moveDown();

    // Dati anagrafica
    doc.fontSize(12)
       .text(`Data di nascita: ${String(anag.data_nascita).slice(0,10)}`)
       .text(`Comune: ${anag.luogo_nascita}`)
       .text(`Cellulare: ${anag.cellulare}`)
       .moveDown();

    // Terapia
    doc.fontSize(16).text('Dettagli della terapia', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12)
       .text(`Data trattamento: ${String(th.data_trattamento).slice(0,10)}`)
       .text(`Distretto: ${th.distretti.nome}`)
       .text(`Trattamento: ${th.trattamenti.nome}`)
       .text(`Operatore: ${th.operatore}`)
       .text(`Stato: ${th.sigla || '—'}`)
       .text(`Note: ${th.note || '—'}`)
       .moveDown();

    // Allegati
    if (attachments.length) {
      doc.fontSize(16).text('Allegati', { underline: true });
      doc.moveDown(0.5);
      for (let { url } of attachments) {
        // PDFKit supporta immagini via URL se hai un modulo aggiuntivo o devi scaricarle prima.
        // Per semplicità qui mettiamo solo il link testuale:
        doc.fontSize(12).fillColor('blue').text(url, { link: url, underline: true });
        doc.fillColor('black').moveDown(0.5);
      }
    }

    doc.end();

  } catch (err) {
    console.error('Errore nell’esportazione PDF:', err);
    res.status(500).send('Errore nell’esportazione');
  }
});

// ===== ROTTE DISTRETTI ANATOMICI =====

// Mostra la pagina con form + tabella
app.get('/distretti', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  try {
    const { data: distretti, error } = await supabase
      .from('distretti')
      .select('id, nome')
      .order('nome', { ascending: true });
    if (error) throw error;
    res.render('layout', {
      page:        'distretti_content',
      distretti,
      message:     null
    });
  } catch (err) {
    console.error('Errore caricamento distretti:', err);
    res.render('layout', {
      page:       'distretti_content',
      distretti:  [],
      message:    'Errore nel caricamento dei distretti'
    });
  }
});

// Crea un nuovo distretto
app.post('/distretti', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { nome } = req.body;
  try {
    const { error } = await supabase
      .from('distretti')
      .insert({ nome });
    if (error) throw error;
    res.redirect('/distretti');
  } catch (err) {
    console.error('Errore creazione distretto:', err);
    // ripropongo lista + messaggio
    const { data: distretti } = await supabase
      .from('distretti')
      .select('id, nome')
      .order('nome', { ascending: true });
    res.render('layout', {
      page:       'distretti_content',
      distretti,
      message:    'Impossibile creare il distretto: ' + err.message
    });
  }
});

// Modifica nome di un distretto
app.post('/distretti/:id/update', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const id = parseInt(req.params.id, 10);
  const { nome } = req.body;
  try {
    const { error } = await supabase
      .from('distretti')
      .update({ nome })
      .eq('id', id);
    if (error) throw error;
    res.sendStatus(200);
  } catch (err) {
    console.error('Errore aggiornamento distretto:', err);
    res.sendStatus(500);
  }
});

// Elimina un distretto
// elimina distretto + terapie collegate
app.post('/distretti/:id/delete', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const id = parseInt(req.params.id, 10);
  try {
    // 1) rimuovi tutte le terapie collegate
    let { error: errT } = await supabase
      .from('terapie')
      .delete()
      .eq('distretto_id', id);
    if (errT) throw errT;

    // 2) elimina il distretto
    let { error: errD } = await supabase
      .from('distretti')
      .delete()
      .eq('id', id);
    if (errD) throw errD;

    res.redirect('/distretti');
  } catch (err) {
    console.error('Errore eliminazione distretto + terapie:', err);
    // puoi anche renderizzare un messaggio di errore in pagina
    res.redirect('/distretti');
  }
});

// Mostra pagina Trattamenti
app.get('/trattamenti', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  try {
    const { data: trattamenti, error } = await supabase
      .from('trattamenti')
      .select('*')
      .order('nome', { ascending: true });
    if (error) throw error;
    res.render('layout', {
      page: 'trattamenti_content',
      trattamenti,
      message: null
    });
  } catch (err) {
    console.error('Errore caricamento trattamenti:', err);
    res.render('layout', {
      page: 'trattamenti_content',
      trattamenti: [],
      message: 'Errore nel caricamento'
    });
  }
});

// Crea nuovo trattamento
app.post('/trattamenti', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { nome } = req.body;
  try {
    const { error } = await supabase
      .from('trattamenti')
      .insert({ nome });
    if (error) throw error;
    res.redirect('/trattamenti');
  } catch (err) {
    console.error('Errore creazione trattamento:', err);
    res.redirect('/trattamenti');
  }
});

// Update inline di un trattamento
app.post('/trattamenti/:id/update', async (req, res) => {
  if (!req.session.user) return res.sendStatus(401);
  const id = parseInt(req.params.id, 10);
  const { nome } = req.body;
  if (isNaN(id)) return res.sendStatus(400);
  try {
    const { error } = await supabase
      .from('trattamenti')
      .update({ nome })
      .eq('id', id);
    if (error) throw error;
    res.sendStatus(200);
  } catch (err) {
    console.error('Errore update trattamento:', err);
    res.sendStatus(500);
  }
});

// Elimina trattamento + terapie collegate
app.post('/trattamenti/:id/delete', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const id = parseInt(req.params.id, 10);
  try {
    // 1) elimina terapie
    let { error: errT } = await supabase
      .from('terapie')
      .delete()
      .eq('trattamento_id', id);
    if (errT) throw errT;

    // 2) elimina trattamento
    let { error: errD } = await supabase
      .from('trattamenti')
      .delete()
      .eq('id', id);
    if (errD) throw errD;

    res.redirect('/trattamenti');
  } catch (err) {
    console.error('Errore eliminazione trattamento + terapie:', err);
    res.redirect('/trattamenti');
  }
});

// GET /operatori
app.get('/operatori', async (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const { data: operatori, error } = await supabase
    .from('operatori')
    .select('*')
    .order('id', { ascending: false });
  if (error) console.error(error);
  res.render('layout', {
    page: 'operatori_content',
    operatori,
    message: null
  });
});

// POST crea nuovo operatore
app.post('/operatori', async (req, res) => {
  const { nome, cognome, email, password, passwordConfirm } = req.body;
  // Verifica corrispondenza password
  if (password !== passwordConfirm) {
    // Ricarico la lista per non passare array vuoto
    const { data: operatori = [], error: errOp } = await supabase
      .from('operatori')
      .select('*')
      .order('id', { ascending: false });
    return res.render('layout', {
      page: 'operatori_content',
      operatori,
      message: { type: 'danger', text: 'Le password non corrispondono' }
    });
  }

  // Inserimento
  const { error: errInsert } = await supabase
    .from('operatori')
    .insert({ nome, cognome, email, password_hash: sha256(password) });

  if (errInsert) {
    console.error('Errore creazione operatore:', errInsert);
    const { data: operatori = [] } = await supabase
      .from('operatori')
      .select('*')
      .order('id', { ascending: false });
    return res.render('layout', {
      page: 'operatori_content',
      operatori,
      message: { type: 'danger', text: 'Errore creazione operatore' }
    });
  }

  // Se tutto ok, torna alla lista
  res.redirect('/operatori');
});

// POST modifica operatore (inline, verifica password corrente)
app.post('/operatori/update/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nome, cognome, email, passwordConfirm } = req.body;

  // Recupero l’hash salvato
  const { data: [op], error: errFetch } = await supabase
    .from('operatori')
    .select('password_hash')
    .eq('id', id);

  if (errFetch || !op) {
    console.error('Operatore non trovato:', errFetch);
    return res.status(404).send('Operatore non trovato');
  }

  // Verifico che la password inserita corrisponda
  if (sha256(passwordConfirm) !== op.password_hash) {
    return res.status(401).send('Password errata');
  }

  // Se ok, aggiorno i dati
  const { error: errUpdate } = await supabase
    .from('operatori')
    .update({ nome, cognome, email })
    .eq('id', id);

  if (errUpdate) {
    console.error('Errore aggiornamento operatore:', errUpdate);
    return res.status(500).send('Errore salvataggio');
  }

  res.sendStatus(200);
});

// POST elimina operatore (con warning JS già impostato)
app.post('/operatori/delete/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  // Elimino tutte le terapie collegate a quell’operatore (campo operatore è email o id a tua scelta)
  await supabase
    .from('terapie')
    .delete()
    .eq('operatore', id);

  // Elimino l’operatore
  await supabase
    .from('operatori')
    .delete()
    .eq('id', id);

  res.redirect('/operatori');
});

app.get('/api/dashboard/:metric', async (req, res) => {
  if (!req.session.user) return res.status(401).end();
  const { metric } = req.params;
  const since = getSinceDate(req.query.period);

  try {
    // 1) fetch all therapies in window, with the fields we need
    const { data: therapies, error } = await supabase
      .from('terapie')
      .select(`
        id,
        data_trattamento,
        distretti ( nome ),
        trattamenti ( nome ),
        operatore,
        anagrafica_id
      `)
      .gt('data_trattamento', since);

    if (error) throw error;

    // 2) reduce() to group & count
    const counter = therapies.reduce((acc, t) => {
      let key;
      switch (metric) {
        case 'distretti':
          key = t.distretti.nome;
          break;
        case 'trattamenti':
          key = t.trattamenti.nome;
          break;
        case 'operatori':
          key = t.operatore;
          break;
        case 'giocatori':
          key = String(t.anagrafica_id); // we'll translate later
          break;
        default:
          return acc;
      }
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    // 3) create arrays
    const labels = Object.keys(counter);
    const counts = labels.map(l => counter[l]);

    // 4) if “giocatori”, fetch names for the IDs
    if (metric === 'giocatori' && labels.length) {
      // fetch all involved players at once
      const ids = labels.map(id => parseInt(id,10));
      const { data: players } = await supabase
        .from('anagrafica')
        .select('id,nome,cognome')
        .in('id', ids);
      const nameMap = players.reduce((m,p) => {
        m[p.id] = `${p.nome} ${p.cognome}`;
        return m;
      }, {});
      // replace labels
      for (let i=0; i<labels.length; i++) {
        const id = parseInt(labels[i],10);
        labels[i] = nameMap[id] || labels[i];
      }
    }

    return res.json({ labels, counts });
  } catch (err) {
    console.error('Dashboard API error:', err);
    return res.status(500).end();
  }
});

// In fondo a server.js, subito prima di "Avvio server"
app.post('/fascicoli/:id/infortunio', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const id = parseInt(req.params.id,10);
  const { infortunio, data_rientro } = req.body;
  try {
    const { error } = await supabase
      .from('anagrafica')
      .update({
        infortunio: infortunio === 'true',
        data_rientro: data_rientro || null
      })
      .eq('id', id);
    if (error) throw error;
    res.sendStatus(200);
  } catch (err) {
    console.error('Errore update infortunio:', err);
    res.status(500).send('Errore salvataggio');
  }
});
// =========================
//  TERAPIE -> EXPORT PDF
// =========================

// helper comune: genera il PDF in risposta HTTP
/*
function streamTerapiePDF(res, dayISO, grouped) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ autoFirstPage: false });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=terapie_${dayISO}.pdf`);
  doc.pipe(res);

  doc.addPage({ margin: 40 });
  doc.fontSize(18).text(`Terapie del ${dayISO}`, { align: 'center' });
  doc.moveDown();

  // se non ci sono dati
  if (Object.keys(grouped).length === 0) {
    doc.fontSize(12).text('Nessuna terapia trovata per questa data.');
    doc.end();
    return;
  }

  Object.entries(grouped).forEach(([playerName, items], ix) => {
    doc.fontSize(14).font('Helvetica-Bold').text(playerName);
    doc.moveDown(0.3);
    doc.fontSize(12).font('Helvetica');

    items.forEach((row) => {
      const riga =
        `• ${row.distretto} — ${row.trattamento}` +
        (row.sigla ? ` — ${row.sigla}` : '') +
        (row.note ? ` — Note: ${row.note}` : '');
      doc.text(riga);
    });

    if (ix !== Object.keys(grouped).length - 1) {
      doc.moveDown(); // spazio tra giocatori
    }
  });

  doc.end();
} */


 function streamTerapiePDF(res, dayISO, grouped) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 40, size: 'A4', autoFirstPage: false });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=terapie_${dayISO}.pdf`);
  doc.pipe(res);

  // Helpers di stile
  const colors = {
    primary: '#0d6efd',
    text:    '#212529',
    muted:   '#6c757d',
    headerBg:'#343a40',
    headerFg:'#ffffff',
    tableHeadBg:'#e9ecef',
    border:  '#dee2e6',
    D:  { bg:'#d1e7dd', fg:'#0f5132' },      // verde pastello
    DG: { bg:'#d1e7dd', fg:'#0f5132' },      // stesso verde
    I:  { bg:'#f8d7da', fg:'#842029' },      // rosso pastello
    DV: { bg:'#fff3cd', fg:'#664d03' }       // giallo pastello
  };

  const fmtDateIT = iso => {
    // YYYY-MM-DD -> DD/MM/YYYY
    return `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}`;
  };

 const LOGO_H = 92; // altezza fissa logo in px (regolabile)

const addHeader = () => {
  doc.addPage();

  const left  = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const top   = 30;

  // --- Logo ---
  let logoBottom = top; // y di fine logo (fallback)
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, left, top, { height: LOGO_H }); // altezza fissa ⇒ niente sorprese
      logoBottom = top + LOGO_H;
    } catch {}
  }

  // --- Titoli ---
  const titleX  = left + 120;     // abbastanza a destra del logo
  const y1      = top + 4;        // riga 1
  const y2      = y1 + 24;        // riga 2 (sotto di ~24px)

  doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(14)
     .text('CATANIA FC – STAFF MEDICO', titleX, y1, { align: 'left' });

  doc.fontSize(20)
     .text(`Report terapie – ${fmtDateIT(dayISO)}`, titleX, y2, { align: 'left' });

  const titlesBottom = y2 + 26;   // stima bottom dei titoli

  // --- Separatore posizionato sotto logo/titoli (il più basso dei due) ---
  const hrY = Math.max(logoBottom, titlesBottom) + 10;
  doc.moveTo(left, hrY).lineTo(right, hrY)
     .strokeColor(colors.border).lineWidth(1).stroke();

  // --- Legenda subito sotto il separatore ---
  let x = left, y = hrY + 12;

  const pill = (label, desc, key) => {
    const padX = 6, padY = 3;
    const w = doc.widthOfString(label) + padX * 2;
    const h = 16;
    doc.roundedRect(x, y, w, h, 4)
       .fillAndStroke(colors[key].bg, colors[key].bg);
    doc.fillColor(colors[key].fg).font('Helvetica-Bold').fontSize(10)
       .text(label, x + padX, y + padY - 1);

    x += w + 8;
    doc.fillColor(colors.muted).font('Helvetica').fontSize(10)
       .text(desc, x, y + 2);
    x += doc.widthOfString(desc) + 14;

    doc.fillColor(colors.text);
  };

  doc.fontSize(11).fillColor(colors.text).text('Legenda:', x, y + 1);
  x += doc.widthOfString('Legenda:') + 10;

  pill('D', 'Disponibile',              'D');
  pill('D (GRADUALE)', 'Disponibilità graduale', 'DG');
  pill('DV', 'Da valutare',             'DV');
  pill('I', 'Indisponibile',            'I');

  // imposta il cursore per i contenuti successivi
  doc.y = y + 28;
};


  // Tabellina per giocatore
  function drawPlayerTable(playerName, rows) {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const maxY = doc.page.height - doc.page.margins.bottom;

    const colW = {
      distretto: 150,
      trattamento: 170,
      sigla: 70,
      note: (right - left) - (150 + 170 + 70)
    };
    const rowPad = 6;
    const headH  = 22;

    // A capo pagina se serve spazio per titolo + header
    const need = 24 + headH + 8;
    if (doc.y + need > maxY) addHeader();

    // Nome giocatore
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(13)
       .text(playerName, left, doc.y + 6);
    doc.fillColor(colors.text).moveDown(0.3);

    // Header tabella
    let y = doc.y;
    doc.rect(left, y, right - left, headH).fillAndStroke(colors.tableHeadBg, colors.border);
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(10);
    doc.text('Distretto',   left + 6, y + 6, { width: colW.distretto });
    doc.text('Trattamento', left + 6 + colW.distretto, y + 6, { width: colW.trattamento });
    doc.text('Stato',       left + 6 + colW.distretto + colW.trattamento, y + 6, { width: colW.sigla });
    doc.text('Note',        left + 6 + colW.distretto + colW.trattamento + colW.sigla, y + 6, { width: colW.note });
    doc.fillColor(colors.text).font('Helvetica').fontSize(10);
    y += headH;

    // Righe
    rows.forEach((r, idx) => {
      // Calcolo altezza riga in base ai contenuti (wrapping)
      const hDist = doc.heightOfString(r.distretto || '—',   { width: colW.distretto - 12 });
      const hTrat = doc.heightOfString(r.trattamento || '—', { width: colW.trattamento - 12 });
      const hSigl = 14;
      const hNote = doc.heightOfString(r.note || '—',        { width: colW.note - 12 });
      const rowH  = Math.max(hDist, hTrat, hSigl, hNote) + rowPad*2;

      // Se non ci sta, nuova pagina con header + re-header tabella
      if (y + rowH > maxY) {
        addHeader();
        // re-header tabella
        y = doc.y;
        doc.rect(left, y, right - left, headH).fillAndStroke(colors.tableHeadBg, colors.border);
        doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(10);
        doc.text('Distretto',   left + 6, y + 6, { width: colW.distretto });
        doc.text('Trattamento', left + 6 + colW.distretto, y + 6, { width: colW.trattamento });
        doc.text('Stato',       left + 6 + colW.distretto + colW.trattamento, y + 6, { width: colW.sigla });
        doc.text('Note',        left + 6 + colW.distretto + colW.trattamento + colW.sigla, y + 6, { width: colW.note });
        doc.fillColor(colors.text).font('Helvetica').fontSize(10);
        y += headH;
      }

      // Riga (bordo)
      doc.rect(left, y, right - left, rowH).strokeColor(colors.border).lineWidth(0.8).stroke();

      // Celle testo
      doc.text(r.distretto || '—', left + 6, y + rowPad, { width: colW.distretto - 12 });
      doc.text(r.trattamento || '—', left + 6 + colW.distretto, y + rowPad, { width: colW.trattamento - 12 });

      // Sigla come “badge”
      const val = (r.sigla || '').toUpperCase();
      const badge = (key, text) => {
        const m = colors[key];
        const padX = 5, padY = 3;
        const w = Math.max(30, doc.widthOfString(text) + padX*2);
        const h = 14;
        const cx = left + colW.distretto + colW.trattamento + (colW.sigla - w)/2;
        const cy = y + rowPad + 2;
        doc.roundedRect(cx, cy, w, h, 3).fillAndStroke(m.bg, m.bg);
        doc.fillColor(m.fg).font('Helvetica-Bold').fontSize(9).text(text, cx + padX, cy + padY - 2);
        doc.fillColor(colors.text).font('Helvetica').fontSize(10);
      };
      if (val === 'D') badge('D','D');
      else if (val === 'D (GRADUALE)') badge('DG','D (GRADUALE)');
      else if (val === 'I') badge('I','I');
      else if (val === 'DV') badge('DV','DV');
      else doc.text('—', left + 6 + colW.distretto + colW.trattamento, y + rowPad, { width: colW.sigla - 12, align:'center' });

      doc.text(r.note || '—',
               left + 6 + colW.distretto + colW.trattamento + colW.sigla,
               y + rowPad, { width: colW.note - 12 });

      y += rowH;
    });

    doc.moveDown(0.6);
    doc.y = y + 6;
  }

  // ===== Avvio costruzione documento =====
  addHeader();

  // Nessun dato
  if (!grouped || Object.keys(grouped).length === 0) {
    doc.moveDown(2);
    doc.fontSize(12).fillColor(colors.muted).text('Nessuna terapia trovata per questa data.');
    doc.end();
    return;
  }

  // Ordina per nome e stampa
  Object.entries(grouped)
    .sort((a,b) => a[0].localeCompare(b[0], 'it'))
    .forEach(([playerName, items]) => {
      drawPlayerTable(playerName, items);
    });

  doc.end();
}
 

// helper: valida "YYYY-MM-DD"
function parseDateParam(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
  return dateStr;
}

// GET /terapie/export/today
app.get('/terapie/export/today', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');

  const today = new Date();
  const dayISO = today.toISOString().slice(0, 10);

  try {
    // --- SUPABASE ---
    const { data, error } = await supabase
      .from('terapie')
      .select(`
        data_trattamento,
        sigla,
        note,
        anagrafica:anagrafica_id ( id, nome, cognome ),
        distretto:distretto_id ( nome ),
        trattamento:trattamento_id ( nome )
      `)
      .eq('data_trattamento', dayISO)
      .order('cognome', { foreignTable: 'anagrafica', ascending: true })
      .order('nome', { foreignTable: 'anagrafica', ascending: true });

    if (error) throw error;

    // raggruppo per "Nome Cognome"
    const grouped = {};
    (data || []).forEach(row => {
      const player = `${row.anagrafica?.nome || ''} ${row.anagrafica?.cognome || ''}`.trim();
      if (!grouped[player]) grouped[player] = [];
      grouped[player].push({
        distretto: row.distretto?.nome || '—',
        trattamento: row.trattamento?.nome || '—',
        sigla: row.sigla || '',
        note: row.note || ''
      });
    });

    streamTerapiePDF(res, dayISO, grouped);

  } catch (err) {
    console.error('Errore export today:', err);
    res.status(500).send('Errore durante la generazione del PDF');
  }
});

// GET /terapie/export/by-date?date=YYYY-MM-DD
app.get('/terapie/export/by-date', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');

  const dayISO = parseDateParam(req.query.date);
  if (!dayISO) return res.status(400).send('Data non valida, formato atteso YYYY-MM-DD');

  try {
    // --- SUPABASE ---
    const { data, error } = await supabase
      .from('terapie')
      .select(`
        data_trattamento,
        sigla,
        note,
        anagrafica:anagrafica_id ( id, nome, cognome ),
        distretto:distretto_id ( nome ),
        trattamento:trattamento_id ( nome )
      `)
      .eq('data_trattamento', dayISO)
      .order('cognome', { foreignTable: 'anagrafica', ascending: true })
      .order('nome', { foreignTable: 'anagrafica', ascending: true });

    if (error) throw error;

    const grouped = {};
    (data || []).forEach(row => {
      const player = `${row.anagrafica?.nome || ''} ${row.anagrafica?.cognome || ''}`.trim();
      if (!grouped[player]) grouped[player] = [];
      grouped[player].push({
        distretto: row.distretto?.nome || '—',
        trattamento: row.trattamento?.nome || '—',
        sigla: row.sigla || '',
        note: row.note || ''
      });
    });

    streamTerapiePDF(res, dayISO, grouped);

  } catch (err) {
    console.error('Errore export by-date:', err);
    res.status(500).send('Errore durante la generazione del PDF');
  }
});
// Copia una terapia con data odierna
app.post('/terapie/copia/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).send('ID non valido');

  // data odierna in timezone locale (YYYY-MM-DD)
  const todayLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

  try {
    // prendo i dati originali
    const { data: orig, error: e1 } = await supabase
      .from('terapie')
      .select('anagrafica_id, distretto_id, trattamento_id, sigla, note') // aggiungi altri campi se servono
      .eq('id', id)
      .single();

    if (e1) throw e1;
    if (!orig) return res.status(404).send('Terapia non trovata');

    // payload da inserire con data di oggi
    const payload = {
      anagrafica_id:  orig.anagrafica_id,
      distretto_id:   orig.distretto_id,
      trattamento_id: orig.trattamento_id,
      sigla:          orig.sigla || null,
      note:           orig.note || null,
      data_trattamento: todayLocal,
      // Se nel tuo schema esiste una colonna "operatore", puoi valorizzarla:
      operatore: req.session.user
    };

    const { error: e2 } = await supabase.from('terapie').insert(payload);
    if (e2) throw e2;

    res.sendStatus(200);
  } catch (err) {
    console.error('Errore copia terapia:', err);
    res.status(500).send('Errore durante la copia');
  }
});
/////////////////////////reportistica

app.get('/reportistica', async (req, res) => {
  if (!req.session.user) return res.redirect('/');

  // data selezionata (default oggi, nel formato YYYY-MM-DD locale)
  const todayLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString().slice(0,10);
  const giorno = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
    ? req.query.date
    : todayLocal;

  try {
    const [{ data: anagrafiche }, { data: distretti }] = await Promise.all([
      supabase.from('anagrafica').select('id, nome, cognome').order('cognome').order('nome'),
      supabase.from('distretti').select('id, nome').order('nome')
    ]);

    const { data: rows = [] } = await supabase
      .from('report_sigle')
      .select('anagrafica_id, distretto_id, sigla')
      .eq('data', giorno);

    const sigleMap = {};
    rows.forEach(r => { sigleMap[`${r.anagrafica_id}|${r.distretto_id}`] = r.sigla || ''; });

    return res.render('layout', {
      page: 'reportistica_content',
      anagrafiche: anagrafiche || [],
      distretti: distretti || [],
      sigleMap,
      giorno
    });
  } catch (err) {
    console.error('Errore /reportistica:', err);
    return res.render('layout', {
      page: 'reportistica_content',
      anagrafiche: [], distretti: [], sigleMap: {}, giorno: todayLocal
    });
  }
});

app.post('/api/reportistica/upsert', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');

  let { date, anagrafica_id, distretto_id, sigla } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).send('Data non valida');
  anagrafica_id = parseInt(anagrafica_id, 10);
  distretto_id  = parseInt(distretto_id, 10);
  if (!Number.isInteger(anagrafica_id) || !Number.isInteger(distretto_id))
    return res.status(400).send('ID non validi');

  sigla = (sigla && typeof sigla === 'string' && sigla.trim()) ? sigla.trim() : null;
  const operatore = req.session.user;

  try {
    if (sigla === null) {
      // svuota = delete
      const { error } = await supabase
        .from('report_sigle')
        .delete()
        .eq('data', date)
        .eq('anagrafica_id', anagrafica_id)
        .eq('distretto_id', distretto_id);
      if (error) throw error;
    } else {
      // upsert con vincolo unico
      const { error } = await supabase
        .from('report_sigle')
        .upsert([{
          data: date,
          anagrafica_id,
          distretto_id,
          sigla,
          operatore,
          updated_at: new Date().toISOString()
        }], { onConflict: 'data,anagrafica_id,distretto_id' });
      if (error) throw error;
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Errore upsert reportistica:', err);
    res.status(500).send('Errore salvataggio');
  }
});

app.post('/api/reportistica/copia', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');
  const to_date = req.body?.to_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to_date || '')) return res.status(400).send('Data target non valida');

  // calcola "ieri"
  const dt = new Date(to_date + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() - 1);
  const from_date = dt.toISOString().slice(0,10);

  try {
    // prendo i valori di ieri
    const { data: yesterday = [], error: e1 } = await supabase
      .from('report_sigle')
      .select('anagrafica_id, distretto_id, sigla')
      .eq('data', from_date);
    if (e1) throw e1;

    // prendo già presenti per oggi
    const { data: today = [], error: e2 } = await supabase
      .from('report_sigle')
      .select('anagrafica_id, distretto_id')
      .eq('data', to_date);
    if (e2) throw e2;

    const existing = new Set((today || []).map(r => `${r.anagrafica_id}|${r.distretto_id}`));

    const rows = [];
    yesterday.forEach(r => {
      const key = `${r.anagrafica_id}|${r.distretto_id}`;
      if (!existing.has(key) && r.sigla) {
        rows.push({
          data: to_date,
          anagrafica_id: r.anagrafica_id,
          distretto_id:  r.distretto_id,
          sigla:         r.sigla,
          operatore:     req.session.user,
          updated_at:    new Date().toISOString()
        });
      }
    });

    if (rows.length) {
      const { error: e3 } = await supabase
        .from('report_sigle')
        .upsert(rows, { onConflict: 'data,anagrafica_id,distretto_id', ignoreDuplicates: true });
      if (e3) throw e3;
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('Errore copia reportistica:', err);
    res.status(500).send('Errore copia');
  }
});

app.get('/reportistica/export', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');

  const { from, to } = req.query || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || ''))
    return res.status(400).send('Intervallo non valido');

  const fromDate = new Date(from + 'T00:00:00Z');
  const toDate   = new Date(to   + 'T00:00:00Z');
  if (fromDate > toDate) return res.status(400).send('Intervallo invertito');

  try {
    // carico righe e colonne fisse
    const [{ data: anagrafiche }, { data: distretti }] = await Promise.all([
      supabase.from('anagrafica').select('id, nome, cognome').order('cognome').order('nome'),
      supabase.from('distretti').select('id, nome').order('nome')
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Fisio Catania';
    workbook.created = new Date();

    // Palette pastello + testo scuro
    const styles = {
      D:  { fill: { type:'pattern', pattern:'solid', fgColor:{argb:'D1E7DD'} }, font:{ bold:true, color:{argb:'0F5132'} } },
      DG: { fill: { type:'pattern', pattern:'solid', fgColor:{argb:'D1E7DD'} }, font:{ bold:true, color:{argb:'0F5132'} } },
      I:  { fill: { type:'pattern', pattern:'solid', fgColor:{argb:'F8D7DA'} }, font:{ bold:true, color:{argb:'842029'} } },
      DV: { fill: { type:'pattern', pattern:'solid', fgColor:{argb:'FFF3CD'} }, font:{ bold:true, color:{argb:'664D03'} } },
      header: { fill:{ type:'pattern', pattern:'solid', fgColor:{argb:'6C757D'} }, font:{ bold:true, color:{argb:'FFFFFF'} } },
      colA:   { fill:{ type:'pattern', pattern:'solid', fgColor:{argb:'F8F9FA'} }, font:{ bold:true, color:{argb:'000000'} } }
    };

    // genera tutti i giorni
    const days = [];
    for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate()+1)) {
      days.push(new Date(d));
    }

    for (const d of days) {
      const dayISO = d.toISOString().slice(0,10);
      const { data: rows = [] } = await supabase
        .from('report_sigle')
        .select('anagrafica_id, distretto_id, sigla')
        .eq('data', dayISO);

      const map = new Map();
      rows.forEach(r => map.set(`${r.anagrafica_id}|${r.distretto_id}`, r.sigla || ''));

      const ws = workbook.addWorksheet(dayISO);

      // Titolo
      ws.mergeCells('A1:' + String.fromCharCode(65 + distretti.length) + '1');
      ws.getCell('A1').value = 'RESOCONTO GIORNALIERO';
      ws.getCell('A1').font = { bold: true, size: 16 };

      // Header
      ws.getCell(2,1).value = 'Calciatori';
      Object.assign(ws.getCell(2,1), { fill: styles.header.fill, font: styles.header.font });
      distretti.forEach((dist, idx) => {
        const cell = ws.getCell(2, idx+2);
        cell.value = dist.nome;
        Object.assign(cell, { fill: styles.header.fill, font: styles.header.font });
      });

      // Righe
      anagrafiche.forEach((a, rIdx) => {
        const rowNum = rIdx + 3;
        const cA = ws.getCell(rowNum, 1);
        cA.value = `${a.cognome} ${a.nome}`;
        Object.assign(cA, { fill: styles.colA.fill, font: styles.colA.font });

        distretti.forEach((dist, cIdx) => {
          const cell = ws.getCell(rowNum, cIdx+2);
          const val = map.get(`${a.id}|${dist.id}`) || '';
          cell.value = val;
          // Stile badge pastello
          if (val === 'D')        { Object.assign(cell, styles.D);  }
          else if (val === 'D (GRADUALE)') { Object.assign(cell, styles.DG); }
          else if (val === 'I')   { Object.assign(cell, styles.I);  }
          else if (val === 'DV')  { Object.assign(cell, styles.DV); }
        });
      });

      // Colonne responsive
      ws.getColumn(1).width = 28;
      for (let i=2; i<=distretti.length+1; i++) ws.getColumn(i).width = 14;

      // Freeze prima riga e prima colonna
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];
    }

    // stream al client
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=report_${from}_to_${to}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Errore export Excel:', err);
    res.status(500).send('Errore export Excel');
  }
});


// =============================
//  FASCICOLI -> EXPORT RANGE
// =============================
app.get('/fascicoli/:id/export-range', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Non autorizzato');

  const id = parseInt(req.params.id, 10);
  const { from, to } = req.query || {};
  if (!Number.isInteger(id)) return res.status(400).send('ID non valido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || ''))
    return res.status(400).send('Intervallo date non valido');

  try {
    // 1) Dati giocatore
    const { data: anag, error: errA } = await supabase
      .from('anagrafica')
      .select('id, nome, cognome')
      .eq('id', id).single();
    if (errA || !anag) throw errA || new Error('Anagrafica non trovata');

    // 2) Terapie nel range
    const { data: rows, error: errT } = await supabase
      .from('terapie')
      .select(`
        data_trattamento,
        sigla,
        note,
        distretti:distretto_id ( nome ),
        trattamenti:trattamento_id ( nome )
      `)
      .eq('anagrafica_id', id)
      .gte('data_trattamento', from)
      .lte('data_trattamento', to)
      .order('data_trattamento', { ascending: true });
    if (errT) throw errT;

    // Group by giorno
    const byDay = rows.reduce((acc, r) => {
      const d = String(r.data_trattamento).slice(0,10);
      (acc[d] ||= []).push({
        distretto:     r.distretti?.nome || '—',
        trattamento:   r.trattamenti?.nome || '—',
        sigla:         r.sigla || '',
        note:          r.note || '—'
      });
      return acc;
    }, {});

    // 3) PDF “pro” con header + logo + legenda + tabelle
// 3) PDF “pro” con header + logo + legenda + tabelle
const PDFDocument = require('pdfkit');

const PAGE_MARGIN   = 40;
const LOGO_W        = 90;             // larghezza logo
const LOGO_BLOCK_H  = 140;            // altezza riservata al blocco logo
const LEGEND_ROW_H  = 18;             // altezza dei badge in legenda

const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', autoFirstPage: false });

res.setHeader('Content-Type', 'application/pdf');
res.setHeader(
  'Content-Disposition',
  `attachment; filename="${anag.cognome}_${anag.nome}_terapie_${from}_to_${to}.pdf"`
);
doc.pipe(res);

// Utilità sicure anche prima della prima pagina
const W = () => (doc.page ? doc.page.width  : 595.28);  // A4 fallback
const H = () => (doc.page ? doc.page.height : 841.89);
const M = PAGE_MARGIN;

const colors = {
  header: '#1F2937',
  line:   '#e5e7eb',
  text:   '#111827',
  badge: {
    D:  { bg:'#D1E7DD', fg:'#0F5132', label:'D' },
    DG: { bg:'#D1E7DD', fg:'#0F5132', label:'D (GRADUALE)' },
    I:  { bg:'#F8D7DA', fg:'#842029', label:'I' },
    DV: { bg:'#FFF3CD', fg:'#664D03', label:'DV' }
  }
};

// dove iniziano testi/legenda, a destra del logo
const HEADER_TEXT_X = M + LOGO_W + 12;

function addPage() {
  doc.addPage({ margin: PAGE_MARGIN });
  let y = M;

  // Logo
  const logoPath = require('path').join(__dirname, 'public', 'images', 'Logo_CATANIA_FC.svg.png');
  try { doc.image(logoPath, M, y, { width: LOGO_W }); } catch (_) {}

  // Titoli a destra del logo
  doc.font('Helvetica-Bold').fontSize(14).fillColor(colors.header)
     .text('CATANIA FC – STAFF MEDICO', HEADER_TEXT_X, y);
  y += 22;

  doc.font('Helvetica').fontSize(20).fillColor('black')
     .text(`Fascicolo terapie – ${anag.nome} ${anag.cognome}`, HEADER_TEXT_X, y);
  y += 22;

  // (opzionale) periodo
  doc.font('Helvetica').fontSize(11).fillColor(colors.text)
     .text(`Periodo: ${from} → ${to}`, HEADER_TEXT_X, y);
  y += 18;

  // Divider sotto al logo: parte dopo LOGO_BLOCK_H
  const dividerY = Math.max(y, M + LOGO_BLOCK_H);
  doc.moveTo(M, dividerY).lineTo(W() - M, dividerY)
     .strokeColor(colors.line).lineWidth(1).stroke();
  y = dividerY + 12;

  // Legenda (badge + descrizione) a destra del logo
  let x = HEADER_TEXT_X;

  function legendItem(label, spec, text) {
    const padX = 6, padY = 3;
    doc.font('Helvetica-Bold').fontSize(10);
    const wBadge = doc.widthOfString(label) + padX * 2;
    doc.roundedRect(x, y, wBadge, LEGEND_ROW_H, 4).fillColor(spec.bg).fill();
    doc.fillColor(spec.fg).text(label, x + padX, y + padY);
    x += wBadge + 6;

    // descrizione a fianco
    doc.font('Helvetica').fillColor(colors.text);
    const wText = doc.widthOfString(text);
    doc.text(text, x, y + 4);
    x += wText + 16;

    // wrap se non ci sta (non dovrebbe servire con 4 elementi, ma sicuro)
    if (x > W() - M - 100) {
      x = HEADER_TEXT_X;
      y += LEGEND_ROW_H + 6;
    }
  }

  legendItem('D',               colors.badge.D,  'Disponibile');
  legendItem('D (GRADUALE)',    colors.badge.DG, 'Disponibilità graduale');
  legendItem('DV',              colors.badge.DV, 'Da valutare');
  legendItem('I',               colors.badge.I,  'Indisponibile');

  // spazio sotto la legenda
  y += LEGEND_ROW_H + 10;

  return y;
}

function ensureSpace(needed, yRef) {
  if (yRef + needed > H() - M) return addPage();
  return yRef;
}

// badge centrato verticalmente nella cella
function drawStatusCell(x, y, text, rowH) {
  const map = {
    'D': colors.badge.D,
    'D (GRADUALE)': colors.badge.DG,
    'I': colors.badge.I,
    'DV': colors.badge.DV
  };
  const spec = map[text];

  if (!spec || !text) {
    doc.fillColor('#6b7280').font('Helvetica').fontSize(10)
       .text('—', x, y + Math.max(4, Math.floor((rowH - 10)/2)));
    doc.fillColor(colors.text);
    return;
  }

  doc.font('Helvetica-Bold').fontSize(10);
  const pillH = 16;
  const w = doc.widthOfString(text) + 12;
  const top = y + Math.max(3, Math.floor((rowH - pillH)/2));

  doc.roundedRect(x, top, w, pillH, 4).fillColor(spec.bg).fill();
  doc.fillColor(spec.fg).text(text, x + 6, top + 3);

  // reset
  doc.fillColor(colors.text).font('Helvetica').fontSize(10);
}

// === Prima pagina
let y = addPage();

const days = Object.keys(byDay).sort();

if (!days.length) {
  y = ensureSpace(30, y);
  doc.font('Helvetica').fontSize(12).fillColor(colors.text)
     .text(`Nessuna terapia tra ${from} e ${to}.`, M, y);
} else {
  // Definizione colonne tabella
  const cols = [
    { title: 'Distretto',   w: 140 },
    { title: 'Trattamento', w: 160 },
    { title: 'Stato',       w: 90  },
    { title: 'Note',        w: W() - M*2 - (140 + 160 + 90) }
  ];
  const padX = 6, padY = 6;

  for (const day of days) {
    const rows = byDay[day];

    // header giorno
   // header giorno — più spazio sotto la data
y = ensureSpace(30, y);
doc.font('Helvetica-Bold').fontSize(13).fillColor(colors.header).text(day, M, y);

// calcolo l'altezza effettiva della riga data e aggiungo margine extra
const dayH = doc.heightOfString(day, { width: W() - M * 2 });
const DAY_GAP = 10;            // margine extra sotto la data (regolabile)
y += dayH + DAY_GAP;

doc.fillColor(colors.text);


    // header tabella
    y = ensureSpace(28, y);
    let x = M;
    doc.font('Helvetica-Bold').fontSize(10);
    cols.forEach(c => {
      doc.rect(x, y, c.w, 20).fillColor('#f3f4f6').fill();
      doc.fillColor(colors.text).text(c.title, x + padX, y + 6);
      x += c.w;
    });
    y += 20;
    doc.fillColor(colors.text).font('Helvetica').fontSize(10);

    // righe con altezza dinamica
    for (const r of rows) {
      // misura dei testi con wrapping
      doc.font('Helvetica').fontSize(10);
      const hDist = doc.heightOfString(r.distretto || '—',   { width: cols[0].w - padX*2 });
      const hTr   = doc.heightOfString(r.trattamento || '—', { width: cols[1].w - padX*2 });
      const hNote = doc.heightOfString(r.note || '—',        { width: cols[3].w - padX*2 });

      const contentH = Math.max(hDist, hTr, hNote, 16); // almeno quanto il badge
      const rowH = Math.max(22, contentH + padY*2);

      y = ensureSpace(rowH, y);
      let cx = M;

      // Distretto
      doc.rect(cx, y, cols[0].w, rowH).strokeColor(colors.line).stroke();
      doc.text(r.distretto || '—', cx + padX, y + padY, { width: cols[0].w - padX*2 });
      cx += cols[0].w;

      // Trattamento
      doc.rect(cx, y, cols[1].w, rowH).stroke();
      doc.text(r.trattamento || '—', cx + padX, y + padY, { width: cols[1].w - padX*2 });
      cx += cols[1].w;

      // Stato (badge)
      doc.rect(cx, y, cols[2].w, rowH).stroke();
      drawStatusCell(cx + padX, y, r.sigla, rowH);
      cx += cols[2].w;

      // Note
      doc.rect(cx, y, cols[3].w, rowH).stroke();
      doc.text(r.note || '—', cx + padX, y + padY, { width: cols[3].w - padX*2 });

      y += rowH;
    }

    // spazio tra giornate
    y += 10;
  }
}

doc.end();


  } catch (err) {
    console.error('Export fascicolo range:', err);
    res.status(500).send('Errore durante la generazione del PDF');
  }
});


// Avvio server
app.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});
