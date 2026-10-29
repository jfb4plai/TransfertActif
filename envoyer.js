// TransfertActif — téléphone de l'élève (émetteur).
'use strict';

const $ = (id) => document.getElementById(id);
const ETAPES = ['etape-code', 'etape-animal', 'etape-choisir', 'etape-envoyer', 'etape-resultat'];
const COTE_MAX = 2000; // px : une photo de 12 Mpx devient ~0,5 Mo, assez pour projeter.

const etat = {
  code: null,
  pair: null,
  conn: null,
  animal: null,     // identité [emoji, texte] : un animal ou un code (voir TRANSFERT.identite)
  prof: new URLSearchParams(location.search).has('prof'), // smartphone de l'enseignant : choix animal/code, élève suivant
  modeEcran: 'animaux', // mode demandé par l'écran de la classe
  modeLocal: 'animaux', // mode choisi sur ce téléphone (enseignant seulement)
  pris: [],             // identités déjà portées par d'autres élèves (clés TRANSFERT.cle)
  doublons: false,      // l'enseignant autorise deux élèves sur la même identité
  client: null,         // identifiant stable de ce téléphone, conservé au rechargement de la page
  modeChoisi: false,    // l'enseignant a basculé lui-même : on ne suit plus l'écran
  pause: false,
  pret: null,       // { id, nom, mime, donnees, apercu }
  attente: null,    // { id, minuterie }
  reconnexion: null, // { ok, ko } pendant une reconnexion automatique
  flux: null,       // flux vidéo de l'appareil photo dans la page
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

function bonjour() {
  return { type: 'bonjour', animal: etat.animal, client: etat.client, prof: etat.prof };
}

function rejoindre(code) {
  etat.code = code;
  majEtat('⏳ Connexion…');
  if (etat.pair) etat.pair.destroy();
  const pair = new Peer(TRANSFERT.OPTIONS_PAIR);
  etat.pair = pair;

  pair.on('open', connecterEcran);
  pair.on('error', (err) => {
    majEtat('🔴 Hors ligne', 'ko');
    if (etat.reconnexion) { etat.reconnexion.ko(err); return; }
    afficherErreur(TRANSFERT.erreurLisible(err));
  });
}

function connecterEcran() {
  const conn = etat.pair.connect(TRANSFERT.idPair(etat.code), { reliable: true, serialization: 'binary' });
  etat.conn = conn;
  const minuterie = setTimeout(() => {
    if (conn.open) return;
    if (etat.reconnexion) etat.reconnexion.ko({ type: 'webrtc' });
    else afficherErreur(TRANSFERT.erreurLisible({ type: 'webrtc' }));
  }, 15000);

  conn.on('open', () => {
    clearTimeout(minuterie);
    majEtat('🟢 Connecté', 'ok');
    if (etat.reconnexion) { // reconnexion silencieuse : on reste à l'étape en cours
      if (etat.animal) conn.send(bonjour());
      etat.reconnexion.ok();
      return;
    }
    if (etat.animal) {
      conn.send(bonjour());
      if (!$('etape-code').hidden || !$('etape-animal').hidden || ETAPES.every((e) => $(e).hidden)) montrer('etape-choisir');
    } else {
      montrer('etape-animal');
    }
  });
  conn.on('data', recevoir);
  conn.on('close', () => majEtat('🟠 Déconnecté', 'ko'));
}

// Signe de vie vers l'écran : sans lui, l'écran libère l'identité de ce téléphone au bout de 30 s.
setInterval(() => { if (etat.conn && etat.conn.open) etat.conn.send({ type: 'ping' }); }, 5000);

// Le téléphone coupe souvent la connexion quand l'élève quitte la page (appareil photo, verrouillage) :
// on la rétablit sans perdre la photo préparée.
function assurerConnexion() {
  if (etat.conn && etat.conn.open) return Promise.resolve();
  if (etat.reconnexion) return etat.reconnexion.promesse;
  let ok, ko;
  const promesse = new Promise((a, b) => { ok = a; ko = b; });
  const fin = () => { clearTimeout(minuterie); etat.reconnexion = null; };
  const minuterie = setTimeout(() => ko({ type: 'webrtc' }), 20000);
  etat.reconnexion = { promesse, ok: () => { fin(); ok(); }, ko: (e) => { fin(); ko(e); } };
  majEtat('⏳ Reconnexion…');
  if (etat.pair && !etat.pair.destroyed && !etat.pair.disconnected) connecterEcran();
  else rejoindre(etat.code);
  return promesse;
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
    const mode = msg.mode === 'codes' ? 'codes' : 'animaux';
    etat.doublons = !!msg.doublons;
    etat.pris = Array.isArray(msg.pris) ? msg.pris.filter((x) => typeof x === 'string') : [];
    if (!$('etape-animal').hidden && modeIdentification() === 'animaux') dessinerAnimaux();
    if (mode !== etat.modeEcran) {
      etat.modeEcran = mode;
      if (etat.prof && !etat.modeChoisi) etat.modeLocal = mode;
      if (!$('etape-animal').hidden) dessinerIdentification();
    } else if (etat.prof && !etat.modeChoisi && etat.modeLocal !== mode) {
      etat.modeLocal = mode;
      if (!$('etape-animal').hidden) dessinerIdentification();
    }
  } else if (msg.type === 'recu' || msg.type === 'refuse') {
    if (!etat.attente || etat.attente.id !== msg.id) return;
    clearTimeout(etat.attente.minuterie);
    etat.attente = null;
    if (msg.type === 'recu') resultat('✅', 'Bien reçu sur l\'écran !', 'Bien reçu.');
    else if (msg.raison === 'pause') resultat('⏸️', 'L\'enseignant a mis les envois en pause. Attends un peu.', 'Les envois sont en pause. Attends un peu.');
    else resultat('⚠️', 'Le fichier est trop lourd.', 'Le fichier est trop lourd.');
  } else if (msg.type === 'identite-prise') {
    // Deux élèves ont choisi la même identité presque en même temps : l'écran a gardé la première.
    etat.animal = null;
    if (!etat.prof) memoire('transfertactif-animal-' + etat.code, null);
    majIdentite();
    dessinerIdentification();
    montrer('etape-animal');
    signalerIdentitePrise();
  } else if (msg.type === 'document') {
    ajouterDocument(msg);
  }
}

