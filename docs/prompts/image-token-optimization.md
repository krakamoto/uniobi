# Prompt — Ottimizzazione immagini e token

## Obiettivo

Ridurre i token immagine senza compromettere la trascrizione di appunti, formule e figure.

## Interventi approvati

1. Correzione orientamento EXIF.
2. Stima del colore di sfondo.
3. Rilevamento del bounding box del contenuto.
4. Crop dei soli margini esterni.
5. Fallback all’immagine originale se il crop elimina più del 2% dei pixel di contenuto.
6. Ridimensionamento massimo a 1600 px.
7. JPEG qualità 88.
8. Tracking di token input, output e cache per ogni job.

## Interventi esclusi per ora

- Rimozione automatica delle bande vuote interne.
- Riduzione globale a 1400 px.
- OCR-first.
- Vision selettiva sulle regioni.

Questi richiedono una fase di benchmark sulla qualità.

## Criteri di accettazione

- Un’immagine con ampi margini viene ritagliata.
- Un’immagine con contenuto fino ai bordi non viene ritagliata.
- Un’immagine vuota o ambigua usa il percorso sicuro.
- Nessun crop elimina più del 2% dei pixel di contenuto.
- L’output non supera 1600 px sul lato maggiore.
- Il job espone token e statistiche di elaborazione.
- Tutti i test passano.
