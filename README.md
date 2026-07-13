# LoL Rank Tracker – OBS Overlay

Minimalistisches, komplett transparentes OBS-Overlay für League of Legends:

- **Rank-Emblem + aktuelle LP** (z.B. „Diamant IV · 5 LP")
- **LP-Bilanz des Tages** als `+32 / −18` (Reset um Mitternacht)
- **Letzte 3 Ranked-Champs** mit grünem (Win) / rotem (Loss) Rand
- **Lane-Zähler**: wie oft du heute welche Position bekommen hast — direkt aus der Champ-Auswahl (inkl. offizieller Role-Swaps), nicht aus Riots Ingame-Schätzung

**Kein API-Key, keine Konfiguration, kein Account eintragen.** Die Daten kommen direkt vom lokalen League-Client (LCU-API). Das Overlay zeigt automatisch den Account, der gerade eingeloggt ist — beim Umloggen auf einen Smurf wechselt es mit, jede Tagesstatistik wird pro Account getrennt geführt.

## Installation

1. [Node.js](https://nodejs.org) installieren (falls noch nicht vorhanden)
2. Dieses Repository herunterladen (Code → Download ZIP) und entpacken — der Ordner kann liegen, wo du willst
3. **`install.bat` doppelklicken** — fertig. Der Tracker läuft ab sofort unsichtbar im Hintergrund und startet automatisch mit Windows.

## In OBS einbinden

1. Quellen → **+** → **Browser**
2. URL: `http://localhost:8090/`
3. Breite **650**, Höhe **140**
4. An die gewünschte Stelle ziehen — der Hintergrund ist transparent

Sobald der League-Client läuft, füllt sich das Overlay nach ~30 Sekunden automatisch.

## Eigene Rank-Embleme (optional)

Lege einfach Bilddateien in den Projektordner, deren Dateiname den englischen Tier-Namen enthält (z.B. `Mein_Diamond.png`, `emblem-gold.webp`). Sie werden automatisch erkannt. Für Tiers ohne lokale Datei wird das offizielle Emblem von CommunityDragon geladen.

## Anpassen (`config.json`)

| Option | Standard | Bedeutung |
|---|---|---|
| `port` | `8090` | Port der Overlay-URL |
| `pollSeconds` | `30` | Aktualisierungsintervall in Sekunden |
| `champCount` | `3` | Anzahl der angezeigten letzten Champs |

## Updates

Der Tracker prüft automatisch, ob es auf GitHub eine neuere Version gibt. Falls ja, erscheint unten links im Overlay dezent **„⬆ Update verfügbar"**. Zum Aktualisieren gibt es zwei Wege:

- **`update.bat` doppelklicken**, oder
- **http://localhost:8090/update** im Browser öffnen und auf „Jetzt updaten" klicken

Beides lädt die neueste Version herunter, tauscht die Dateien aus und startet den Tracker neu. Deine Einstellungen (`config.json`) und Statistiken (`state.json`) bleiben dabei erhalten.

## Deinstallieren

`uninstall.bat` doppelklicken — beendet den Tracker und entfernt den Autostart. Danach kann der Ordner einfach gelöscht werden.

## Wie es funktioniert

- `server.js` (reines Node.js, keine Abhängigkeiten) verbindet sich mit dem lokalen League-Client und stellt das Overlay unter `http://localhost:8090/` bereit
- Rank, LP und Match-Historie kommen von der LCU-API des Clients; während der Champ-Auswahl wird alle 5 Sekunden die zugewiesene Position mitgeschrieben
- LP-Änderungen werden in `state.json` pro Account aufsummiert (Gewinne und Verluste getrennt) und um Mitternacht zurückgesetzt
- Ist der Client geschlossen, zeigt das Overlay den letzten bekannten Stand

## Voraussetzungen

- Windows
- [Node.js](https://nodejs.org) 18 oder neuer
- League of Legends

## Rechtliches

LoL Rank Tracker isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
