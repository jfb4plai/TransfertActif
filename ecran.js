// TransfertActif — écran de la classe (récepteur).
// Les fichiers arrivent en pair-à-pair (WebRTC) et ne vivent qu'en mémoire de cet onglet.
'use strict';

const $ = (id) => document.getElementById(id);

const etat = {
  code: null,
  pair: null,
  connexions: new Map(), // id connexion -> { conn, animal }
  envois: [],            // { id, nom, mime, taille, url, animal, heure }
  choisis: [],           // ids sélectionnés pour la comparaison
  coches: [],            // ids cochés pour le téléchargement (indépendant de la comparaison)
  pause: false,
  doublons: false,       // true : deux élèves peuvent porter le même animal ou code (binômes)
  mode: 'animaux',       // identification des élèves : 'animaux' (26) ou 'codes'
  projection: null,      // { mode: 'qr' } | { mode: 'un', index } | { mode: 'duo', ids }
  dernier: null,         // id du dernier envoi, seul à être animé à son arrivée
};

function toast(texte) {
  const t = $('toast');
  t.textContent = texte;
  t.hidden = false;
  clearTimeout(toast.minuterie);
  toast.minuterie = setTimeout(() => { t.hidden = true; }, 3500);
}

// prof : lien pour le smartphone de l'enseignant (choix animal/code à l'envoi, « élève suivant »).
function lienEnvoi(code, prof) {
  return new URL('envoyer.html' + (prof ? '?prof' : '') + '#' + code, location.href).href;
}

// Identités déjà portées par un élève connecté. Le smartphone de l'enseignant n'en bloque aucune.
function prises() {
  const cles = new Set();
  etat.connexions.forEach((i) => { if (i.animal && !i.prof) cles.add(TRANSFERT.cle(i.animal)); });
  return [...cles];
}

function messageEtat() {
  return { type: 'etat', pause: etat.pause, mode: etat.mode, doublons: etat.doublons, pris: prises() };
}

function diffuserEtat() {
  etat.connexions.forEach(({ conn }) => conn.open && conn.send(messageEtat()));
}

// Un autre élève (autre client, pas l'enseignant) porte-t-il déjà cette identité ?
function prisParUnAutre(identite, moi) {
  const cle = TRANSFERT.cle(identite);
  return [...etat.connexions.values()].some((i) => i !== moi && !i.prof && i.client !== moi.client && i.animal && TRANSFERT.cle(i.animal) === cle);
}

// Niveau de correction H (≈30 % récupérable) : le logo posé au centre n'empêche pas la lecture.
function qrSvg(texte) {
  const qr = qrcode(0, 'H');
  qr.addData(texte);
  qr.make();
  return '<div class="qr-logo">' + qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) +
    '<img src="logo-jfb4plai.png" alt=""></div>';
}

function majEtat(texte, classe) {
  const e = $('etat');
  e.textContent = texte;
  e.className = 'pastille ' + (classe || '');
}

function majTelephones() {
  $('nb-telephones').textContent = '📱 ' + etat.connexions.size;
}

// ---------- Mise en relation ----------

function demarrer() {
  etat.code = TRANSFERT.nouveauCode();
  const pair = new Peer(TRANSFERT.idPair(etat.code), TRANSFERT.OPTIONS_PAIR);
  etat.pair = pair;

  pair.on('open', () => {
    const lien = lienEnvoi(etat.code);
    $('qr').innerHTML = qrSvg(lien);
    $('code').textContent = etat.code;
    $('lien').textContent = lien;
    majEtat('🟢 Prêt', 'ok');
  });

  pair.on('connection', accueillir);

  pair.on('disconnected', () => {
    majEtat('🟠 Reconnexion…', 'ko');
    setTimeout(() => { if (!pair.destroyed) pair.reconnect(); }, 1500);
  });

  pair.on('error', (err) => {
    if (err.type === 'unavailable-id') { // code déjà pris : on en tire un autre
      pair.destroy();
      demarrer();
      return;
    }
    if (err.type === 'peer-unavailable') return; // concerne un téléphone parti, sans gravité
    majEtat('🔴 ' + TRANSFERT.erreurLisible(err), 'ko');
  });
}

