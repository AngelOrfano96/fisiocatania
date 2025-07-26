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






const app = express();
const PORT = process.env.PORT || 3000;


const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // lato server usa la service-role key
);

function getSinceDate(period) {
  const now = new Date();
  if (period === 'week')  now.setDate(now.getDate() - 7);
  if (period === 'month') now.setMonth(now.getMonth() - 1);
  if (period === 'year')  now.setFullYear(now.getFullYear() - 1);
  return now.toISOString();
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
        id, data_trattamento, note, operatore,
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
  const since = getSinceDate(req.query.period || 'month');

  try {
    let query;
    switch(metric) {
      case 'distretti':
        query = supabase
          .from('terapie')
          .select('distretti(nome)', { count:'exact' })
          .gt('data_trattamento', since)
          .group('distretti.nome');
        break;
      case 'trattamenti':
        query = supabase
          .from('terapie')
          .select('trattamenti(nome)', { count:'exact' })
          .gt('data_trattamento', since)
          .group('trattamenti.nome');
        break;
      case 'operatori':
        query = supabase
          .from('terapie')
          .select('operatore', { count:'exact' })
          .gt('data_trattamento', since)
          .group('operatore');
        break;
      case 'giocatori':
        query = supabase
          .from('terapie')
          .select('anagrafica_id', { count:'exact' })
          .gt('data_trattamento', since)
          .group('anagrafica_id');
        break;
      default:
        return res.status(400).end();
    }

    const { data, error } = await query;
    if (error) throw error;

    const labels = data.map(r => {
      if (metric === 'giocatori') {
        // recupera nome cognome
        return r.anagrafica_id; // poi si può espandere con join
      } else if (metric === 'operatori') {
        return r.operatore;
      } else {
        // distretti.nome o trattamenti.nome
        const key = Object.keys(r).find(k=>k!=='count');
        return r[key].nome;
      }
    });

    const counts = data.map(r=>r.count);

    res.json({ labels, counts });
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// Avvio server
app.listen(PORT, () => {
  console.log(`Server in ascolto su http://localhost:${PORT}`);
});
