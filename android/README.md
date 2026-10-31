# UniAi Android

Client Android nativo per UniAi. Permette di scattare o selezionare foto degli appunti, caricarli sul server e salvare la nota generata da Gemini nel vault Obsidian.

Versione: **1.1**

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
4. Selezionare o scattare le foto.
5. Scegliere un corso dal menu oppure crearne uno nuovo con **+ Corso**.
6. La data della lezione è opzionale.
7. Compilare gli altri metadati e premere **Carica e analizza**.
8. Aprire il job dallo storico, controllare il Markdown e premere **Salva nel vault**.

I corsi creati restano salvati sul telefono. Se il backend contiene già corsi nello storico, vengono importati automaticamente nel menu.

## Sicurezza

- La chiave Gemini non è mai presente nell’APK.
- Il backend è l’unico a contattare Gemini.
- L’HTTP in chiaro è abilitato solo per facilitare lo sviluppo locale; in produzione usare HTTPS e un reverse proxy.
- Le credenziali di sessione sono conservate nelle preferenze private dell’app.

## Limiti

- Non c’è ancora una coda offline: se la rete manca, l’upload fallisce.
- L’app usa le API native Android senza librerie AndroidX per mantenere il progetto leggero.
- La build è stata verificata; il test UI su dispositivo non è stato eseguito perché non c’era un emulatore/telefono collegato.
