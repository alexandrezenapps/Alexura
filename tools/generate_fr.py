#!/usr/bin/env python3
"""Generate French localization app/i18n_fr.py for ALEZURA / JIZURA."""
import json
import os

with open('/tmp/en_data.json', encoding='utf-8') as f:
    en_data = json.load(f)

# Comprehensive French translation dictionary for English phrases
# Both exact matching and substring replacement
EN_TO_FR = {
    # Tour & Dialogs
    "A short tour of the Simple mode": "Guide rapide du mode Facile",
    "A wrong tap? Press <span class=\"kbd\">Backspace</span> or “Undo tap”. To redo from a line in the middle, press ◎ in the line list.": "Une erreur ? Appuyez sur <span class=\"kbd\">Retour</span> ou « Annuler le tap ». Pour reprendre depuis une ligne, appuyez sur ◎ dans la liste.",
    "Drag the line markers (top) to move line starts. Hold <span class=\"kbd\">Shift</span> to ignore beats": "Glissez les marqueurs de ligne (en haut) pour déplacer leur début. Maintenez <span class=\"kbd\">Maj</span> pour ignorer les temps",
    "Undo lyric and timing changes (Ctrl+Z)": "Annuler les modifications de paroles et de rythme (Ctrl+Z)",
    "Zoom out": "Dézoomer",
    "Zoom the timeline out": "Dézoomer la frise",
    "Zoom in (or scroll on the timeline)": "Zoomer (ou molette sur la frise)",
    "Zoom the timeline in": "Zoomer la frise",
    "Song title (shown on title cards and in HUD)": "Titre du morceau (affiché sur la carte de titre et le HUD)",
    "Song title": "Titre du morceau",
    "Artist name": "Nom de l'artiste",
    "Artist": "Artiste",
    "Randomize style, mood, effects and palette": "Changer le style, l'ambiance, les effets et la palette",
    "Create a variation": "Créer une variation",
    "Randomize": "Aléatoire",
    "Menu": "Menu",
    "Display mode": "Mode d'affichage",
    "Phone layout (Randomize pinned at the top, lines folded)": "Disposition mobile (Aléatoire fixé en haut, lignes repliées)",
    "Phone": "Mobile",
    "Simple mode with a focus on Randomize": "Mode épuré centré sur le bouton Aléatoire",
    "Simple": "Facile",
    "Show every setting": "Afficher tous les réglages détaillés",
    "Advanced": "Détaillé",
    "Share / save": "Partager / enregistrer",
    "The on-screen preview loops automatically.": "L'aperçu à l'écran tourne automatiquement en boucle.",
    "Split on tall frames": "Disposition sur écrans verticaux",
    "On tall frames": "Sur écrans verticaux",
    "Top / bottom": "Haut / bas",
    "Left / right": "Gauche / droite",
    "Unified look": "Harmonie visuelle",
    "Typesetting": "Typographie soignée",
    "Pick the file first; the video is written straight into it. Use this when long songs or 1080p and above fail because the browser runs out of memory (Chrome / Edge)": "Sélectionnez d'abord le fichier de destination ; la vidéo y sera directement enregistrée. Recommandé pour les morceaux longs ou le 1080p+ si la mémoire du navigateur sature (Chrome / Edge)",
    "For large videos (save straight to a file)": "Pour grandes vidéos (enregistrement direct)",
    "MP4 (large videos, save straight to a file)": "MP4 (grandes vidéos, enregistrement direct)",
    "For a character or other footage in the middle: lyrics and their effects go to the left / right on wide frames and top / bottom on tall ones, alternating line by line. Backgrounds and screen effects still cover the whole frame (the preview outlines the free area with a dotted line)": "Idéal pour incruster un personnage ou une vidéo au centre : les textes et effets se placent à gauche / droite sur écran large et en haut / bas sur écran vertical, en alternant ligne par ligne. Les fonds et effets couvrent tout le cadre (l'espace libre est marqué en pointillés).",
    "Keep the centre free (for a character)": "Libérer le centre (pour un personnage)",
    "Clear the lyrics with their line timings, per-line settings and export range (Undo or Ctrl+Z brings them back)": "Effacer les paroles, leurs minutages et leurs réglages (Annuler ou Ctrl+Z pour restaurer)",
    "Clear lyrics": "Effacer les paroles",
    "Clear lyrics, song, settings and history and start over": "Effacer les paroles, la chanson, les réglages et recommencer à zéro",
    "Reset": "Réinitialiser",
    "This clears everything below and starts over. <strong>It cannot be undone.</strong>": "Ceci effacera tout le projet et réinitialisera l'application. <strong>Cette action est irréversible.</strong>",
    "Lyrics, song title and artist": "Paroles, titre de la chanson et artiste",
    "The loaded song (including the copy kept in this browser)": "Le morceau chargé (y compris la copie locale enregistrée)",
    "Timing, per-line settings and export range": "Rythme, réglages par ligne et plage d'exportation",
    "Style, motion, palette, fonts and other settings": "Style, animation, palette, polices et autres paramètres",
    "Variation history (◀ ▶) and the lyrics / timing undo history": "Historique des variations (◀ ▶) et de l'annulation",
    "Simple / Advanced mode, preview volume and the interface language stay as they are. Saved project files (.json) are not affected.": "Le mode d'affichage, le volume d'aperçu et la langue restent inchangés. Les projets enregistrés (.json) ne sont pas supprimés.",
    "Cancel": "Annuler",
    "an 8-second instrumental part (no lyrics, background and decorations only). Without a number it lasts 4 seconds; tap sync or markers set its length": "un passage instrumental de 8 secondes (sans paroles, décorations et fond uniquement). Sans chiffre, dure 4 s ; réglable avec la synchronisation au tap ou les marqueurs",
    "Skip": "Passer",
    "Back": "Précédent",
    "Next": "Suivant",
    "Tour": "Guide",
    "Undo tap": "Annuler le tap",
    "Undo": "Annuler",
    "Redo": "Rétablir",
    "Load LRC (lyrics with timestamps) to replace the current lyrics (Undo brings them back)": "Charger un fichier LRC (paroles avec minutage) pour remplacer les paroles actuelles (Annuler permet de revenir en arrière)",
    "Load LRC": "Charger LRC",
    "Load LRC (lyrics with timestamps) or subtitle file (SRT / VTT) to replace the current lyrics (Undo brings them back). Files can also be dropped onto the window": "Charger un fichier LRC (paroles horodatées) ou sous-titres (SRT / VTT) pour remplacer les paroles (Annuler pour revenir). Vous pouvez aussi glisser-déposer le fichier",
    "Load LRC / SRT": "Charger LRC / SRT",
    "Save lyrics with line start times (.lrc). When an export range is selected, only those lines, with times from the video start": "Exporter les paroles horodatées (.lrc). Si une plage est sélectionnée, seules ces lignes seront exportées avec leur minutage",
    "Save LRC": "Exporter LRC",
    "Lyrics (LRC)": "Paroles (LRC)",
    "Drop to load": "Glissez-déposez pour charger",
    "Song (mp3, wav …), lyrics (LRC / SRT / text), or project (.json)": "Morceau (mp3, wav…), paroles (LRC / SRT / texte) ou projet (.json)",
    "When a line has several cuts, press <span class=\"kbd\">Tab</span> the moment the cut should change to set the cut time on that line too.": "Quand une ligne contient plusieurs coupes, appuyez sur <span class=\"kbd\">Tab</span> au moment où la coupe change pour caler aussi le minutage de chaque coupe.",
    "Speed": "Vitesse",
    "Playback speed while tapping": "Vitesse de lecture pendant la synchronisation",
    "Countdown": "Compte à rebours",
    "Variation theme": "Thème de variation",
    "Variation theme (when chosen, Randomize stays within that direction and turns the needed part sets on)": "Thème de variation (oriente l'aléatoire vers ce style et active les composants requis)",
    "No theme": "Aucun thème",
    "Lyric video": "Vidéo typographique",
    "Kinetic": "Cinétique",
    "Japanese style": "Style japonais",
    "Horror": "Horreur",
    "Pop": "Pop",
    "Ballad": "Ballade",
    "Variations are made within the chosen direction": "Les variations suivront cette direction",
    "Leave out decorative numbers added by layouts or decor, such as “No.01” or “#03” (numbers in the lyrics stay)": "Masquer les numéros décoratifs générés par les mises en page comme « No.01 » ou « #03 » (les chiffres des paroles sont conservés)",
    "Hide decorative numbers": "Masquer les numéros décoratifs",
    "Leave out decorative times added by layouts or decor, such as “00:12.34” (times in the lyrics stay)": "Masquer les horodatages décoratifs comme « 00:12.34 » (les heures contenues dans les paroles restent affichées)",
    "Hide decorative times": "Masquer les horodatages décoratifs",
    "Typographic parts": "Composants typographiques",
    "Kinetic parts": "Composants cinétiques",
    "Include horror effects": "Inclure les effets d'horreur",
    "About 50 motion-first parts: words move, bounce and stack one by one": "Environ 50 composants axés sur le mouvement : mots qui bondissent, s'empilent et glissent",
    "About 50 parts that use only lines, numbers and typography, in the spirit of lyric videos": "Environ 50 composants basés sur les lignes, chiffres et lettrages au style vidéo de paroles",
    "About 50 eerie parts and 3 styles. When on, Randomize adds a Horror mood": "Environ 50 composants angoissants et 3 styles. Lorsqu'il est activé, l'aléatoire propose l'ambiance Horreur",
    "Techniques marked T. When off, Randomize and Shuffle skip them": "Techniques marquées T. Si désactivé, l'aléatoire les ignore",
    "Techniques marked K. When off, Randomize and Shuffle skip them": "Techniques marquées K. Si désactivé, l'aléatoire les ignore",
    "Techniques and styles marked H. Randomize uses them only in the Horror mood": "Techniques marquées H. L'aléatoire ne les utilise qu'en ambiance Horreur",
    "Include extra parts 2": "Inclure les effets additionnels 2",
    "Parts added in v0.12 (marked E2). New typographic, kinetic, horror, and Japanese motif parts are only used when their own switch is also on": "Composants ajoutés en v0.12 (marqués E2). Les composants typographiques, cinétiques, d'horreur et japonais ne sont utilisés que si leur propre interrupteur est actif",
    "Include extra parts": "Inclure les effets additionnels",
    "Japanese motifs": "Motifs japonais",
    "Export MP4": "Exporter MP4",
    "PNG sequence": "Séquence PNG",
    "Transparent PNG layers": "Calques PNG transparents",
    "Color key background": "Fond d'incrustation couleur",
    "Aspect ratio": "Format d'image",
    "Resolution": "Résolution",
    "Frame rate": "Images par seconde",
    "Lyrics language": "Langue des paroles",
    "Auto-detect": "Détection auto",
}

