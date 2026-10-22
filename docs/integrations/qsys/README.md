# Q-SYS-Plugin

1. `LZ Room Frame.qplug` nach `Dokumente/QSC/Q-Sys Designer/Plugins` kopieren und Designer neu starten.
2. Plugin aus *Plugins → LZ Room Frame* in das Design ziehen.
3. IP-Adresse des Rechners mit LZ Room Frame und Port eintragen (Standard **4198**). In der App muss unter *Steuerung* „Steuerung aus dem Netz erlauben" an sein.

| Steuerelement | Wirkung |
|---|---|
| Scene 1–12 | Szene abrufen; der Name kommt aus der App |
| Mode | Übersicht, Gruppe, Kacheln, Sprecher, Präsentator |
| Privacy / Freeze | Kamera aus (schwarzes Bild) / Bild halten |
| OutputNDI / OutputWindow | Ausgänge ein und aus |
| SpeakerZone 1–8 | Sprecherzone aktiv. Hier die Gate-Ausgänge des Automixers oder die Mic-Active-Pins der Tischmikrofone anschließen |
| Persons, Speaker | Rückmeldung: Personen im Bild, Platz der sprechenden Person |
| Command | beliebiger Befehl, z. B. `shot close` |

Sprecherzonen: In der App unter *Framing → Sprecher* „Audiosystem" wählen und im Kamerabild für jedes Mikrofon eine Zone ziehen. Zone 1 ist die zuerst gezogene. Die Person, deren Kopf in einer aktiven Zone liegt, gilt als Sprecher.

Ungeprüft: Das Plugin wurde noch nicht in Q-SYS Designer oder auf einem Core getestet.
