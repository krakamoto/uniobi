# Prompt — Controllo costi AI

## Obiettivo

Evitare catene di fallback che moltiplicano le richieste AI e consumano token in modo imprevedibile.

## Regole

1. Massimo 6 immagini per il fallback foto-per-foto.
2. Oltre 6 immagini, un batch incompleto non deve generare una richiesta per ogni foto.
3. Massimo 10 chiamate AI complessive per job.
4. Retry massimo 4 tentativi per provider.
5. Sonnet non deve essere chiamato solo per un warning di illeggibilità.
6. Ogni job deve registrare input, output e token in cache.
7. Il log token deve sopravvivere alla cancellazione del job.
8. Il riepilogo deve essere disponibile con `npm run ai:usage`.
9. Il prompt deve richiedere output concisi.
10. I limiti devono essere configurabili da `.env`.

## Criteri di accettazione

- Un batch fallito su 38 immagini non produce 38 richieste separate.
- Il budget chiamate interrompe la catena quando viene superato.
- Sonnet viene usato solo per errori oggettivi di copertura o precisione.
- I token vengono scritti in `data/ai-usage.jsonl`.
- `npm run ai:usage` mostra totali per modello e per giorno.
- I test backend restano verdi.