def translate_str(text):
    if not isinstance(text, str):
        return text
    # Direct match
    if text in EN_TO_FR:
        return EN_TO_FR[text]
    # Check partial replacements
    t = text
    for en_sub, fr_sub in EN_TO_FR.items():
        if en_sub in t:
            t = t.replace(en_sub, fr_sub)
    return t

# Build the dictionaries
body_fr = {}
for k, v in en_data['BODY'].items():
    body_fr[k] = translate_str(v)

ui_fr = {}
for k, v in en_data['UI'].items():
    ui_fr[k] = translate_str(v)

export_fr = {}
for k, v in en_data['EXPORT'].items():
    export_fr[k] = translate_str(v)

# Define French Styles & Moods
styles_fr = {
    'hrRuin': ('Ruines', 'Gris-vert délavé, rouge rouille et empattements réverbérants'),
    'hrNightRec': ('Enregistrement Nocturne', 'Écran noir profond, blanc et rouge de caméra de surveillance, bruit statique'),
    'hrCurse': ('Lettre Maudite', 'Papier jauni, encre délavée et écriture rouge sombre'),
    'noir': ('Noir Chromatique', 'Noir et blanc avec décalages cyan et ambre'),
    'crimson': ('Signal Carmin', 'Rouge profond, polices monochromes et données corrompues'),
    'caution': ('Avertissement', 'Jaune, rouge, bleu et graphismes de tableau de bord'),
    'magenta': ('Pop Magenta', 'Rose vif, polices rondes et épaisses, lignes indicatrices'),
    'paper': ('Papier & Encre', 'Texture papier, indigo, magenta et ombres à empattement'),
    'hud': ('HUD Sombre', 'Anthracite, bordures fines, accents orange et éclipse'),
    'mint': ('Terminal Menthe', 'Noir, sarcelle, citron vert et balayage radar'),
    'specimen': ('Spécimen Typo', 'Fond encré avec annotations à empattements'),
    'transit': ('Transit', 'Olive et jaune, panneaux directionnels et demi-teintes'),
    'blueprint': ('Plan Bleu', 'Collage graphique bleu, blanc et noir'),
    'rouge': ('Dégradé Rouge', 'Dégradé gris clair et rouge avec capsules géométriques'),
    'mono': ('Mono RVB', 'Espace gris, empattements blancs et forte séparation RVB'),
    'sakura': ('Sakura', 'Rose cerisier doux et prune, polices arrondies et serif'),
    'ocean': ('Abysses', 'Bleu marine, cyan lumineux, bulles et sans-serif épuré'),
    'sunset': ('Coucher de Soleil', 'Dégradé orange à violet, serif gras et contre-jour'),
    'forest': ('Notes Sylvestres', 'Vert mousse, papier naturel et traits de crayon'),
    'vapor': ('Vaporwave', 'Rose et bleu pastel avec lueur nostalgique VHS'),
    'newsprint': ('Papier Journal', 'Papier grisâtre, noir et rouge, trames et coquilles'),
    'synth80': ('Synthwave 80s', 'Fond noir, néons magenta et cyan avec lignes de scan'),
    'kraft': ('Papier Kraft', 'Papier chaud, tampons rouge et indigo, ruban adhésif'),
    'candy': ('Bonbon', 'Menthe et pastels fruités avec typographie rebondissante'),
    'acid': ('Acid', 'Noir, vert acide et magenta avec polices brutes et abrasives'),
    'sumi': ('Encre & Vermillon', 'Papier washi japonais, calligraphie au pinceau et sceau rouge'),
    'gold': ('Nuit Dorée', 'Noir profond, dorure à la feuille, serif ivoire et étincelles'),
}

