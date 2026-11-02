# Release

## Policy

Il repository conserva solo:

1. la release stabile più recente;
2. una milestone critica di compatibilità;
3. la prima release storica.

Le release intermedie e i relativi tag vengono eliminati per evitare duplicati e confusione.

## Release conservate

| Tag | Ruolo | Contenuto |
| --- | --- | --- |
| `v2.4-android` | Ultima stabile | APK, AAB e ZIP con ciclo attività automatico e pulizia server |
| `v2.1-android` | Milestone Android 17 | Fix critico `ACCESS_LOCAL_NETWORK` per server LAN |
| `v1.0-android` | Prima release storica | Primo pacchetto Android distribuibile |

## Asset

Ogni release conservata contiene:

- `UniAi-<versione>.apk`
- `UniAi-<versione>.aab`
- `UniAi-Android-<versione>.zip`

## Download

- Ultima versione: https://github.com/krakamoto/uniobi/releases/latest
- Tutte le release conservate: https://github.com/krakamoto/uniobi/releases
