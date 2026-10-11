// TransfertActif — téléphone de l'élève (émetteur).
'use strict';

const $ = (id) => document.getElementById(id);
const ETAPES = ['etape-code', 'etape-animal', 'etape-choisir', 'etape-envoyer', 'etape-resultat'];
const COTE_MAX = 2000; // px : une photo de 12 Mpx devient ~0,5 Mo, assez pour projeter.

const etat = {
  code: null,
  pair: null,
  conn: null,
  animal: null,
  pause: false,
  pret: null,       // { id, nom, mime, donnees, apercu }
  attente: null,    // { id, minuterie }
};

function montrer(id) {
  ETAPES.forEach((e) => { $(e).hidden = e !== id; });
  const titre = $(id).querySelector('h2');
  if (titre) { titre.tabIndex = -1; titre.focus({ preventScroll: false }); }
}

function majEtat(texte, classe) {
  const e = $('etat');
  e.textContent = texte;
  e.className = 'pastille ' + (classe || '');
}

function memoire(cle, valeur) {
  try {
    if (valeur === undefined) return JSON.parse(sessionStorage.getItem(cle));
    sessionStorage.setItem(cle, JSON.stringify(valeur));
  } catch (_) { return null; }
}

// ---------- Connexion à l'écran ----------

function rejoindre(code) {
  etat.code = code;
  majEtat('⏳ Connexion…');
  if (etat.pair) etat.pair.destroy();
  const pair = new Peer(TRANSFERT.OPTIONS_PAIR);
  etat.pair = pair;

  pair.on('open', connecterEcran);
  pair.on('error', (err) => {
    majEtat('🔴 Hors ligne', 'ko');
    afficherErreur(TRANSFERT.erreurLisible(err));
  });
}

function connecterEcran() {
  const conn = etat.pair.connect(TRANSFERT.idPair(etat.code), { reliable: true, serialization: 'binary' });
  etat.conn = conn;
  const minuterie = setTimeout(() => {
    if (!conn.open) afficherErreur(TRANSFERT.erreurLisible({ type: 'webrtc' }));
  }, 15000);

  conn.on('open', () => {
    clearTimeout(minuterie);
    majEtat('🟢 Connecté', 'ok');
    if (etat.animal) {
      conn.send({ type: 'bonjour', animal: etat.animal });
      if (!$('etape-code').hidden || !$('etape-animal').hidden || ETAPES.every((e) => $(e).hidden)) montrer('etape-choisir');
    } else {
      montrer('etape-animal');
    }
  });
  conn.on('data', recevoir);
  conn.on('close', () => majEtat('🟠 Déconnecté', 'ko'));
}

function afficherErreur(texte) {
  $('resultat').innerHTML = '<span class="emoji" aria-hidden="true">😕</span><span class="erreur"></span>';
  $('resultat').lastChild.textContent = texte;
  $('btn-autre').innerHTML = '<span class="emoji" aria-hidden="true">🔄</span> Réessayer';
  $('btn-autre').onclick = () => location.reload();
  montrer('etape-resultat');
}

function recevoir(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'etat') {
    etat.pause = !!msg.pause;
    $('btn-envoyer').disabled = etat.pause;
    majEtat(etat.pause ? '⏸️ Envois en pause' : '🟢 Connecté', etat.pause ? '' : 'ok');
  } else if (msg.type === 'recu' || msg.type === 'refuse') {
    if (!etat.attente || etat.attente.id !== msg.id) return;
    clearTimeout(etat.attente.minuterie);
    etat.attente = null;
    if (msg.type === 'recu') resultat('✅', 'Bien reçu sur l\'écran !', 'Bien reçu.');
    else if (msg.raison === 'pause') resultat('⏸️', 'L\'enseignant a mis les envois en pause. Attends un peu.', 'Les envois sont en pause. Attends un peu.');
    else resultat('⚠️', 'Le fichier est trop lourd.', 'Le fichier est trop lourd.');
  } else if (msg.type === 'document') {
    ajouterDocument(msg);
  }
}

// ---------- Étape 1 : animal ----------

function dessinerAnimaux() {
  const grille = $('animaux');
  grille.textContent = '';
  TRANSFERT.ANIMAUX.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'animal';
    b.setAttribute('aria-pressed', String(!!etat.animal && etat.animal[1] === a[1]));
    b.innerHTML = '<span class="emoji" aria-hidden="true"></span><span></span>';
    b.firstChild.textContent = a[0];
    b.lastChild.textContent = a[1];
    b.onclick = () => {
      etat.animal = a;
      memoire('transfertactif-animal-' + etat.code, a);
      if (etat.conn && etat.conn.open) etat.conn.send({ type: 'bonjour', animal: a });
      dessinerAnimaux();
      montrer('etape-choisir');
    };
    grille.append(b);
  });
}

// ---------- Étape 2 : préparer le fichier ----------

// Ré-encode la photo : allège l'envoi ET supprime les métadonnées EXIF (dont la position GPS).
async function preparerImage(fichier) {
  const bitmap = await createImageBitmap(fichier);
  const echelle = Math.min(1, COTE_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * echelle);
  canvas.height = Math.round(bitmap.height * echelle);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close && bitmap.close();
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
  if (!blob) throw new Error('encodage');
  return blob;
}

