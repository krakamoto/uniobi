# Prompt riorganizzato — Ciclo di vita delle attività UniAi

## Obiettivo

Rendere la tab **Attività** auto-pulente e ottimizzare lo spazio sul server senza mai cancellare le note già salvate nel vault Obsidian.

## Regole funzionali

1. Ogni attività è identificata da un job.
2. Un job non ancora salvato nel vault conserva:
   - immagini originali caricate;
   - risultato AI temporaneo;
   - markdown e metadati.
3. La rimozione manuale di un job non salvato deve eliminare:
   - record del job;
   - immagini originali;
   - nota temporanea e risultati AI;
   - file temporanei relativi al job.
4. Il salvataggio nel vault deve:
   - scrivere note e figure nel vault;
   - aggiornare gli indici delle materie;
   - conservare note e figure nel vault;
   - eliminare automaticamente il job dalla tab Attività;
   - eliminare dal server immagini originali e risultati temporanei.
5. La rimozione manuale di un job già salvato deve eliminare solo i dati temporanei del server, mai i file del vault.
6. I file del vault non devono essere cancellati da nessun endpoint di gestione attività.
7. L’interfaccia deve spiegare chiaramente la differenza tra server e vault.
8. I client Android e Web devono chiudere il dettaglio dopo il salvataggio o la rimozione e ricaricare la cronologia.
9. Il backend deve restituire un messaggio esplicito e un flag `autoRemoved`.
10. I test devono verificare:
    - il job sparisce dopo il salvataggio;
    - la nota resta nel vault;
    - un job non salvato può essere eliminato;
    - dopo l’eliminazione il job restituisce 404.

## Endpoint

- `POST /api/jobs/:id/save-to-vault`
- `DELETE /api/jobs/:id`

## Criteri di accettazione

- La tab Attività non contiene job già salvati.
- Le note e le figure restano nel vault.
- Le immagini originali non occupano più spazio sul server dopo il salvataggio.
- Un job non salvato rimosso manualmente non lascia dati temporanei.
- Android e Web UI mostrano messaggi coerenti.
- Tutti i test backend passano.