// WebRTC ne signale pas toujours la fermeture d'un onglet : sans nouvelles depuis 30 s (les téléphones
// envoient un « ping » toutes les 5 s), on considère le téléphone parti et son identité est libérée.
setInterval(() => {
  let parti = false;
  etat.connexions.forEach((info, id) => {
    if (Date.now() - info.vu > 30000) {
      etat.connexions.delete(id);
      try { info.conn.close(); } catch (_) { /* déjà fermée */ }
      parti = true;
    }
  });
  if (parti) { majTelephones(); diffuserEtat(); }
}, 5000);

function accueillir(conn) {
  conn.on('open', () => {
    etat.connexions.set(conn.connectionId, { conn, animal: null, vu: Date.now() });
    majTelephones();
    conn.send(messageEtat());
  });
  conn.on('data', (msg) => recevoir(conn, msg));
  const fin = () => {
    etat.connexions.delete(conn.connectionId);
    majTelephones();
    diffuserEtat(); // l'identité du téléphone parti redevient disponible
  };
  conn.on('close', fin);
  conn.on('error', fin);
}

function recevoir(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  const info = etat.connexions.get(conn.connectionId);
  if (info) info.vu = Date.now();
  if (msg.type === 'ping') return;

  if (msg.type === 'bonjour') {
    if (!info) return;
    const identite = validerAnimal(msg.animal);
    // « client » est stable d'un rechargement à l'autre : un élève qui se reconnecte ne se bloque pas lui-même.
    info.client = typeof msg.client === 'string' ? msg.client.slice(0, 64) : conn.connectionId;
    info.prof = msg.prof === true;
    if (identite && !info.prof && !etat.doublons && prisParUnAutre(identite, info)) {
      info.animal = null;
      conn.send({ type: 'identite-prise' });
    } else {
      info.animal = identite;
    }
    diffuserEtat();
    return;
  }

  if (msg.type === 'fichier') {
    if (etat.pause) {
      conn.send({ type: 'refuse', id: msg.id, raison: 'pause' });
      return;
    }
    const donnees = msg.donnees;
    const taille = donnees && donnees.byteLength;
    if (!taille || taille > TRANSFERT.TAILLE_MAX) {
      conn.send({ type: 'refuse', id: msg.id, raison: 'taille' });
      return;
    }
    const mime = typeof msg.mime === 'string' ? msg.mime : 'application/octet-stream';
    const blob = new Blob([donnees], { type: mime });
    ajouterEnvoi({
      id: TRANSFERT.uid(),
      nom: String(msg.nom || 'fichier').slice(0, 120),
      mime,
      taille,
      url: URL.createObjectURL(blob),
      animal: validerAnimal(msg.animal) || (info && info.animal) || ['❔', 'Anonyme'],
      heure: new Date(),
    });
    conn.send({ type: 'recu', id: msg.id });
  }
}

// N'accepte qu'un animal de la liste ou un code (A-Z, 0-9, tiret, 8 max) : rien d'autre ne s'affiche à l'écran.
function validerAnimal(a) {
  return TRANSFERT.identite(a);
}

// ---------- Téléchargement sur l'ordinateur ----------

// Nom de fichier unique et lisible : « Renard_10h42_photo.jpg ». Les photos de téléphone s'appellent
// toutes « photo.jpg » : sans préfixe, elles s'écraseraient. Un rang est ajouté en cas de doublon.
function nomTelechargement(e, rang) {
  const propre = (s) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  const h = e.heure.getHours() + 'h' + String(e.heure.getMinutes()).padStart(2, '0');
  const base = propre(e.animal[1]) + '_' + h + '_' + propre(e.nom);
  if (!rang) return base;
  const point = base.lastIndexOf('.');
  return point > 0 ? base.slice(0, point) + '_' + rang + base.slice(point) : base + '_' + rang;
}

