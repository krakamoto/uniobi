# UniAi Android

Client Android nativo per UniAi. Permette di scattare o selezionare foto degli appunti, caricarli sul server e salvare la nota generata da Gemini nel vault Obsidian.

Versione: **2.5**

## Build

Requisiti:
- JDK 17
- Android SDK 35
- Build Tools 35.0.0
- Gradle wrapper incluso

```bash
cd android
# Creare local.properties con sdk.dir=/percorso/android-sdk se non si usa Android Studio
./gradlew assembleDebug
```

APK:

```text
app/build/outputs/apk/debug/app-debug.apk
```

Installazione:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Configurazione

1. Avviare il backend UniAi.
2. Aprire l’app e impostare l’URL:
   - emulatore: `http://10.0.2.2:3000`;
   - telefono reale: `http://IP_LAN_DEL_SERVER:3000`.
3. Se il backend ha `APP_PASSWORD`, inserire la password.
4. Selezionare una o più foto dalla galleria oppure scattarle con la fotocamera.
5. Scegliere un corso dal menu oppure crearne uno nuovo con **+ Corso**.
6. La data della lezione è opzionale.
7. Compilare gli altri metadati e premere **Metti in coda**.
8. Le foto vengono compresse, salvate localmente e caricate automaticamente appena il server è raggiungibile.
9. Aprire il job dallo storico, controllare il Markdown e premere **Salva nel vault**.

I corsi creati restano salvati sul telefono. Se il backend contiene già corsi nello storico, vengono importati automaticamente nel menu.

## Sicurezza di rete

L'app legge l'SSID del Wi-Fi corrente e contatta il backend solo se la rete è stata autorizzata, se è attiva una VPN o se si usa un emulatore locale. Su Wi-Fi pubblici o reti sconosciute la coda locale resta sospesa e non viene inviato alcun dato.

- tema chiaro, scuro o automatico;
- modalità compatibilità rete locale con avviso di sicurezza;
- test connessione server dalle impostazioni;
- certificate pin TLS opzionale;
- test strumentale di smoke test incluso;
- tab Carica, Coda, Attività e Impostazioni.

Su Android 17 è inoltre necessario concedere il permesso **Rete locale** (`ACCESS_LOCAL_NETWORK`). Senza questo permesso qualsiasi connessione a `192.168.x.x` viene bloccata dal sistema.

Per leggere l'SSID su Android moderno servono contemporaneamente:
- permesso di posizione precisa;
- permesso Dispositivi Wi-Fi vicini su Android 13+;
- posizione di sistema attiva.

La schermata Rete Wi-Fi mostra lo stato dei tre requisiti e apre direttamente le impostazioni di sistema se la posizione è disattivata.

Se Android 17 non espone l'SSID nonostante i permessi, l'app calcola un'impronta locale basata su interfaccia Wi-Fi, gateway, DNS e DHCP. L'utente può autorizzare esplicitamente questa impronta dalla schermata Rete Wi-Fi. L'impronta è una misura di affidabilità, non una garanzia crittografica: per la massima sicurezza usare HTTPS o una VPN.

## Sicurezza

- La chiave Gemini non è mai presente nell’APK.
- Il backend è l’unico a contattare Gemini.
- L’HTTP in chiaro è abilitato solo per facilitare lo sviluppo locale; in produzione usare HTTPS e un reverse proxy.
- Le credenziali di sessione sono conservate nelle preferenze private dell’app.

## Limiti

- La coda offline richiede che l’app non venga forzata a chiudere; Android può ritardare i job in background per risparmiare batteria.
- L’app usa le API native Android senza librerie AndroidX per mantenere il progetto leggero.
- La build è stata verificata; il test UI su dispositivo non è stato eseguito perché non c’era un emulatore/telefono collegato.
