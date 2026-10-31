# Prompt operativo — Numerazione note, corsi Android e data opzionale

Agisci come senior full-stack engineer e Android developer. Modifica il progetto UniAi esistente con queste specifiche.

## Obiettivo 1 — Numerazione progressiva delle note

- Non inserire più la data nel nome file delle note generate.
- Usa un prefisso numerico a tre cifre: `001`, `002`, `003`, ...
- Il numero deve essere calcolato separatamente per ogni cartella materia.
- La prima nota di una materia deve essere `001 Titolo nota.md`.
- La note successive devono usare il numero massimo esistente + 1.
- Mantieni il titolo descrittivo nel frontmatter e nell'H1, senza prefisso numerico.
- Se una nota con lo stesso nome esiste già, incrementa il numero senza sovrascrivere.
- Aggiorna l'indice della materia ordinando le note per nome file con ordinamento numerico.
- Non usare la data nel titolo logico né nel nome file.

## Obiettivo 2 — Data lezione opzionale

- Nell'app Android la data della lezione deve essere chiaramente etichettata come opzionale.
- Non deve essere obbligatorio compilare il campo.
- Il backend deve continuare ad accettare anche una data vuota.
- La data, quando presente, resta solo nel frontmatter e nei metadati.

## Obiettivo 3 — Gestione corsi nell'app Android

- Sostituire il campo di testo libero del corso con un selettore.
- Permettere di creare nuovi corsi tramite un pulsante dedicato e una finestra di dialogo.
- Salvare i corsi localmente nelle preferenze Android.
- Mantenere il corso selezionato tra un caricamento e l'altro.
- Evitare duplicati.
- Caricare dal backend i corsi già presenti e unirli a quelli locali.
- Mostrare un placeholder quando non c'è ancora nessun corso.
- Inviare al backend il corso selezionato.

## Migliorie aggiuntive

- Etichettare chiaramente i campi opzionali.
- Aggiornare test backend per il nuovo schema dei nomi file.
- Aggiornare README e documentazione.
- Incrementare versione Android a 1.1 e ricompilare l'APK.
- Verificare che APK, backend e test siano coerenti.

## Criteri di accettazione

1. `npm test` passa.
2. Le note generate usano `001 Titolo.md`, senza data.
3. L'indice ordina le note numericamente.
4. L'app Android compila.
5. Nell'app si possono creare e selezionare corsi persistenti.
6. La data lezione può restare vuota.
7. Le modifiche vengono caricate su GitHub.