// ---------- Étape 1 : s'identifier (animal ou code) ----------

function modeIdentification() { return etat.prof ? etat.modeLocal : etat.modeEcran; }

function choisirIdentite(identite) {
  etat.animal = identite;
  if (!etat.prof) memoire('transfertactif-animal-' + etat.code, identite); // l'enseignant change d'élève à chaque envoi : rien à retenir
  if (etat.conn && etat.conn.open) etat.conn.send(bonjour());
  majIdentite();
  montrer('etape-choisir');
}

function majIdentite() {
  const id = etat.animal;
  $('identite').textContent = id ? (etat.prof ? 'Élève : ' : 'Tu es : ') + id[0] + ' ' + id[1] : '';
  $('btn-changer-animal').textContent = etat.prof ? 'Changer d\'élève'
    : (id && id[0] === TRANSFERT.CODE_EMOJI ? 'Changer de code' : 'Changer d\'animal');
}

function dessinerIdentification() {
  const codes = modeIdentification() === 'codes';
  $('bascule-mode').hidden = !etat.prof;
  $('bascule-animaux').setAttribute('aria-pressed', String(!codes));
  $('bascule-codes').setAttribute('aria-pressed', String(codes));
  $('bloc-animaux').hidden = codes;
  $('bloc-code').hidden = !codes;
  const consigne = codes
    ? (etat.prof ? 'Tape le code de l\'élève' : 'Tape ton code')
    : (etat.prof ? 'Choisis l\'animal de l\'élève' : 'Choisis ton animal');
  $('titre-identification').textContent = consigne;
  $('ecouter-identification').dataset.lire = 'Étape 1. ' + consigne + '. Aucun prénom ne sera affiché.';
  if (codes) {
    $('label-pseudo').textContent = etat.prof ? 'Code de l\'élève' : 'Ton code';
    $('aide-pseudo').textContent = (etat.prof
      ? 'Code de l\'élève dont tu envoies le travail'
      : 'Tape le code donné par ton enseignant')
      + ' : lettres sans accent, chiffres ou tiret, 8 au plus. Pas de prénom : seul ce code s\'affiche à l\'écran et dans le nom du fichier.';
    $('champ-pseudo').value = etat.animal && etat.animal[0] === TRANSFERT.CODE_EMOJI ? etat.animal[1] : '';
    return;
  }
  $('msg-identite').hidden = true;
  dessinerAnimaux();
}