async function preparer(fichier) {
  if (!fichier) return;
  let blob = fichier;
  let nom = fichier.name || 'photo.jpg';
  const recodable = /^image\/(jpeg|png|webp|heic|heif)$/.test(fichier.type) || (!fichier.type && /\.(jpe?g|png|heic)$/i.test(nom));
  if (recodable) {
    try {
      blob = await preparerImage(fichier);
      nom = nom.replace(/\.[^.]+$/, '') + '.jpg';
    } catch (_) { blob = fichier; } // format non décodable : envoyé tel quel
  }
  if (blob.size > TRANSFERT.TAILLE_MAX) {
    resultat('⚠️', 'Ce fichier est trop lourd (' + TRANSFERT.taille(blob.size) + '). Maximum : ' + TRANSFERT.taille(TRANSFERT.TAILLE_MAX) + '.', 'Ce fichier est trop lourd.');
    return;
  }
  if (etat.pret) URL.revokeObjectURL(etat.pret.apercu);
  etat.pret = {
    id: crypto.randomUUID(),
    nom,
    mime: blob.type || 'application/octet-stream',
    donnees: await blob.arrayBuffer(),
    apercu: URL.createObjectURL(blob),
  };

  const apercu = $('apercu');
  apercu.textContent = '';
  if (etat.pret.mime.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = etat.pret.apercu;
    img.alt = 'Aperçu de ta photo';
    apercu.append(img);
  } else {
    const d = document.createElement('div');
    d.className = 'fichier';
    d.textContent = '📎 ' + nom + ' (' + TRANSFERT.taille(blob.size) + ')';
    apercu.append(d);
  }
  $('btn-envoyer').disabled = etat.pause;
  montrer('etape-envoyer');
}

// ---------- Étape 3 : envoyer ----------

function envoyer() {
  const p = etat.pret;
  if (!p) return;
  if (!etat.conn || !etat.conn.open) {
    resultat('🔌', 'La connexion avec l\'écran est coupée. Rescanne le QR code.', 'La connexion est coupée.');
    return;
  }
  $('btn-envoyer').disabled = true;
  $('btn-envoyer').innerHTML = '<span class="emoji" aria-hidden="true">⏳</span> Envoi en cours…';
  etat.conn.send({ type: 'fichier', id: p.id, nom: p.nom, mime: p.mime, donnees: p.donnees, animal: etat.animal });
  etat.attente = {
    id: p.id,
    minuterie: setTimeout(() => {
      etat.attente = null;
      resultat('⌛', 'Pas de réponse de l\'écran. Réessaie.', 'Pas de réponse de l\'écran.');
    }, 90000),
  };
}

function resultat(emoji, texte, aLire) {
  $('resultat').innerHTML = '<span class="emoji" aria-hidden="true"></span><span></span>';
  $('resultat').firstChild.textContent = emoji;
  $('resultat').lastChild.textContent = texte;
  $('btn-envoyer').innerHTML = '<span class="emoji" aria-hidden="true">🕊️</span> Envoyer';
  $('btn-autre').innerHTML = '<span class="emoji" aria-hidden="true">📷</span> Envoyer autre chose';
  $('btn-autre').onclick = () => montrer('etape-choisir');
  montrer('etape-resultat');
  if (aLire) TRANSFERT.parler(aLire);
}

// ---------- Documents distribués par l'enseignant ----------

function ajouterDocument(msg) {
  if (!msg.donnees || !msg.donnees.byteLength || msg.donnees.byteLength > TRANSFERT.TAILLE_MAX) return;
  const blob = new Blob([msg.donnees], { type: typeof msg.mime === 'string' ? msg.mime : 'application/octet-stream' });
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'bouton';
  a.href = URL.createObjectURL(blob);
  a.download = String(msg.nom || 'document').slice(0, 120);
  a.textContent = '📄 ' + a.download;
  li.append(a);
  $('liste-documents').prepend(li);
  $('documents').hidden = false;
  TRANSFERT.parler('L\'enseignant t\'a envoyé un document.');
}

// ---------- Démarrage ----------

document.querySelectorAll('[data-lire]').forEach((b) => { b.onclick = () => TRANSFERT.parler(b.dataset.lire); });

$('btn-code').onclick = () => {
  const code = TRANSFERT.normaliserCode($('champ-code').value);
  if (code.length !== 5) { $('champ-code').focus(); return; }
  location.hash = code;
  demarrer();
};
$('champ-code').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('btn-code').click(); });
$('photo').onchange = (ev) => { preparer(ev.target.files[0]); ev.target.value = ''; };
$('fichier').onchange = (ev) => { preparer(ev.target.files[0]); ev.target.value = ''; };
$('btn-envoyer').onclick = envoyer;
$('btn-recommencer').onclick = () => montrer('etape-choisir');
$('btn-changer-animal').onclick = () => { dessinerAnimaux(); montrer('etape-animal'); };
$('btn-autre').onclick = () => montrer('etape-choisir');

function demarrer() {
  const code = TRANSFERT.normaliserCode(location.hash.slice(1));
  if (code.length !== 5) {
    majEtat('🔑 Code ?');
    montrer('etape-code');
    return;
  }
  etat.animal = memoire('transfertactif-animal-' + code);
  if (!TRANSFERT.ANIMAUX.some((a) => etat.animal && a[1] === etat.animal[1])) etat.animal = null;
  ETAPES.forEach((e) => { $(e).hidden = true; });
  dessinerAnimaux();
  rejoindre(code);
}

demarrer();
