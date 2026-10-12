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
  pause: false,
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

function lienEnvoi(code) {
  return new URL('envoyer.html#' + code, location.href).href;
}

function qrSvg(texte) {
  const qr = qrcode(0, 'M');
  qr.addData(texte);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
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

function accueillir(conn) {
  conn.on('open', () => {
    etat.connexions.set(conn.connectionId, { conn, animal: null });
    majTelephones();
    conn.send({ type: 'etat', pause: etat.pause });
  });
  conn.on('data', (msg) => recevoir(conn, msg));
  const fin = () => {
    etat.connexions.delete(conn.connectionId);
    majTelephones();
  };
  conn.on('close', fin);
  conn.on('error', fin);
}

function recevoir(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  const info = etat.connexions.get(conn.connectionId);

  if (msg.type === 'bonjour') {
    if (info) info.animal = validerAnimal(msg.animal);
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

// N'accepte qu'un animal de la liste : rien d'autre que le pseudo ne s'affiche à l'écran.
function validerAnimal(a) {
  if (!Array.isArray(a)) return null;
  return TRANSFERT.ANIMAUX.find(([e, n]) => e === a[0] && n === a[1]) || null;
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
    infos.innerHTML = '<span aria-hidden="true"></span><span class="qui"></span><span class="quand"></span>';
    infos.children[0].textContent = e.animal[0];
    infos.children[1].textContent = e.animal[1];
    infos.children[2].textContent = heure(e.heure) + ' · ' + TRANSFERT.taille(e.taille);
    infos.title = e.nom;

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
    telecharger.download = e.nom;
    telecharger.textContent = '💾';
    telecharger.title = 'Enregistrer sur cet ordinateur';
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
  dessinerGalerie();
}

function toutEffacer() {
  if (!confirm('Effacer tous les envois de cet écran ?')) return;
  etat.envois.forEach((e) => URL.revokeObjectURL(e.url));
  etat.envois = [];
  etat.choisis = [];
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
  legende.innerHTML = '<span></span> <span class="qui"></span> <span class="nom"></span>';
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
    qr.innerHTML = qrSvg(lienEnvoi(etat.code));
    const code = document.createElement('div');
    code.className = 'grand-code';
    code.textContent = etat.code;
    boite.append(qr, code);
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
$('btn-diaporama').onclick = () => ouvrirProjection({ mode: 'un', index: 0 });
$('btn-comparer').onclick = () => ouvrirProjection({ mode: 'duo', ids: [...etat.choisis] });
$('btn-effacer').onclick = toutEffacer;
$('proj-prec').onclick = () => naviguer(-1);
$('proj-suiv').onclick = () => naviguer(1);
$('proj-fermer').onclick = fermerProjection;

$('btn-pause').onclick = (ev) => {
  etat.pause = !etat.pause;
  ev.currentTarget.setAttribute('aria-pressed', String(etat.pause));
  ev.currentTarget.textContent = etat.pause ? '▶️ Reprendre' : '⏸️ Pause';
  etat.connexions.forEach(({ conn }) => conn.open && conn.send({ type: 'etat', pause: etat.pause }));
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