// Identité déjà portée par un autre élève ? Jamais pour l'enseignant, ni si les doublons sont autorisés.
function prisParUnAutre(identite) {
  if (etat.prof || etat.doublons) return false;
  if (etat.animal && TRANSFERT.cle(etat.animal) === TRANSFERT.cle(identite)) return false;
  return etat.pris.includes(TRANSFERT.cle(identite));
}

function signalerIdentitePrise() {
  const m = $('msg-identite');
  m.textContent = 'Cet animal ou ce code est déjà pris par un autre élève. Choisis-en un autre.';
  m.hidden = false;
  TRANSFERT.parler('Déjà pris. Choisis-en un autre.');
}

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
    if (prisParUnAutre(a)) {
      b.disabled = true;
      b.title = 'Déjà pris par un autre élève';
    }
    b.onclick = () => choisirIdentite(a);
    grille.append(b);
  });
}

function validerCode() {
  const code = TRANSFERT.normaliserPseudo($('champ-pseudo').value);
  if (!code) { $('champ-pseudo').focus(); return; }
  const identite = [TRANSFERT.CODE_EMOJI, code];
  if (prisParUnAutre(identite)) { signalerIdentitePrise(); $('champ-pseudo').focus(); return; }
  choisirIdentite(identite);
}

// Enseignant : élève suivant = on oublie l'identité, pour ne jamais attribuer un envoi au mauvais élève.
function eleveSuivant() {
  etat.animal = null;
  majIdentite();
  dessinerIdentification();
  montrer('etape-animal');
}

// ---------- Étape 2 : préparer le fichier ----------

// Ré-encode la photo : allège l'envoi ET supprime les métadonnées EXIF (dont la position GPS).
// createImageBitmap n'accepte un fichier qu'à partir de Safari 15 : repli sur un élément <img>.
async function decoder(fichier) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(fichier); } catch (_) { /* repli ci-dessous */ }
  }
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('décodage')); };
    img.src = url;
  });
}

// Dessine une source (image, vidéo) réduite à COTE_MAX et l'encode en JPEG.
function versJpeg(source, largeur, hauteur) {
  const echelle = Math.min(1, COTE_MAX / Math.max(largeur, hauteur));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(largeur * echelle);
  canvas.height = Math.round(hauteur * echelle);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error('encodage'))), 'image/jpeg', 0.85));
}

async function preparerImage(fichier) {
  const image = await decoder(fichier);
  const blob = await versJpeg(image, image.naturalWidth || image.width, image.naturalHeight || image.height);
  if (image.close) image.close();
  return blob;
}

async function preparer(fichier, dejaPret) {
  if (!fichier) return;
  $('preparation').hidden = false;
  try {
    await preparerFichier(fichier, dejaPret);
  } catch (_) {
    resultat('😕', 'La photo n\'a pas pu être préparée. Réessaie, ou choisis-la avec « Choisir une photo ou un fichier ».', 'La photo n\'a pas pu être préparée. Réessaie.');
  } finally {
    $('preparation').hidden = true;
  }
}

