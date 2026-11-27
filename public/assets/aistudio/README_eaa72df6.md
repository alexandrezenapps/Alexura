# AI Studio Master Skills — Pack de 20 compétences

Ce pack contient 20 fichiers `SKILL.md` indépendants, plus un guide d'intégration.

## Contenu
Chaque dossier numéroté contient un `SKILL.md` avec un nom, une description et des instructions spécialisées.

## Utilisation avec Google AI Studio
Google AI Studio Build n'expose pas nécessairement un gestionnaire natif permettant d'installer directement un dossier de Skills comme une extension. Utilise ces fichiers comme ressources d'instructions dans ton workflow :
1. Décompresse l'archive.
2. Ouvre le projet dans Google AI Studio.
3. Ajoute le ou les fichiers `SKILL.md` pertinents au contexte du projet si l'interface permet l'ajout de fichiers.
4. Sinon, copie la compétence choisie dans les instructions système ou dans le prompt de travail.
5. Pour un projet complexe, ajoute au contexte uniquement les Skills utiles à la tâche afin d'éviter des instructions contradictoires ou trop longues.

## Utilisation avec Gemini Skills
Si ton compte Gemini propose l'import de Skills, suis l'interface officielle de Gemini pour importer les fichiers/dossiers compatibles. La disponibilité et le format accepté peuvent varier selon le produit, le compte et le déploiement.

## Ordre conseillé
- Cadrage produit : 11 Product Management
- Design : 01 UI/UX Premium, 07 Animation & Motion, 17 Accessibility & i18n
- Développement : 02 Frontend, 03 Backend, 04 Database, 06 Flutter, 12 API
- IA et médias : 05 AI Agents, 13 Audio, 14 Image, 15 Video
- Qualité et livraison : 08 Security, 09 Performance, 10 QA, 16 Analytics, 18 DevOps, 19 Documentation, 20 Debugging

## Prompt de chargement conseillé
« Utilise le fichier SKILL.md [nom] comme guide de travail pour cette tâche. Respecte ses étapes et livrables. Commence par inspecter le projet et ses contraintes. Ne prétends pas avoir exécuté une action ou un test sans preuve. Signale clairement les hypothèses et les points qui nécessitent ma validation. »

## Important
Ces Skills sont des fichiers d'instructions, pas des extensions exécutables. Ils ne donnent pas automatiquement accès à des outils, API, clés, permissions ou fonctions non disponibles dans l'environnement.