function nomsUniques() {
  const vus = new Map();
  return etat.envois.map((e) => {
    const base = nomTelechargement(e, 0);
    const n = (vus.get(base) || 0) + 1;
    vus.set(base, n);
    return n === 1 ? base : nomTelechargement(e, n);
  });
}

function enregistrer(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(octets) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ZIP sans compression (« stored ») : photos et PDF sont déjà compressés, le gain serait nul.
// Noms en UTF-8 (bit 11) pour conserver les accents. Limite : 4 Go, très au-dessus de 25 Mo × élèves.
function creerZip(fichiers) { // [{ nom, octets: Uint8Array }]
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let decalage = 0;
  const d = new Date();
  const heureDos = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dateDos = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

  fichiers.forEach(({ nom, octets }) => {
    const n = enc.encode(nom);
    const crc = crc32(octets);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true);
    loc.setUint16(4, 20, true);
    loc.setUint16(6, 0x0800, true);
    loc.setUint16(8, 0, true);
    loc.setUint16(10, heureDos, true);
    loc.setUint16(12, dateDos, true);
    loc.setUint32(14, crc, true);
    loc.setUint32(18, octets.length, true);
    loc.setUint32(22, octets.length, true);
    loc.setUint16(26, n.length, true);
    parts.push(loc.buffer, n, octets);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(12, heureDos, true);
    cen.setUint16(14, dateDos, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, octets.length, true);
    cen.setUint32(24, octets.length, true);
    cen.setUint16(28, n.length, true);
    cen.setUint32(42, decalage, true);
    central.push(cen.buffer, n);
    decalage += 30 + n.length + octets.length;
  });

  const tailleCentral = central.reduce((s, p) => s + (p.byteLength !== undefined ? p.byteLength : p.length), 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, fichiers.length, true);
  fin.setUint16(10, fichiers.length, true);
  fin.setUint32(12, tailleCentral, true);
  fin.setUint32(16, decalage, true);
  return new Blob([...parts, ...central, fin.buffer], { type: 'application/zip' });
}

// Télécharge les envois cochés ; si aucun n'est coché, tous les envois.
async function telecharger() {
  if (!etat.envois.length) return;
  const noms = nomsUniques(); // calculés sur tous les envois : un nom ne change pas selon la sélection
  const retenus = etat.envois
    .map((e, i) => ({ e, nom: noms[i] }))
    .filter(({ e }) => !etat.coches.length || etat.coches.includes(e.id));
  if (retenus.length === 1) { // un seul fichier : pas besoin d'archive
    enregistrer(await (await fetch(retenus[0].e.url)).blob(), retenus[0].nom);
    return;
  }
  const fichiers = await Promise.all(retenus.map(async ({ e, nom }) => ({
    nom,
    octets: new Uint8Array(await (await fetch(e.url)).arrayBuffer()),
  })));
  const j = new Date();
  const jour = j.getFullYear() + '-' + String(j.getMonth() + 1).padStart(2, '0') + '-' + String(j.getDate()).padStart(2, '0');
  enregistrer(creerZip(fichiers), 'TransfertActif_' + jour + '.zip');
  toast('💾 ' + fichiers.length + ' fichiers enregistrés dans le dossier Téléchargements.');
}

function basculerCoche(id) {
  const i = etat.coches.indexOf(id);
  if (i >= 0) etat.coches.splice(i, 1);
  else etat.coches.push(id);
  dessinerGalerie();
}

function toutCocher() {
  etat.coches = etat.coches.length === etat.envois.length ? [] : etat.envois.map((e) => e.id);
  dessinerGalerie();
}

// ---------- Galerie ----------