moods_fr = {
    'glitch': 'Glitch', 'calm': 'Calme', 'pop': 'Pop', 'graphic': 'Graphique',
    'editorial': 'Éditorial', 'emotional': 'Émotionnel', 'chaos': 'Chaos', 'horror': 'Horreur',
}

title_fr = 'ALEZURA — Créateur de vidéos de paroles animées'
desc_fr = 'Transformez des paroles en vidéos de paroles animées dans votre navigateur et exportez en MP4.'
sample_fr = 'Je me souviens de/la couleur de l’aube\nUne voix lointaine a résonné dans la nuit\nDis-moi, est-il encore temps ?\nOn ne peut pas finir en restant *transparent* !'

# Generate app/i18n_fr.py file content
out = []
out.append('"""French localization for ALEZURA / JIZURA."""')
out.append(f'TITLE = {repr(title_fr)}')
out.append(f'DESCRIPTION = {repr(desc_fr)}')
out.append(f'SAMPLE = {repr(sample_fr)}')
out.append(f'MOODS = {repr(moods_fr)}')
out.append(f'STYLES = {repr(styles_fr)}')
out.append('BODY = ' + json.dumps(body_fr, ensure_ascii=False, indent=4))
out.append('UI = ' + json.dumps(ui_fr, ensure_ascii=False, indent=4))
out.append('EXPORT = ' + json.dumps(export_fr, ensure_ascii=False, indent=4))

with open('app/i18n_fr.py', 'w', encoding='utf-8') as f:
    f.write('\n\n'.join(out) + '\n')

print('Generated app/i18n_fr.py with:', len(body_fr), 'body strings,', len(ui_fr), 'ui strings,', len(export_fr), 'export strings')
