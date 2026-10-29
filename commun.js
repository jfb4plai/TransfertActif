// TransfertActif — fonctions partagées entre l'écran (ecran.js) et le téléphone (envoyer.js).
'use strict';

const TRANSFERT = {
  PREFIXE: 'plai-transfertactif-',
  // Pas de 0/O, 1/I/L : un code lisible à voix haute et au tableau.
  ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  TAILLE_MAX: 25 * 1024 * 1024,
  // Options PeerJS. On retire volontairement les relais TURN publics de PeerJS (eu-0/us-0.turn.peerjs.com,
  // présents par défaut en 1.5.4) : sans relais, les fichiers ne transitent par aucun serveur tiers.
  // Contrepartie : sur un réseau très filtré, la connexion directe peut échouer -> voir README (TURN de l'école).
  OPTIONS_PAIR: {
    debug: 0,
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
  },
  // Pseudonymes : l'élève choisit un animal, jamais son nom.
  ANIMAUX: [
    ['🦊', 'Renard'], ['🐢', 'Tortue'], ['🦉', 'Hibou'], ['🐝', 'Abeille'],
    ['🐙', 'Pieuvre'], ['🦔', 'Hérisson'], ['🐸', 'Grenouille'], ['🦋', 'Papillon'],
    ['🐳', 'Baleine'], ['🦁', 'Lion'], ['🐧', 'Manchot'], ['🐌', 'Escargot'],
    ['🐞', 'Coccinelle'], ['🦒', 'Girafe'], ['🐿️', 'Écureuil'], ['🐬', 'Dauphin'],
    ['🐘', 'Éléphant'], ['🦅', 'Aigle'], ['🐺', 'Loup'], ['🐻', 'Ours'],
    ['🦓', 'Zèbre'], ['🐼', 'Panda'], ['🦜', 'Perroquet'], ['🐠', 'Poisson'],
    ['🐇', 'Lapin'], ['🐴', 'Cheval'],
  ],
  // Identité par code : le même couple [emoji, texte] qu'un animal, pour que l'écran n'ait qu'un seul cas à gérer.
  CODE_EMOJI: '🔖',

  // Code d'élève : lettres sans accent, chiffres et tiret, 8 caractères au plus. Aucun prénom possible en pratique.
  normaliserPseudo(saisie) {
    return (saisie || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8);
  },

  // Renvoie l'identité [emoji, texte] si c'est un animal de la liste ou un code valide, sinon null.
  identite(a) {
    if (!Array.isArray(a)) return null;
    if (a[0] === this.CODE_EMOJI) return typeof a[1] === 'string' && /^[A-Z0-9-]{1,8}$/.test(a[1]) ? [a[0], a[1]] : null;
    return this.ANIMAUX.find(([e, n]) => e === a[0] && n === a[1]) || null;
  },

  nouveauCode(n = 5) {
    const octets = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(octets, (o) => this.ALPHABET[o % this.ALPHABET.length]).join('');
  },

  // crypto.randomUUID n'existe qu'à partir d'iOS 15.4 : les iPad d'école plus anciens en ont besoin.
  uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (o) => o.toString(16).padStart(2, '0')).join('');
  },

  normaliserCode(saisie) {
    return (saisie || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  },

  idPair(code) {
    return this.PREFIXE + code.toLowerCase();
  },

  taille(octets) {
    if (octets < 1024) return octets + ' o';
    if (octets < 1024 * 1024) return Math.round(octets / 1024) + ' Ko';
    return (octets / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo';
  },

  // Lecture à voix haute des consignes (synthèse vocale du navigateur, rien ne sort de l'appareil).
  parler(texte) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texte);
    const voix = speechSynthesis.getVoices();
    const fr = voix.find((v) => v.lang === 'fr-BE') || voix.find((v) => v.lang.startsWith('fr'));
    if (fr) u.voice = fr;
    u.lang = fr ? fr.lang : 'fr-FR';
    u.rate = 0.95;
    speechSynthesis.speak(u);
  },

  // Messages d'erreur PeerJS traduits en langage clair.
  erreurLisible(err) {
    const t = err && err.type;
    if (t === 'peer-unavailable') return "L'écran de la classe est introuvable. Vérifie le code, ou demande à l'enseignant si l'écran est bien ouvert.";
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Pas de connexion au service de mise en relation. Vérifie le Wi-Fi ou la 4G.';
    if (t === 'browser-incompatible') return 'Ce navigateur ne permet pas le transfert direct. Essaie avec Chrome, Firefox ou Safari à jour.';
    if (t === 'webrtc') return "La connexion directe a échoué (réseau de l'école trop filtré ?). Essaie en 4G.";
    return 'Une erreur est survenue (' + (t || 'inconnue') + ').';
  },
};