function estImage(e) { return e.mime.startsWith('image/'); }
function estPdf(e) { return e.mime === 'application/pdf'; }
function icone(e) {
  if (estPdf(e)) return '📄';
  if (e.mime.startsWith('video/')) return '🎬';
  if (e.mime.startsWith('audio/')) return '🎧';
  return '📎';
}
function heure(d) {
  return d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
}

function ajouterEnvoi(envoi) {
  etat.envois.push(envoi);
  etat.dernier = envoi.id;
  dessinerGalerie();
  etat.dernier = null;
  toast(envoi.animal[0] + ' ' + envoi.animal[1] + ' a envoyé « ' + envoi.nom + ' »');
}

function dessinerGalerie() {
  const g = $('galerie');
  g.textContent = '';
  etat.envois.forEach((e, index) => {
    const carte = document.createElement('article');
    carte.className = 'envoi' + (etat.choisis.includes(e.id) ? ' choisi' : '') + (e.id === etat.dernier ? ' nouveau' : '');

    const vignette = document.createElement('button');
    vignette.className = 'vignette';
    vignette.setAttribute('aria-label', 'Projeter ' + e.nom);
    if (estImage(e)) {
      const img = document.createElement('img');
      img.src = e.url;
      img.alt = '';
      vignette.append(img);
    } else {
      const span = document.createElement('span');
      span.className = 'icone';
      span.textContent = icone(e);
      vignette.append(span);
    }
    vignette.onclick = () => ouvrirProjection({ mode: 'un', index });

    const infos = document.createElement('div');
    infos.className = 'infos';
    infos.innerHTML = '<span class="pic" aria-hidden="true"></span><span class="qui"></span><span class="quand"></span>';
    infos.children[0].textContent = e.animal[0];
    infos.children[1].textContent = e.animal[1];
    infos.children[2].textContent = heure(e.heure) + ' · ' + TRANSFERT.taille(e.taille);
    infos.title = e.nom;
    const coche = document.createElement('label');
    coche.className = 'coche';
    coche.title = 'Cocher pour télécharger seulement les envois cochés';
    const case_ = document.createElement('input');
    case_.type = 'checkbox';
    case_.checked = etat.coches.includes(e.id);
    case_.setAttribute('aria-label', 'Télécharger l\'envoi de ' + e.animal[1] + ' à ' + heure(e.heure));
    case_.onchange = () => basculerCoche(e.id);
    coche.append(case_);
    infos.prepend(coche);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const choisir = document.createElement('button');
    choisir.className = 'bouton';
    choisir.textContent = etat.choisis.includes(e.id) ? '✔️ Choisi' : '⚖️ Choisir';
    choisir.setAttribute('aria-pressed', String(etat.choisis.includes(e.id)));
    choisir.onclick = () => basculerChoix(e.id);
    const telecharger = document.createElement('a');
    telecharger.className = 'bouton';
    telecharger.href = e.url;
    telecharger.download = nomsUniques()[index];
    telecharger.textContent = '💾 Enregistrer';
    telecharger.title = 'Enregistrer ce fichier sur cet ordinateur (dossier Téléchargements)';
    const retirer = document.createElement('button');
    retirer.className = 'bouton danger';
    retirer.textContent = '✖️';
    retirer.title = 'Retirer de l\'écran';
    retirer.onclick = () => retirerEnvoi(e.id);
    actions.append(choisir, telecharger, retirer);

    carte.append(vignette, infos, actions);
    g.append(carte);
  });

  const n = etat.envois.length;
  $('vide').hidden = n > 0;
  $('compteur').textContent = n ? '(' + n + ')' : '';
  $('btn-diaporama').disabled = n === 0;
  $('btn-effacer').disabled = n === 0;
  $('btn-telecharger').disabled = n === 0;
  $('btn-telecharger').textContent = etat.coches.length
    ? '💾 Télécharger la sélection (' + etat.coches.length + ')'
    : '💾 Tout télécharger' + (n ? ' (' + n + ')' : '');
  $('btn-cocher').disabled = n === 0;
  $('btn-cocher').textContent = etat.coches.length === n && n > 0 ? '☐ Tout décocher' : '☑️ Tout cocher';
  $('btn-comparer').disabled = etat.choisis.length !== 2;
  $('btn-comparer').textContent = '⚖️ Comparer (' + etat.choisis.length + '/2)';
}

