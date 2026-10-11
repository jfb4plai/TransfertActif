# TransfertActif

<img src="logo.svg" alt="Logo TransfertActif" width="96" align="right">

**Du téléphone à l'écran de la classe, sans compte, sans installation, sans serveur de stockage.**

TransfertActif est une adaptation PLAI de [Roucoule](https://roucoule.forge.apps.education.fr/) (forge des communs numériques éducatifs, France) : l'élève scanne un QR code projeté et sa photo arrive directement sur l'ordinateur relié au TBI ou au projecteur.

## Ce que TransfertActif ajoute à l'idée de départ

| Extension | Pour qui / pourquoi |
|---|---|
| **Mur de classe** : plusieurs élèves envoient en même temps, les envois s'affichent en galerie | Mise en commun : on projette les productions de toute la classe, pas d'une seule personne. |
| **Comparer 2 productions côte à côte** | Retour collectif sur un geste ou un résultat (dressage d'assiette, coupe, montage, schéma, cahier). |
| **Pseudonymes « animaux »** : l'élève choisit 🦊 Renard, 🐢 Tortue… jamais son prénom | Aucun nom d'élève à l'écran, et la projection reste « sans jugement nominatif ». Bouton 🙈 pour masquer aussi les animaux. |
| **Parcours élève FALC** : 3 étapes numérotées, gros boutons, pictogrammes, bouton 🔊 qui lit chaque consigne | Élèves lecteurs fragiles, DYS, allophones, enseignement spécialisé. Synthèse vocale du navigateur : rien ne part vers un service externe. |
| **Rappel « pas de visage, pas de nom »** avant chaque photo | Réflexe RGPD et droit à l'image, intégré au geste. |
| **Photo nettoyée avant envoi** : redimensionnée (2000 px max) et ré-encodée en JPEG | Envoi plus rapide **et suppression des métadonnées EXIF**, dont la position GPS du téléphone. |
| **Distribuer un document** de l'écran vers tous les téléphones connectés | Sens inverse : l'enseignant envoie la fiche procédure, la consigne ou le modèle sur le téléphone de chaque élève. |
| **Pause des envois** | Reprendre la main sur la classe sans fermer la page. |

## Fonctionnement technique

- 100 % statique (HTML/CSS/JS, aucun build). Déployable tel quel sur Vercel, GitHub Pages ou un serveur d'école.
- Transfert **pair-à-pair WebRTC** via [PeerJS](https://peerjs.com/) 1.5.4. Le serveur PeerJS ne sert qu'à la mise en relation (échange d'identifiants), les fichiers ne passent pas par lui.
- **Relais TURN désactivés volontairement.** PeerJS 1.5.4 configure par défaut des relais publics (`eu-0.turn.peerjs.com`, `us-0.turn.peerjs.com`, constaté dans le code de la version 1.5.4 le 2026-10-11). TransfertActif les retire (`OPTIONS_PAIR` dans `commun.js`) : aucun fichier ne transite par un tiers. Contrepartie : sur un réseau d'école très filtré, la connexion directe peut échouer. Dans ce cas, passer le téléphone en 4G ou ajouter le TURN de l'établissement dans `iceServers`.
- Le STUN de Google (`stun.l.google.com`) reste utilisé pour découvrir l'adresse IP publique : il voit l'IP, pas les fichiers. À remplacer par un STUN européen ou d'école si besoin.
- Rien n'est stocké : les envois vivent en mémoire de l'onglet et disparaissent à sa fermeture. Le seul stockage est le choix d'animal, en `sessionStorage` du téléphone.
- Bibliothèques embarquées dans `vendor/` (PeerJS, qrcode-generator, MIT) : aucune requête vers un CDN.
- HTTPS obligatoire en production (WebRTC et `crypto.randomUUID` exigent un contexte sécurisé).

### Points d'attention

- **Service de mise en relation** : par défaut, le serveur gratuit `0.peerjs.com` (pas de garantie de disponibilité, pas vérifiée ici). Pour un usage durable : héberger son propre serveur (`npm i peer`, quelques lignes), puis renseigner `host`/`port`/`path` dans `OPTIONS_PAIR`.
- Le code de classe (5 caractères, 31⁵ ≈ 28 millions de combinaisons) change à chaque ouverture de la page. Il n'y a pas d'authentification : quelqu'un qui voit le QR peut envoyer. D'où le bouton Pause et le bouton ✖️ par envoi.
- Taille maximale : 25 Mo par fichier.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` + `ecran.js` | Écran de classe : QR code, galerie, projection, comparaison, distribution |
| `envoyer.html` + `envoyer.js` | Parcours élève sur téléphone |
| `commun.js` | Constantes, pseudonymes, synthèse vocale, messages d'erreur |
| `transfertactif.css` | Styles (mode clair/sombre, cibles tactiles ≥ 44 px) |
| `logo.svg` | Logo : pigeon voyageur portant une photo, jaune et rouge de Liège |

## Tester en local

```bash
cd transfertactif
python3 -m http.server 8000
# Ouvrir http://localhost:8000 sur l'ordinateur.
# Pour un vrai téléphone, il faut du HTTPS : déployer (Vercel) ou passer par un tunnel.
```

Testé le 2026-10-11 dans Chromium (Playwright), avec un serveur PeerJS local : envoi d'une photo et d'un PDF, accusé de réception, galerie, comparaison, QR plein écran, pause, distribution vers le téléphone, saisie manuelle du code, mode sombre. **Pas encore testé** sur de vrais téléphones iOS/Android ni sur le réseau d'une école.

## Licence

Code : PolyForm Noncommercial 1.0.0 (voir `LICENSE`). Logo TransfertActif : tous droits réservés, comme le reste de l'identité visuelle PLAI. Bibliothèques tierces : voir `vendor/LICENCES-TIERCES.md`.