async function preparerFichier(fichier, dejaPret) {
  let blob = fichier;
  let nom = fichier.name || 'photo.jpg';
  const recodable = !dejaPret && (/^image\/(jpeg|png|webp|heic|heif)$/.test(fichier.type) || (!fichier.type && /\.(jpe?g|png|heic)$/i.test(nom)));
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
    id: TRANSFERT.uid(),
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

async function envoyer() {
  const p = etat.pret;
  if (!p) return;
  $('btn-envoyer').disabled = true;
  if (!etat.conn || !etat.conn.open) {
    $('btn-envoyer').innerHTML = '<span class="emoji" aria-hidden="true">⏳</span> Reconnexion…';
    try {
      await assurerConnexion();
    } catch (_) {
      resultat('🔌', 'Impossible de rejoindre l\'écran. Vérifie que l\'écran de la classe est toujours ouvert, puis rescanne le QR code.', 'Impossible de rejoindre l\'écran.');
      return;
    }
  }
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
  const profOk = etat.prof && emoji === '✅';
  $('btn-meme').hidden = !profOk;
  $('btn-meme').onclick = () => montrer('etape-choisir');
  if (profOk) {
    $('btn-autre').innerHTML = '<span class="emoji" aria-hidden="true">👤</span> Élève suivant';
    $('btn-autre').onclick = eleveSuivant;
  } else {
    $('btn-autre').innerHTML = '<span class="emoji" aria-hidden="true">📷</span> Envoyer autre chose';
    $('btn-autre').onclick = () => montrer('etape-choisir');
  }
  montrer('etape-resultat');
  if (aLire) TRANSFERT.parler(aLire);
}

// ---------- Appareil photo dans la page ----------
// L'élève ne quitte pas la page : la connexion avec l'écran n'est pas coupée
// et Android ne risque pas de fermer l'onglet pendant la prise de vue.

async function ouvrirCamera() {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) { basculerCameraNative(); $('photo').click(); return; }
  try {
    etat.flux = await md.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (_) {
    // Refus d'accès ou caméra indisponible : on propose l'appareil photo du téléphone.
    basculerCameraNative();
    resultat('📷', 'La caméra n\'est pas accessible dans la page. Appuie sur « Ouvrir l\'appareil photo ».', 'Appuie sur Ouvrir l\'appareil photo.');
    $('btn-autre').innerHTML = '<span class="emoji" aria-hidden="true">↩️</span> Revenir';
    return;
  }
  const video = $('video');
  video.srcObject = etat.flux;
  $('camera').hidden = false;
  try { await video.play(); } catch (_) { /* autoplay muet : la lecture démarre seule */ }
  $('btn-declencher').focus();
}

function fermerCamera() {
  if (etat.flux) etat.flux.getTracks().forEach((t) => t.stop());
  etat.flux = null;
  $('video').srcObject = null;
  $('camera').hidden = true;
}

async function declencher() {
  const video = $('video');
  if (!video.videoWidth) return; // image pas encore prête
  let blob;
  try {
    blob = await versJpeg(video, video.videoWidth, video.videoHeight);
  } catch (_) {
    fermerCamera();
    resultat('😕', 'La photo n\'a pas pu être prise. Réessaie.', 'La photo n\'a pas pu être prise.');
    return;
  }
  fermerCamera();
  blob.name = 'photo.jpg';
  preparer(blob, true);
}

function basculerCameraNative() {
  $('btn-camera').hidden = true;
  $('btn-camera-native').hidden = false;
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
$('btn-camera').onclick = ouvrirCamera;
$('btn-declencher').onclick = declencher;
$('btn-camera-annuler').onclick = fermerCamera;
$('photo').onchange = (ev) => { preparer(ev.target.files[0]); ev.target.value = ''; };
$('fichier').onchange = (ev) => { preparer(ev.target.files[0]); ev.target.value = ''; };
$('btn-envoyer').onclick = envoyer;
$('btn-recommencer').onclick = () => montrer('etape-choisir');
$('btn-changer-animal').onclick = () => { dessinerIdentification(); montrer('etape-animal'); };
$('bascule-animaux').onclick = () => { etat.modeLocal = 'animaux'; etat.modeChoisi = true; dessinerIdentification(); };
$('bascule-codes').onclick = () => { etat.modeLocal = 'codes'; etat.modeChoisi = true; dessinerIdentification(); };
$('btn-pseudo').onclick = validerCode;
$('champ-pseudo').addEventListener('input', (ev) => {
  const propre = TRANSFERT.normaliserPseudo(ev.target.value);
  if (propre !== ev.target.value) ev.target.value = propre;
});
$('champ-pseudo').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') validerCode(); });
$('btn-autre').onclick = () => montrer('etape-choisir');

// Retour sur la page (après l'appareil photo du téléphone, un verrouillage…) : on vérifie la connexion.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !etat.code || !$('etape-code').hidden) return;
  if (etat.conn && etat.conn.open) return;
  assurerConnexion().catch(() => majEtat('🔴 Hors ligne', 'ko'));
});

function demarrer() {
  const code = TRANSFERT.normaliserCode(location.hash.slice(1));
  if (code.length !== 5) {
    majEtat('🔑 Code ?');
    montrer('etape-code');
    return;
  }
  etat.client = memoire('transfertactif-client') || TRANSFERT.uid();
  memoire('transfertactif-client', etat.client);
  etat.animal = etat.prof ? null : TRANSFERT.identite(memoire('transfertactif-animal-' + code));
  ETAPES.forEach((e) => { $(e).hidden = true; });
  majIdentite();
  dessinerIdentification();
  rejoindre(code);
}

demarrer();