function basculerChoix(id) {
  const i = etat.choisis.indexOf(id);
  if (i >= 0) etat.choisis.splice(i, 1);
  else {
    etat.choisis.push(id);
    if (etat.choisis.length > 2) etat.choisis.shift();
  }
  dessinerGalerie();
}

function retirerEnvoi(id) {
  const i = etat.envois.findIndex((e) => e.id === id);
  if (i < 0) return;
  URL.revokeObjectURL(etat.envois[i].url);
  etat.envois.splice(i, 1);
  etat.choisis = etat.choisis.filter((c) => c !== id);
  etat.coches = etat.coches.filter((c) => c !== id);
  dessinerGalerie();
}

function toutEffacer() {
  if (!confirm('Effacer tous les envois de cet écran ?')) return;
  etat.envois.forEach((e) => URL.revokeObjectURL(e.url));
  etat.envois = [];
  etat.choisis = [];
  etat.coches = [];
  dessinerGalerie();
}

// ---------- Projection ----------

function figure(e) {
  const f = document.createElement('figure');
  let media;
  if (estImage(e)) {
    media = document.createElement('img');
    media.src = e.url;
    media.alt = 'Envoi de ' + e.animal[1];
  } else if (estPdf(e)) {
    media = document.createElement('iframe');
    media.src = e.url;
    media.title = e.nom;
  } else {
    media = document.createElement('div');
    media.className = 'grand-code';
    media.style.margin = 'auto';
    media.textContent = icone(e);
  }
  const legende = document.createElement('figcaption');
  legende.className = 'legende';
  legende.innerHTML = '<span class="pic"></span> <span class="qui"></span> <span class="nom"></span>';
  legende.children[0].textContent = e.animal[0];
  legende.children[1].textContent = e.animal[1];
  legende.children[2].textContent = estImage(e) ? '' : '— ' + e.nom;
  f.append(media, legende);
  return f;
}

function ouvrirProjection(p) {
  etat.projection = p;
  dessinerProjection();
  $('projection').hidden = false;
  $('proj-fermer').focus();
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
}

function dessinerProjection() {
  const p = etat.projection;
  const scene = $('scene');
  scene.textContent = '';
  scene.className = 'scene';
  const navigable = p.mode === 'un';
  $('proj-prec').hidden = !navigable;
  $('proj-suiv').hidden = !navigable;

  if (p.mode === 'qr') {
    const boite = document.createElement('div');
    boite.style.cssText = 'display:flex;flex-direction:column;gap:16px;margin:auto;';
    const qr = document.createElement('div');
    qr.className = 'grand-qr';
    qr.innerHTML = qrSvg(lienEnvoi(etat.code, p.prof));
    const code = document.createElement('div');
    code.className = 'grand-code';
    code.textContent = etat.code;
    boite.append(qr, code);
    if (p.prof) {
      const note = document.createElement('div');
      note.className = 'legende';
      note.textContent = '📱 Lien enseignant : à scanner avec ton smartphone';
      boite.append(note);
    }
    scene.append(boite);
  } else if (p.mode === 'un') {
    const e = etat.envois[p.index];
    if (e) scene.append(figure(e));
  } else if (p.mode === 'duo') {
    scene.classList.add('duo');
    p.ids.forEach((id) => {
      const e = etat.envois.find((x) => x.id === id);
      if (e) scene.append(figure(e));
    });
  }
}

