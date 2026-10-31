# Prompt operativo — Divisione automatica in più note Obsidian

Agisci come senior full-stack engineer e Android developer. Modifica UniAi affinché un singolo job composto da più immagini possa generare una o più note Obsidian.

## Obiettivo

Quando l'utente carica un gruppo di immagini dello stesso corso:

- analizza tutti i contenuti;
- se le immagini riguardano lo stesso argomento, genera una sola nota;
- se contengono argomenti chiaramente distinti, dividile in note atomiche separate;
- massimo 6 note per job;
- ogni nota deve avere titolo, riassunto, contenuto Markdown, tag, alias, concetti chiave e wikilink propri;
- le note dello stesso gruppo devono potersi collegare tra loro tramite wikilink;
- la numerazione `001`, `002`, ... deve essere assegnata per materia al momento del salvataggio;
- l'indice della materia deve includere tutte le note generate.

## Backend

- Estendere il contratto JSON dell'AI con un array `notes`.
- Mantenere compatibilità con risposte a nota singola.
- Validare e normalizzare ogni nota.
- Salvare tutte le note generate con numerazione progressiva.
- Aggiornare una sola volta l'indice della materia.
- Salvare nel database l'elenco completo dei percorsi generati.
- Restituire `vaultPaths` nell'API di salvataggio.
- Supportare la modifica di più note tramite API.
- Aggiornare i test.

## Interfacce

- Web e Android devono mostrare il numero di note generate.
- Il dettaglio del job deve elencare tutte le note separate.
- Il pulsante di salvataggio deve salvare tutte le note.
- Per le note multiple mostrare i contenuti in anteprima; per la nota singola mantenere l'editor Markdown.

## Criteri di accettazione

1. Una risposta AI con due argomenti produce due note separate.
2. Le note vengono nominate `001 Titolo.md` e `002 Titolo.md`.
3. I wikilink tra le nuove note vengono conservati.
4. L'indice contiene entrambe le note.
5. L'API restituisce tutti i percorsi salvati.
6. Web e Android compilano.
7. Test backend superati.
8. Modifiche caricate su GitHub.
