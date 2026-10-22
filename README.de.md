# LZ Room Frame

Multi-Personen-Framing für Meetingräume, aus jeder Kamera. Jede Person bekommt eine eigene Kachel, wie bei der Tile View von KI-Raumkameras. Das Bild geht als Fenster, NDI, Stream oder virtuelle Kamera hinaus, gesteuert von Crestron, Q-SYS oder dem Browser.

[English](README.md)

## Funktionen

- **Jeder Eingang, jede Auflösung:** USB/UVC-Kameras, HDMI- und SDI-Capture-Karten, IP- und PTZ-Kameras per RTSP/SRT/RTMP, Videodateien. Die App fordert das Maximum des Geräts an; das Ausgabeformat ist frei (16:9, 9:16, quadratisch, 4K …).
- **Framing wie bei KI-PTZ-Kameras:** Modi *Übersicht, Gruppe, Kacheln, Sprecher, Präsentator*. Dazu kommen Bildgrößen von Nah bis Halbtotale, Kopfluft, Rand um die Gruppe, Ruhezone, Geschwindigkeit und Übergang (weich, Blende, Schnitt). Außerdem eine Haltezeit und eine Schärfegrenze, die das Kamerabild nie über einen festen Faktor vergrößert.
- **Raster nach Personenzahl:** Raster, Raster mit Mittelbild (wie „7 Kacheln mit Übersicht"), Sprecher groß mit Leiste, Übersicht mit Leiste. Eigene Layouts zeichnet man auf einem 12 × 12-Raster. Man legt sie je Personenzahl oder fest pro Szene fest, z. B. *Gruppe groß + Nahaufnahme als Bild im Bild*.
- **Raum:** Raumgrenze, Ausschlusszonen (Glaswand, Tür, Bildschirme) und eine Mindestkopfgröße.
- **Sprecher:** kommen vom Audiosystem (Sprecherzonen, geschaltet von Q-SYS-Automixer-Gates, Crestron oder Tischmikrofonen). Alternativ experimentell über Lippenbewegung plus Raummikrofon.
- **Zweite Ausgabe (B):** ein zweites Bild aus derselben Kamera mit eigener Größe und Szene, z. B. 9:16.
- **PTZ-Auto-Tracking:** Die Erkennung steuert eine echte PTZ-Kamera per VISCA (Sony VISCA over IP UDP 52381, VISCA TCP/UDP).
- **ATEM:** Eine SuperSource-Box zeigt die Kamera auf die Hauptperson beschnitten und folgt ihr. Die Tracking-Daten gibt es zusätzlich als `TRK`-Zeilen und über `GET /api/tracking`.
- **Ausgänge:** Vollbildfenster auf jedem Bildschirm oder HDMI-Ausgang, NDI (A und B), Stream per RTMP/SRT/RTSP/UDP und unter Linux v4l2loopback. Zoom, Teams und Meet bekommen das Bild über NDI Virtual Input (Mac) bzw. NDI Webcam Input (Windows).
- **Steuerung:** TCP 4198 (ein Befehl pro Zeile), HTTP und WebSocket auf 4197, eine Web-Fernbedienung für Touchpanels. Dazu ein Q-SYS-Plugin und Crestron-Beispiele (`docs/integrations`).
- **Raumrechner:** Die App startet mit dem System, auf Wunsch versteckt im Tray, und öffnet Eingang, Szene und Ausgänge wieder.

Die Erkennung läuft lokal in einem Worker (MediaPipe EfficientDet-Lite0 + BlazeFace, GPU mit CPU-Rückfall). Es ist keine Cloud beteiligt.

## Entwicklung

```sh
npm install
npm run dev          # Vite auf 4196 + Electron
npm test
npm run dist:mac     # bzw. dist:win / dist:linux
```

NDI braucht auf dem Zielrechner die kostenlose NDI-Runtime (ndi.video).

## Stand

Geprüft unter macOS (Apple Silicon) mit einer Videodatei:
- Erkennung, alle Raster, Szenen und Programm B
- NDI A und B, mit einem NDI-Empfänger gegengeprüft
- UDP-Stream und Steuerung per TCP und HTTP
- VISCA-Pakete an einem UDP-Empfänger

**Noch nicht geprüft:**
- echte Kameras und Capture-Karten
- echte PTZ-Kamera und echter ATEM
- Q-SYS-Plugin in Designer und Crestron
- Builds für Windows und Linux

NDI® ist eine eingetragene Marke der Vizrt NDI AB. ATEM ist eine Marke von Blackmagic Design.