function naviguer(sens) {
  const p = etat.projection;
  if (!p || p.mode !== 'un' || !etat.envois.length) return;
  p.index = (p.index + sens + etat.envois.length) % etat.envois.length;
  dessinerProjection();
}

function fermerProjection() {
  $('projection').hidden = true;
  etat.projection = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// ---------- Distribution vers les téléphones ----------

async function distribuer(fichier) {
  if (!fichier) return;
  if (fichier.size > TRANSFERT.TAILLE_MAX) { toast('Fichier trop lourd (max ' + TRANSFERT.taille(TRANSFERT.TAILLE_MAX) + ').'); return; }
  const ouvertes = [...etat.connexions.values()].filter((c) => c.conn.open);
  if (!ouvertes.length) { toast('Aucun téléphone connecté pour l\'instant.'); return; }
  const donnees = await fichier.arrayBuffer();
  ouvertes.forEach(({ conn }) => conn.send({ type: 'document', nom: fichier.name, mime: fichier.type || 'application/octet-stream', donnees }));
  toast('📤 « ' + fichier.name + ' » envoyé à ' + ouvertes.length + ' téléphone(s).');
}

// ---------- Commandes ----------

$('btn-qr-grand').onclick = () => ouvrirProjection({ mode: 'qr' });
$('btn-qr-prof').onclick = () => ouvrirProjection({ mode: 'qr', prof: true });

function choisirMode(mode) {
  etat.mode = mode;
  $('mode-animaux').setAttribute('aria-pressed', String(mode === 'animaux'));
  $('mode-codes').setAttribute('aria-pressed', String(mode === 'codes'));
  diffuserEtat();
}
$('mode-animaux').onclick = () => choisirMode('animaux');
$('mode-codes').onclick = () => choisirMode('codes');
$('doublons').onchange = (ev) => { etat.doublons = ev.target.checked; diffuserEtat(); };
$('btn-diaporama').onclick = () => ouvrirProjection({ mode: 'un', index: 0 });
$('btn-comparer').onclick = () => ouvrirProjection({ mode: 'duo', ids: [...etat.choisis] });
$('btn-effacer').onclick = toutEffacer;
$('btn-telecharger').onclick = telecharger;
$('btn-cocher').onclick = toutCocher;
$('proj-telecharger').onclick = () => {
  const p = etat.projection;
  if (!p || p.mode !== 'un') return;
  const e = etat.envois[p.index];
  if (e) fetch(e.url).then((r) => r.blob()).then((b) => enregistrer(b, nomsUniques()[p.index]));
};
$('proj-prec').onclick = () => naviguer(-1);
$('proj-suiv').onclick = () => naviguer(1);
$('proj-fermer').onclick = fermerProjection;

$('btn-pause').onclick = (ev) => {
  etat.pause = !etat.pause;
  ev.currentTarget.setAttribute('aria-pressed', String(etat.pause));
  ev.currentTarget.textContent = etat.pause ? '▶️ Reprendre' : '⏸️ Pause';
  diffuserEtat();
  toast(etat.pause ? 'Envois en pause.' : 'Envois rouverts.');
};

$('btn-pseudos').onclick = (ev) => {
  const actif = document.body.classList.toggle('masquer-pseudos');
  ev.currentTarget.setAttribute('aria-pressed', String(actif));
};

$('fichier-distribuer').onchange = (ev) => {
  distribuer(ev.target.files[0]);
  ev.target.value = '';
};

document.addEventListener('keydown', (ev) => {
  if ($('projection').hidden) return;
  if (ev.key === 'Escape') fermerProjection();
  else if (ev.key === 'ArrowLeft') naviguer(-1);
  else if (ev.key === 'ArrowRight') naviguer(1);
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && !$('projection').hidden) fermerProjection();
});

window.addEventListener('beforeunload', (ev) => {
  if (etat.envois.length) ev.preventDefault();
});

dessinerGalerie();
demarrer();
